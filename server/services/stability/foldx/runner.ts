import path from "path";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";
import { buildModelBudgetMs, clampToJobRemaining, FOLDX_REPAIR_MAX_RESIDUES, repairFitsBudget } from "./budget.ts";
import { isAlphaFoldModel } from "./estimate.ts";
import {
  canRetryFoldxAfterRepair,
  classifyFoldxFailure,
  describeFoldxFailure,
  foldxCrashContext,
  parseRepairProgress,
  tailOutput,
  type FoldxRepairDiagnostic,
  type FoldxRunContext
} from "./failure.ts";
import crypto from "crypto";
import { AMINO_ACID_1_TO_3 } from "../../../../src/shared/aminoAcids.ts";
import { CONFIG, resolveFoldxConcurrency } from "../../../config.ts";
import { Semaphore } from "../../../utils.ts";
import { killProcessTree } from "../../../utils/process-tree.ts";
import { meterChildProcess } from "../../infra/job-meter.ts";
import { preemptBackgroundFoldx } from "./preemption.ts";
import { inflightRepair, joinWaitMs } from "./inflight-repairs.ts";
import {
  parseResiduesFromPdbMaybeAsync,
  parseAtomsFromPdb
} from "../../structure/pdb-parser.ts";
import { calculateLocalSidechainRmsd } from "../../structure/structural-diff.ts";
import {
  getMutantFromCache,
  writeMutantToCache,
  getFoldxCacheKey,
  getRepairCacheKey,
  getRepairedStructureFromCache,
  writeRepairedStructureToCache
} from "./cache.ts";
import {
  getFoldxExecutionTarget,
  detectFoldxBinaryAndDir
} from "./detector.ts";
import {
  type FoldxParsedResult,
  parseFoldxDifFile
} from "./parser.ts";
import {
  cleanPdbForFoldX,
  countIncompleteResidues,
  detectBFactorProvenance,
  injectBFactorsFromWtPdb
} from "./pdb-utils.ts";

const NICE_BIN = "/usr/bin/nice";

/**
 * The lowest CPU priority, for background work beside a person's job. `nice -n 19` where it exists, so
 * every thread the process starts inherits it; elsewhere `execFileAsync` lowers the priority after spawn.
 * Measured on the OCI host (2 vCPU, FoldX concurrency 1, 2026-10-18, n = 3): a RepairPDB at nice 19 beside
 * interactive BuildModels slowed them 1.5-2.6% (SOD1 10.05 -> 10.20 s, p53 35.3 -> 36.2 s, 6N7E 7.50 ->
 * 7.66 s) and itself still got 96% of a core.
 */
function lowPriorityTarget(target: { file: string; args: string[] }): { file: string; args: string[] } {
  return process.platform === "linux" && fs.existsSync(NICE_BIN)
    ? { file: NICE_BIN, args: ["-n", "19", target.file, ...target.args] }
    : target;
}

function execFileAsync(
  file: string,
  args: string[],
  options: { timeout?: number; cwd?: string; signal?: AbortSignal; lowPriority?: boolean }
): Promise<{ stdout: string; stderr: string }> {
  const { lowPriority, ...execOptions } = options;
  const direct = getFoldxExecutionTarget(file, args);
  const target = lowPriority ? lowPriorityTarget(direct) : direct;
  return new Promise((resolve, reject) => {
    let killed = false;
    const child = execFile(target.file, target.args, { maxBuffer: 16 * 1024 * 1024, ...execOptions }, (err, stdout, stderr) => {
      if (err) {
        if (!killed) {
          killed = true;
          killProcessTree(child.pid);
        }
        // execFile hands the output it collected to the callback, not to the error: a rejection that
        // dropped it left every caller reading `err.stdout` / `err.stderr` as undefined, so a killed
        // RepairPDB logged nothing but its own message. (promisify(execFile) attaches them the same way.)
        Object.assign(err, { stdout, stderr });
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
    // Its memory counts toward the queue job running it (job-meter.ts); a no-op outside a job.
    meterChildProcess(child);
    if (lowPriority && target === direct && child.pid) {
      try { os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW); } catch { /* best effort: no nice on this host */ }
    }

    if (options.signal) {
      const onAbort = () => {
        if (!killed) {
          killed = true;
          killProcessTree(child.pid);
        }
      };
      options.signal.addEventListener("abort", onAbort);
      const cleanListener = () => {
        options.signal?.removeEventListener("abort", onAbort);
      };
      child.on("exit", cleanListener);
      child.on("error", cleanListener);
    }
  });
}

// Derived from the queue's bound and capped by the CPU count (server/config.ts, resolveFoldxConcurrency).
export const biophysicalSemaphore = new Semaphore(resolveFoldxConcurrency());

export interface FoldxOptions {
  pH?: number;
  temperature?: number;
  ionicStrength?: number;
  seed?: number;
}

/**
 * Reports what the FoldX leg is doing, for the UI to render verbatim.
 *
 * The phase vocabulary lives in `src/shared/foldxPhase.ts` so the worker, the job record and the
 * client all name the same four states. Awaited, so a caller that persists the phase cannot have
 * its write overtaken by the next phase.
 */
export type FoldxPhaseReporter = (phase: "repairing" | "modelling" | "finalizing") => void | Promise<void>;

const inFlightFoldx = new Map<string, Promise<any>>();

/**
 * BuildModel writes a paired wild type beside every variant it builds: `WT_wt_1_0.pdb` for
 * `wt_1_0.pdb` (FoldX 5.x), `WT_wt_1.pdb` for `wt_1.pdb` (FoldX 4.x). The pair shares the run, so
 * run 0's wild type is read for run 0's variant. Null when FoldX wrote none.
 */
async function readPairedWildType(variantPath: string): Promise<string | null> {
  const pairedPath = path.join(path.dirname(variantPath), `WT_${path.basename(variantPath)}`);
  try {
    return fs.existsSync(pairedPath) ? await fs.promises.readFile(pairedPath, "utf8") : null;
  } catch (err: any) {
    console.warn(`[Biophysical Modeling] Could not read FoldX's paired wild type ${pairedPath}:`, err?.message);
    return null;
  }
}

export async function generateMutantPdb(
  wtPdb: string,
  validatedMutation: string,
  uniprotId: string | undefined,
  jobDir: string,
  signal?: AbortSignal,
  options?: FoldxOptions,
  /**
   * Progress callback. Optional and additive: every existing caller keeps working, and a caller
   * that cannot persist a phase (a benchmark, a script) simply omits it.
   */
  onPhase?: FoldxPhaseReporter
): Promise<{ pdb: string; wtReferencePdb?: string | null; ddG: number | null; status: "success"; foldedResidueIndex: number; resolvedChain?: string; energetics?: any }> {
  if (signal?.aborted) {
    throw new Error("Aborted");
  }

  const normalizedPdb = cleanPdbForFoldX(wtPdb);
  const pdbHash = crypto.createHash("sha256").update(normalizedPdb).digest("hex");
  const cacheKey = getFoldxCacheKey(pdbHash, validatedMutation, options);
  
  const cached = await getMutantFromCache(cacheKey);
  if (cached) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Biophysical Caching] Cache Hit for mutant mutation: ${validatedMutation}`);
    }
    return cached;
  }

  let promise = inFlightFoldx.get(cacheKey);
  if (!promise) {
    promise = (async () => {
      try {
        const seed = options?.seed !== undefined ? options.seed : 12345;
        const result = await generateMutantPdbInternal(wtPdb, validatedMutation, uniprotId, jobDir, undefined, { ...options, seed }, onPhase);
        writeMutantToCache(cacheKey, result);
        return result;
      } finally {
        inFlightFoldx.delete(cacheKey);
      }
    })();
    inFlightFoldx.set(cacheKey, promise);
  } else {
    console.log(`[Biophysical Deduplication] Joining in-flight FoldX task for cache key: ${cacheKey}`);
  }

  if (signal) {
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new Error("Aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise!
        .then((res) => {
          signal.removeEventListener("abort", onAbort);
          resolve(res);
        })
        .catch((err) => {
          signal.removeEventListener("abort", onAbort);
          reject(err);
        });
    });
  }

  return promise;
}

/**
 * Everything FoldX needs beside the structure: the validated binary, `molecules/` and `rotabase.txt`
 * linked into `jobDir`, and the environment arguments. One place for the interactive job and the
 * background repair, so the two cannot disagree about how FoldX is invoked (and so share a repair-cache key).
 */
function prepareFoldxWorkdir(jobDir: string, options?: FoldxOptions): { foldxBin: string; extraArgs: string[] } {
  const { foldxBin, foldxDir } = detectFoldxBinaryAndDir();

  // Prevent executing Windows scripts on POSIX/Linux platforms
  if (process.platform !== "win32" && (foldxBin.toLowerCase().endsWith(".cmd") || foldxBin.toLowerCase().endsWith(".bat"))) {
    throw new Error(`Invalid FoldX binary on ${process.platform}: Windows batch script '${path.basename(foldxBin)}' cannot be executed on Linux. Please install a Linux FoldX executable or mount it into /app/tools/foldx/ or /app/tools/foldx_linux/`);
  }

  // Fail fast if the binary does not exist (P0-1.5)
  if (!fs.existsSync(foldxBin)) {
    throw new Error(`FoldX binary not found or not executable at: ${foldxBin}`);
  }

  if (process.platform !== "win32") {
    try {
      fs.chmodSync(foldxBin, 0o755);
    } catch (_) {
      // Ignored if mounted in a read-only filesystem (:ro)
    }
  }

  if (foldxDir || process.cwd()) {
    const candidateMolecules = [
      foldxDir ? path.join(foldxDir, "molecules") : "",
      path.join(process.cwd(), "tools", "foldx_linux", "molecules"),
      path.join(process.cwd(), "tools", "foldx", "molecules"),
      "/app/tools/foldx_linux/molecules",
      "/app/tools/foldx/molecules",
      path.join(process.cwd(), "molecules")
    ].filter(p => p && fs.existsSync(p));
    if (candidateMolecules.length === 0) {
      throw new Error("FoldX parameter files missing: molecules/ directory not found in tools/foldx, tools/foldx_linux, or /app/tools/foldx.");
    }
    const sourceMolecules = candidateMolecules[0];
    const destMolecules = path.join(jobDir, "molecules");
    if (!fs.existsSync(destMolecules)) {
      try {
        console.log(`[Biophysical Modeling] Creating symlink/junction for FoldX molecules parameters...`);
        const type = process.platform === "win32" ? "junction" : "dir";
        fs.symlinkSync(sourceMolecules, destMolecules, type);
      } catch (err: any) {
        console.warn(`[Biophysical Modeling] Symlink molecules failed, falling back to copy: ${err.message}`);
        fs.cpSync(sourceMolecules, destMolecules, { recursive: true });
      }
    }

    const candidateRotabase = [
      foldxDir ? path.join(foldxDir, "rotabase.txt") : "",
      path.join(process.cwd(), "tools", "foldx", "rotabase.txt"),
      path.join(process.cwd(), "tools", "foldx_linux", "rotabase.txt"),
      path.join("/app/tools/foldx", "rotabase.txt"),
      path.join("/app/tools/foldx_linux", "rotabase.txt"),
      path.join(process.cwd(), "rotabase.txt")
    ].filter(p => p && fs.existsSync(p));
    if (candidateRotabase.length === 0) {
      throw new Error("FoldX parameter files missing: rotabase.txt not found in tools/foldx, tools/foldx_linux, or /app/tools/foldx.");
    }
    const sourceRotabase = candidateRotabase[0];
    const destRotabase = path.join(jobDir, "rotabase.txt");
    if (!fs.existsSync(destRotabase)) {
      try {
        console.log(`[Biophysical Modeling] Creating symlink for FoldX rotabase from ${sourceRotabase}...`);
        fs.symlinkSync(sourceRotabase, destRotabase, "file");
      } catch (err: any) {
        console.warn(`[Biophysical Modeling] Symlink rotabase failed, falling back to copy: ${err.message}`);
        fs.copyFileSync(sourceRotabase, destRotabase);
      }
    }
  }

  const extraArgs: string[] = ["--timeSeedRotabase=false"];
  if (options?.pH !== undefined && options?.pH !== null) {
    extraArgs.push(`--pH=${options.pH}`);
  }
  if (options?.temperature !== undefined && options?.temperature !== null) {
    extraArgs.push(`--temperature=${options.temperature}`);
  }
  if (options?.ionicStrength !== undefined && options?.ionicStrength !== null) {
    extraArgs.push(`--ionStrength=${options.ionicStrength}`);
  }
  return { foldxBin, extraArgs };
}

/**
 * Wait for a background RepairPDB of this structure that is already running on the spare core, when that
 * is predicted to be quicker than BuildModel completing the side chains itself (`joinWaitMs`). Returns the
 * repaired template; `pdb: null` when it waited and the repair did not finish (the wait is still reported, since
 * it came out of the job's time); or null when it did not wait at all (no repair in flight, or not worth it). The wait never exceeds what it could save, and always leaves the job its fallback.
 */
async function joinInflightRepair(
  repairCacheKey: string,
  input: {
    residueCount: number;
    incompleteResidues: number;
    emulated: boolean;
    jobStartedAt: number;
    signal?: AbortSignal;
    onPhase?: FoldxPhaseReporter;
  }
): Promise<{ pdb: string | null; waitedMs: number } | null> {
  const flight = inflightRepair(repairCacheKey);
  if (!flight) return null;
  const startedAt = Date.now();
  const waitMs = joinWaitMs({
    now: startedAt,
    expectedEndAt: flight.expectedEndAt,
    unrepairedExtraMs: input.incompleteResidues * CONFIG.timeouts.foldxEmulatedMsPerIncompleteResidue,
    jobRemainingMs: CONFIG.timeouts.foldxSec * 1000 - (startedAt - input.jobStartedAt),
    fallbackMs: buildModelBudgetMs({ residueCount: input.residueCount, numberOfRuns: 5, emulated: input.emulated, incompleteResidues: input.incompleteResidues })
  });
  if (waitMs === 0) {
    console.log(`[Biophysical Modeling] A background RepairPDB of this structure is running but would not finish before an unrepaired BuildModel; not waiting for it.`);
    return null;
  }
  console.log(`[Biophysical Modeling] Waiting up to ${(waitMs / 1000).toFixed(0)} s for the background RepairPDB of this structure (${input.incompleteResidues} incomplete residues it saves rebuilding).`);
  await input.onPhase?.("repairing");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      flight.done,
      new Promise<void>(resolve => { timer = setTimeout(resolve, waitMs); }),
      new Promise<void>((_resolve, reject) => {
        if (!input.signal) return;
        onAbort = () => reject(new Error("Aborted"));
        if (input.signal.aborted) onAbort();
        else input.signal.addEventListener("abort", onAbort, { once: true });
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) input.signal?.removeEventListener("abort", onAbort);
  }
  const cached = await getRepairedStructureFromCache(repairCacheKey);
  const waitedMs = Date.now() - startedAt;
  if (!cached) {
    console.log(`[Biophysical Modeling] The background RepairPDB did not finish inside ${(waitedMs / 1000).toFixed(0)} s; continuing unrepaired.`);
    return { pdb: null, waitedMs };
  }
  console.log(`[Biophysical Modeling] Joined the background RepairPDB after ${(waitedMs / 1000).toFixed(0)} s; using the repaired template.`);
  return { pdb: cached.pdb, waitedMs };
}

interface RepairRun {
  diagnostic: FoldxRepairDiagnostic;
  /** The repaired coordinates, when RepairPDB wrote them. */
  repairedPdb?: string;
}

/**
 * One RepairPDB invocation in `jobDir` (which holds `wt.pdb`). A FoldX failure is returned as a
 * diagnostic, never thrown; only an abort is rethrown, because the caller must stop too.
 */
async function runRepairPdb(input: {
  foldxBin: string;
  extraArgs: string[];
  jobDir: string;
  budgetMs: number;
  signal?: AbortSignal;
  /** Background work: lowest CPU priority (see lowPriorityTarget). */
  lowPriority?: boolean;
}): Promise<RepairRun> {
  const { foldxBin, extraArgs, jobDir, budgetMs, signal, lowPriority } = input;
  console.log(`[Biophysical Modeling] Running FoldX RepairPDB: ${foldxBin}...`);
  const startedAt = Date.now();
  try {
    const repairRes = await execFileAsync(foldxBin, [
      "--command=RepairPDB",
      "--pdb=wt.pdb",
      ...extraArgs
    ], {
      timeout: budgetMs,
      cwd: jobDir,
      signal,
      lowPriority
    });
    const repairedPdbPath = path.join(jobDir, "wt_Repair.pdb");
    if (fs.existsSync(repairedPdbPath)) {
      console.log(`[Biophysical Modeling] Successfully repaired PDB. Overwriting wt.pdb with repaired coordinates.`);
      const repairedPdb = await fs.promises.readFile(repairedPdbPath, "utf8");
      /**
       * The repaired file is REMOVED, exactly as the previous `rename` removed it.
       *
       * FoldX derives what it reads and how it names outputs from the file it is handed, and
       * `wt_Repair.pdb` sitting beside `wt.pdb` is a template this runner never asked it to
       * use. Leaving it behind would be an unverified change to BuildModel's input naming —
       * for a run whose output files are looked up by name (`wt_1_0.pdb` / `Dif_wt.fxout`).
       */
      await fs.promises.unlink(repairedPdbPath).catch(() => {});
      return { repairedPdb, diagnostic: { outcome: "completed", budgetMs, elapsedMs: Date.now() - startedAt, ...parseRepairProgress(repairRes.stdout) } };
    }
    console.warn(`[Biophysical Modeling] RepairPDB warning: wt_Repair.pdb not found. Continuing with un-repaired structure.`);
    return {
      diagnostic: {
        outcome: "no-output", budgetMs, elapsedMs: Date.now() - startedAt,
        ...parseRepairProgress(repairRes.stdout), stderrTail: tailOutput(repairRes.stderr), stdoutTail: tailOutput(repairRes.stdout)
      }
    };
  } catch (repairErr: any) {
    if (signal?.aborted || repairErr?.name === "AbortError") throw repairErr;
    const isTimeout = Boolean(
      repairErr?.code === "ETIMEDOUT" ||
      (!signal?.aborted && (repairErr?.killed || repairErr?.signal === "SIGTERM"))
    );
    const isMaxBuffer = repairErr?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    const diagnostic: FoldxRepairDiagnostic = {
      outcome: isTimeout ? "timed-out" : "failed",
      budgetMs,
      elapsedMs: Date.now() - startedAt,
      ...parseRepairProgress(String(repairErr?.stdout ?? "")),
      signal: repairErr?.signal ?? null,
      exitCode: repairErr?.code ?? null,
      stderrTail: tailOutput(repairErr?.stderr),
      stdoutTail: tailOutput(repairErr?.stdout)
    };
    if (isTimeout) {
      console.warn(`[Biophysical Modeling] RepairPDB timed out after ${(budgetMs / 1000).toFixed(0)}s (exceeded repair budget). Continuing with un-repaired structure.`);
    } else if (isMaxBuffer) {
      console.warn(`[Biophysical Modeling] RepairPDB output exceeded maximum buffer limit. Continuing with un-repaired structure.`);
    } else {
      console.warn(`[Biophysical Modeling] RepairPDB warning (failed):`, repairErr.message);
    }
    // One record of what FoldX itself said, whatever ended it. A killed RepairPDB used to leave
    // nothing but the line above, which is how a working repair got reported as a failed one.
    console.error(`[RepairPDB ${isTimeout ? "Timeout" : "Failure"} Context]:`, JSON.stringify(diagnostic));
    return { diagnostic };
  }
}

export async function generateMutantPdbInternal(
  wtPdb: string,
  validatedMutation: string,
  uniprotId: string | undefined,
  jobDir: string,
  signal?: AbortSignal,
  options?: FoldxOptions,
  onPhase?: FoldxPhaseReporter
): Promise<{ pdb: string; wtReferencePdb?: string | null; ddG: number | null; sd?: number; status: "success"; foldedResidueIndex: number; resolvedChain?: string; energetics?: any }> {
  // Waiting for a concurrency slot is part of the job's wall-clock cost, so it is budgeted here
  // and counted against the queue's whole-job cap (see CONFIG.timeouts).
  const jobStartedAt = Date.now();
  // The request is checked against the structure before anything else: one that cannot run must not stop
  // background work or wait for a FoldX slot. (FoldX mutation format: R A 215 W;)
  const mutMatch = validatedMutation.match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$/);
  if (!mutMatch) {
    throw new Error("Invalid mutation code format.");
  }
  const wt1 = mutMatch[1].toUpperCase();
  const chain = mutMatch[2].toUpperCase();
  const pos = parseInt(mutMatch[3], 10);
  const mut1 = mutMatch[4].toUpperCase();

  // Validate pos exists in WT PDB structure and resolve correct chain
  const pdbResidues = await parseResiduesFromPdbMaybeAsync(wtPdb);
  let targetRes = pdbResidues.find(r => r.resSeq === pos && r.chain === chain);
  let resolvedChain = chain;

  if (!targetRes) {
    throw new Error(`Target residue position ${pos} on chain ${chain} is not found in the PDB structure.`);
  }

  const expectedWt3 = AMINO_ACID_1_TO_3[wt1];
  if (expectedWt3 && targetRes.resName3 !== expectedWt3) {
    throw new Error(`Mutation mismatch: expected wild-type residue at position ${pos} is ${wt1} (${expectedWt3}), but PDB structure contains ${targetRes.resName3}.`);
  }

  // Background work (a speculative RepairPDB) yields the slot to this job rather than making it wait.
  preemptBackgroundFoldx();
  await biophysicalSemaphore.acquire(CONFIG.timeouts.foldxSemaphoreWaitMs, signal);
  try {
  const fullWtPath = path.join(jobDir, "wt.pdb");
  const fullMutPath = path.join(jobDir, "individual_list.txt");

  // 1. Write WT PDB data to temporary file (cleaned of HETATMs to prevent RepairPDB crashes)
  await fs.promises.mkdir(jobDir, { recursive: true });
  const cleanedWt = cleanPdbForFoldX(wtPdb);
  await fs.promises.writeFile(fullWtPath, cleanedWt, "utf8");

  /**
   * Identity of the STRUCTURE, computed from the same normalised text the mutant cache hashes.
   * Used for the repair cache, which must not depend on the mutation (see `cache.ts`).
   */
  const pdbHash = crypto.createHash("sha256").update(cleanedWt).digest("hex");

  // Construct mutation list using resolved chain and insertion code (BIO-4)
  const insCode = targetRes.insCode || "";
  const mutLine = `${wt1}${resolvedChain}${pos}${insCode}${mut1};\n`;
  await fs.promises.writeFile(fullMutPath, mutLine, "utf8");

  const { foldxBin, extraArgs } = prepareFoldxWorkdir(jobDir, options);

  let foldxSuccess = false;
  let mutantPdbContent = "";
  /** BuildModel's paired wild type for the same run (`WT_wt_1_0.pdb`), or null when FoldX wrote none. */
  let wtReferencePdbContent: string | null = null;
  let overallDdG: number | null = null;
  let overallSd: number = 0;
  let status: "success" = "success";
  let parsedResult: FoldxParsedResult | null = null;
  let foldxRepairFailed = false;
  let foldxRepairSkipped = false;
  /**
   * Distinguishes "this structure was repaired just now" from "this structure was repaired once and
   * the coordinates were reused", and names WHICH heuristic skipped repair when it was skipped.
   * Both travel into `energetics` so a surface can disclose them: a ΔΔG computed on an
   * un-repaired template is a weaker claim, and the reason it was not repaired is either a
   * deliberate cost guard (large structure) or a deliberate pLDDT guard (AlphaFold model).
   */
  let foldxRepairSkippedReason: "large-structure" | "alphafold-plddt" | "repair-exceeds-budget" | undefined;
  let foldxRepairCached = false;
  /** What RepairPDB did, for the failure record (see FoldxRunContext.repair). Unset until it is decided. */
  let repairDiagnostic: FoldxRepairDiagnostic | undefined;
  const residueCount = pdbResidues.length;
  /**
   * AlphaFold structures skip RepairPDB. The original rationale — pLDDT in the B-factor column
   * "confuses RepairPDB" and causes "constant failures" — is UNVERIFIED and did not reproduce:
   * RepairPDB completed on AF-P00441 (SOD1, 154 residues, 48 s native) and moved p.Ala5Val's ΔΔG
   * from 2.81 to 2.12 kcal/mol. The guard is kept until a benchmark against experimental ΔΔG shows
   * whether repairing small AlphaFold models helps; the skip is disclosed via
   * `foldxRepairSkippedReason`, so the UI says the template was not repaired and why.
   */
  const isAlphaFoldPdb = isAlphaFoldModel(wtPdb);
  const shouldRepair = residueCount <= FOLDX_REPAIR_MAX_RESIDUES && !isAlphaFoldPdb;
  const foldxEmulated = getFoldxExecutionTarget(foldxBin, []).file !== foldxBin;
  /**
   * Sized to this structure, host AND template (see budget.ts): a flat 180 s killed a run that needed
   * 214 s. It depends on how many incomplete residues BuildModel is handed, which RepairPDB changes, so
   * it is settled after the repair stage below.
   */
  let buildModelBudget = buildModelBudgetMs({ residueCount, numberOfRuns: 5, emulated: foldxEmulated });

  if (isAlphaFoldPdb) {
    console.log(`[Biophysical Modeling] Detected AlphaFold structure — skipping RepairPDB (pLDDT B-factors would cause false repairs).`);
  }

  try {
    // Pre-flight PDB validation: check for non-standard content that could crash RepairPDB
    const hasStandardResidues = /\bATOM\s+.*?\b(?:ALA|ARG|ASN|ASP|CYS|GLN|GLU|GLY|HIS|ILE|LEU|LYS|MET|PHE|PRO|SER|THR|TRP|TYR|VAL)/i.test(wtPdb);
    const hasTerminations = /HETATM|WAT|HOH|SOL|UNK|NONSTD/i.test(wtPdb);
    if (!hasStandardResidues && pdbResidues.length > 0) {
      console.warn("[Biophysical Modeling] PDB has ATOM lines but no standard amino acid residues detected — RepairPDB will likely fail.");
      foldxRepairFailed = true;
    } else if (hasTerminations && shouldRepair) {
      console.log(`[Biophysical Modeling] PDB contains heteroatoms (${hasTerminations}), RepairPDB will attempt cleanup.`);
    }

    if (shouldRepair) {
      /**
       * Repair is a function of the STRUCTURE, not of the mutation, so it is cached on its own key
       * and reused across variants. Without this every new substitution on the same template paid
       * the full repack again — measured at 205 s of a 208 s run (see `cache.ts`).
       *
       * The repaired coordinates are still produced by FoldX RepairPDB; a cache hit only skips
       * repeating identical work, and the payload says so (`foldxRepairCached`) rather than
       * pretending a fresh minimisation happened.
       */
      const repairCacheKey = getRepairCacheKey(pdbHash, options);
      const cachedRepair = await getRepairedStructureFromCache(repairCacheKey);

      if (cachedRepair) {
        console.log(`[Biophysical Modeling] Reusing cached FoldX-repaired template (${cachedRepair.pdb.length} bytes) — skipping RepairPDB.`);
        await fs.promises.writeFile(fullWtPath, cachedRepair.pdb, "utf8");
        foldxRepairCached = true;
        repairDiagnostic = { outcome: "reused" };
      } else if (!repairFitsBudget({ residueCount, incompleteResidues: countIncompleteResidues(cleanedWt), emulated: foldxEmulated })) {
        // Not attempted here: it would run to its cap and be killed (see repairFitsBudget). If the background
        // repair of this structure is nearly done, wait for it; otherwise BuildModel completes the side chains
        // itself, and the reason is disclosed like the other skips.
        const joined = await joinInflightRepair(repairCacheKey, {
          residueCount, incompleteResidues: countIncompleteResidues(cleanedWt), emulated: foldxEmulated, jobStartedAt, signal, onPhase
        });
        if (joined?.pdb) {
          await fs.promises.writeFile(fullWtPath, joined.pdb, "utf8");
          foldxRepairCached = true;
          repairDiagnostic = { outcome: "reused", elapsedMs: joined.waitedMs };
        } else {
          foldxRepairSkipped = true;
          foldxRepairSkippedReason = "repair-exceeds-budget";
          // A wait for the background repair that ran out is recorded: it shortened BuildModel's share of the job.
          repairDiagnostic = { outcome: "skipped", skipReason: foldxRepairSkippedReason, ...(joined ? { elapsedMs: joined.waitedMs } : {}) };
          console.log(`[Biophysical Modeling] Skipping FoldX RepairPDB for ${residueCount} residues (${countIncompleteResidues(cleanedWt)} incomplete): predicted to exceed its ${(CONFIG.timeouts.foldxRepairMs / 1000).toFixed(0)} s cap under Box64.`);
        }
      } else {
        // 1. Run FoldX RepairPDB first to resolve starting steric clashes and stabilize energy delta
        await onPhase?.("repairing");
        const repair = await runRepairPdb({ foldxBin, extraArgs, jobDir, budgetMs: CONFIG.timeouts.foldxRepairMs, signal });   // counted against the queue's whole-job cap
        repairDiagnostic = repair.diagnostic;
        if (repair.repairedPdb) {
          await writeRepairedStructureToCache(repairCacheKey, repair.repairedPdb);
          await fs.promises.writeFile(fullWtPath, repair.repairedPdb, "utf8");
        } else {
          foldxRepairFailed = true;
        }
      }
    } else {
      foldxRepairSkipped = true;
      foldxRepairSkippedReason = isAlphaFoldPdb ? "alphafold-plddt" : "large-structure";
      repairDiagnostic = { outcome: "skipped", skipReason: foldxRepairSkippedReason };
      console.log(`[Biophysical Modeling] Skipping FoldX RepairPDB for ${isAlphaFoldPdb ? "AlphaFold model (pLDDT B-factors)" : `large protein structure (${residueCount} residues)`} to expedite calculations.`);
    }

    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    // The template BuildModel will actually read: repaired, reused from the repair cache, or the cleaned
    // input. FoldX rebuilds its incomplete residues itself (~4.7 s each under Box64), so they set the cap.
    const templateIncomplete = countIncompleteResidues(await fs.promises.readFile(fullWtPath, "utf8").catch(() => cleanedWt));
    // A failed repair leaves the retry on the original PDB; hold its time back so both fit the job cap.
    const retryReserveMs = foldxRepairFailed ? CONFIG.timeouts.foldxBuildModelRetryMs : 0;
    buildModelBudget = clampToJobRemaining(
      buildModelBudgetMs({ residueCount, numberOfRuns: 5, emulated: foldxEmulated, incompleteResidues: templateIncomplete }),
      CONFIG.timeouts.foldxSec * 1000 - (Date.now() - jobStartedAt) - retryReserveMs
    );

    // 2. Run FoldX BuildModel with 5 stochastic runs for publication-grade statistics (H1)
    console.log(`[Biophysical Modeling] Executing FoldX BuildModel (5 runs, ${residueCount} residues, ${templateIncomplete} incomplete, budget ${(buildModelBudget / 1000).toFixed(0)} s${foldxEmulated ? ", Box64" : ""}): ${foldxBin}...`);
    await onPhase?.("modelling");
    let stdout = "", stderr = "";
    try {
      const execRes = await execFileAsync(foldxBin, [
        "--command=BuildModel",
        "--pdb=wt.pdb",
        "--mutant-file=individual_list.txt",
        "--numberOfRuns=5",
        ...extraArgs
      ], {
        timeout: buildModelBudget,   // counted against the queue's whole-job cap
        cwd: jobDir,
        signal
      });
      stdout = execRes.stdout;
      stderr = execRes.stderr;
    } catch (execErr: any) {
      if (execErr.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || execErr.killed || execErr.signal === "SIGTERM") {
        console.warn(`[Biophysical Modeling] FoldX execution timed out or killed.`);
      }
      throw execErr;
    }

    console.log(`[FoldX STDOUT]:`, stdout.slice(0, 300));
    if (stderr) console.warn(`[FoldX STDERR]:`, stderr);

    // FoldX generates "wt_1_0.pdb" (FoldX 5.x) or "wt_1.pdb" (FoldX 4.x)
    let foldxOutPdb = path.join(jobDir, "wt_1_0.pdb");
    if (!fs.existsSync(foldxOutPdb)) {
      foldxOutPdb = path.join(jobDir, "wt_1.pdb");
    }
    const foldxOutFx = path.join(jobDir, "Dif_wt.fxout");

    if (fs.existsSync(foldxOutPdb)) {
      mutantPdbContent = await fs.promises.readFile(foldxOutPdb, "utf8");
      wtReferencePdbContent = await readPairedWildType(foldxOutPdb);
      foldxSuccess = true;
      console.log(`[Biophysical Modeling] Successfully loaded FoldX mutant structure (${mutantPdbContent.length} bytes).`);

      if (fs.existsSync(foldxOutFx)) {
        const fxText = await fs.promises.readFile(foldxOutFx, "utf8");
        parsedResult = parseFoldxDifFile(fxText);
        overallDdG = parsedResult.ddG;
        overallSd = parsedResult.sd;
        console.log(`[Biophysical Modeling] Parsed FoldX 5-run stochastic ddG: ${overallDdG} ± ${overallSd} kcal/mol`);
      }
    } else {
      throw new Error("FoldX BuildModel completed without producing a mutant PDB");
    }
  } catch (foldxErr: any) {
    if (signal?.aborted || foldxErr?.name === "AbortError") throw foldxErr;
    console.warn(`[Biophysical Modeling] FoldX execution failed:`, foldxErr.message);
    // Tails only: execFile now returns everything FoldX printed, and a killed BuildModel can print megabytes.
    if (foldxErr.stdout) console.log(`[FoldX Failure STDOUT]:`, tailOutput(foldxErr.stdout, 2000));
    if (foldxErr.stderr) console.error(`[FoldX Failure STDERR]:`, tailOutput(foldxErr.stderr, 2000));
    const failureKind = classifyFoldxFailure(foldxErr);
    const runContext = (budgetMs: number): FoldxRunContext => ({
      budgetMs,
      residueCount,
      numberOfRuns: 5,
      template: foldxRepairCached ? "repaired (reused)"
        : foldxRepairSkipped ? `unrepaired (${foldxRepairSkippedReason === "alphafold-plddt" ? "AlphaFold model" : foldxRepairSkippedReason === "repair-exceeds-budget" ? "repair exceeds its budget under Box64" : "over 400 residues"})`
        : foldxRepairFailed ? "unrepaired (repair failed)"
        : "repaired",
      emulated: foldxEmulated,
      repair: repairDiagnostic
    });
    // The queue worker reports the repair state from these fields, not by searching the message text
    // (every message now names RepairPDB, whatever it did).
    const withRepairState = (error: Error): Error =>
      Object.assign(error, { foldxRepair: { failed: foldxRepairFailed, skipped: foldxRepairSkipped, skippedReason: foldxRepairSkippedReason } });
    if (failureKind === "runtime-crash" || failureKind === "timeout") {
      // jobDir still holds the exact wt.pdb, individual_list.txt and parameter links: rerun it by hand,
      // or time it with `npm run foldx:timing -- --pdb <jobDir>/wt.pdb --mut <WT><pos><MUT>`.
      console.error(`[FoldX ${failureKind === "timeout" ? "Timeout" : "Crash"} Context]:`, JSON.stringify(foldxCrashContext({
        binary: foldxBin, jobDir, pdbText: await fs.promises.readFile(fullWtPath, "utf8").catch(() => cleanedWt),
        mutation: await fs.promises.readFile(fullMutPath, "utf8").then(text => text.trim()).catch(() => ""),
        args: ["--command=BuildModel", "--pdb=wt.pdb", "--mutant-file=individual_list.txt", "--numberOfRuns=5", ...extraArgs],
        emulated: foldxEmulated,
        repair: repairDiagnostic
      })));
    }

    // Surface ENOENT (binary missing) explicitly so callers can report engine unavailability (P0-1.5)
    if (foldxErr?.code === "ENOENT") {
      throw new Error(`FoldX binary not found or not executable at: ${foldxBin}`);
    }

    // If RepairPDB previously failed, try one more time with the original PDB content
    if (!foldxSuccess && canRetryFoldxAfterRepair(foldxRepairFailed, foldxErr, signal)) {
      console.warn("[Biophysical Modeling] BuildModel failed after RepairPDB failure. " +
        "Retrying with original PDB content (no cleanup)...");
      try {
        await fs.promises.writeFile(fullWtPath, wtPdb, "utf8");
        await execFileAsync(foldxBin, [
          "--command=BuildModel",
          "--pdb=wt.pdb",
          "--mutant-file=individual_list.txt",
          "--numberOfRuns=5",
          ...extraArgs
        ], {
          timeout: clampToJobRemaining(CONFIG.timeouts.foldxBuildModelRetryMs, CONFIG.timeouts.foldxSec * 1000 - (Date.now() - jobStartedAt)),
          cwd: jobDir,
          signal
        });

        // Check BuildModel output files
        let foldxOutPdb2 = path.join(jobDir, "wt_1_0.pdb");
        if (!fs.existsSync(foldxOutPdb2)) {
          foldxOutPdb2 = path.join(jobDir, "wt_1.pdb");
        }
        if (fs.existsSync(foldxOutPdb2)) {
          mutantPdbContent = await fs.promises.readFile(foldxOutPdb2, "utf8");
          wtReferencePdbContent = await readPairedWildType(foldxOutPdb2);
          foldxSuccess = true;
          console.log(`[Biophysical Modeling] BuildModel succeeded on second attempt with original PDB (${mutantPdbContent.length} bytes).`);

          const foldxOutFx = path.join(jobDir, "Dif_wt.fxout");
          if (fs.existsSync(foldxOutFx)) {
            const fxText = await fs.promises.readFile(foldxOutFx, "utf8");
            parsedResult = parseFoldxDifFile(fxText);
            overallDdG = parsedResult.ddG;
            overallSd = parsedResult.sd;
            console.log(`[Biophysical Modeling] Parsed FoldX 5-run stochastic ddG: ${overallDdG} ± ${overallSd} kcal/mol`);
          }
        } else {
          throw new Error("FoldX BuildModel retry completed without producing a mutant PDB");
        }
      } catch (secondErr: any) {
        if (signal?.aborted || secondErr?.name === "AbortError") throw secondErr;
        console.warn(`[Biophysical Modeling] Second BuildModel attempt also failed:`, secondErr.message);
        if (secondErr.stderr) console.error(`[Second BuildModel STDERR]:`, secondErr.stderr.slice(0, 500));

        // Both attempts failed — throw a combined error
        throw withRepairState(new Error(
          `FoldX BuildModel failed after two attempts. ` +
          `Attempt 1 (cleaned PDB after RepairPDB): ${foldxErr.message}. ` +
          `Attempt 2 (original PDB): ${describeFoldxFailure(secondErr, foldxRepairFailed, runContext(CONFIG.timeouts.foldxBuildModelRetryMs))}. ` +
          `Check that the FoldX binary is accessible and parameter files (molecules/, rotabase.txt) are in place.`
        ));
      }
    }

    // If we got here and still haven't succeeded, surface the original error
    if (!foldxSuccess) {
      throw withRepairState(new Error(describeFoldxFailure(foldxErr, foldxRepairFailed, runContext(buildModelBudget))));
    }
  }

  if (foldxSuccess && mutantPdbContent) {
    try {
      mutantPdbContent = injectBFactorsFromWtPdb(wtPdb, mutantPdbContent);
      console.log(`[Biophysical Modeling] Successfully injected B-factors (pLDDT confidence) from template structure into FoldX mutant PDB.`);
    } catch (injectErr: any) {
      console.error(`[Biophysical Modeling] Failed to inject B-factors:`, injectErr.message);
    }
    if (wtReferencePdbContent) {
      try {
        wtReferencePdbContent = injectBFactorsFromWtPdb(wtPdb, wtReferencePdbContent);
      } catch (injectErr: any) {
        console.error(`[Biophysical Modeling] Failed to inject B-factors into the paired wild type:`, injectErr.message);
      }
    }

    // Calculate local sidechain RMSD (BIO-8)
    // Null until measured: a failed RMSD used to reach the tab as a measured 0.00 Å.
    //
    // Measured against BuildModel's paired wild type when FoldX wrote one: against the input
    // template it also counted every side chain RepairPDB moved in the window, which is the repair,
    // not the substitution.
    let localSidechainRmsd: number | null = null;
    const localSidechainRmsdReference: "foldx-paired" | "template" = wtReferencePdbContent ? "foldx-paired" : "template";
    try {
      const wtAtoms = parseAtomsFromPdb(wtReferencePdbContent ?? wtPdb);
      const mutAtoms = parseAtomsFromPdb(mutantPdbContent);
      localSidechainRmsd = calculateLocalSidechainRmsd(wtAtoms, mutAtoms, pos, resolvedChain);
      console.log(`[Biophysical Modeling] Calculated local sidechain RMSD against the ${localSidechainRmsdReference === "foldx-paired" ? "paired wild type" : "input template"}: ${localSidechainRmsd} Å`);
    } catch (rmsdErr: any) {
      console.error(`[Biophysical Modeling] Failed to calculate local sidechain RMSD:`, rmsdErr?.message);
    }

    // Secondary predictors (RaSP, StabilityOracle, ThermoMPNN) are evaluated
    // asynchronously in energy-models.ts / biophysics-bridge.ts to keep FoldX decoupled.
    const bFactorMetadata = detectBFactorProvenance(wtPdb);

    await onPhase?.("finalizing");

    const energetics = {
      ...(parsedResult ? {
        foldxMean: parsedResult.ddG,
        foldxSd: parsedResult.sd,
        vdw: parsedResult.vdw,
        electrostatics: parsedResult.electrostatics,
        stericClashWarning: parsedResult.stericClashWarning,
        rawDdGs: parsedResult.rawDdGs,
      } : {}),
      seed: options?.seed,
      localSidechainRmsd,
      ...(localSidechainRmsd !== null ? { localSidechainRmsdReference } : {}),
      foldxRepairFailed,
      foldxRepairSkipped,
      // Named only when repair was skipped, so the UI can say WHY rather than only that it was.
      ...(foldxRepairSkippedReason ? { foldxRepairSkippedReason } : {}),
      // Disclosed, not hidden: reuse changes nothing about the coordinates, but a reader auditing
      // "was this template minimised for this run?" deserves the true answer.
      ...(foldxRepairCached ? { foldxRepairCached: true } : {}),
      bFactorMetadata,
      rasp: null,
      raspReason: undefined,
      thermompnn: null,
      stabilityoracle: null
    };

      return { 
        pdb: mutantPdbContent, 
        /**
         * The wild type FoldX built in the same run: the repaired template with its own side chains
         * repacked by the same procedure. It is the reference the variant's contact, χ1 and surface
         * differences are meant against; the raw template also carries every change RepairPDB made.
         */
        wtReferencePdb: wtReferencePdbContent,
        ddG: overallDdG, 
        sd: overallSd, 
        status, 
        foldedResidueIndex: pos, 
        resolvedChain,
        energetics
      };
    } else {
      if (foldxRepairFailed) {
        throw new Error("FoldX BuildModel was attempted after RepairPDB failure, but did not produce expected output coordinates (wt_1_0.pdb / wt_1.pdb).");
      }
      throw new Error("Biophysical modeling engine unavailable (FoldX is not installed or failed to execute in this environment).");
    }
  } finally {
    biophysicalSemaphore.release();
  }
}

/**
 * How a background repair gets CPU.
 *   "spare-core": the host has more cores than FoldX slots (the OCI host: 2 vCPU, 1 slot). The repair runs
 *                 beside interactive jobs at the lowest priority and never takes their slot.
 *   "shared":     no spare core. The repair takes the FoldX slot (waiting at most `slotWaitMs`, never
 *                 queueing behind a job), so the caller must only start it when the slot is idle and must
 *                 let interactive jobs preempt it (`preemption.ts`).
 */
export type BackgroundRepairSlot = "spare-core" | "shared";

/**
 * How long a "shared" background repair waits for the FoldX slot before giving up for now. Deliberately
 * short and not a stage timeout: background work must never queue behind a person's job, and the caller
 * retries at its next idle poll.
 */
export const BACKGROUND_SLOT_WAIT_MS = 1_000;

/**
 * RepairPDB for a structure and nothing else: fills the repair cache so later variants on this template
 * skip the repair (see `background-repair.ts`, the only caller). Returns the diagnostic instead of
 * throwing for a FoldX failure; an abort, or no free slot in "shared" mode, rejects.
 */
export async function repairTemplateOnly(
  wtPdb: string,
  jobDir: string,
  options: FoldxOptions | undefined,
  budgetMs: number,
  run: { slot: BackgroundRepairSlot; signal?: AbortSignal; slotWaitMs?: number }
): Promise<FoldxRepairDiagnostic> {
  const cleanedWt = cleanPdbForFoldX(wtPdb);
  const repairCacheKey = getRepairCacheKey(crypto.createHash("sha256").update(cleanedWt).digest("hex"), options);
  if (await getRepairedStructureFromCache(repairCacheKey)) return { outcome: "reused" };

  const shared = run.slot === "shared";
  if (shared) await biophysicalSemaphore.acquire(run.slotWaitMs ?? BACKGROUND_SLOT_WAIT_MS, run.signal);
  try {
    await fs.promises.mkdir(jobDir, { recursive: true });
    await fs.promises.writeFile(path.join(jobDir, "wt.pdb"), cleanedWt, "utf8");
    const { foldxBin, extraArgs } = prepareFoldxWorkdir(jobDir, options);
    const repair = await runRepairPdb({ foldxBin, extraArgs, jobDir, budgetMs, signal: run.signal, lowPriority: true });
    if (repair.repairedPdb) await writeRepairedStructureToCache(repairCacheKey, repair.repairedPdb);
    return repair.diagnostic;
  } finally {
    if (shared) biophysicalSemaphore.release();
  }
}

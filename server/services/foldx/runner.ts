import os from "os";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import crypto from "crypto";
import { AMINO_ACID_1_TO_3 } from "../../../src/shared/aminoAcids.ts";
import { Semaphore } from "../../utils.ts";
import {
  parseResiduesFromPdbMaybeAsync,
  parseAtomsFromPdb
} from "../pdb-parser.ts";
import { calculateLocalSidechainRmsd } from "../structural-diff.ts";
import { runRaspLocal, submitThermoMpnnJob } from "../energy-models.ts";
import { runStabilityOracleAnalysis } from "../stabilityoracle.ts";
import {
  getMutantFromCache,
  writeMutantToCache,
  getFoldxCacheKey
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
  detectBFactorProvenance,
  injectBFactorsFromWtPdb
} from "./pdb-utils.ts";

function killProcessSafely(pid?: number) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      execFile("taskkill", ["/F", "/T", "/PID", String(pid)], () => {});
    } catch (_) {}
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (_) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (_) {}
    }
  }
}

function execFileAsync(
  file: string,
  args: string[],
  options: { timeout?: number; cwd?: string; signal?: AbortSignal }
): Promise<{ stdout: string; stderr: string }> {
  const target = getFoldxExecutionTarget(file, args);
  return new Promise((resolve, reject) => {
    let killed = false;
    const child = execFile(target.file, target.args, { maxBuffer: 16 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        if (!killed) {
          killed = true;
          killProcessSafely(child.pid);
        }
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });

    if (options.signal) {
      const onAbort = () => {
        if (!killed) {
          killed = true;
          killProcessSafely(child.pid);
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

// A-4 Fix: Dynamically size biophysical semaphore concurrency based on CPU core availability
const defaultConcurrency = parseInt(process.env.BIOPHYSICAL_CONCURRENCY || "", 10) || Math.max(1, os.cpus().length - 1);
export const biophysicalSemaphore = new Semaphore(defaultConcurrency);

export interface FoldxOptions {
  pH?: number;
  temperature?: number;
  ionicStrength?: number;
  seed?: number;
}

const inFlightFoldx = new Map<string, Promise<any>>();

export async function generateMutantPdb(
  wtPdb: string,
  validatedMutation: string,
  uniprotId: string | undefined,
  jobDir: string,
  signal?: AbortSignal,
  options?: FoldxOptions
): Promise<{ pdb: string; ddG: number | null; status: "success"; foldedResidueIndex: number; resolvedChain?: string; energetics?: any }> {
  if (signal?.aborted) {
    throw new Error("Aborted");
  }

  const normalizedPdb = cleanPdbForFoldX(wtPdb);
  const pdbHash = crypto.createHash("sha256").update(normalizedPdb).digest("hex");
  const cacheKey = getFoldxCacheKey(pdbHash, validatedMutation, options);
  
  const cached = getMutantFromCache(cacheKey);
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
        const result = await generateMutantPdbInternal(wtPdb, validatedMutation, uniprotId, jobDir, undefined, { ...options, seed });
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

export async function generateMutantPdbInternal(
  wtPdb: string,
  validatedMutation: string,
  uniprotId: string | undefined,
  jobDir: string,
  signal?: AbortSignal,
  options?: FoldxOptions
): Promise<{ pdb: string; ddG: number | null; sd?: number; status: "success"; foldedResidueIndex: number; resolvedChain?: string; energetics?: any }> {
  await biophysicalSemaphore.acquire(120000, signal);
  try {
  const fullWtPath = path.join(jobDir, "wt.pdb");
  const fullMutPath = path.join(jobDir, "individual_list.txt");

  // 1. Write WT PDB data to temporary file (cleaned of HETATMs to prevent RepairPDB crashes)
  await fs.promises.mkdir(jobDir, { recursive: true });
  const cleanedWt = cleanPdbForFoldX(wtPdb);
  await fs.promises.writeFile(fullWtPath, cleanedWt, "utf8");

  // 2. Create mutation configuration text file (FoldX format: R A 215 W;)
  const mutMatch = validatedMutation.match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$/);
  if (!mutMatch) {
    throw new Error("Invalid mutation code format.");
  }
  const wt1 = mutMatch[1].toUpperCase();
  const chain = mutMatch[2].toUpperCase();
  const pos = parseInt(mutMatch[3], 10);
  const mut1 = mutMatch[4].toUpperCase();

  // 3. Validate pos exists in WT PDB structure and resolve correct chain
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

  // Construct mutation list using resolved chain and insertion code (BIO-4)
  const insCode = targetRes.insCode || "";
  const mutLine = `${wt1}${resolvedChain}${pos}${insCode}${mut1};\n`;
  await fs.promises.writeFile(fullMutPath, mutLine, "utf8");

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

  let foldxSuccess = false;
  let mutantPdbContent = "";
  let overallDdG: number | null = null;
  let overallSd: number = 0;
  let status: "success" = "success";
  let parsedResult: FoldxParsedResult | null = null;
  let foldxRepairFailed = false;
  let foldxRepairSkipped = false;
  const residueCount = pdbResidues.length;
  // AlphaFold structures use pLDDT as B-factor (0-100 scale), which confuses
  // RepairPDB. Skip repair for AF structures to avoid constant failures.
  const isAlphaFoldPdb = /ALPHAFOLD|DBREF.*AF\-/i.test(wtPdb) || 
    /^REMARK.*ALPHAFOLD/mi.test(wtPdb) ||
    /^HEADER.*PREDICTED/mi.test(wtPdb) ||
    detectBFactorProvenance(wtPdb).source === "alphafold";
  const shouldRepair = residueCount <= 400 && !isAlphaFoldPdb;

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
      // 1. Run FoldX RepairPDB first to resolve starting steric clashes and stabilize energy delta
      console.log(`[Biophysical Modeling] Running FoldX RepairPDB: ${foldxBin}...`);
      try {
        await execFileAsync(foldxBin, [
          "--command=RepairPDB",
          "--pdb=wt.pdb",
          ...extraArgs
        ], {
          timeout: 300000,   // 5 min — RepairPDB on large chains (~350 res) routinely takes >60s
          cwd: jobDir,
          signal
        });
        const repairedPdbPath = path.join(jobDir, "wt_Repair.pdb");
        if (fs.existsSync(repairedPdbPath)) {
          console.log(`[Biophysical Modeling] Successfully repaired PDB. Overwriting wt.pdb with repaired coordinates.`);
          await fs.promises.rename(repairedPdbPath, fullWtPath);
        } else {
          console.warn(`[Biophysical Modeling] RepairPDB warning: wt_Repair.pdb not found. Continuing with un-repaired structure.`);
          foldxRepairFailed = true;
        }
      } catch (repairErr: any) {
        console.warn(`[Biophysical Modeling] RepairPDB warning (failed):`, repairErr.message);
        if (repairErr.stdout) console.log(`[RepairPDB STDOUT]:`, repairErr.stdout.slice(0, 500));
        if (repairErr.stderr) console.error(`[RepairPDB STDERR]:`, repairErr.stderr.slice(0, 500));
        if (repairErr.code) console.error(`[RepairPDB Exit Code]:`, repairErr.code);
        foldxRepairFailed = true;
      }
    } else {
      console.log(`[Biophysical Modeling] Skipping FoldX RepairPDB for large protein structure (${residueCount} residues) to expedite calculations.`);
      foldxRepairSkipped = true;
    }

    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    // 2. Run FoldX BuildModel with 5 stochastic runs for publication-grade statistics (H1)
    console.log(`[Biophysical Modeling] Executing FoldX BuildModel (5 runs): ${foldxBin}...`);
    let stdout = "", stderr = "";
    try {
      const execRes = await execFileAsync(foldxBin, [
        "--command=BuildModel",
        "--pdb=wt.pdb",
        "--mutant-file=individual_list.txt",
        "--numberOfRuns=5",
        ...extraArgs
      ], {
        timeout: 300000,   // 5 min — BuildModel 5 runs on large chains (~400 res) under Box64 emulation takes ~2-3 min
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
      foldxSuccess = true;
      console.log(`[Biophysical Modeling] Successfully loaded FoldX mutant structure (${mutantPdbContent.length} bytes).`);

      if (fs.existsSync(foldxOutFx)) {
        const fxText = await fs.promises.readFile(foldxOutFx, "utf8");
        parsedResult = parseFoldxDifFile(fxText);
        overallDdG = parsedResult.ddG;
        overallSd = parsedResult.sd;
        console.log(`[Biophysical Modeling] Parsed FoldX 5-run stochastic ddG: ${overallDdG} ± ${overallSd} kcal/mol`);
      }
    }
  } catch (foldxErr: any) {
    console.warn(`[Biophysical Modeling] FoldX execution failed:`, foldxErr.message);
    if (foldxErr.stdout) console.log(`[FoldX Failure STDOUT]:`, foldxErr.stdout);
    if (foldxErr.stderr) console.error(`[FoldX Failure STDERR]:`, foldxErr.stderr);

    // Surface ENOENT (binary missing) explicitly so callers can report engine unavailability (P0-1.5)
    if (foldxErr?.code === "ENOENT") {
      throw new Error(`FoldX binary not found or not executable at: ${foldxBin}`);
    }

    // If RepairPDB previously failed, try one more time with the original PDB content
    if (foldxRepairFailed && !foldxSuccess) {
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
        ], { timeout: 120000, cwd: jobDir, signal });

        // Check BuildModel output files
        let foldxOutPdb2 = path.join(jobDir, "wt_1_0.pdb");
        if (!fs.existsSync(foldxOutPdb2)) {
          foldxOutPdb2 = path.join(jobDir, "wt_1.pdb");
        }
        if (fs.existsSync(foldxOutPdb2)) {
          mutantPdbContent = await fs.promises.readFile(foldxOutPdb2, "utf8");
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
        }
      } catch (secondErr: any) {
        console.warn(`[Biophysical Modeling] Second BuildModel attempt also failed:`, secondErr.message);
        if (secondErr.stderr) console.error(`[Second BuildModel STDERR]:`, secondErr.stderr.slice(0, 500));

        // Both attempts failed — throw a combined error
        throw new Error(
          `FoldX BuildModel failed after two attempts. ` +
          `Attempt 1 (cleaned PDB after RepairPDB): ${foldxErr.message}. ` +
          `Attempt 2 (original PDB): ${secondErr.message}. ` +
          `Check that the FoldX binary is accessible and parameter files (molecules/, rotabase.txt) are in place.`
        );
      }
    }

    // If we got here and still haven't succeeded, surface the original error
    if (!foldxSuccess) {
      const repairSummary = foldxRepairFailed
        ? "(RepairPDB previously failed — PDB may contain steric clashes or formatting issues)"
        : "unknown cause";
      throw new Error(
        `FoldX BuildModel failed (${repairSummary}): ${foldxErr.message}. ` +
        `Verify that wt.pdb is a valid PDB structure and FoldX parameters are accessible.`
      );
    }
  }

  if (foldxSuccess && mutantPdbContent) {
    try {
      mutantPdbContent = injectBFactorsFromWtPdb(wtPdb, mutantPdbContent);
      console.log(`[Biophysical Modeling] Successfully injected B-factors (pLDDT confidence) from template structure into FoldX mutant PDB.`);
    } catch (injectErr: any) {
      console.error(`[Biophysical Modeling] Failed to inject B-factors:`, injectErr.message);
    }

    // Calculate local sidechain RMSD (BIO-8)
    let localSidechainRmsd = 0.0;
    try {
      const wtAtoms = parseAtomsFromPdb(wtPdb);
      const mutAtoms = parseAtomsFromPdb(mutantPdbContent);
      localSidechainRmsd = calculateLocalSidechainRmsd(wtAtoms, mutAtoms, pos, resolvedChain);
      console.log(`[Biophysical Modeling] Calculated local sidechain RMSD: ${localSidechainRmsd} Å`);
    } catch (rmsdErr: any) {
      console.error(`[Biophysical Modeling] Failed to calculate local sidechain RMSD:`, rmsdErr.message);
    }

    // Run local RaSP score calculation
    let rasp: number | null = null;
    let raspReason: string | undefined = undefined;
    try {
      const raspRes = await runRaspLocal("", "", resolvedChain, pos, wt1, mut1, uniprotId);
      if (raspRes !== null) {
        rasp = raspRes.score;
        raspReason = raspRes.reason;
        console.log(`[RaSP] Local prediction computed: ${rasp} kcal/mol (reason: ${raspReason || "none"})`);
      }
    } catch (raspErr: any) {
      console.warn(`[RaSP] Failed to compute local prediction:`, raspErr.message);
    }

    // Run local StabilityOracle score calculation
    let stabilityoracle: number | null = null;
    try {
      const soRes = await runStabilityOracleAnalysis(
        uniprotId || "UNKNOWN",
        `${wt1}${pos}${mut1}`,
        uniprotId || "",
        "",
        wtPdb
      );
      if (soRes !== null) {
        stabilityoracle = soRes.ddG;
        console.log(`[StabilityOracle] Local prediction computed: ${stabilityoracle} kcal/mol (${soRes.provenance})`);
      }
    } catch (soErr: any) {
      console.warn(`[StabilityOracle] Failed to compute prediction:`, soErr.message);
    }

    // Run local ThermoMPNN score calculation
    let thermompnn: number | null = null;
    try {
      const tmRes = await submitThermoMpnnJob(
        wtPdb,
        `${wt1}${resolvedChain}${pos}${mut1}`,
        undefined,
        AbortSignal.timeout(10000)
      );
      if (tmRes && typeof tmRes.prediction === "number") {
        thermompnn = tmRes.prediction;
        console.log(`[ThermoMPNN] Local prediction computed: ${thermompnn} kcal/mol`);
      }
    } catch (tmErr: any) {
      console.warn(`[ThermoMPNN] Failed to compute local prediction:`, tmErr.message);
    }

    const bFactorMetadata = detectBFactorProvenance(wtPdb);

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
      foldxRepairFailed,
      foldxRepairSkipped,
      bFactorMetadata,
      rasp,
      raspReason,
      thermompnn,
      stabilityoracle
    };

      return { 
        pdb: mutantPdbContent, 
        ddG: overallDdG, 
        sd: overallSd, 
        status, 
        foldedResidueIndex: pos, 
        resolvedChain,
        energetics
      };
    } else {
      if (foldxRepairFailed) {
        throw new Error("FoldX RepairPDB failed (PDB repair unsuccessful). BuildModel was not attempted.");
      }
      throw new Error("Biophysical modeling engine unavailable (FoldX is not installed or failed to execute in this environment).");
    }
  } finally {
    biophysicalSemaphore.release();
  }
}

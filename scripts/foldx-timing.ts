/**
 * scripts/foldx-timing.ts — time FoldX BuildModel (and optionally RepairPDB) on one structure.
 *
 * WHY THIS EXISTS
 * ---------------
 * `foldxBuildModelMs` (server/config.ts) was calibrated from a comment, not from a measurement on
 * the deployed host. A p.Gln867His run on SLC12A4 (~1,085 residues) hit that 180 s cap although an
 * unrepaired 875-residue AlphaFold structure completed BuildModel x5 in 5.1 s (foldx/cache.ts).
 * Size plus emulation cannot account for a >35x gap, so the first question is whether the slow
 * run is SLOW or HUNG. This script answers it by reporting:
 *
 *   - time to FIRST output byte   (a hang under emulation never prints; a slow run prints early)
 *   - wall time and exit state    (completed / timed out / crashed, with signal)
 *   - peak RSS on Linux           (an OOM-driven stall looks like a hang)
 *   - whether the mutant PDB and Dif file were produced, and the parsed ddG
 *
 * It reproduces the runner's job layout and command line exactly (cleanPdbForFoldX, symlinked
 * molecules/ and rotabase.txt, the same `extraArgs`, the same Box64 routing), but never touches
 * the cache, the queue or the server.
 *
 * Usage (run on the host you want to measure — the OCI box for the Box64 question):
 *
 *   npm run foldx:timing -- --pdb <file.pdb> --mut Q867H [--chain A]
 *        [--runs 1,5] [--timeout 600] [--repair] [--keep]
 *
 *   --runs     comma list of --numberOfRuns values to time, each in a fresh job dir (default 1,5)
 *   --timeout  per-config cap in seconds (default 600 — deliberately above the 180 s production
 *              cap, so a slow run FINISHES and reports its true duration)
 *   --repair   also time RepairPDB first and feed its output to BuildModel (production path for
 *              <=400-residue experimental structures)
 *   --keep     keep the job dirs so a crash or hang can be rerun by hand
 *   --workdir  parent directory for job dirs (default: node_modules/.cache/tmp on Windows, else the OS temp dir)
 *
 * In the container:
 *   docker exec -it <app> npx tsx scripts/foldx-timing.ts --pdb /tmp/AF-Q9UP95.pdb --mut Q867H
 *
 * Gotcha for any FoldX harness: FoldX APPENDS to `Dif_wt.fxout` when one exists, so reusing a job
 * dir for a second mutation silently mixes runs. This script uses a fresh dir per configuration.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildModelBudgetMs } from "../server/services/stability/foldx/budget.ts";
import { detectFoldxBinaryAndDir, getFoldxExecutionTarget } from "../server/services/stability/foldx/detector.ts";
import { cleanPdbForFoldX } from "../server/services/stability/foldx/pdb-utils.ts";
import { parseFoldxDifFile } from "../server/services/stability/foldx/parser.ts";
import { AA3, EXTRA_ARGS, defaultWorkRoot, prepareFoldxJobDir } from "./lib/foldx-job.ts";

interface StepResult {
  step: string;
  numberOfRuns?: number;
  state: "completed" | "timed-out" | "crashed" | "spawn-error";
  exitCode: number | null;
  signal: string | null;
  wallSec: number;
  firstOutputSec: number | null;
  peakRssMB: number | null;
  outputs: string[];
  ddG?: number | null;
  sd?: number | null;
  stdoutTail: string;
  stderrTail: string;
  jobDir: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function fail(message: string): never {
  console.error(`foldx-timing: ${message}`);
  process.exit(2);
}

/** Peak resident set size of a pid in MB, Linux only (`/proc`); null elsewhere. */
function readRssMB(pid: number | undefined): number | null {
  if (!pid || process.platform !== "linux") return null;
  try {
    const m = fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/VmHWM:\s+(\d+)\s+kB/);
    return m ? Math.round(parseInt(m[1], 10) / 1024) : null;
  } catch {
    return null;
  }
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/F", "/T", "/PID", String(pid)]);
    else process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

function runFoldx(foldxBin: string, args: string[], cwd: string, timeoutSec: number): Promise<Omit<StepResult, "step" | "outputs" | "jobDir">> {
  const target = getFoldxExecutionTarget(foldxBin, args);
  const started = Date.now();
  return new Promise(resolve => {
    let firstOutput: number | null = null;
    let stdout = "";
    let stderr = "";
    let peak: number | null = null;
    let timedOut = false;
    let settled = false;

    const child = spawn(target.file, target.args, { cwd });
    const sample = setInterval(() => {
      const rss = readRssMB(child.pid);
      if (rss !== null && (peak === null || rss > peak)) peak = rss;
    }, 1000);
    const cap = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutSec * 1000);

    const note = () => { if (firstOutput === null) firstOutput = (Date.now() - started) / 1000; };
    child.stdout.on("data", d => { note(); stdout += d; });
    child.stderr.on("data", d => { note(); stderr += d; });

    const finish = (state: StepResult["state"], exitCode: number | null, signal: string | null, extraErr = "") => {
      if (settled) return;
      settled = true;
      clearInterval(sample);
      clearTimeout(cap);
      resolve({
        state: timedOut ? "timed-out" : state,
        exitCode,
        signal,
        wallSec: (Date.now() - started) / 1000,
        firstOutputSec: firstOutput,
        peakRssMB: peak,
        stdoutTail: stdout.slice(-400),
        stderrTail: (stderr + extraErr).slice(-400)
      });
    };
    child.on("error", err => finish("spawn-error", null, null, String(err)));
    child.on("close", (code, signal) => finish(code === 0 && !signal ? "completed" : "crashed", code, signal));
  });
}

async function main() {
  const pdbPath = arg("pdb") ?? fail("--pdb <file> is required");
  const mut = arg("mut") ?? fail("--mut <WT><pos><MUT>, e.g. Q867H, is required");
  const chain = (arg("chain") ?? "A").toUpperCase();
  const runsList = (arg("runs") ?? "1,5").split(",").map(s => parseInt(s, 10)).filter(n => n > 0);
  const timeoutSec = parseInt(arg("timeout") ?? "600", 10);
  const keep = flag("keep");
  // Where job dirs live (see defaultWorkRoot for the Windows %TEMP% fault).
  const workRoot = arg("workdir") ?? defaultWorkRoot();

  const m = mut.match(/^([A-Za-z])(\d+)([A-Za-z])$/);
  if (!m) fail(`--mut must look like Q867H, got "${mut}"`);
  const [, wt1, posStr, mut1] = m;
  const pos = parseInt(posStr, 10);

  const raw = fs.readFileSync(pdbPath, "utf8");
  const cleaned = cleanPdbForFoldX(raw);
  const atomLines = cleaned.split(/\r?\n/).filter(l => l.startsWith("ATOM"));
  const residues = new Set(atomLines.map(l => `${l[21]}:${l.slice(22, 27)}`));
  const target = atomLines.find(l => l[21] === chain && parseInt(l.slice(22, 26), 10) === pos);
  if (!target) fail(`residue ${pos} on chain ${chain} not found in ${pdbPath}`);
  const found3 = target.slice(17, 20).trim();
  if (found3 !== AA3[wt1.toUpperCase()]) fail(`residue ${pos} is ${found3}, not ${AA3[wt1.toUpperCase()]} (${wt1})`);

  const { foldxBin, foldxDir } = detectFoldxBinaryAndDir();
  if (!fs.existsSync(foldxBin)) fail(`FoldX binary not found: ${foldxBin}`);
  if (process.platform !== "win32") { try { fs.chmodSync(foldxBin, 0o755); } catch { /* read-only mount */ } }
  const molecules = path.join(foldxDir, "molecules");
  const rotabase = path.join(foldxDir, "rotabase.txt");
  if (!fs.existsSync(molecules) || !fs.existsSync(rotabase)) fail(`molecules/ or rotabase.txt missing in ${foldxDir}`);

  const exec = getFoldxExecutionTarget(foldxBin, []);
  const host = {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalMemMB: Math.round(os.totalmem() / 1048576),
    freeMemMB: Math.round(os.freemem() / 1048576),
    emulated: exec.file !== foldxBin,
    runner: exec.file,
    foldxBin,
    // Box64 tuning flags in effect, so a speed comparison records exactly what was varied.
    box64Env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("BOX64_")))
  };
  const structure = { file: pdbPath, residues: residues.size, atoms: atomLines.length, mutation: `${wt1.toUpperCase()}${chain}${pos}${mut1.toUpperCase()}` };
  // What production would allow BuildModel for this structure on this host (foldx/budget.ts).
  const productionBudgetSec = Object.fromEntries(
    runsList.map(n => [`x${n}`, buildModelBudgetMs({ residueCount: residues.size, numberOfRuns: n, emulated: host.emulated }) / 1000])
  );
  console.log(JSON.stringify({ host, structure, timeoutSec, productionBudgetSec }, null, 2));

  const results: StepResult[] = [];

  const mutation = `${wt1.toUpperCase()}${chain}${pos}${mut1.toUpperCase()}`;
  const newJob = (label: string) => prepareFoldxJobDir({ workRoot, label: `timing-${label}`, pdbText: cleaned, mutation, foldxDir });

  // Optional: RepairPDB once, reused as the input of every BuildModel config below.
  let repairedPdb: string | null = null;
  if (flag("repair")) {
    const jobDir = newJob("repair");
    console.log(`\n[RepairPDB] timing (cap ${timeoutSec}s) …`);
    const r = await runFoldx(foldxBin, ["--command=RepairPDB", "--pdb=wt.pdb", ...EXTRA_ARGS], jobDir, timeoutSec);
    const out = path.join(jobDir, "wt_Repair.pdb");
    const step: StepResult = { step: "RepairPDB", ...r, outputs: fs.existsSync(out) ? ["wt_Repair.pdb"] : [], jobDir };
    results.push(step);
    console.log(JSON.stringify(step));
    if (fs.existsSync(out)) repairedPdb = fs.readFileSync(out, "utf8");
    else console.log("[RepairPDB] produced no wt_Repair.pdb — BuildModel configs will use the unrepaired structure.");
  }

  for (const n of runsList) {
    const jobDir = newJob(`bm${n}`);
    if (repairedPdb) fs.writeFileSync(path.join(jobDir, "wt.pdb"), repairedPdb, "utf8");
    console.log(`\n[BuildModel x${n}] timing (cap ${timeoutSec}s)${repairedPdb ? " on repaired input" : ""} …`);
    const r = await runFoldx(
      foldxBin,
      ["--command=BuildModel", "--pdb=wt.pdb", "--mutant-file=individual_list.txt", `--numberOfRuns=${n}`, ...EXTRA_ARGS],
      jobDir,
      timeoutSec
    );
    const outputs = fs.readdirSync(jobDir).filter(f => /^(WT_)?wt_1(_0)?\.pdb$|^Dif_wt\.fxout$/.test(f));
    const step: StepResult = { step: "BuildModel", numberOfRuns: n, ...r, outputs, jobDir };
    const dif = path.join(jobDir, "Dif_wt.fxout");
    if (fs.existsSync(dif)) {
      try {
        const parsed = parseFoldxDifFile(fs.readFileSync(dif, "utf8"));
        step.ddG = parsed.ddG;
        step.sd = parsed.sd;
      } catch { /* leave undefined; the raw file is in jobDir with --keep */ }
    }
    results.push(step);
    console.log(JSON.stringify(step));
  }

  console.log("\n=== SUMMARY ===");
  console.table(results.map(r => ({
    step: r.numberOfRuns ? `BuildModel x${r.numberOfRuns}` : r.step,
    state: r.state,
    wallSec: +r.wallSec.toFixed(1),
    firstOutputSec: r.firstOutputSec === null ? "none" : +r.firstOutputSec.toFixed(1),
    peakRssMB: r.peakRssMB ?? "n/a",
    budgetSec: r.numberOfRuns ? productionBudgetSec[`x${r.numberOfRuns}`] : "",
    ddG: r.ddG ?? "",
    signal: r.signal ?? ""
  })));

  const bm = results.filter(r => r.step === "BuildModel");
  if (bm.length >= 2 && bm.every(r => r.state === "completed")) {
    const [a, b] = [bm[0], bm[bm.length - 1]];
    const perRun = (b.wallSec - a.wallSec) / (b.numberOfRuns! - a.numberOfRuns!);
    console.log(`\nMarginal cost per extra run ≈ ${perRun.toFixed(1)}s; fixed cost (parse + rotamer table) ≈ ${(a.wallSec - perRun * a.numberOfRuns!).toFixed(1)}s.`);
  }
  const hung = bm.find(r => r.state === "timed-out" && r.firstOutputSec === null);
  if (hung) console.log(`\nBuildModel x${hung.numberOfRuns} printed NOTHING before the cap: that is a hang/stall signature, not slow progress. Rerun its job dir by hand (${hung.jobDir}).`);

  if (!keep) for (const r of results) fs.rmSync(r.jobDir, { recursive: true, force: true });
  else console.log("\nJob dirs kept:\n" + results.map(r => `  ${r.jobDir}`).join("\n"));
}

main().catch(err => { console.error(err); process.exit(1); });

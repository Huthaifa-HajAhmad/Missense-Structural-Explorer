/**
 * scripts/compute-benchmark.ts — wall time and peak memory of FoldX and P2Rank on this machine, at
 * three structure sizes (doc/COMPUTE_ROUTING_PLAN.md, WP-0).
 *
 * WHY THIS EXISTS
 * ---------------
 * The placement engine's FoldX priors come from a handful of timings in comments, and it has no memory
 * numbers at all, so it judges memory by size alone. This script measures both tools the way production
 * runs them (the runner's job layout, command line, Box64 routing and P2Rank profile), on a fixed set of
 * AlphaFold models, and writes the result per host class so machines can be compared side by side:
 *
 *   doc/compute-benchmark/<host-class>.json   one file per machine class, replaced on each run
 *   doc/COMPUTE_BENCHMARK.md                  rendered from every JSON file in that folder
 *
 * Memory is the peak of the whole process tree (process-sampler.ts): Box64 + FoldX, or the P2Rank
 * script + its JVM. The engine's prior for each FoldX step is printed beside the measurement.
 *
 * Usage
 *   npm run compute:benchmark                     all sizes, FoldX and P2Rank
 *   npm run compute:benchmark -- --sizes small    one size (small, medium, large; comma list)
 *   npm run compute:benchmark -- --only foldx     one tool
 *   npm run compute:benchmark -- --render         only rebuild the Markdown from the JSON files
 *
 *   --out <dir>        where compute-benchmark/ and COMPUTE_BENCHMARK.md go (default: doc)
 *   --structures <dir> AlphaFold PDB cache (default: data/benchmark-structures); filled on first use
 *   --timeout <s>      per-step cap (default 1800: far above production, so a slow step FINISHES)
 *   --repair-all       RepairPDB at every size (default: only where production repairs, <= 400 residues)
 *
 * In the production container (no tsx, no sources: the build bundles this script):
 *   docker exec -it <app> node dist/compute-benchmark.cjs --out /app/data
 * then copy /app/data/compute-benchmark/<class>.json into doc/compute-benchmark/ in the repository and
 * run `npm run compute:benchmark -- --render`. A full run takes about 10 minutes on the 2-core server.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { foldxPriorP50Ms, foldxRepairApplies, formatDuration, hostClassOf } from "../src/shared/computeRouting.ts";
import { foldxBuildExpiry, serverHostFacts, serverTools } from "../server/services/infra/host-probe.ts";
import { ProcessTreeSampler } from "../server/services/infra/process-sampler.ts";
import { detectFoldxBinaryAndDir, getFoldxExecutionTarget } from "../server/services/stability/foldx/detector.ts";
import { cleanPdbForFoldX } from "../server/services/stability/foldx/pdb-utils.ts";
import { checkP2RankCapability, discoverJavaHome } from "../server/services/structure/pocket/java-detector.ts";
import { selectP2RankProfile } from "../server/services/structure/pocket/runner.ts";
import { fetchAlphafoldPdb } from "../server/services/structure/structure-fetcher.ts";
import { killProcessTree } from "../server/utils/process-tree.ts";
import { AA3, EXTRA_ARGS, defaultWorkRoot, prepareFoldxJobDir } from "./lib/foldx-job.ts";

/** The fixed set. AlphaFold models, so every machine measures identical coordinates. */
const STRUCTURES = [
  { size: "small", gene: "SOD1", uniprot: "P00441" },
  { size: "medium", gene: "GCK", uniprot: "P35557" },
  { size: "large", gene: "SLC12A4", uniprot: "Q9UP95" },
] as const;
type Size = (typeof STRUCTURES)[number]["size"];

/** BuildModel runs per job in production (foldx/runner.ts). */
const PRODUCTION_RUNS = 5;

interface Step {
  tool: "foldx" | "p2rank";
  step: "RepairPDB" | "BuildModel x5" | "predict";
  gene: string;
  residues: number;
  state: "completed" | "timed-out" | "failed";
  wallMs: number;
  peakRssBytes: number | null;
  /** FoldX only: this BuildModel ran on RepairPDB's output, so it is not comparable to the others. */
  repairedInput?: boolean;
  note?: string;
}

export interface BenchmarkReport {
  hostClass: string;
  measuredAt: string;
  host: { os: string; arch: string; emulated: boolean; cores: number; cpuModel: string; totalRamGiB: number };
  tools: { name: string; version: string; verified: boolean }[];
  foldxBuildExpires: string | null;
  steps: Step[];
}

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string) => argv.includes(`--${name}`);

function fail(message: string): never {
  console.error(`compute-benchmark: ${message}`);
  process.exit(2);
}

// ── Structures ──────────────────────────────────────────────────────────────────────────────────────

/** The app's own AlphaFold fetcher (version fallback, headers the EBI accepts), cached on disk here. */
async function alphaFoldPdb(uniprot: string, cacheDir: string): Promise<string> {
  const file = path.join(cacheDir, `AF-${uniprot}.pdb`);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  console.log(`Downloading the AlphaFold model for ${uniprot} …`);
  const text = await fetchAlphafoldPdb(uniprot);
  if (!text) throw new Error(`AlphaFold has no model for ${uniprot} (or could not be reached)`);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return text;
}

/**
 * Strip machine-specific paths from a diagnostic note before it is persisted. The note is committed to
 * `doc/compute-benchmark/*.json`, and spawn/tool diagnostics routinely contain executable, working
 * directory and home paths; the raw tail stays on the console.
 */
export function redactPaths(text: string, ...roots: string[]): string {
  let out = text;
  for (const r of roots) {
    if (r && r.length > 1) out = out.split(r).join("<path>");
  }
  return out;
}

/** Residues of chain A, and a mutation in the middle of it (to Ala, or Gly where it is Ala). */
function middleMutation(cleanedPdb: string): { residues: number; mutation: string } {
  const seen = new Map<number, string>();
  for (const line of cleanedPdb.split(/\r?\n/)) {
    if (!line.startsWith("ATOM") || line[21] !== "A") continue;
    seen.set(parseInt(line.slice(22, 26), 10), line.slice(17, 20).trim());
  }
  const positions = [...seen.keys()].sort((a, b) => a - b);
  if (positions.length === 0) throw new Error("no chain A residues");
  const pos = positions[Math.floor(positions.length / 2)];
  const wt3 = seen.get(pos)!;
  const wt1 = Object.entries(AA3).find(([, three]) => three === wt3)?.[0];
  if (!wt1) throw new Error(`unexpected residue ${wt3} at ${pos}`);
  return { residues: positions.length, mutation: `${wt1}A${pos}${wt1 === "A" ? "G" : "A"}` };
}

// ── Running one measured step ───────────────────────────────────────────────────────────────────────

function measure(
  file: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number; verbatim?: boolean },
): Promise<{ state: Step["state"]; wallMs: number; peakRssBytes: number | null; tail: string }> {
  const started = Date.now();
  const sampler = new ProcessTreeSampler({ intervalMs: process.platform === "win32" ? 2_000 : 500 });
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let settled = false;
    // `detached` gives the child its own process group on POSIX, so killProcessTree's -pid reaches the
    // JVM or container it starts, not only the wrapper.
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, windowsHide: true, windowsVerbatimArguments: opts.verbatim, detached: process.platform !== "win32" });
    sampler.track(child.pid);
    const cap = setTimeout(() => {
      timedOut = true;
      // Kill the whole tool tree: a bare child.kill() signals only the wrapper (the prank script, or
      // `docker`), leaving its JVM/container running — and unmeasured — for the rest of the run.
      killProcessTree(child.pid);
    }, opts.timeoutMs);
    child.stdout?.on("data", (d) => { output = (output + d).slice(-2_000); });
    child.stderr?.on("data", (d) => { output = (output + d).slice(-2_000); });
    const finish = async (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(cap);
      const wallMs = Date.now() - started;
      const peakRssBytes = await sampler.stop();
      resolve({ state: timedOut ? "timed-out" : ok ? "completed" : "failed", wallMs, peakRssBytes, tail: output.trim().split(/\r?\n/).slice(-3).join(" | ") });
    };
    child.on("error", (err) => { output += String(err); void finish(false); });
    child.on("close", (code) => void finish(code === 0));
  });
}

// ── The two tools ───────────────────────────────────────────────────────────────────────────────────

async function benchFoldx(opts: {
  gene: string;
  cleaned: string;
  residues: number;
  mutation: string;
  repair: boolean;
  workRoot: string;
  timeoutMs: number;
}): Promise<Step[]> {
  const { foldxBin, foldxDir } = detectFoldxBinaryAndDir();
  if (process.platform !== "win32") {
    try { fs.chmodSync(foldxBin, 0o755); } catch { /* read-only mount */ }
  }
  const steps: Step[] = [];
  const dirs: string[] = [];
  const run = (args: string[], jobDir: string) => {
    const target = getFoldxExecutionTarget(foldxBin, args);
    return measure(target.file, target.args, { cwd: jobDir, timeoutMs: opts.timeoutMs });
  };
  let input = opts.cleaned;
  let repairedInput = false;
  // Called only when a step "completed" but produced no output file.
  const missingNote = (tail: string, missing: string) => `no ${missing}: ${redactPaths(tail, opts.workRoot)}`;
  try {
    if (opts.repair) {
      const jobDir = prepareFoldxJobDir({ workRoot: opts.workRoot, label: `bench-repair-${opts.gene}`, pdbText: input, mutation: opts.mutation, foldxDir });
      dirs.push(jobDir);
      console.log(`  FoldX RepairPDB, ${opts.gene} (${opts.residues} residues) …`);
      const r = await run(["--command=RepairPDB", "--pdb=wt.pdb", ...EXTRA_ARGS], jobDir);
      const repaired = path.join(jobDir, "wt_Repair.pdb");
      const produced = fs.existsSync(repaired);
      if (produced) {
        input = fs.readFileSync(repaired, "utf8");
        repairedInput = true;
      }
      steps.push({
        tool: "foldx", step: "RepairPDB", gene: opts.gene, residues: opts.residues,
        state: r.state === "completed" && !produced ? "failed" : r.state, wallMs: r.wallMs, peakRssBytes: r.peakRssBytes,
        note: r.state === "completed" && !produced ? missingNote(r.tail, "wt_Repair.pdb") : r.state !== "completed" ? redactPaths(r.tail, opts.workRoot) : undefined,
      });
    }
    const jobDir = prepareFoldxJobDir({ workRoot: opts.workRoot, label: `bench-bm-${opts.gene}`, pdbText: input, mutation: opts.mutation, foldxDir });
    dirs.push(jobDir);
    console.log(`  FoldX BuildModel x${PRODUCTION_RUNS}, ${opts.gene} (${opts.residues} residues) …`);
    const r = await run(["--command=BuildModel", "--pdb=wt.pdb", "--mutant-file=individual_list.txt", `--numberOfRuns=${PRODUCTION_RUNS}`, ...EXTRA_ARGS], jobDir);
    const produced = fs.existsSync(path.join(jobDir, "Dif_wt.fxout"));
    steps.push({
      tool: "foldx", step: "BuildModel x5", gene: opts.gene, residues: opts.residues,
      state: r.state === "completed" && !produced ? "failed" : r.state, wallMs: r.wallMs, peakRssBytes: r.peakRssBytes,
      repairedInput,
      note: r.state === "completed" && !produced ? missingNote(r.tail, "Dif_wt.fxout") : r.state !== "completed" ? redactPaths(r.tail, opts.workRoot) : undefined,
    });
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
  return steps;
}

async function benchP2Rank(opts: { gene: string; pdbText: string; residues: number; workRoot: string; timeoutMs: number }): Promise<Step> {
  const cap = await checkP2RankCapability();
  if (!cap.ready || !cap.path) throw new Error("P2Rank is not ready on this machine (needs tools/p2rank and Java 17+)");
  const env = { ...process.env };
  const javaHome = await discoverJavaHome();
  if (javaHome) env.JAVA_HOME = javaHome;
  else if (javaHome === "") delete env.JAVA_HOME;
  fs.mkdirSync(opts.workRoot, { recursive: true });
  const jobDir = fs.mkdtempSync(path.join(opts.workRoot, `p2rank-bench-${opts.gene}-`));
  try {
    fs.writeFileSync(path.join(jobDir, "wt.pdb"), opts.pdbText, "utf8");
    // The runner's command line (pocket/runner.ts): same profile choice, same descriptor export.
    const args = ["predict", "-f", path.join(jobDir, "wt.pdb"), "-o", path.join(jobDir, "out"), "-c", selectP2RankProfile(opts.pdbText), "-export_pocket_descriptors", "1"];
    console.log(`  P2Rank predict, ${opts.gene} (${opts.residues} residues) …`);
    const isBatch = process.platform === "win32" && /\.(bat|cmd)$/i.test(cap.path);
    const r = isBatch
      ? await measure(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${[cap.path, ...args].map((a) => `"${a.replace(/"/g, '""')}"`).join(" ")}"`], { cwd: jobDir, env, timeoutMs: opts.timeoutMs, verbatim: true })
      : await measure(cap.path, args, { cwd: jobDir, env, timeoutMs: opts.timeoutMs });
    const produced = fs.existsSync(path.join(jobDir, "out", "wt.pdb_predictions.csv"));
    return {
      tool: "p2rank", step: "predict", gene: opts.gene, residues: opts.residues,
      state: r.state === "completed" && !produced ? "failed" : r.state, wallMs: r.wallMs, peakRssBytes: r.peakRssBytes,
      note: r.state === "completed" && !produced ? `no predictions file: ${redactPaths(r.tail, opts.workRoot)}` : r.state !== "completed" ? redactPaths(r.tail, opts.workRoot) : undefined,
    };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The engine's CURRENT prior (p50) for a FoldX step on that host, computed when the report is rendered,
 * so the table always shows how far today's prior is from the measurement. P2Rank has none.
 */
export function stepPriorMs(step: Pick<Step, "tool" | "step" | "residues">, emulated: boolean): number | null {
  if (step.tool !== "foldx") return null;
  const job = { residues: step.residues, numberOfRuns: PRODUCTION_RUNS };
  const plain = foldxPriorP50Ms({ ...job, repair: false }, emulated);
  return step.step === "RepairPDB" ? foldxPriorP50Ms({ ...job, repair: true }, emulated) - plain : plain;
}

const mib = (b: number | null) => (b == null ? "n/a" : `${Math.round(b / 1048576).toLocaleString("en-US")} MiB`);

export function renderBenchmarkMarkdown(reports: BenchmarkReport[]): string {
  const lines = [
    "# Compute benchmark",
    "",
    "Wall time and peak memory of FoldX and P2Rank, measured by `npm run compute:benchmark`",
    "(`scripts/compute-benchmark.ts`) the way production runs them. One section per machine class;",
    "the JSON beside this file (`doc/compute-benchmark/`) holds the same numbers for tools.",
    "",
    "- Memory is the peak of the whole process tree (Box64 + FoldX, or the P2Rank script + its JVM).",
    "- **Prior** is what the placement engine assumes TODAY before it has eight jobs of its own telemetry",
    "  (`foldxPriorP50Ms`, `src/shared/computeRouting.ts`), recomputed each time this file is rendered.",
    "  Native RepairPDB is anchored on the SOD1 row below. P2Rank has no time prior.",
    "- One run per row: a single measurement, not a distribution. The engine learns the spread from telemetry.",
    "- Structures are AlphaFold models with one mutation in the middle of chain A. Production skips",
    "  RepairPDB for AlphaFold models; here it is forced on an AlphaFold model (400 residues or fewer),",
    "  so the RepairPDB row is a LOWER BOUND for the experimental structures production actually repairs",
    "  (an AlphaFold model has almost nothing to repair).",
    "- A BuildModel row marked `repaired input` ran on RepairPDB's output, so it is not comparable to a",
    "  BuildModel row on the cleaned model.",
    "",
  ];
  if (reports.length === 0) lines.push("No measurements yet. Run `npm run compute:benchmark`.", "");
  for (const r of [...reports].sort((a, b) => a.hostClass.localeCompare(b.hostClass))) {
    const h = r.host;
    const prior = (s: Step) => {
      const ms = stepPriorMs(s, h.emulated);
      return ms == null ? "" : formatDuration(ms);
    };
    lines.push(
      `## ${r.hostClass}`,
      "",
      `Measured ${r.measuredAt.slice(0, 10)} on ${h.os}/${h.arch}${h.emulated ? " (FoldX under Box64)" : ""}, ${h.cores} cores (${h.cpuModel}), ${h.totalRamGiB} GiB.`,
      `Tools: ${r.tools.map((t) => `${t.name} ${t.version}${t.verified ? "" : " (self-test failed)"}`).join(", ") || "none found"}` +
        (r.foldxBuildExpires ? `; this FoldX build stops working on ${r.foldxBuildExpires}.` : "."),
      "",
      "| Tool | Step | Structure | Residues | Result | Wall time | Prior | Peak memory |",
      "|---|---|---|---:|---|---:|---:|---:|",
      ...r.steps.map((s) =>
        `| ${s.tool === "foldx" ? "FoldX" : "P2Rank"} | ${s.step} | ${s.gene} | ${s.residues} | ${s.state}${s.repairedInput ? " (repaired input)" : ""}${s.note ? ` (${s.note.replace(/\|/g, "/")})` : ""} | ${formatDuration(s.wallMs)} | ${prior(s)} | ${mib(s.peakRssBytes)} |`,
      ),
      "",
    );
  }
  return lines.join("\n");
}

function readReports(dir: string): BenchmarkReport[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as BenchmarkReport);
}

function writeMarkdown(outRoot: string) {
  const md = path.join(outRoot, "COMPUTE_BENCHMARK.md");
  fs.writeFileSync(md, renderBenchmarkMarkdown(readReports(path.join(outRoot, "compute-benchmark"))), "utf8");
  console.log(`Wrote ${md}`);
}

async function main() {
  const outRoot = arg("out") ?? "doc";
  if (flag("render")) return writeMarkdown(outRoot);

  const sizes = (arg("sizes") ?? "small,medium,large").split(",").map((s) => s.trim()) as Size[];
  for (const s of sizes) if (!STRUCTURES.some((x) => x.size === s)) fail(`unknown size "${s}" (small, medium, large)`);
  const only = arg("only");
  if (only && only !== "foldx" && only !== "p2rank") fail(`--only takes foldx or p2rank, got "${only}"`);
  const timeoutMs = parseInt(arg("timeout") ?? "1800", 10) * 1000;
  const cacheDir = arg("structures") ?? path.join("data", "benchmark-structures");
  const workRoot = defaultWorkRoot();

  // The same self-tests the server runs: a tool that fails here would fail in production too.
  const tools = await serverTools();
  const facts = serverHostFacts();
  const hostClass = hostClassOf(facts);
  const wantFoldx = only !== "p2rank";
  const wantP2Rank = only !== "foldx";
  const has = (name: string) => tools.some((t) => t.name === name && t.verified);
  if (wantFoldx && !has("foldx")) fail("FoldX did not pass its self-test on this machine; see the [host-probe] reason by starting the server, or use --only p2rank");
  if (wantP2Rank && !has("p2rank")) fail("P2Rank did not pass its self-test on this machine (needs tools/p2rank and Java 17+), or use --only foldx");

  console.log(`Benchmarking on ${hostClass} (${tools.map((t) => `${t.name} ${t.version}`).join(", ")}).`);
  const steps: Step[] = [];
  for (const s of STRUCTURES.filter((x) => sizes.includes(x.size))) {
    const raw = await alphaFoldPdb(s.uniprot, cacheDir);
    const cleaned = cleanPdbForFoldX(raw);
    const { residues, mutation } = middleMutation(cleaned);
    console.log(`${s.gene} (${s.uniprot}, ${residues} residues), mutation ${mutation}:`);
    if (wantFoldx) {
      const repair = flag("repair-all") || foldxRepairApplies(residues);
      steps.push(...(await benchFoldx({ gene: s.gene, cleaned, residues, mutation, repair, workRoot, timeoutMs })));
    }
    if (wantP2Rank) steps.push(await benchP2Rank({ gene: s.gene, pdbText: raw, residues, workRoot, timeoutMs }));
    for (const st of steps.filter((x) => x.gene === s.gene)) {
      console.log(`    ${st.tool} ${st.step}: ${st.state}, ${formatDuration(st.wallMs)}, peak ${mib(st.peakRssBytes)}${stepPriorMs(st, facts.emulated) != null ? ` (prior ${formatDuration(stepPriorMs(st, facts.emulated)!)})` : ""}`);
    }
  }

  const { foldxBin } = detectFoldxBinaryAndDir();
  const report: BenchmarkReport = {
    hostClass,
    measuredAt: new Date().toISOString(),
    host: {
      os: process.platform,
      arch: process.arch,
      emulated: facts.emulated,
      cores: facts.cores,
      cpuModel: os.cpus()[0]?.model?.trim() ?? "unknown",
      totalRamGiB: Math.round(facts.totalRamBytes / 1024 ** 3),
    },
    tools,
    foldxBuildExpires: foldxBuildExpiry(foldxBin),
    steps,
  };
  const dir = path.join(outRoot, "compute-benchmark");
  fs.mkdirSync(dir, { recursive: true });
  const json = path.join(dir, `${hostClass}.json`);
  fs.writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${json}`);
  writeMarkdown(outRoot);
}

// Run only as a script, so the renderer can be imported by tests.
const invoked = process.argv[1] ? path.basename(process.argv[1]).replace(/\.(c?js|ts)$/, "") : "";
if (invoked === "compute-benchmark") {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

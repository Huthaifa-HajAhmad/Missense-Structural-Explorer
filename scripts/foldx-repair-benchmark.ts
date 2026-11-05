/**
 * foldx-repair-benchmark.ts — which FoldX repair is closest to EXPERIMENT?
 *
 * The app repairs the template in one of two ways (`src/shared/foldxRepairMode.ts`), and until now the two
 * were only compared with each other, as if a whole-chain repair were the truth. This script runs FoldX on
 * variants with a measured stability change, under all three template states, and compares each with the
 * measurement:
 *
 *   none   BuildModel on the cleaned structure
 *   full   RepairPDB on the whole chain, once per chain, then BuildModel
 *   local  RepairPDB with the shipped shell rule (`planFixShell`), once per position, then BuildModel
 *
 * It uses the shipped cleaner, shell planner and result parser, the same command lines as the runner, and
 * 5 BuildModel runs. Results are appended to `results.jsonl`, so an interrupted run resumes.
 *
 *   npx tsx scripts/foldx-repair-benchmark.ts --chains 30         pilot: the 10 largest chains + an even spread
 *   npx tsx scripts/foldx-repair-benchmark.ts                     every chain
 *   npx tsx scripts/foldx-repair-benchmark.ts --report            statistics only, from results.jsonl
 *   ... --report --write-disclosure                               also rewrites the numbers the interface shows
 *                                                                 (src/shared/foldxRepairBenchmark.generated.ts)
 *
 * The default dataset is S669 (Pancotti et al. 2022), as shipped in tools/thermompnn. In that file a NEGATIVE
 * value is destabilizing, so it is negated here to match the app's convention (positive = destabilizing).
 * Work files stay under logs/, because FoldX writes nothing when run from the Windows temp folder.
 */
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { AMINO_ACID_3_TO_1 } from "../src/shared/aminoAcids.ts";
import { cleanPdbForFoldX } from "../server/services/stability/foldx/pdb-utils.ts";
import { parseFoldxDifFile } from "../server/services/stability/foldx/parser.ts";
import { planFixShell } from "../server/services/stability/foldx/repair-shell.ts";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const OUT = path.resolve(arg("out") ?? "logs/foldx_bench/s669");
const DATASET = path.resolve(arg("dataset") ?? "tools/thermompnn/data_all/testing/s669_clean_dir.csv");
const WORKERS = parseInt(arg("workers") ?? "12", 10);
const CHAINS = arg("chains") ? parseInt(arg("chains")!, 10) : null;
const FOLDX = path.resolve(arg("foldx") ?? "tools/foldx/foldx_1_20270131.exe");
const MOLECULES = path.join(path.dirname(FOLDX), "molecules");
const ROTABASE = path.resolve(arg("rotabase") ?? "logs/foldx_bench/full/rotabase.txt");
const REPAIR_CAP_MS = 45 * 60 * 1000;
const BUILD_CAP_MS = 20 * 60 * 1000;
/** The conditions the app sends; a repaired template is only valid under the conditions it was made with. */
const CONDITIONS = ["--timeSeedRotabase=false", "--pH=7.4", "--temperature=298.15", "--ionStrength=0.15"];

type Mode = "none" | "full" | "local";
const MODES: Mode[] = ["none", "full", "local"];

interface Row { id: string; pdb: string; chain: string; wt: string; pos: number; mut: string; measured: number }
interface Residue { resSeq: number; insCode: string; aa: string }
interface Result {
  id: string; pdb: string; chain: string; mutation: string; residues: number; numbering: string; measured: number;
  movable: number | null; sphere: number | null;
  ddg: Partial<Record<Mode, number | null>>; sd: Partial<Record<Mode, number | null>>; seconds: Partial<Record<Mode, number>>;
  error?: string;
}

function readRows(): Row[] {
  const lines = fs.readFileSync(DATASET, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const col = (name: string) => header.indexOf(name);
  return lines.slice(1).map(line => {
    const c = line.split(",");
    const code = c[col("PDB")];
    const m = /^([A-Z])(\d+)([A-Z])$/.exec(c[col("MUT")])!;
    return {
      id: `${code}_${c[col("MUT")]}`,
      pdb: code.slice(0, 4).toUpperCase(), chain: code.slice(4),
      wt: m[1], pos: parseInt(m[2], 10), mut: m[3],
      measured: -parseFloat(c[col("DDG")])
    };
  });
}

/** One chain of the first model, cleaned exactly as the runner cleans a template. */
function chainText(pdbText: string, chain: string): string {
  const kept: string[] = [];
  for (const line of pdbText.split(/\r?\n/)) {
    if (line.startsWith("ENDMDL")) break;
    if (line.startsWith("ATOM") && line[21] === chain) kept.push(line);
  }
  return cleanPdbForFoldX(kept.join("\n"));
}

function residuesOf(cleaned: string): Residue[] {
  const seen = new Map<string, Residue>();
  for (const line of cleaned.split(/\r?\n/)) {
    if (!line.startsWith("ATOM") || line.slice(12, 16).trim() !== "CA") continue;
    const key = line.slice(22, 27);
    if (!seen.has(key)) {
      seen.set(key, { resSeq: parseInt(line.slice(22, 26), 10), insCode: line[26].trim(), aa: AMINO_ACID_3_TO_1[line.slice(17, 20).trim().toUpperCase()] ?? "?" });
    }
  }
  return [...seen.values()];
}

/**
 * The residue a dataset position refers to. The file's numbering is the structure's own for most rows and a
 * running count along the chain for others, so the wild-type letter decides; a row matching neither is dropped.
 */
function locate(residues: Residue[], row: Row): { residue: Residue; numbering: string } | null {
  const own = residues.find(r => r.resSeq === row.pos && r.insCode === "");
  if (own?.aa === row.wt) return { residue: own, numbering: "structure" };
  const running = residues[row.pos - 1];
  if (running?.aa === row.wt) return { residue: running, numbering: "running-count" };
  return null;
}

// ── A fixed number of FoldX processes at a time ─────────────────────────────────────────────────────
let free = WORKERS;
const waiting: Array<() => void> = [];
async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (free === 0) await new Promise<void>(resolve => waiting.push(resolve));
  else free -= 1;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else free += 1;
  }
}

function makeWorkDir(): string {
  const dir = path.join(OUT, "work", crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(MOLECULES, path.join(dir, "molecules"), "junction");
  fs.linkSync(ROTABASE, path.join(dir, "rotabase.txt"));
  return dir;
}

function foldx(cwd: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(FOLDX, [...args, ...CONDITIONS], { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, err => (err ? reject(err) : resolve()));
  });
}

/** RepairPDB, kept on disk so a resumed run does not pay for it again. Null when FoldX wrote no template. */
async function repaired(cacheFile: string, wt: string, fixResiduesFile?: string | null): Promise<string | null> {
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, "utf8");
  return withSlot(async () => {
    const dir = makeWorkDir();
    try {
      fs.writeFileSync(path.join(dir, "wt.pdb"), wt);
      if (fixResiduesFile) fs.writeFileSync(path.join(dir, "fix.txt"), fixResiduesFile);
      await foldx(dir, ["--command=RepairPDB", "--pdb=wt.pdb", ...(fixResiduesFile ? ["--fix-residues-file=fix.txt"] : [])], REPAIR_CAP_MS);
      const out = path.join(dir, "wt_Repair.pdb");
      if (!fs.existsSync(out)) return null;
      const text = fs.readFileSync(out, "utf8");
      fs.writeFileSync(cacheFile, text);
      return text;
    } catch (err: any) {
      console.warn(`[repair] ${path.basename(cacheFile)}: ${String(err?.message ?? err).slice(0, 160)}`);
      return null;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
}

async function buildModel(template: string, mutationLine: string): Promise<{ ddg: number | null; sd: number | null; seconds: number }> {
  return withSlot(async () => {
    const dir = makeWorkDir();
    const startedAt = Date.now();
    try {
      fs.writeFileSync(path.join(dir, "wt.pdb"), template);
      fs.writeFileSync(path.join(dir, "individual_list.txt"), mutationLine);
      await foldx(dir, ["--command=BuildModel", "--pdb=wt.pdb", "--mutant-file=individual_list.txt", "--numberOfRuns=5"], BUILD_CAP_MS);
      const parsed = parseFoldxDifFile(fs.readFileSync(path.join(dir, "Dif_wt.fxout"), "utf8"));
      return { ddg: parsed.ddG, sd: parsed.sd, seconds: (Date.now() - startedAt) / 1000 };
    } catch (err: any) {
      console.warn(`[build] ${mutationLine.trim()}: ${String(err?.message ?? err).slice(0, 160)}`);
      return { ddg: null, sd: null, seconds: (Date.now() - startedAt) / 1000 };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
}

async function fetchPdb(code: string): Promise<string | null> {
  const file = path.join(OUT, "pdb", `${code}.pdb`);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const res = await fetch(`https://files.rcsb.org/download/${code}.pdb`);
  if (!res.ok) return null;
  const text = await res.text();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

async function run(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const resultsFile = path.join(OUT, "results.jsonl");
  const done = new Set(fs.existsSync(resultsFile)
    ? fs.readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map(l => (JSON.parse(l) as Result).id)
    : []);

  const groups = new Map<string, Row[]>();
  for (const row of readRows()) {
    const key = `${row.pdb}${row.chain}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const chains: Array<{ key: string; rows: Row[]; wt: string; residues: Residue[] }> = [];
  const dropped: string[] = [];
  for (const [key, rows] of groups) {
    const text = await fetchPdb(rows[0].pdb);
    if (!text) { dropped.push(`${key}: no PDB-format file at RCSB`); continue; }
    const wt = chainText(text, rows[0].chain);
    const residues = residuesOf(wt);
    if (residues.length === 0) { dropped.push(`${key}: chain not in the file`); continue; }
    chains.push({ key, rows, wt, residues });
  }
  chains.sort((a, b) => b.residues.length - a.residues.length);

  let selected = chains;
  if (CHAINS !== null && CHAINS < chains.length) {
    // Deterministic: the largest chains (where a local repair differs most from a whole-chain one) plus an even spread.
    const largest = chains.slice(0, Math.min(10, CHAINS));
    const rest = chains.slice(largest.length);
    const need = CHAINS - largest.length;
    selected = [...largest, ...Array.from({ length: need }, (_, i) => rest[Math.floor((i * rest.length) / need)])];
  }
  console.log(`[benchmark] ${chains.length} chains available, ${selected.length} selected, sizes ${selected[selected.length - 1].residues.length} to ${selected[0].residues.length}. Dropped: ${dropped.join("; ") || "none"}`);

  const startedAt = Date.now();
  let finished = 0;
  const pending = selected.flatMap(c => c.rows).filter(r => !done.has(r.id)).length;

  await Promise.all(selected.map(async ({ key, rows, wt, residues }) => {
    const dir = path.join(OUT, "chains", key);
    fs.mkdirSync(dir, { recursive: true });
    const todo = rows.filter(r => !done.has(r.id));
    if (todo.length === 0) return;

    const full = await repaired(path.join(dir, "full_Repair.pdb"), wt);
    const localByPosition = new Map<string, Promise<{ text: string | null; movable: number | null; sphere: number | null }>>();

    await Promise.all(todo.map(async row => {
      const base = { id: row.id, pdb: row.pdb, chain: row.chain, residues: residues.length, measured: row.measured };
      const found = locate(residues, row);
      if (!found) {
        const skipped: Result = { ...base, mutation: `${row.wt}${row.pos}${row.mut}`, numbering: "unmatched", movable: null, sphere: null, ddg: {}, sd: {}, seconds: {}, error: "wild type does not match the structure" };
        fs.appendFileSync(resultsFile, JSON.stringify(skipped) + "\n");
        finished += 1;
        return;
      }
      const { residue, numbering } = found;
      const site = `${residue.resSeq}${residue.insCode}`;
      if (!localByPosition.has(site)) {
        const plan = planFixShell(wt, { chain: row.chain, resSeq: residue.resSeq, insCode: residue.insCode });
        localByPosition.set(site, repaired(path.join(dir, `local_${site}_Repair.pdb`), wt, plan?.fixResiduesFile).then(text => ({
          text, movable: plan?.summary.movableResidues ?? null, sphere: plan?.summary.sphereResidues ?? null
        })));
      }
      const local = await localByPosition.get(site)!;
      const line = `${row.wt}${row.chain}${residue.resSeq}${residue.insCode}${row.mut};\n`;
      const templates: Record<Mode, string | null> = { none: wt, full, local: local.text };

      const result: Result = { ...base, mutation: line.trim().replace(";", ""), numbering, movable: local.movable, sphere: local.sphere, ddg: {}, sd: {}, seconds: {} };
      await Promise.all(MODES.map(async mode => {
        const template = templates[mode];
        if (!template) { result.ddg[mode] = null; return; }
        const r = await buildModel(template, line);
        result.ddg[mode] = r.ddg;
        result.sd[mode] = r.sd;
        result.seconds[mode] = r.seconds;
      }));
      fs.appendFileSync(resultsFile, JSON.stringify(result) + "\n");
      finished += 1;
      if (finished % 10 === 0) console.log(`[benchmark] ${finished}/${pending} done, ${((Date.now() - startedAt) / 60000).toFixed(1)} min`);
    }));
    console.log(`[benchmark] chain ${key} (${residues.length} residues) finished`);
  }));
  fs.rmSync(path.join(OUT, "work"), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  report();
}

// ── Statistics ───────────────────────────────────────────────────────────────────────────────────────
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
function pearson(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
function ranks(v: number[]): number[] {
  const order = v.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(v.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
    for (let k = i; k <= j; k++) out[order[k].i] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}
const rmse = (x: number[], y: number[]) => Math.sqrt(mean(x.map((v, i) => (v - y[i]) ** 2)));
const mae = (x: number[], y: number[]) => mean(x.map((v, i) => Math.abs(v - y[i])));
const band = (v: number) => (v >= 1.5 ? 2 : v >= 0.5 ? 1 : 0);
const percentile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

type Complete = Result & { ddg: Record<Mode, number> };

/** Rows are grouped by protein, so the interval resamples whole chains, not single rows. */
function bootstrapDifference(rows: Complete[], metric: (x: number[], y: number[]) => number, a: Mode, b: Mode, draws = 2000): { low: number; high: number } {
  const byChain = [...new Set(rows.map(r => r.pdb + r.chain))].map(key => rows.filter(r => r.pdb + r.chain === key));
  let seed = 20261103;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const diffs: number[] = [];
  for (let d = 0; d < draws; d++) {
    const sample: Complete[] = [];
    for (let i = 0; i < byChain.length; i++) sample.push(...byChain[Math.floor(random() * byChain.length)]);
    const measured = sample.map(r => r.measured);
    diffs.push(metric(sample.map(r => r.ddg[a]), measured) - metric(sample.map(r => r.ddg[b]), measured));
  }
  diffs.sort((x, y) => x - y);
  return { low: percentile(diffs, 0.025), high: percentile(diffs, 0.975) };
}

function section(title: string, rows: Complete[]): Record<string, unknown> | null {
  if (rows.length < 5) {
    console.log(`\n${title}: only ${rows.length} variants, not reported`);
    return null;
  }
  const measured = rows.map(r => r.measured);
  const chains = new Set(rows.map(r => r.pdb + r.chain)).size;
  console.log(`\n${title}: ${rows.length} variants on ${chains} chains`);
  const perMode: Record<string, unknown> = {};
  for (const mode of MODES) {
    const x = rows.map(r => r.ddg[mode]);
    const stats = {
      pearson: pearson(x, measured),
      spearman: pearson(ranks(x), ranks(measured)),
      rmse: rmse(x, measured),
      mae: mae(x, measured),
      bandAgreement: mean(x.map((v, i) => (band(v) === band(measured[i]) ? 1 : 0)))
    };
    perMode[mode] = stats;
    console.log(`  ${mode.padEnd(5)} r ${stats.pearson.toFixed(3)}  rho ${stats.spearman.toFixed(3)}  RMSE ${stats.rmse.toFixed(3)}  MAE ${stats.mae.toFixed(3)}  band matches measurement ${(stats.bandAgreement * 100).toFixed(1)}%`);
  }
  const compare = (a: Mode, b: Mode) => {
    const dR = bootstrapDifference(rows, pearson, a, b);
    const dE = bootstrapDifference(rows, rmse, a, b);
    console.log(`  ${a} minus ${b} (95% interval, resampling chains): r [${dR.low.toFixed(3)}, ${dR.high.toFixed(3)}], RMSE [${dE.low.toFixed(3)}, ${dE.high.toFixed(3)}]`);
    return { pearson: dR, rmse: dE };
  };
  const localVsFull = compare("local", "full");
  const noneVsFull = compare("none", "full");
  const gaps = rows.map(r => Math.abs(r.ddg.local - r.ddg.full)).sort((a, b) => a - b);
  const flips = rows.filter(r => band(r.ddg.local) !== band(r.ddg.full)).length;
  const noneFlips = rows.filter(r => band(r.ddg.none) !== band(r.ddg.full)).length;
  const signed = mean(rows.map(r => r.ddg.local - r.ddg.full));
  console.log(`  local vs full: median gap ${percentile(gaps, 0.5).toFixed(3)}, 90th ${percentile(gaps, 0.9).toFixed(3)}, max ${gaps[gaps.length - 1].toFixed(3)}, mean signed ${signed.toFixed(3)}, band changes ${flips} of ${rows.length}`);
  console.log(`  none vs full: band changes ${noneFlips} of ${rows.length}`);
  return { variants: rows.length, chains, perMode, localVsFull, noneVsFull, medianGap: percentile(gaps, 0.5), maxGap: gaps[gaps.length - 1], signedGap: signed, flips, noneFlips };
}

function report(): void {
  const all = fs.readFileSync(path.join(OUT, "results.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as Result);
  const complete = all.filter((r): r is Complete => MODES.every(m => typeof r.ddg[m] === "number"));
  const reasons = all.filter(r => !complete.includes(r as Complete));
  console.log(`\n${all.length} rows, ${complete.length} complete under all three modes, ${reasons.filter(r => r.error).length} unmatched, ${reasons.filter(r => !r.error).length} with a FoldX failure. Numbering: ${all.filter(r => r.numbering === "structure").length} structure, ${all.filter(r => r.numbering === "running-count").length} running count.`);
  const summary = {
    conditions: CONDITIONS,
    all: section("All variants", complete),
    above233: section("Chains above 233 residues (where the app uses the local repair)", complete.filter(r => r.residues > 233)),
    atMost233: section("Chains up to 233 residues", complete.filter(r => r.residues <= 233)),
    restricted: section("Local repair moved under half the chain", complete.filter(r => r.movable !== null && r.movable / r.residues < 0.5)),
    timings: Object.fromEntries(MODES.map(m => [m, mean(complete.map(r => r.seconds[m] ?? 0))]))
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

  if (process.argv.includes("--write-disclosure")) {
    const above = summary.above233 as any;
    const allSizes = summary.all as any;
    const small = summary.atMost233 as any;
    const two = (v: number) => Math.round(v * 100) / 100;
    // "Always say no destabilization" is what the band has to beat, so it is shown beside the band's score.
    const neutralShare = (rows: Complete[]) => two(mean(rows.map(r => (band(r.measured) === 0 ? 1 : 0))) * 100);
    // A regression slope cannot say this: it is low whenever the correlation is low. The averages can.
    const large = complete.filter(r => r.ddg.full >= 3);
    const body = {
      dataset: path.basename(DATASET),
      // The local repair's own figures, on the chains large enough to use it.
      variants: above.variants,
      chains: above.chains,
      medianGap: two(above.medianGap),
      maxGap: two(above.maxGap),
      bandChanges: above.flips,
      typicalError: two(above.perMode.local.rmse),
      // FoldX's accuracy against the measured ΔΔG, by the mode each size actually gets. The band chip
      // beside the value needs both: picking one would misstate whichever regime the reader is in.
      smallChainRmse: two(small.perMode.full.rmse),
      smallChainVariants: small.variants,
      smallChainBandAgreement: two(small.perMode.full.bandAgreement * 100),
      localBandAgreement: two(above.perMode.local.bandAgreement * 100),
      overallRmse: two(allSizes.perMode.full.rmse),
      overallVariants: allSizes.variants,
      overallBandAgreement: two(allSizes.perMode.full.bandAgreement * 100),
      overallNeutralShare: neutralShare(complete),
      smallChainNeutralShare: neutralShare(complete.filter(r => r.residues <= 233)),
      localNeutralShare: neutralShare(complete.filter(r => r.residues > 233)),
      smallChainWithinError: two(mean(complete.filter(r => r.residues <= 233).map(r => (Math.abs(r.ddg.full - r.measured) <= small.perMode.full.rmse ? 1 : 0))) * 100),
      localWithinError: two(mean(complete.filter(r => r.residues > 233).map(r => (Math.abs(r.ddg.local - r.measured) <= above.perMode.local.rmse ? 1 : 0))) * 100),
      largeValueFoldx: two(mean(large.map(r => r.ddg.full))),
      largeValueMeasured: two(mean(large.map(r => r.measured)))
    };
    fs.writeFileSync(
      path.resolve("src/shared/foldxRepairBenchmark.generated.ts"),
      "// Written by `npx tsx scripts/foldx-repair-benchmark.ts --report --write-disclosure`. Do not edit by hand.\n" +
        "// Above 233 residues the app repairs locally (typicalError, medianGap, maxGap, bandChanges cover those chains).\n" +
        "// overall* / smallChain* are FoldX's error against the measured ΔΔG (kcal/mol) and its band hit rate.\n" +
        `export const LOCAL_REPAIR_BENCHMARK = ${JSON.stringify(body, null, 2)} as const;\n`
    );
  }
}

if (process.argv.includes("--report")) report();
else await run();

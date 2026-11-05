/**
 * verdict-benchmark.ts — how good is the Energetics headline verdict against the lab?
 *
 * Takes the per-variant FoldX rows from scripts/foldx-repair-benchmark.ts, adds ThermoMPNN and StabilityOracle through the same
 * sidecar endpoints the app uses, and feeds all three into the shipped `buildEnergeticsEvidence`, so the verdict tested is the
 * one users see. Only these engines run: DynaMut2 and DDMut are remote academic services and are not for bulk use, and RaSP is
 * a table keyed by accession. So this is the verdict over 3 of 6 engines, and the report says so.
 *
 * Needs a running sidecar:  SIDECAR_SECRET=... SIDECAR_PORT=8011 tools/.venv/Scripts/python.exe tools/model_server.py
 *
 *   SIDECAR_SECRET=... npx tsx scripts/verdict-benchmark.ts --collect logs/foldx_bench/s669
 *   npx tsx scripts/verdict-benchmark.ts --report logs/foldx_bench/s669 logs/foldx_bench/ssym
 *
 * Results are appended to engines.jsonl, so an interrupted run resumes. Sign: positive = destabilizing, as in the app.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { cleanPdbForFoldX } from "../server/services/stability/foldx/pdb-utils.ts";
import { buildEnergeticsEvidence, type AgreementDirection } from "../src/shared/energeticsEvidence.ts";

const BASE = process.env.SIDECAR_URL ?? "http://127.0.0.1:8011";
const SECRET = process.env.SIDECAR_SECRET ?? "";
const CONCURRENCY = parseInt(process.env.BENCH_CONCURRENCY ?? "3", 10);

export interface FoldxRow { id: string; pdb: string; chain: string; mutation: string; residues: number; measured: number; ddg: Record<string, number | null> }
export interface EngineRow { id: string; thermompnn: number | null; stabilityoracle: number | null; thermompnnError?: string; stabilityoracleError?: string }

const readJsonl = <T>(file: string): T[] =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as T) : [];

const complete = (r: FoldxRow) => ["none", "full", "local"].every(m => typeof r.ddg[m] === "number");

function templateOf(dir: string, r: FoldxRow): string {
  const kept: string[] = [];
  for (const line of fs.readFileSync(path.join(dir, "pdb", `${r.pdb}.pdb`), "utf8").split(/\r?\n/)) {
    if (line.startsWith("ENDMDL")) break;
    if (line.startsWith("ATOM") && line[21] === r.chain) kept.push(line);
  }
  return cleanPdbForFoldX(kept.join("\n"));
}

async function post(endpoint: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Sidecar-Secret": SECRET },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function collect(dir: string): Promise<void> {
  const out = path.join(dir, "engines.jsonl");
  const done = new Set(readJsonl<EngineRow>(out).map(r => r.id));
  const rows = readJsonl<FoldxRow>(path.join(dir, "results.jsonl")).filter(r => complete(r) && !done.has(r.id));
  console.log(`[engines] ${dir}: ${rows.length} variants to run`);
  const startedAt = Date.now();
  let next = 0, finished = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < rows.length) {
      const r = rows[next++];
      const wtPdb = templateOf(dir, r);
      const m = /^([A-Z])([A-Za-z0-9])(\d+)[A-Za-z]?([A-Z])$/.exec(r.mutation)!;
      const row: EngineRow = { id: r.id, thermompnn: null, stabilityoracle: null };
      try {
        const t = await post("/predict/thermompnn", { pdb_content: wtPdb, mutation: r.mutation, chain: m[2] });
        if (typeof t?.ddG === "number") row.thermompnn = t.ddG;
        else row.thermompnnError = String(t?.error ?? "no value").slice(0, 160);
      } catch (err: any) {
        row.thermompnnError = String(err?.message ?? err).slice(0, 160);
      }
      try {
        const s = await post("/predict/stabilityoracle", { sequence: "", position: parseInt(m[3], 10), wt: m[1], mut: m[4], wtPdb, chain: m[2] });
        if (typeof s?.ddG === "number") row.stabilityoracle = s.ddG;
        else row.stabilityoracleError = String(s?.error ?? "no value").slice(0, 160);
      } catch (err: any) {
        row.stabilityoracleError = String(err?.message ?? err).slice(0, 160);
      }
      fs.appendFileSync(out, JSON.stringify(row) + "\n");
      finished += 1;
      if (finished % 25 === 0) console.log(`[engines] ${finished}/${rows.length}, ${((Date.now() - startedAt) / 60000).toFixed(1)} min`);
    }
  }));
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────────────
export const band = (v: number) => (v >= 1.5 ? 2 : v >= 0.5 ? 1 : 0);
/** Typed on the app's own direction names, so a new direction there fails the type check here until it is given a band. */
export const DIRECTION_BAND: Record<AgreementDirection, number | null> = {
  destabilizing: 2, "mostly-destabilizing": 2, moderate: 1, "mostly-moderate": 1, "not-destabilizing": 0, "mostly-not-destabilizing": 0, split: null, none: null
};

export interface Row { key: string; measured: number; foldx: number; thermompnn: number; stabilityoracle: number; verdict: number | null; noFoldx: number | null; noFoldxModerate: number | null; bands: Record<string, number> }

/** The app's own marks decide each engine's band, read back from the evidence model rather than copied here. */
export function buildRow(f: FoldxRow, e: EngineRow): Row | null {
  if (e.thermompnn === null || e.stabilityoracle === null) return null;
  const foldx = f.residues <= 233 ? (f.ddg.full as number) : (f.ddg.local as number);
  const evidence = (energetics: Record<string, unknown>) =>
    buildEnergeticsEvidence({ foldingStatus: "success", foldingEnergetics: { ...energetics, dynamut2: null, ddmut: null, rasp: null, structureProvenance: { source: "experimental", chainId: f.chain } }, dynamut2Status: "unavailable", ddmutStatus: "unavailable", thermompnnStatus: "done" });
  const all = evidence({ foldx, foldxMean: foldx, thermompnn: e.thermompnn, stabilityoracle: e.stabilityoracle });
  const riskBand = (id: string) => {
    const risk = all.readings.find(r => r.key === id)?.outcome.risk?.id;
    return risk === "high" ? 2 : risk === "moderate" ? 1 : 0;
  };
  const bands = { foldx: riskBand("foldx"), thermompnn: riskBand("thermompnn"), stabilityoracle: riskBand("stabilityoracle") };
  const noFoldx = evidence({ foldx: null, foldxMean: null, thermompnn: e.thermompnn, stabilityoracle: e.stabilityoracle });
  // FoldX's reading, when it is in its moderate band, simply does not vote.
  const moderateOut = bands.foldx === 1 ? noFoldx : all;
  return {
    key: f.pdb + f.chain, measured: f.measured, foldx, thermompnn: e.thermompnn, stabilityoracle: e.stabilityoracle,
    verdict: DIRECTION_BAND[all.agreement.direction], noFoldx: DIRECTION_BAND[noFoldx.agreement.direction], noFoldxModerate: DIRECTION_BAND[moderateOut.agreement.direction], bands
  };
}

/** `low`/`high` are the 95% interval the usefulness rule reads. `low90`/`high90` show how close to the line a result sits. */
export type Score = { value: number; low: number; high: number; low90: number; high90: number };

export function resampled<T extends { key: string }>(rows: T[], stat: (s: T[]) => number): Score {
  const keys = [...new Set(rows.map(r => r.key))];
  const by = new Map(keys.map(k => [k, rows.filter(r => r.key === k)]));
  let seed = 20261104;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const draws: number[] = [];
  for (let d = 0; d < 2000; d++) {
    const s: T[] = [];
    for (let i = 0; i < keys.length; i++) s.push(...by.get(keys[Math.floor(rand() * keys.length)])!);
    draws.push(stat(s));
  }
  draws.sort((a, b) => a - b);
  const at = (share: number) => draws[Math.floor(draws.length * share)];
  return { value: stat(rows), low: at(0.025), high: at(0.975), low90: at(0.05), high90: at(0.95) };
}

const called = (rows: Row[], get: (r: Row) => number | null) => rows.filter(r => get(r) !== null);
export const agreement = (rows: Row[], get: (r: Row) => number | null) => {
  const c = called(rows, get);
  return c.length ? c.filter(r => get(r) === band(r.measured)).length / c.length : NaN;
};
const neutralShare = (rows: Row[]) => rows.filter(r => band(r.measured) === 0).length / rows.length;

function pearson(x: number[], y: number[]): number {
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  x.forEach((v, i) => { sxy += (v - mx) * (y[i] - my); sxx += (v - mx) ** 2; syy += (y[i] - my) ** 2; });
  return sxy / Math.sqrt(sxx * syy);
}
const pct = (v: number) => (v * 100).toFixed(1);

function report(dirs: string[]): void {
  const summary: Record<string, unknown> = {};
  for (const dir of dirs) {
    const engines = new Map(readJsonl<EngineRow>(path.join(dir, "engines.jsonl")).map(e => [e.id, e]));
    const foldx = readJsonl<FoldxRow>(path.join(dir, "results.jsonl")).filter(complete);
    const rows = foldx.flatMap(f => { const e = engines.get(f.id); const row = e ? buildRow(f, e) : null; return row ? [row] : []; });
    const failed = [...engines.values()].filter(e => e.thermompnn === null || e.stabilityoracle === null);
    console.log(`\n=== ${dir}: ${rows.length} of ${foldx.length} variants with all three engines, ${new Set(rows.map(r => r.key)).size} chains; ${failed.length} engine failures${failed[0] ? ` (e.g. ${failed[0].thermompnnError ?? failed[0].stabilityoracleError})` : ""} ===`);
    const y = rows.map(r => r.measured);
    const engineList = ["foldx", "thermompnn", "stabilityoracle"] as const;
    const singles: Record<string, unknown> = {};
    for (const name of engineList) {
      const x = rows.map(r => r[name]);
      const rmse = Math.sqrt(x.reduce((a, v, i) => a + (v - y[i]) ** 2, 0) / x.length);
      const a = agreement(rows, r => r.bands[name]);
      singles[name] = { r: pearson(x, y), rmse, band: a };
      console.log(`  ${name.padEnd(16)} r ${pearson(x, y).toFixed(3)} RMSE ${rmse.toFixed(3)} band ${pct(a)}% (with the app's marks for that engine)`);
    }
    const med = rows.map(r => [r.foldx, r.thermompnn, r.stabilityoracle].sort((a, b) => a - b)[1]);
    console.log(`  median of the 3    r ${pearson(med, y).toFixed(3)} RMSE ${Math.sqrt(med.reduce((a, v, i) => a + (v - y[i]) ** 2, 0) / med.length).toFixed(3)}`);

    const neutral = neutralShare(rows);
    const gain = (get: (r: Row) => number | null) => resampled(rows, s => agreement(s, get) - neutralShare(called(s, get)));
    const callRate = (get: (r: Row) => number | null) => called(rows, get).length / rows.length;
    const line = (label: string, get: (r: Row) => number | null) => {
      const g = gain(get);
      console.log(`  ${label.padEnd(26)} calls ${pct(callRate(get))}%, band ${pct(agreement(rows, get))}%, beats always-neutral on those by ${pct(g.value)}, 95% [${pct(g.low)}, ${pct(g.high)}], 90% [${pct(g.low90)}, ${pct(g.high90)}]`);
      return { callRate: callRate(get), agreement: agreement(rows, get), gain: g };
    };
    console.log(`  always "no destabilization" on all: ${pct(neutral)}%`);
    const entry = {
      variants: rows.length, chains: new Set(rows.map(r => r.key)).size, neutral, singles,
      verdict: line("Verdict (3 engines)", r => r.verdict),
      noFoldx: line("Verdict without FoldX", r => r.noFoldx),
      noFoldxModerate: line("Without FoldX moderate", r => r.noFoldxModerate),
      foldxOnly: line("FoldX alone", r => r.bands.foldx),
      thermompnnOnly: line("ThermoMPNN alone", r => r.bands.thermompnn),
      oracleOnly: line("StabilityOracle alone", r => r.bands.stabilityoracle)
    };
    const table = [0, 1, 2].map(v => {
      const part = rows.filter(r => r.verdict === v);
      return { verdict: v, n: part.length, measured: [0, 1, 2].map(k => (part.length ? part.filter(r => band(r.measured) === k).length / part.length : 0)) };
    });
    console.log(`  Measured band when the verdict says low / moderate / high: ${table.map(t => `[${t.measured.map(p => Math.round(p * 100)).join(" ")}] n ${t.n}`).join("; ")}`);
    summary[path.basename(dir)] = { ...entry, table };
  }
  fs.writeFileSync(path.join(dirs[0], "..", "verdict-benchmark.json"), JSON.stringify(summary, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag, ...dirs] = process.argv.slice(2);
  if (flag === "--collect") {
    for (const dir of dirs) await collect(dir);
  } else if (flag === "--report") {
    report(dirs);
  } else {
    console.error("Use --collect <dir>... or --report <dir>...");
    process.exit(1);
  }
}

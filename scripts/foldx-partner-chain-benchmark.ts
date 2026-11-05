/**
 * foldx-partner-chain-benchmark.ts — does FoldX get closer to the lab when a partner chain touching the variant is in the template?
 *
 * The app cuts a PDB entry down to one chain (`extractChainFromPdb`), so a residue at a chain interface loses its neighbours. Only
 * interface variants can differ, so only they run: a variant's alpha carbon has another chain's atom within 10 Angstrom. Both template
 * kinds use the shipped cleaner, shell planner, repair rule by size (`foldxIntendedRepairMode`) and FoldX command lines.
 *
 * RULE, FIXED BEFORE ANY RUN (2026-11-05). Compare with the repair the app would use for each template. Recommend sending partner chains
 * to FoldX only if all of these hold, otherwise keep one chain:
 *   A. On S669 interface variants, partner minus single RMSE is -0.10 kcal/mol or lower, with the chain-resampled 95% interval below zero.
 *   B. On S669 interface variants, band agreement with the lab does not fall.
 *   C. On the independent set (T2837 and FireProtDB, no entry shared with S669, Ssym, p53 or myoglobin), the RMSE difference is also below
 *      zero. Its interval is reported, but this set is small, so the direction is what must repeat.
 * Secondary, reported but deciding nothing: the subset with a direct contact (a partner atom within 5 Angstrom of the variant residue),
 * and the same comparison with no repair on either side. A partner chain in a PDB file can also be a crystal contact, not a real partner.
 *
 *   npx tsx scripts/foldx-partner-chain-benchmark.ts --s669
 *   npx tsx scripts/foldx-partner-chain-benchmark.ts --independent <upstream-folder>/data/predictions/SO
 *   npx tsx scripts/foldx-partner-chain-benchmark.ts --report
 */
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { AMINO_ACID_3_TO_1 } from "../src/shared/aminoAcids.ts";
import { foldxIntendedRepairMode } from "../src/shared/foldxRepairMode.ts";
import { cleanPdbForFoldX } from "../server/services/stability/foldx/pdb-utils.ts";
import { parseFoldxDifFile } from "../server/services/stability/foldx/parser.ts";
import { planFixShell } from "../server/services/stability/foldx/repair-shell.ts";

const ROOT = path.resolve("logs/foldx_bench/partner");
const FOLDX = path.resolve("tools/foldx/foldx_1_20270131.exe");
const MOLECULES = path.join(path.dirname(FOLDX), "molecules");
const ROTABASE = path.resolve("logs/foldx_bench/full/rotabase.txt");
const CONDITIONS = ["--timeSeedRotabase=false", "--pH=7.4", "--temperature=298.15", "--ionStrength=0.15"];
const WORKERS = 12;
const REPAIR_CAP_MS = 45 * 60 * 1000;
const BUILD_CAP_MS = 20 * 60 * 1000;
const INTERFACE_A = 10;
const CONTACT_A = 5;
const MAX_INDEPENDENT_PER_CHAIN = 8;

interface Row { id: string; pdb: string; chain: string; wt: string; pos: number; insCode: string; mut: string; measured: number; single?: { none: number; intended: number } }
interface Atom { chain: string; resSeq: number; insCode: string; resName: string; name: string; xyz: [number, number, number]; line: string }
interface Result {
  id: string; pdb: string; chain: string; measured: number; partners: string[]; closeContact: boolean; residuesSingle: number; residuesPartner: number;
  single: { none: number | null; intended: number | null }; partner: { none: number | null; intended: number | null }; partnerSeconds: number | null;
}

const band = (v: number) => (v >= 1.5 ? 2 : v >= 0.5 ? 1 : 0);
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function firstModelAtoms(text: string): Atom[] {
  const atoms: Atom[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("ENDMDL")) break;
    if (!line.startsWith("ATOM") || line.length < 54 || ![" ", "A", "1"].includes(line[16])) continue;
    const name = line.slice(12, 16).trim();
    if (name.replace(/^\d+/, "").startsWith("H")) continue;
    atoms.push({
      chain: line[21], resSeq: parseInt(line.slice(22, 26), 10), insCode: line[26].trim(), resName: line.slice(17, 20).trim().toUpperCase(), name,
      xyz: [parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))], line
    });
  }
  return atoms;
}

/** Partner chains touching the variant, as the StabilityOracle reader chooses them. Null when the variant's residue is not in the file. */
function site(atoms: Atom[], row: Row): { partners: string[]; closeContact: boolean } | null {
  const residue = atoms.filter(a => a.chain === row.chain && a.resSeq === row.pos && a.insCode === row.insCode);
  const alpha = residue.find(a => a.name === "CA");
  if (!alpha || AMINO_ACID_3_TO_1[alpha.resName] !== row.wt) return null;
  const others = atoms.filter(a => a.chain !== row.chain);
  return {
    partners: [...new Set(others.filter(a => distance(a.xyz, alpha.xyz) < INTERFACE_A).map(a => a.chain))].sort(),
    closeContact: others.some(a => residue.some(r => distance(a.xyz, r.xyz) < CONTACT_A))
  };
}

const templateOf = (atoms: Atom[], chains: string[]) => cleanPdbForFoldX(atoms.filter(a => chains.includes(a.chain)).map(a => a.line).join("\n"));
const residueCount = (cleaned: string) => new Set(cleaned.split(/\r?\n/).filter(l => l.startsWith("ATOM") && l.slice(12, 16).trim() === "CA").map(l => l.slice(21, 27))).size;

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

function makeWorkDir(out: string): string {
  const dir = path.join(out, "work", crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(MOLECULES, path.join(dir, "molecules"), "junction");
  fs.linkSync(ROTABASE, path.join(dir, "rotabase.txt"));
  return dir;
}

const foldx = (cwd: string, args: string[], timeout: number) => new Promise<void>((resolve, reject) => {
  execFile(FOLDX, [...args, ...CONDITIONS], { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, err => (err ? reject(err) : resolve()));
});

const repairs = new Map<string, Promise<string | null>>();
function repaired(out: string, key: string, wt: string, fixResiduesFile?: string | null): Promise<string | null> {
  const existing = repairs.get(key);
  if (existing) return existing;
  const job = withSlot(async () => {
    const dir = makeWorkDir(out);
    try {
      fs.writeFileSync(path.join(dir, "wt.pdb"), wt);
      if (fixResiduesFile) fs.writeFileSync(path.join(dir, "fix.txt"), fixResiduesFile);
      await foldx(dir, ["--command=RepairPDB", "--pdb=wt.pdb", ...(fixResiduesFile ? ["--fix-residues-file=fix.txt"] : [])], REPAIR_CAP_MS);
      const file = path.join(dir, "wt_Repair.pdb");
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    } catch (err: any) {
      console.warn(`[repair] ${key}: ${String(err?.message ?? err).slice(0, 140)}`);
      return null;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
  repairs.set(key, job);
  return job;
}

function buildModel(out: string, template: string | null, line: string): Promise<number | null> {
  if (!template) return Promise.resolve(null);
  return withSlot(async () => {
    const dir = makeWorkDir(out);
    try {
      fs.writeFileSync(path.join(dir, "wt.pdb"), template);
      fs.writeFileSync(path.join(dir, "individual_list.txt"), line);
      await foldx(dir, ["--command=BuildModel", "--pdb=wt.pdb", "--mutant-file=individual_list.txt", "--numberOfRuns=5"], BUILD_CAP_MS);
      return parseFoldxDifFile(fs.readFileSync(path.join(dir, "Dif_wt.fxout"), "utf8")).ddG;
    } catch (err: any) {
      console.warn(`[build] ${line.trim()}: ${String(err?.message ?? err).slice(0, 140)}`);
      return null;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
}

/** The value under the repair the app would choose for this template: whole template up to the size limit, otherwise the site's region. */
async function intendedValue(out: string, keyBase: string, wt: string, row: Row, line: string): Promise<number | null> {
  const useFull = foldxIntendedRepairMode(residueCount(wt)) === "full";
  const plan = useFull ? null : planFixShell(wt, { chain: row.chain, resSeq: row.pos, insCode: row.insCode });
  if (!useFull && !plan) return null;
  const key = useFull ? `${keyBase}_full` : `${keyBase}_local_${row.pos}${row.insCode}`;
  return buildModel(out, await repaired(out, key, wt, plan?.fixResiduesFile), line);
}

async function pdbText(code: string): Promise<string | null> {
  for (const folder of ["s669", "ssym", "t2837"]) {
    const file = path.resolve("logs/foldx_bench", folder, "pdb", `${code}.pdb`);
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  }
  const res = await fetch(`https://files.rcsb.org/download/${code}.pdb`);
  if (!res.ok) return null;
  const text = await res.text();
  const file = path.resolve("logs/foldx_bench/t2837/pdb", `${code}.pdb`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

async function runSet(name: string, rows: Row[]): Promise<void> {
  const out = path.join(ROOT, name);
  fs.mkdirSync(out, { recursive: true });
  const resultsFile = path.join(out, "results.jsonl");
  const done = new Set(fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map(l => (JSON.parse(l) as Result).id) : []);

  const jobs: Array<{ row: Row; atoms: Atom[]; partners: string[]; closeContact: boolean }> = [];
  const atomsOf = new Map<string, Atom[] | null>();
  let notFound = 0, noPartner = 0;
  for (const row of rows) {
    if (!atomsOf.has(row.pdb)) {
      const text = await pdbText(row.pdb);
      atomsOf.set(row.pdb, text ? firstModelAtoms(text) : null);
    }
    const atoms = atomsOf.get(row.pdb);
    const found = atoms ? site(atoms, row) : null;
    if (!atoms || !found) { notFound += 1; continue; }
    if (found.partners.length === 0) { noPartner += 1; continue; }
    jobs.push({ row, atoms, ...found });
  }
  const todo = jobs.filter(j => !done.has(j.row.id));
  console.log(`[${name}] ${rows.length} variants: ${noPartner} with no partner chain, ${notFound} not in the file, ${jobs.length} at an interface, ${todo.length} to run`);

  let finished = 0;
  const startedAt = Date.now();
  await Promise.all(todo.map(async ({ row, atoms, partners, closeContact }) => {
    const line = `${row.wt}${row.chain}${row.pos}${row.insCode}${row.mut};\n`;
    const single = templateOf(atoms, [row.chain]);
    const partner = templateOf(atoms, [row.chain, ...partners]);
    const started = Date.now();
    const [partnerNone, partnerIntended, singleNone, singleIntended] = await Promise.all([
      buildModel(out, partner, line),
      intendedValue(out, `${row.pdb}_${row.chain}_${partners.join("")}`, partner, row, line),
      row.single ? row.single.none : buildModel(out, single, line),
      row.single ? row.single.intended : intendedValue(out, `${row.pdb}_${row.chain}`, single, row, line)
    ]);
    const result: Result = {
      id: row.id, pdb: row.pdb, chain: row.chain, measured: row.measured, partners, closeContact,
      residuesSingle: residueCount(single), residuesPartner: residueCount(partner),
      single: { none: singleNone, intended: singleIntended }, partner: { none: partnerNone, intended: partnerIntended },
      partnerSeconds: (Date.now() - started) / 1000
    };
    fs.appendFileSync(resultsFile, JSON.stringify(result) + "\n");
    finished += 1;
    if (finished % 10 === 0) console.log(`[${name}] ${finished}/${todo.length}, ${((Date.now() - startedAt) / 60000).toFixed(1)} min`);
  }));
  fs.rmSync(path.join(out, "work"), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function s669Rows(): Row[] {
  const lines = fs.readFileSync("logs/foldx_bench/s669/results.jsonl", "utf8").trim().split("\n").map(l => JSON.parse(l));
  return lines.flatMap(r => {
    const m = /^([A-Z])([A-Za-z0-9])(-?\d+)([A-Za-z]?)([A-Z])$/.exec(r.mutation);
    if (!m || typeof r.ddg?.none !== "number") return [];
    const intended = foldxIntendedRepairMode(r.residues) === "full" ? r.ddg.full : r.ddg.local;
    if (typeof intended !== "number") return [];
    return [{ id: r.id, pdb: r.pdb, chain: r.chain, wt: m[1], pos: parseInt(m[3], 10), insCode: m[4], mut: m[5], measured: r.measured, single: { none: r.ddg.none, intended } }];
  });
}

function independentRows(folder: string): Row[] {
  const read = (name: string) => {
    const lines = fs.readFileSync(path.join(folder, `${name}.csv`), "utf8").trim().split(/\r?\n/);
    const header = lines[0].split(",");
    return lines.slice(1).map(l => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])));
  };
  const used = new Set(["S669", "S-Sym", "p53", "myoglobin"].flatMap(read).map(r => r.pdb_id.slice(0, 4).toUpperCase()));
  const rows = new Map<string, Row>();
  for (const r of [...read("T2837"), ...read("fireprotdb")]) {
    const code = r.pdb_id.slice(0, 4).toUpperCase();
    const m = /^([A-Z])(\d+)([A-Z])$/.exec(r.mutation);
    if (used.has(code) || !m) continue;
    const id = `${code}${r.chain_id}_${r.mutation}`;
    if (!rows.has(id)) rows.set(id, { id, pdb: code, chain: r.chain_id, wt: m[1], pos: parseInt(m[2], 10), insCode: "", mut: m[3], measured: parseFloat(r.ddg) });
  }
  return [...rows.values()];
}

function capPerChain(rows: Row[]): Row[] {
  const seen = new Map<string, number>();
  const order = (id: string) => crypto.createHash("sha256").update(id).digest("hex");
  return [...rows].sort((a, b) => order(a.id).localeCompare(order(b.id))).filter(r => {
    const key = r.pdb + r.chain;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    return seen.get(key)! <= MAX_INDEPENDENT_PER_CHAIN;
  });
}

type Pair = { key: string; measured: number; a: number; b: number };
const rmse = (x: number[], y: number[]) => Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0) / x.length);
const agreement = (x: number[], y: number[]) => x.filter((v, i) => band(v) === band(y[i])).length / x.length;

function compare(label: string, rows: Pair[]): void {
  if (rows.length < 5) { console.log(`  ${label}: only ${rows.length} variants`); return; }
  const stat = (s: Pair[]) => {
    const y = s.map(r => r.measured), a = s.map(r => r.a), b = s.map(r => r.b);
    return { d: rmse(b, y) - rmse(a, y), band: agreement(b, y) - agreement(a, y) };
  };
  const keys = [...new Set(rows.map(r => r.key))];
  const by = new Map(keys.map(k => [k, rows.filter(r => r.key === k)]));
  let seed = 20261105;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const ds: number[] = [], bands: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const s: Pair[] = [];
    for (let k = 0; k < keys.length; k++) s.push(...by.get(keys[Math.floor(rand() * keys.length)])!);
    const v = stat(s);
    ds.push(v.d); bands.push(v.band);
  }
  ds.sort((x, y) => x - y); bands.sort((x, y) => x - y);
  const y = rows.map(r => r.measured), a = rows.map(r => r.a), b = rows.map(r => r.b), v = stat(rows);
  const q = (list: number[], p: number) => list[Math.floor(list.length * p)];
  const gaps = rows.map(r => Math.abs(r.a - r.b)).sort((m, n) => m - n);
  console.log(`  ${label}: ${rows.length} variants, ${keys.length} chains. RMSE one chain ${rmse(a, y).toFixed(3)}, with partners ${rmse(b, y).toFixed(3)}, difference ${v.d.toFixed(3)} (95% ${q(ds, 0.025).toFixed(3)} to ${q(ds, 0.975).toFixed(3)}). Band match ${(agreement(a, y) * 100).toFixed(1)}% to ${(agreement(b, y) * 100).toFixed(1)}%, change ${(v.band * 100).toFixed(1)} points (95% ${(q(bands, 0.025) * 100).toFixed(1)} to ${(q(bands, 0.975) * 100).toFixed(1)}). Median change in the value ${gaps[Math.floor(gaps.length / 2)].toFixed(2)}, largest ${gaps[gaps.length - 1].toFixed(2)}. Band changes on ${rows.filter(r => band(r.a) !== band(r.b)).length}`);
}

function report(): void {
  for (const name of ["s669", "independent"]) {
    const file = path.join(ROOT, name, "results.jsonl");
    if (!fs.existsSync(file)) { console.log(`\n${name}: no results`); continue; }
    const all = fs.readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l) as Result);
    const pairs = (rows: Result[], mode: "intended" | "none"): Pair[] => rows.flatMap(r => (r.single[mode] === null || r.partner[mode] === null ? [] : [{ key: r.pdb + r.chain, measured: r.measured, a: r.single[mode]!, b: r.partner[mode]! }]));
    const sizes = all.map(r => r.residuesPartner).sort((a, b) => a - b);
    console.log(`\n=== ${name}: ${all.length} interface variants, ${new Set(all.map(r => r.pdb + r.chain)).size} chains; complex size median ${sizes[Math.floor(sizes.length / 2)]}, largest ${sizes[sizes.length - 1]} residues; ${all.filter(r => r.partner.intended === null).length} with no partner value`);
    compare("App's repair, all interface variants", pairs(all, "intended"));
    compare("App's repair, direct contact only (secondary)", pairs(all.filter(r => r.closeContact), "intended"));
    compare("No repair, all interface variants (secondary)", pairs(all, "none"));
  }
}

const flag = process.argv[2];
if (flag === "--s669") await runSet("s669", s669Rows());
else if (flag === "--independent") await runSet("independent", capPerChain(independentRows(process.argv[3])));
if (flag === "--report" || flag === "--s669" || flag === "--independent") report();
else { console.error("Use --s669, --independent <folder> or --report"); process.exit(1); }

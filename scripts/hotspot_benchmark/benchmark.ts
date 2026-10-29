/**
 * The pre-registered 3D benchmark (thresholds.json). Offline: reads the committed slices and models.
 *
 *   npx tsx scripts/hotspot_benchmark/benchmark.ts
 *
 * Writes results.json and results.md and grades mechanically against thresholds.json. The clustering
 * and PathProx code is the production module (src/shared/spatialClustering.ts), so what is graded here
 * is what the Hotspots subtab would show.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { readCaTrace } from "../../src/shared/coordinateText.ts";
import { spatialClustering } from "../../src/shared/spatialClustering.ts";
import { AMINO_ACID_3_TO_1 } from "../../src/shared/aminoAcids.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const thText = readFileSync(join(HERE, "thresholds.json"), "utf8");
const TH = JSON.parse(thText);
const manifest = JSON.parse(readFileSync(join(HERE, "data", "manifest.json"), "utf8"));
const PLDDT_CONFIDENT = 70;

interface Snv { id: string; residue: number; csq: string; exomeAc: number | null; exomeFilters: string[] | null; genomeAc: number | null; genomeFilters: string[] | null; jointAc: number | null }
interface Cv { id: string; residue: number; csq: string; class: "plp" | "blb" | "other"; stars: number | null; significance: string }
interface Slice { gene: string; transcript: string; protein: string; snvs: Snv[]; clinvar: Cv[]; regions: Array<{ residues: [number, number]; oe: number }>; provenance: { clinvarRelease: string } }

const gz = (p: string) => gunzipSync(readFileSync(p));

function load(gene: string): { slice: Slice; pdb: string } {
  const entry = manifest[gene];
  const slicePath = entry.slice.startsWith("scripts/") ? join(REPO, entry.slice) : join(HERE, entry.slice);
  const pdb = gz(join(HERE, "data", `${gene}.af.pdb.gz`));
  const sha = createHash("sha256").update(pdb).digest("hex");
  if (sha !== entry.model.sha256) throw new Error(`${gene}: model bytes differ from manifest`);
  return { slice: JSON.parse(gz(slicePath).toString("utf8")), pdb: pdb.toString("utf8") };
}

// The tolerance benchmark's rules, ported unchanged (benchmark.py: counted, ac_of, variant_sets).
const counted = (s: Snv) => Boolean((s.exomeAc && s.exomeAc > 0 && s.exomeFilters?.length === 0) || (s.genomeAc && s.genomeAc > 0 && s.genomeFilters?.length === 0));
const acOf = (s: Snv) => s.jointAc ?? (s.exomeAc ?? 0) + (s.genomeAc ?? 0);

function variantSets(rec: Slice) {
  const L = rec.protein.length;
  const ok = (v: { csq: string; residue: number }) => v.csq === "missense" && v.residue >= 2 && v.residue <= L;
  const cv = new Map<string, Cv>();
  for (const v of rec.clinvar) if (ok(v) && !cv.has(v.id)) cv.set(v.id, v);
  const plp = [...cv.values()].filter((v) => v.class === "plp" && (v.stars ?? 0) >= 1);
  const blb = [...cv.values()].filter((v) => v.class === "blb" && (v.stars ?? 0) >= 1);
  const exclude = new Set([...cv.values()].filter((v) => v.class === "plp" || /conflicting/i.test(v.significance)).map((v) => v.id));
  const gn = new Map<string, Snv>();
  for (const s of rec.snvs) if (ok(s) && counted(s) && !exclude.has(s.id) && !gn.has(s.id)) gn.set(s.id, s);
  return { plp, blb, gnomadAll: [...gn.values()], gnomad_ac2: [...gn.values()].filter((s) => acOf(s) >= 2) };
}

function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mann-Whitney AUROC, ties count one half (metrics.py: auroc). */
function auroc(pos: number[], neg: number[]): number | null {
  if (!pos.length || !neg.length) return null;
  const all = [...pos.map((v) => [v, 1] as const), ...neg.map((v) => [v, 0] as const)].sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j][0] === all[i][0]) j++;
    const avg = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (all[k][1] === 1) rankSum += avg;
    i = j;
  }
  return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

/** Percentile 95% CI, positives and negatives resampled separately (metrics.py: bootstrap / paired_bootstrap_diff). */
function bootstrap<T>(pos: T[], neg: T[], stat: (p: T[], n: T[]) => number | null): [number, number] | null {
  const rand = rngOf(TH.bootstrap.seed);
  const vals: number[] = [];
  for (let i = 0; i < TH.bootstrap.iterations; i++) {
    const p = pos.map(() => pos[Math.floor(rand() * pos.length)]);
    const n = neg.map(() => neg[Math.floor(rand() * neg.length)]);
    const s = stat(p, n);
    if (s !== null) vals.push(s);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  return [vals[Math.floor(0.025 * vals.length)], vals[Math.min(vals.length - 1, Math.floor(0.975 * vals.length))]];
}

function evaluate(gene: string) {
  const { slice, pdb } = load(gene);
  const trace = readCaTrace(pdb);
  const seq = trace.resNames.map((r) => AMINO_ACID_3_TO_1[r[0] + r.slice(1).toLowerCase()] ?? AMINO_ACID_3_TO_1[r] ?? "X").join("");
  const contiguous = trace.residues.every((r, i) => r === i + 1);
  if (!contiguous || seq !== slice.protein) return { gene, excluded: "AlphaFold model sequence differs from the MANE Select protein" };
  const keep = trace.residues.map((_, i) => trace.bFactors[i] >= PLDDT_CONFIDENT);
  const residues = trace.residues.filter((_, i) => keep[i]);
  const coords = trace.residues.flatMap((_, i) => (keep[i] ? [trace.coords[3 * i], trace.coords[3 * i + 1], trace.coords[3 * i + 2]] : []));
  const sets = variantSets(slice);
  // The registered unit is the RESIDUE: thresholds.json defines P as "residues with ≥1 ClinVar P/LP" and
  // grades populations per residue, so every contrast dedupes residues. Grading each VARIANT entered the
  // same residue once per record (BRCA1: 217 records over 91 residues), inflated the n and narrowed the
  // bootstrap by resampling correlated repeats.
  const P = [...new Set(sets.plp.map((v) => v.residue))];
  const N = [...new Set(sets.gnomadAll.map((v) => v.residue))];
  const Blb = [...new Set(sets.blb.map((v) => v.residue))];
  const Nac2 = [...new Set(sets.gnomad_ac2.map((v) => v.residue))];
  const t0 = Date.now();
  const sc = spatialClustering({ residues, coords, pathogenic: P, neutral: N, permutations: TH.clustering_gate.permutations, steps: TH.clustering_gate.grid_steps, seed: TH.clustering_gate.seed });
  const ms = Date.now() - t0;
  const rmcAt = (r: number) => slice.regions.find((g) => g.residues[0] <= r && r <= g.residues[1])?.oe ?? null;
  const out: Record<string, unknown> = {
    gene, transcript: slice.transcript, clinvarRelease: slice.provenance.clinvarRelease, model: manifest[gene].model.entryId,
    modelVersion: manifest[gene].model.version, length: slice.protein.length, confidentResidues: residues.length,
    P: P.length, N: N.length, runtimeMs: ms, regions: slice.regions.length,
  };
  if (!sc) return { ...out, excluded: "fewer than 3 positions in a reference set" };
  Object.assign(out, { clustered: sc.clustered, univariate: sc.univariate, bivariate: sc.bivariate, thresholdA: sc.threshold });
  const score = (r: number) => sc.scores.get(r) ?? null;
  const contrasts: Record<string, unknown> = {};
  for (const [name, negSet] of [["plp_vs_gnomad_ac2", Nac2], ["plp_vs_blb", Blb]] as const) {
    const pos = P.map((r) => score(r)).filter((x): x is number => x !== null);
    const neg = negSet.map((r) => score(r)).filter((x): x is number => x !== null);
    const a = auroc(pos, neg);
    contrasts[name] = { nPos: P.length, nNeg: negSet.length, nPosScored: pos.length, nNegScored: neg.length, auroc: a, aurocCI: a === null ? null : bootstrap(pos, neg, auroc) };
  }
  out.contrasts = contrasts;
  // P5: paired against RMC O/E (lower = intolerant, so it is negated to point the same way). The same
  // residue unit as the contrasts above.
  const pair = (r: number) => [score(r), rmcAt(r)] as const;
  const pp = P.map((r) => pair(r)).filter((x): x is readonly [number, number] => x[0] !== null && x[1] !== null);
  const pn = Nac2.map((r) => pair(r)).filter((x): x is readonly [number, number] => x[0] !== null && x[1] !== null);
  const diff = (p: ReadonlyArray<readonly [number, number]>, n: ReadonlyArray<readonly [number, number]>) => {
    const a = auroc(p.map((x) => x[0]), n.map((x) => x[0]));
    const b = auroc(p.map((x) => -x[1]), n.map((x) => -x[1]));
    return a === null || b === null ? null : a - b;
  };
  out.vsRmc = {
    nPos: pp.length, nNeg: pn.length,
    auroc: auroc(pp.map((x) => x[0]), pn.map((x) => x[0])),
    rmcAuroc: auroc(pp.map((x) => -x[1]), pn.map((x) => -x[1])),
    diff: diff(pp, pn), diffCI: bootstrap([...pp], [...pn], diff),
  };
  return out;
}

const genes = TH.genes.map((g: string) => {
  const r = evaluate(g);
  console.log(JSON.stringify(r));
  return r;
});

// ── Grade (thresholds.json → pass) ──
const ip = TH.pass.informative_gene;
const informative = genes.filter((g: any) => !g.excluded && g.clustered && g.contrasts.plp_vs_gnomad_ac2.nPosScored >= ip.min_positives && g.contrasts.plp_vs_gnomad_ac2.nNegScored >= ip.min_negatives);
const p3 = TH.pass.P3_discrimination;
const p3Genes = informative.filter((g: any) => (g.contrasts.plp_vs_gnomad_ac2.auroc ?? 0) >= p3.min_auroc && (g.contrasts.plp_vs_gnomad_ac2.aurocCI?.[0] ?? 0) >= p3.min_ci_low);
const p5Genes = informative.filter((g: any) => (g.vsRmc.diffCI?.[0] ?? -1) > 0);
const grades = {
  informative: informative.map((g: any) => g.gene),
  P3: { pass: p3Genes.length >= p3.min_genes, genes: p3Genes.map((g: any) => g.gene) },
  P5: { pass: p5Genes.length >= TH.pass.P5_incremental.min_genes, genes: p5Genes.map((g: any) => g.gene) },
};
const decision = grades.P3.pass && grades.P5.pass ? "adopt" : "reject";
const thSha = createHash("sha256").update(thText).digest("hex");
// Scores and timings are separate files: a wall-clock measurement changes on every run, and putting it in
// results.json made the "bit for bit" claim false and rewrote the committed decision record each time.
const scored = genes.map(({ runtimeMs, ...g }: any) => g);
writeFileSync(join(HERE, "results.json"), JSON.stringify({ thresholdsSha256: thSha, genes: scored, grades, decision }, null, 1));
writeFileSync(join(HERE, "timings.json"), JSON.stringify({
  note: "Wall-clock per gene on the machine that ran the benchmark; not part of the decision and not reproducible.",
  genes: genes.map((g: any) => ({ gene: g.gene, runtimeMs: g.runtimeMs })),
}, null, 1));

const f = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
const pf = (x: number) => (x < 0.001 ? x.toExponential(1) : x.toFixed(3));
const md = [
  "# 3D proximity benchmark — results",
  "",
  `thresholds.json sha256 \`${thSha}\`. Decision: **${decision}** (P3 ${grades.P3.pass ? "pass" : "fail"}: ${grades.P3.genes.join(", ") || "none"}; P5 ${grades.P5.pass ? "pass" : "fail"}: ${grades.P5.genes.join(", ") || "none"}). Informative genes: ${grades.informative.join(", ") || "none"}.`,
  "",
  "| Gene | Confident / length | P / N residues | Univariate p | Bivariate p | t (Å) | AUROC P/LP vs gnomAD AC≥2 [95% CI] (scored) | AUROC P/LP vs B/LB | RMC AUROC | ΔAUROC vs RMC [95% CI] | Run time |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...genes.map((g: any) => g.excluded
    ? `| ${g.gene} | excluded: ${g.excluded} |||||||||`
    : `| ${g.gene} | ${g.confidentResidues} / ${g.length} | ${g.P} / ${g.N} | ${pf(g.univariate.p)} (area ${f(g.univariate.area)}) | ${pf(g.bivariate.p)} (area ${f(g.bivariate.area)}) | ${f(g.thresholdA, 1)} | ${f(g.contrasts.plp_vs_gnomad_ac2.auroc)} [${f(g.contrasts.plp_vs_gnomad_ac2.aurocCI?.[0])}, ${f(g.contrasts.plp_vs_gnomad_ac2.aurocCI?.[1])}] (${g.contrasts.plp_vs_gnomad_ac2.nPosScored}/${g.contrasts.plp_vs_gnomad_ac2.nPos} vs ${g.contrasts.plp_vs_gnomad_ac2.nNegScored}/${g.contrasts.plp_vs_gnomad_ac2.nNeg}) | ${f(g.contrasts.plp_vs_blb.auroc)} (${g.contrasts.plp_vs_blb.nPosScored} vs ${g.contrasts.plp_vs_blb.nNegScored}) | ${f(g.vsRmc.rmcAuroc)} | ${f(g.vsRmc.diff)} [${f(g.vsRmc.diffCI?.[0])}, ${f(g.vsRmc.diffCI?.[1])}] | ${(g.runtimeMs / 1000).toFixed(1)} s |`),
  "",
];
writeFileSync(join(HERE, "results.md"), md.join("\n"));
console.log(md.join("\n"));

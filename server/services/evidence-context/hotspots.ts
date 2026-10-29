/**
 * hotspots.ts — the server half of the Functional domains Hotspots view (src/shared/hotspotEvidence.ts).
 * It reads every hot-spot definition for one gene once, so the screen only renders.
 *
 * INVARIANTS
 * - One gnomAD read. ClinVar and gnomAD rows are the Landscape context's cached rows
 *   (`fetchGeneMissenseRows`), so the two views cannot disagree after a ClinVar refresh.
 * - The reference sets follow the pre-registered benchmark (scripts/hotspot_benchmark/thresholds.json):
 *   P = residues with a ClinVar P/LP missense of ≥1 star; N = residues with a gnomAD missense counted in
 *   either callset (AC > 0, no filter flag), excluding ClinVar P/LP and conflicting variants. The PER re-run
 *   uses the paper's own sets instead (every ClinVar P/LP; every counted gnomAD missense).
 * - Numbering is checked, not assumed: the reference residue of every ClinVar and gnomAD HGVSp record is
 *   compared with the model's sequence. One mismatch withholds the 3D reading and unverified PER regions.
 * - The 3D statistic runs in the worker pool; a 2,000-permutation run must not block the event loop.
 * - A failed source is a state on its own rung; the response is never an all-or-nothing error. A degraded
 *   answer is not cached (a retry must be able to repair it); the two expensive computations, the 3D
 *   statistic and the accessibility run, are memoized on their inputs instead, so a CSpec outage does not
 *   make every request redo them.
 */
import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";
import { fetchGeneMissenseRows, fetchLandscapeContext, missenseResidue } from "../prediction/landscape-context.ts";
import { classifyClinvar } from "../../../src/shared/clinvarClassification.ts";
import { loadCspecPm1 } from "./cspec.ts";
import { loadPerRegions } from "./perRegions.ts";
import { fetchAlphafoldPdb, getResolvedAlphafoldVersion } from "../structure/structure-fetcher.ts";
import { readCaTrace } from "../../../src/shared/coordinateText.ts";
import { perBurden } from "../../../src/shared/perBurden.ts";
import { AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";
import { runSpatialClusteringInWorker } from "../stability/biophysics-pool.ts";
import { executeSasaAll } from "../structure/sasa-runner.ts";
import type { HotspotContext } from "../../../src/shared/hotspotEvidence.ts";

/** AlphaFold DB's published "confident" pLDDT band; the benchmark's structure rule. */
const PLDDT_CONFIDENT = 70;
const cache = new LRUCache<string, Promise<HotspotContext>>({ max: 100, ttl: 24 * 60 * 60 * 1000 });
/** Pure functions of their inputs, so a memo cannot serve a stale answer; a failure is never remembered. */
const computed = new LRUCache<string, Promise<unknown>>({ max: 50, ttl: 24 * 60 * 60 * 1000 });
function memoized<T>(kind: string, input: unknown, run: () => Promise<T>, keep: (value: T) => boolean = (v) => v !== null && v !== undefined): Promise<T> {
  const key = `${kind}:${createHash("sha1").update(JSON.stringify(input)).digest("hex")}`;
  const hit = computed.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const value = run();
  computed.set(key, value);
  // Only an answer is remembered. A tool that could not start resolves to an error value, not a rejection, so
  // `keep` says which resolved values are answers.
  value.then((v) => { if (!keep(v)) computed.delete(key); }, () => computed.delete(key));
  return value;
}

const AA3 = (three: string) => AMINO_ACID_3_TO_1[three.toUpperCase()] ?? null;
const refOf = (hgvsp: unknown) => (typeof hgvsp === "string" ? AA3(hgvsp.slice(2, 5)) : null);
const onTranscript = (row: any, canonical: string | null) =>
  !canonical || !row?.transcript_id || String(row.transcript_id).split(".")[0] === canonical.split(".")[0];
const counted = (side: { ac?: number; filters?: string[] } | null | undefined) => !!side && (side.ac ?? 0) > 0 && (side.filters ?? []).length === 0;
const round1 = (v: number) => Math.round(v * 10) / 10;

export interface ReferenceSets {
  /** Reference residue (one letter) at each position named by any ClinVar or gnomAD HGVSp, for the numbering check. */
  refAt: Map<number, string>;
  /** ClinVar germline P/LP missense per residue, with the best review status and the changes seen. */
  plp: Map<number, { n: number; maxStars: number | null; changes: string[] }>;
  blb: Map<number, number>;
  /** P/LP residues with at least one review star: the benchmark's P set for the 3D reading. */
  plpStarred: Set<number>;
  /** gnomAD missense per residue: distinct variants, and those counted (AC > 0, no filter flag, either callset). */
  gn: Map<number, { variants: number; pass: number }>;
  /** Every counted gnomAD missense residue: the PER paper's population set. */
  populationAll: Set<number>;
  /** Counted gnomAD residues excluding ClinVar P/LP and conflicting variants: the benchmark's N set. */
  neutral: Set<number>;
}

/**
 * The residue sets every rung reads, from the raw ClinVar and gnomAD rows on gnomAD's canonical transcript.
 * Pure, so each rule (which transcript, which classification, what counts as observed) is tested directly.
 * `null` rows (a failed read) give empty sets; the caller reports the failure, never these empties.
 */
export function referenceSets(clinvarRows: any[] | null, gnomadRows: any[] | null, canonical: string | null): ReferenceSets {
  const refAt = new Map<number, string>();
  const plp = new Map<number, { n: number; maxStars: number | null; changes: string[] }>();
  const blb = new Map<number, number>();
  const plpStarred = new Set<number>();
  const excludeIds = new Set<string>();
  for (const r of clinvarRows ?? []) {
    if (!onTranscript(r, canonical)) continue;
    const pos = missenseResidue(r.hgvsp);
    if (pos === null) continue;
    const ref = refOf(r.hgvsp);
    if (ref) refAt.set(pos, ref);
    const cls = classifyClinvar(r.clinical_significance);
    const stars = typeof r.gold_stars === "number" ? r.gold_stars : null;
    if (cls === "plp" || /conflicting/i.test(String(r.clinical_significance ?? ""))) excludeIds.add(r.variant_id);
    if (cls === "plp") {
      const cur = plp.get(pos) ?? { n: 0, maxStars: null, changes: [] };
      cur.n++;
      cur.maxStars = stars === null ? cur.maxStars : Math.max(cur.maxStars ?? 0, stars);
      if (!cur.changes.includes(r.hgvsp)) cur.changes.push(r.hgvsp);
      plp.set(pos, cur);
      if ((stars ?? 0) >= 1) plpStarred.add(pos);
    } else if (cls === "blb") blb.set(pos, (blb.get(pos) ?? 0) + 1);
  }
  const gn = new Map<number, { variants: number; pass: number }>();
  const populationAll = new Set<number>();
  const neutral = new Set<number>();
  for (const r of gnomadRows ?? []) {
    if (!onTranscript(r, canonical) || r.consequence !== "missense_variant") continue;
    const pos = missenseResidue(r.hgvsp);
    if (pos === null) continue;
    const ref = refOf(r.hgvsp);
    if (ref) refAt.set(pos, ref);
    const any = (r.exome?.ac ?? 0) + (r.genome?.ac ?? 0) > 0;
    const pass = counted(r.exome) || counted(r.genome);
    if (!any) continue;
    const cur = gn.get(pos) ?? { variants: 0, pass: 0 };
    cur.variants++;
    if (pass) cur.pass++;
    gn.set(pos, cur);
    if (pass) {
      populationAll.add(pos);
      if (!excludeIds.has(r.variant_id)) neutral.add(pos);
    }
  }
  return { refAt, plp, blb, plpStarred, gn, populationAll, neutral };
}

/**
 * Do the reference residues named by ClinVar and gnomAD HGVSp records sit at the same numbers in the model?
 * One mismatch means the two numberings are not the same protein, and every position-dependent rung is withheld.
 */
export function checkNumbering(refAt: ReadonlyMap<number, string>, modelSeq: ReadonlyMap<number, string> | null): HotspotContext["numbering"] {
  if (!modelSeq) return { status: "unchecked", checked: 0, mismatches: 0 };
  let mismatches = 0;
  for (const [pos, ref] of refAt) if (modelSeq.get(pos) !== ref) mismatches++;
  return { status: mismatches ? "mismatch" : "verified", checked: refAt.size, mismatches };
}

/** Relative accessibility of the residues asked for, from the burial reading's own tool, on chain A of the model. */
async function measureAccessibility(pdb: string, residues: readonly number[]): Promise<HotspotContext["accessibility"]> {
  const run = await memoized("sasa", { pdb: createHash("sha1").update(pdb).digest("hex") }, () => executeSasaAll(pdb, "A"), (r) => r.status === "success")
    .catch((e: Error) => ({ status: "error" as const, message: e.message }));
  if (run.status === "error") return { status: "unavailable", reason: `The accessibility run failed: ${run.message}`, values: [] };
  const want = new Set(residues);
  return { status: "ok", reason: null, values: run.residues.filter((x) => want.has(x.resId)).map((x): [number, number] => [x.resId, x.rsa]) };
}

/**
 * `fetchAlphafoldPdb` returns null both when AlphaFold DB has no model and when it could not be reached.
 * Only the prediction API's 404 is absence; anything else is a provider failure, never "no model"
 * (SOD1 read "AlphaFold DB serves no model" while the host was refusing connections).
 */
async function alphafoldAbsent(uniprotId: string): Promise<boolean> {
  const res = await fetchWithRetry(`https://alphafold.ebi.ac.uk/api/prediction/${encodeURIComponent(uniprotId)}`,
    { headers: { Accept: "application/json" }, timeout: 15000 }, 1, 500).catch(() => null);
  if (!res) return false;
  await res.body?.cancel();
  return res.status === 404;
}

export function loadHotspotContext(gene: string, query: Record<string, unknown>): Promise<HotspotContext> {
  const uniprotId = typeof query.uniprot === "string" && /^[A-Z0-9]{6,10}$/.test(query.uniprot) ? query.uniprot : null;
  const transcript = typeof query.transcript === "string" && /^ENST\d+(\.\d+)?$/.test(query.transcript) ? query.transcript : null;
  const key = `${gene.toUpperCase()}::${uniprotId ?? ""}::${transcript ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // The response names the gene as requested: the client checks identity against its own symbol.
  const value = build(gene.toUpperCase(), uniprotId, transcript).then((v) => ({ ...v, gene }));
  cache.set(key, value);
  // A degraded answer is not kept: a retry (the view's Retry button, or the next visit) must be able to repair a
  // transient CSpec, AlphaFold, ClinVar or gnomAD failure, not replay it for the TTL. The expensive parts (the
  // 3D statistic, the accessibility run) are memoized on their inputs above, so repairing one rung does not
  // redo them.
  void value.then((v) => { if (v.errors.length > 0 || v.distribution.status !== "ok") cache.delete(key); }, () => cache.delete(key));
  return value;
}

async function build(gene: string, uniprotId: string | null, transcript: string | null): Promise<HotspotContext> {
  const errors: string[] = [];
  const [[clinvarRes, gnomadRes], cspec, pdb] = await Promise.all([
    fetchGeneMissenseRows(gene),
    loadCspecPm1(gene),
    uniprotId ? fetchAlphafoldPdb(uniprotId).catch(() => null) : Promise.resolve(null),
  ]);
  if (cspec.status === "error") errors.push(`ClinGen CSpec: ${cspec.reason}`);

  // ── Variant rows, on gnomAD's canonical transcript ──
  const canonical = (clinvarRes.status === "fulfilled" ? clinvarRes.value?.canonical_transcript_id : null)
    ?? (gnomadRes.status === "fulfilled" ? gnomadRes.value?.canonical_transcript_id : null) ?? null;
  const clinvarRows = clinvarRes.status === "fulfilled" && clinvarRes.value ? clinvarRes.value.clinvar_variants ?? [] : null;
  const gnomadRows = gnomadRes.status === "fulfilled" && gnomadRes.value ? gnomadRes.value.variants ?? [] : null;
  if (!clinvarRows) errors.push("ClinVar (via gnomAD) could not be read.");
  // Every rung reads residues on gnomAD's canonical transcript (checked against the model below), so the
  // regional intervals must be projected onto that same transcript. The requested transcript is only a
  // fallback for a response that names no canonical one: projecting on it while the rows are canonical
  // would put two rungs on two different protein axes.
  const axis = canonical ?? transcript;
  const landscape = await fetchLandscapeContext(gene, axis).catch((e: Error) => { errors.push(`Regional constraint: ${e.message}`); return null; });
  if (!gnomadRows) errors.push("gnomAD could not be read.");

  const { refAt, plp, blb, plpStarred, gn, populationAll, neutral } = referenceSets(clinvarRows, gnomadRows, canonical);

  // ── Model and numbering ──
  const trace = pdb ? readCaTrace(pdb) : null;
  const modelSeq = trace ? new Map(trace.residues.map((r, i) => [r, AA3(trace.resNames[i]) ?? "X"])) : null;
  const numbering = checkNumbering(refAt, modelSeq);
  const mismatches = numbering.mismatches;
  const length = trace?.residues.length ? Math.max(...trace.residues) : Math.max(0, ...refAt.keys());

  // ── C: published PER, verified against this protein's residues ──
  // The bundle is read from disk: a missing or corrupt file is a failed source on its own rung, never a
  // rejected request (the route would otherwise return 502 for every rung because one table is absent).
  let per: ReturnType<typeof loadPerRegions> | null = null;
  try { per = loadPerRegions(gene); } catch (error) {
    errors.push(`Published regions: ${error instanceof Error ? error.message : "the bundled table could not be read"}`);
  }
  // The 2019 residues must be this protein's residues at the same numbers, read off the model.
  const perPublished: HotspotContext["perPublished"] = per ? {
    status: per.regions.length ? "ok" : "none", reason: null,
    regions: per.regions.map((g) => {
      let mismatched = 0;
      let checked = 0;
      for (let i = 0; i < g.sequence.length; i++) {
        const ours = modelSeq?.get(g.start + i);
        if (!ours) continue;
        checked++;
        if (ours !== g.sequence[i]) mismatched++;
      }
      return { analysis: g.analysis, family: g.family, tag: g.tag, start: g.start, end: g.end, adjP: g.adjP,
        verified: checked > 0 && checked === g.sequence.length && mismatched === 0, mismatches: mismatched, checked };
    }),
  } : { status: "unavailable", reason: "The bundled published-region table could not be read, so no published region was checked.", regions: [] };

  // ── D: the PER test on today's data ──
  const rowsRead = clinvarRows !== null && gnomadRows !== null;
  const patientAll = new Set(plp.keys());
  const rerun = perBurden(patientAll, populationAll, length);
  const perRerun: HotspotContext["perRerun"] = numbering.status === "mismatch"
    // The test's axis is the model's length while its residues are gnomAD canonical-transcript positions.
    // On a mismatch those two disagree, so the windows would be drawn on the wrong axis; the 3D reading is
    // withheld for the same reason.
    ? { status: "unavailable", reason: "The ClinVar/gnomAD residue numbers do not match this protein's sequence, so the enrichment test was not run on this axis.", length, windows: 0, patientResidues: 0, populationResidues: 0, regions: [], best: null }
    : !rowsRead
      ? { status: "unavailable", reason: "ClinVar or gnomAD could not be read.", length, windows: 0, patientResidues: 0, populationResidues: 0, regions: [], best: null }
      : patientAll.size < 2
        ? { status: "too-few", reason: `${patientAll.size} residue${patientAll.size === 1 ? "" : "s"} with a ClinVar P/LP missense: too few to test enrichment.`, length, windows: rerun.windows, patientResidues: rerun.patientResidues, populationResidues: rerun.populationResidues, regions: [], best: null }
        : { status: "ok", reason: null, length, windows: rerun.windows, patientResidues: rerun.patientResidues, populationResidues: rerun.populationResidues, regions: rerun.regions,
            best: rerun.best ? { start: rerun.best.start, end: rerun.best.end, patient: rerun.best.patient, population: rerun.best.population, p: rerun.best.p, adjP: rerun.best.adjP } : null };

  // ── B: regional intervals on the protein axis ──
  const regional: HotspotContext["regional"] = landscape
    ? { status: landscape.regionsStatus, reason: landscape.regionsStatus === "available" ? null : landscape.errors.find((e) => /Regional/.test(e)) ?? null,
        regions: (landscape.regions ?? []).map((g) => ({ start: g.start, end: g.end, oe: g.oe, pValue: g.pValue })) }
    : { status: "unavailable", reason: "The regional constraint context could not be read.", regions: [] };

  // ── Accessibility of the P/LP residues, in parallel with the 3D statistic ──
  const accessibilityRun: Promise<HotspotContext["accessibility"]> | null = pdb && trace && numbering.status !== "mismatch"
    ? measureAccessibility(pdb, [...plp.keys()])
    : null;

  // ── E: 3D proximity ──
  const version = uniprotId ? getResolvedAlphafoldVersion(uniprotId) ?? null : null;
  const model = trace && uniprotId ? { entryId: `AF-${uniprotId}-F1`, version, url: `https://alphafold.ebi.ac.uk/entry/${uniprotId}` } : null;
  const spatialBase = {
    model, structureResidues: trace?.residues.length ?? 0, confidentResidues: 0, pathogenicResidues: 0, neutralResidues: 0, permutations: 0,
    univariate: null, bivariate: null, thresholdA: null, selfCheck: null, scores: [] as Array<[number, number]>,
    trace: trace ? { residues: trace.residues, coords: Array.from(trace.coords, round1), plddt: Array.from(trace.bFactors, round1) } : null,
  };
  let spatial: HotspotContext["spatial"];
  if (!uniprotId) {
    spatial = { ...spatialBase, status: "no-model", reason: "No UniProt accession, so no model was read." };
  } else if (!trace) {
    if (await alphafoldAbsent(uniprotId)) {
      spatial = { ...spatialBase, status: "no-model", reason: "AlphaFold DB serves no model for this protein (none exist above 2,700 residues), so there is no structure to measure." };
    } else {
      errors.push("AlphaFold DB model could not be read.");
      spatial = { ...spatialBase, status: "error", reason: "The AlphaFold DB model could not be read, so this is not an absence of a model. Re-run the analysis to try again." };
    }
  } else if (numbering.status === "mismatch") {
    spatial = { ...spatialBase, status: "numbering-mismatch", reason: `${mismatches} of ${refAt.size} ClinVar/gnomAD reference residues differ from the model's sequence at the same number, so 3D positions cannot be trusted.` };
  } else {
    const keep = trace.residues.map((_, i) => trace.bFactors[i] >= PLDDT_CONFIDENT);
    const residues = trace.residues.filter((_, i) => keep[i]);
    const coords = trace.residues.flatMap((_, i) => (keep[i] ? [trace.coords[3 * i], trace.coords[3 * i + 1], trace.coords[3 * i + 2]] : []));
    const P = [...plpStarred];
    const N = [...neutral];
    const inModel = new Set(residues);
    const counts = { confidentResidues: residues.length, pathogenicResidues: P.filter((r) => inModel.has(r)).length, neutralResidues: N.filter((r) => inModel.has(r)).length };
    // Check the published method's minimum here, where the counts are, instead of inferring it from a null
    // return: `spatialClustering` also returns null for a degenerate distance grid, and telling a protein
    // with plenty of variants that it has too few is a false statement about its data.
    const enough = counts.pathogenicResidues >= 3 && counts.neutralResidues >= 3;
    const r = rowsRead && enough ? await memoized("spatial", { residues, coords, pathogenic: P, neutral: N }, () => runSpatialClusteringInWorker({ residues, coords, pathogenic: P, neutral: N })).catch((e: Error) => { errors.push(`3D reading: ${e.message}`); return undefined; }) : undefined;
    if (!rowsRead) spatial = { ...spatialBase, ...counts, status: "error", reason: "ClinVar or gnomAD could not be read." };
    else if (!enough) spatial = { ...spatialBase, ...counts, status: "too-few", reason: `${counts.pathogenicResidues} P/LP and ${counts.neutralResidues} gnomAD-only residues in the confident model (pLDDT ≥ ${PLDDT_CONFIDENT}); the published method needs at least 3 of each.` };
    else if (r === undefined) spatial = { ...spatialBase, ...counts, status: "error", reason: "The 3D computation failed." };
    else if (r === null) spatial = { ...spatialBase, ...counts, status: "error", reason: "The distance grid is degenerate (no usable bin), so the clustering test could not run on this model. This is not a statement about the protein." };
    else {
      const common = { ...spatialBase, ...counts, permutations: r.permutations, univariate: r.univariate, bivariate: r.bivariate, thresholdA: r.threshold };
      spatial = r.clustered
        ? { ...common, status: "ok", reason: null, selfCheck: r.selfCheck, scores: r.scores.map(([k, v]) => [k, Math.round(v * 1000) / 1000]) }
        : { ...common, status: "not-clustered", reason: "Not shown: pathogenic residues are not significantly clustered in 3D on this model, the pre-registered condition for the score." };
    }
  }

  const accessibility: HotspotContext["accessibility"] = accessibilityRun ? await accessibilityRun
    : numbering.status === "mismatch" ? { status: "numbering-mismatch", reason: "The ClinVar/gnomAD residue numbers do not match the model, so accessibility is not read at those numbers.", values: [] }
    : spatial.status === "no-model" ? { status: "no-model", reason: "There is no model, so accessibility was not measured.", values: [] }
    : { status: "unavailable", reason: "The model could not be read, so accessibility was not measured.", values: [] };
  // A run that failed makes the answer degraded: it is not cached, so the next read can repair it.
  if (accessibilityRun && accessibility.status === "unavailable") errors.push(`Accessibility: ${accessibility.reason}`);

  return {
    gene, status: "ready", uniprotId, transcript: axis,
    clinvarSource: "ClinVar germline classifications via the gnomAD browser API (GRCh38)",
    numbering,
    distribution: {
      status: rowsRead ? "ok" : "unavailable", reason: rowsRead ? null : "ClinVar or gnomAD could not be read.",
      plp: [...plp].map(([pos, v]) => ({ pos, ...v })).sort((a, b) => a.pos - b.pos),
      blb: [...blb].map(([pos, n]) => ({ pos, n })).sort((a, b) => a.pos - b.pos),
      gnomad: [...gn].map(([pos, v]) => ({ pos, ...v })).sort((a, b) => a.pos - b.pos),
      length: length || null,
    },
    cspec, perPublished, perRerun, regional, spatial, errors, accessibility,
  };
}

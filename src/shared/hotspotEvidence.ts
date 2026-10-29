/**
 * hotspotEvidence.ts — the Functional domains tab's Hotspots view: "is this residue in a germline
 * mutational hot spot, and by whose definition?" One contract for the server response and one pure model
 * for the view, its rail and the tests.
 *
 * Six readings, kept apart and never merged into one verdict. Each carries its own grade, so a curator
 * can weigh an expert's residue list against a statistic nobody has validated:
 *
 *   A  ClinGen CSpec      the expert panel's PM1 text, verbatim with its link     Expert specification
 *   B  Regional O/E       gnomAD v4.1.1 interval O/E, Chao et al. v3 PP2/BP1      Calibrated (preprint)
 *   C  Published PER      Pérez-Palma et al. 2020 regions (2019 data)             Published region
 *   D  PER re-run         the same burden test on today's ClinVar and gnomAD      Published method, not validated here
 *   E  3D proximity       Sivley et al. 2018 clustering + PathProx on the model   Published method, benchmarked here
 *   F  Distribution       ClinVar P/LP and gnomAD missense per residue            Measurement
 *
 * INVARIANTS
 * - Germline only. ClinVar comes through gnomAD's mirror of ClinVar's germline classification; somatic
 *   hot-spot databases (cancerhotspots, COSMIC) are never read.
 * - Nothing here feeds the engine. PM1 is still read as a critical site (functionalSites.ts); hot-spot
 *   PM1 is the owner's open decision, and the view says so. Rung B is the engine's PP2 input and shows the
 *   engine's own record beside it.
 * - No cut-point is chosen here. Every edge is the source's: CSpec text, Chao's calibrated O/E edges,
 *   PER's published parameters, and the pre-registered 3D gate (scripts/hotspot_benchmark/thresholds.json,
 *   decision doc/HOTSPOT_3D_DECISION.md). The 3D score is shown only where its clustering gate passes.
 * - Absence is a state. A failed source is "Provider error", never "no hotspot".
 * - Distances are labelled with their frame: sequence residues, or Å between Cα atoms on the named
 *   AlphaFold DB model.
 *
 * REPLACED: the tab's disease-variant density (a 15-residue "densest" window and a ±10 "near" count with
 * ≥10/≥12 triggers), whose window sizes no source set.
 */
import { z } from "zod";
import { cspecPm1Schema, type CspecPm1 } from "./cspecPm1.ts";
import { regionalBp1Code, regionalPp2Code, REGIONAL_MISSENSE_CALIBRATION, REGIONAL_MISSENSE_SOURCE } from "./thresholds/calibration.ts";
import { PER_METHOD } from "./perBurden.ts";
import { ENGINE_STATE_LABELS } from "./engineStatus.ts";
import type { NativeInterfaceSupport } from "./interfacesEvidence.ts";

// ── Wire contract (GET /evidence-context/:gene/hotspots?uniprot=&transcript=) ──────────────────────

const perWindowSchema = z.object({ start: z.number(), end: z.number(), patient: z.number(), population: z.number(), p: z.number(), adjP: z.number() });

export const hotspotContextSchema = z.object({
  gene: z.string(),
  status: z.enum(["ready", "error"]),
  uniprotId: z.string().nullable(),
  transcript: z.string().nullable(),
  clinvarSource: z.string(),
  /** HGVSp reference residues of the ClinVar and gnomAD records checked against the model sequence. */
  numbering: z.object({ status: z.enum(["verified", "mismatch", "unchecked"]), checked: z.number(), mismatches: z.number() }),
  distribution: z.object({
    status: z.enum(["ok", "unavailable"]),
    reason: z.string().nullable(),
    /** ClinVar P/LP missense per residue (germline classification), with the best review status. */
    plp: z.array(z.object({ pos: z.number(), n: z.number(), maxStars: z.number().nullable(), changes: z.array(z.string()) })),
    blb: z.array(z.object({ pos: z.number(), n: z.number() })),
    /** gnomAD v4 missense per residue: distinct variants, and those passing filters in either callset. */
    gnomad: z.array(z.object({ pos: z.number(), variants: z.number(), pass: z.number() })),
    length: z.number().nullable(),
  }),
  cspec: cspecPm1Schema,
  perPublished: z.object({
    status: z.enum(["ok", "none", "unavailable"]),
    reason: z.string().nullable(),
    regions: z.array(z.object({
      analysis: z.enum(["gene", "family"]), family: z.array(z.string()).nullable(), tag: z.string(),
      start: z.number(), end: z.number(), adjP: z.number().nullable(),
      /** The published residues match this protein's sequence at these numbers. */
      verified: z.boolean(), mismatches: z.number(), checked: z.number(),
    })),
  }),
  perRerun: z.object({
    status: z.enum(["ok", "too-few", "unavailable"]),
    reason: z.string().nullable(),
    length: z.number(), windows: z.number(), patientResidues: z.number(), populationResidues: z.number(),
    regions: z.array(z.object({ start: z.number(), end: z.number(), minAdjP: z.number() })),
    best: perWindowSchema.nullable(),
  }),
  regional: z.object({
    status: z.enum(["available", "none", "withheld-mapping", "unavailable"]),
    reason: z.string().nullable(),
    regions: z.array(z.object({ start: z.number(), end: z.number(), oe: z.number().nullable(), pValue: z.number().nullable() })),
  }),
  spatial: z.object({
    status: z.enum(["ok", "not-clustered", "too-few", "no-model", "numbering-mismatch", "error"]),
    reason: z.string().nullable(),
    model: z.object({ entryId: z.string(), version: z.string().nullable(), url: z.string() }).nullable(),
    structureResidues: z.number(), confidentResidues: z.number(), pathogenicResidues: z.number(), neutralResidues: z.number(),
    permutations: z.number(),
    univariate: z.object({ area: z.number(), p: z.number() }).nullable(),
    bivariate: z.object({ area: z.number(), p: z.number() }).nullable(),
    thresholdA: z.number().nullable(),
    /** Leave-residue-out AUROC of the score, P/LP residues vs gnomAD-only residues, in this gene. */
    selfCheck: z.object({ auroc: z.number(), pathogenic: z.number(), neutral: z.number() }).nullable(),
    /** [residue, PathProx score] for every confident residue; empty unless the gate passed. */
    scores: z.array(z.tuple([z.number(), z.number()])),
    /** Cα trace of the model (all residues): numbers, x y z (0.1 Å), pLDDT. For distances only. */
    trace: z.object({ residues: z.array(z.number()), coords: z.array(z.number()), plddt: z.array(z.number()) }).nullable(),
  }),
  /**
   * Relative solvent accessibility of the ClinVar P/LP residues on the model, from the tool the burial reading
   * runs (Shrake-Rupley residue SASA over the whole monomer, over the Tien 2013 maximum). A payload from before
   * this field parses as unavailable rather than failing.
   */
  accessibility: z.object({
    status: z.enum(["ok", "unavailable", "no-model", "numbering-mismatch"]),
    reason: z.string().nullable(),
    /** [residue, RSA as a fraction to 4 places]; above 1 is possible at an exposed terminus. */
    values: z.array(z.tuple([z.number(), z.number()])),
  }).default({ status: "unavailable", reason: "This answer predates the accessibility reading.", values: [] }),
  errors: z.array(z.string()),
});
export type HotspotContext = z.infer<typeof hotspotContextSchema>;

// ── View model ──────────────────────────────────────────────────────────────────────────────────

export type HotspotGrade = "expert" | "calibrated" | "published-region" | "method-unvalidated" | "method-benchmarked" | "measurement";

export const HOTSPOT_GRADE_LABEL: Record<HotspotGrade, string> = {
  expert: "Expert specification",
  calibrated: "Calibrated (preprint)",
  "published-region": "Published region",
  "method-unvalidated": "Published method, not validated here",
  "method-benchmarked": "Published method, benchmarked here",
  measurement: "Measurement",
};

export type RungKey = "cspec" | "regional" | "per-published" | "per-rerun" | "spatial" | "distribution";
export type RungState = "read" | "none" | "not-shown" | "failed" | "loading";

export interface HotspotBand { start: number; end: number; label: string; hit: boolean }

export interface HotspotRung {
  key: RungKey;
  name: string;
  grade: HotspotGrade;
  state: RungState;
  /** What the rung says at the queried residue: "inside" a defined region, "outside", or not applicable. */
  atVariant: "inside" | "outside" | null;
  /** One sentence; the rung's answer for this residue. */
  headline: string;
  /** Further lines: parameters, coverage, caveats. */
  details: string[];
  /** Regions this rung defines on the sequence, for the figure. */
  bands: HotspotBand[];
  source: { label: string; url: string | null };
  /** Key into the research guides (researchGuides.ts). */
  explain: string;
}

export interface HotspotResidueRow {
  key: string;
  residue: number;
  /** "Gly93" when the reference residue is known from HGVSp. */
  label: string;
  plp: number;
  maxStars: number | null;
  changes: string[];
  /** Distinct counted gnomAD missense variants; null when gnomAD was not read (never 0, which is a measurement). */
  gnomad: number | null;
  sequenceDistance: number;
  /** Cα–Cα distance to the queried residue on the model, Å; null without a trace or Cα. */
  distanceA: number | null;
  plddt: number | null;
  /** PathProx score at this residue when the 3D rung is shown. */
  pathprox: number | null;
  /** Relative solvent accessibility on the model (a fraction); null when not measured. */
  rsa: number | null;
  /** UniProt sites and modifications at this residue, each with its evidence level. */
  sites: Array<{ name: string; evidence: string }>;
  /** Native PDBe-KB interfaces at this residue: the partner and the structures that place it there. */
  interfaceSupport: Array<{ label: string; k: number; n: number }>;
  inRegions: RungKey[];
}

/** One UniProt site or modification, as the Functional domains model read it (a plain copy; nothing is re-derived). */
export interface HotspotAnnotation { start: number; end: number; isPair: boolean; name: string; evidence: string }

/** Whether a column could be filled, and if not, why: an empty cell is never a measured absence. */
export interface HotspotColumnState { state: "ok" | "unavailable"; reason: string | null }

export interface HotspotEvidence {
  residue: number;
  residueLabel: string;
  length: number;
  state: "loading" | "failed" | "ready";
  failure: string | null;
  rungs: HotspotRung[];
  /** One sentence, with the count of rungs that place the residue inside a region. */
  finding: { lead: string; rest: string };
  pm1Note: string;
  rows: HotspotResidueRow[];
  /** The queried residue's 3D context: nearest P/LP residue on the model, Å. */
  nearest3d: { residue: number; distanceA: number } | null;
  distribution: HotspotContext["distribution"] | null;
  model: HotspotContext["spatial"]["model"];
  /** What the engine recorded for the codes this view informs. */
  engine: { pm1: string | null; pp2: string | null };
  /** Whether each added column was filled, with the reason it was not. */
  columns: { rsa: HotspotColumnState; sites: HotspotColumnState; interface: HotspotColumnState };
}

export const HOTSPOT_SOURCES = {
  cspec: { label: "ClinGen Criteria Specification Registry", url: "https://cspec.genome.network/cspec/ui/svi/" },
  per: { label: "Pérez-Palma et al. 2020, Genome Res 30:62", url: "https://doi.org/10.1101/gr.252601.119" },
  sivley: { label: "Sivley et al. 2018, Am J Hum Genet 102:415", url: "https://pubmed.ncbi.nlm.nih.gov/29455857/" },
  benchmark: { label: "Pre-registered benchmark (doc/HOTSPOT_3D_DECISION.md)", url: null },
} as const;

const inside = (bands: HotspotBand[], r: number) => bands.some((b) => b.start <= r && r <= b.end);
const span = (s: number, e: number) => (s === e ? `${s}` : `${s}–${e}`);
const pText = (p: number) => (p < 0.001 ? p.toExponential(1) : p.toFixed(3));
/** What the RSA column is, for its header: the method, the maximum, and the monomer limit. */
export const RSA_UNIT_NOTE = "Relative solvent accessibility: Shrake-Rupley residue surface area on the AlphaFold monomer, over the Tien 2013 maximum for the amino acid. A monomer overstates exposure where chains meet. No burial word is shown because its cut-points are the app's own.";
/** The benchmark's informative-gene floor: at least this many P and this many N residues before an in-gene AUROC is shown. */
const MIN_SELF_CHECK_PER_CLASS = 10;

export interface HotspotInput {
  context: HotspotContext | null;
  loadState: "loading" | "ready" | "error";
  loadError?: string | null;
  residue: number;
  residueLabel: string;
  /** Engine record, read only. */
  engineCriteria?: ReadonlyArray<{ code?: string }> | null;
  /** UniProt sites and modifications; null or absent when the feature table was not read. */
  annotations?: ReadonlyArray<HotspotAnnotation> | null;
  /** Native interface support from the assembly read; null or absent when it was not read. */
  interfaces?: NativeInterfaceSupport | null;
}

function cspecRung(c: CspecPm1, residueLabel: string): HotspotRung {
  const base = { key: "cspec" as const, name: "ClinGen expert panel PM1", grade: "expert" as const, atVariant: null, bands: [], source: HOTSPOT_SOURCES.cspec, explain: "hotspot_cspec" };
  if (c.status === "error") return { ...base, state: "failed", headline: `${ENGINE_STATE_LABELS["upstream-error"]}: ${c.reason ?? "the registry did not answer"}.`, details: [] };
  if (c.status === "none") return { ...base, state: "none", headline: "No ClinGen expert panel specification covers this gene, so no expert hot-spot definition exists.", details: [] };
  const released = c.specs.filter((s) => s.released);
  const withPm1 = released.filter((s) => s.pm1);
  // The registry's own words, verbatim but for Markdown escapes ("\<10" reads "<10").
  const plain = (t: string) => t.replace(/\\([\\`*_{}[\]()#+\-.!<>|])/g, "$1").trim();
  const details = c.specs.flatMap((s) => {
    const applicable = s.pm1?.strengths.filter((x) => x.applicable) ?? [];
    const head = `${s.panel} (${s.id}, ${s.status}${s.version ? ` v${s.version}` : ""}): ${s.pm1 ? `PM1 ${applicable.length ? `applicable at ${applicable.map((x) => x.label).join(", ")}` : "not applicable"}` : s.pm1Reason ?? "no PM1 criterion published"}.`;
    if (!s.pm1) return [head];
    return [head, `“${plain(s.pm1.description)}”`, ...applicable.filter((x) => x.description).map((x) => `${x.label}: “${plain(x.description!)}”`)];
  });
  const headline = withPm1.length
    ? `${withPm1.map((s) => s.panel).join("; ")} publish${withPm1.length === 1 ? "es" : ""} a PM1 rule for this gene. Read its text to see whether ${residueLabel} is named; residue lists are not parsed, because some panels publish them as images.`
    : released.length
      ? "A released ClinGen specification covers this gene but defines no PM1 rule."
      : `A ClinGen panel covers this gene, but its rules are not released (${c.specs.map((s) => s.status).join(", ")}).`;
  return { ...base, state: withPm1.length ? "read" : "none", headline, details, source: { label: base.source.label, url: c.specs[0]?.url ?? base.source.url } };
}

function regionalRung(ctx: HotspotContext, residue: number, engine: string | null): HotspotRung {
  const base = { key: "regional" as const, name: "Regional missense O/E", grade: "calibrated" as const, source: { label: REGIONAL_MISSENSE_SOURCE.short, url: `https://doi.org/${REGIONAL_MISSENSE_SOURCE.doi}` }, explain: "hotspot_regional" };
  const r = ctx.regional;
  if (r.status !== "available") {
    // "withheld-mapping" is not the same absence as "no interval exists": the source has data, we could not
    // place it. Reporting it as "No region" would turn an unasked question into a negative answer.
    const state: RungState = r.status === "unavailable" ? "failed" : r.status === "withheld-mapping" ? "not-shown" : "none";
    const fallback = r.status === "none"
      ? "gnomAD releases no regional interval on this protein."
      : r.status === "withheld-mapping"
        ? "gnomAD's regional intervals could not be placed on this protein's sequence, so this was not checked here."
        : "The regional map could not be read.";
    return { ...base, state, atVariant: null, bands: [], headline: r.reason ?? fallback, details: [] };
  }
  const cal = REGIONAL_MISSENSE_CALIBRATION;
  // Near an edge two decimals can print the edge while the unrounded value sits on the other side
  // (0.3601 prints "0.36" but is Supporting). Show the third decimal only where it changes the reading.
  const edges = [cal.pp2.Moderate, cal.pp2.Supporting, cal.bp1.Supporting, cal.bp1.Moderate];
  const oeText = (v: number) => (edges.some((e) => Math.abs(v - e) < 0.005) ? v.toFixed(3) : v.toFixed(2));
  const bands = r.regions
    .filter((g) => regionalPp2Code(g.oe))
    .map((g) => ({ start: g.start, end: g.end, label: `O/E ${g.oe === null ? "unknown" : oeText(g.oe)} · ${regionalPp2Code(g.oe) === "PP2_Moderate" ? "PP2 Moderate" : "PP2 Supporting"}`, hit: g.start <= residue && residue <= g.end }));
  // Two adjacent gnomAD intervals can cover one codon. Pick the first, and say so: the engine refuses the
  // ambiguity, and a silent pick would read as the engine's own answer.
  const covering = r.regions.filter((g) => g.start <= residue && residue <= g.end);
  const here = covering[0] ?? null;
  const code = regionalPp2Code(here?.oe);
  const bp1 = regionalBp1Code(here?.oe);
  const headline = !here
    ? "The residue lies outside every mapped interval."
    : code
      ? `The residue's interval (${span(here.start, here.end)}) has O/E ${oeText(here.oe!)}, in the calibrated ${code === "PP2_Moderate" ? "PP2 Moderate" : "PP2 Supporting"} band.`
      : bp1
        ? `The residue's interval (${span(here.start, here.end)}) has O/E ${oeText(here.oe!)}, in the calibrated BP1 band, which the engine does not apply.`
        : `The residue's interval (${span(here.start, here.end)}) has O/E ${here.oe === null ? "unknown" : oeText(here.oe)}, between the calibrated bands: no evidence either way.`;
  return {
    ...base, state: "read", atVariant: r.regions.length ? (here && code ? "inside" : "outside") : null, bands, headline,
    details: [
      `${r.regions.length} interval${r.regions.length === 1 ? "" : "s"} on this protein. Edges: O/E ≤ ${cal.pp2.Moderate} PP2 Moderate, ≤ ${cal.pp2.Supporting} PP2 Supporting; > ${cal.bp1.Supporting} BP1 Supporting, > ${cal.bp1.Moderate} BP1 Moderate.`,
      // The shared cut-points are not the same thing as the engine's own selection: it picks the interval
      // from the variant's genomic position and requires coverage QC, so the two can disagree.
      `Same calibrated edges as the engine's PP2; the engine selects the interval by the variant's genomic position and requires coverage QC, so it can read another interval, or none, where this view shows a band. Engine record: ${engine ?? "no PP2"}. It measures depletion of population variation, not a cluster of pathogenic variants, so it is PP2, not PM1.`,
      covering.length > 1 ? `${covering.length} intervals overlap this residue; the first is reported.` : "",
      `${REGIONAL_MISSENSE_SOURCE.citation} O/E is read from gnomAD v4.1.1 missense constraint regions; ${REGIONAL_MISSENSE_SOURCE.framework}.`,
      r.regions.length === 1 ? "One interval spans the protein: regional constraint cannot rank residues within it." : "",
    ].filter(Boolean),
  };
}

function perPublishedRung(ctx: HotspotContext, residue: number): HotspotRung {
  const base = { key: "per-published" as const, name: "Published pathogenic-enriched regions", grade: "published-region" as const, source: HOTSPOT_SOURCES.per, explain: "hotspot_per" };
  const p = ctx.perPublished;
  if (p.status === "unavailable") return { ...base, state: "failed", atVariant: null, bands: [], headline: p.reason ?? "The published regions could not be read.", details: [] };
  const verified = p.regions.filter((g) => g.verified);
  const bands = verified.map((g) => ({ start: g.start, end: g.end, label: `${g.analysis === "family" ? `PER (family: ${g.family?.join(", ")})` : "PER (gene)"}`, hit: g.start <= residue && residue <= g.end }));
  const unverified = p.regions.length - verified.length;
  // "Could not compare" and "compared and disagree" are different findings: without a model sequence there
  // were no residues to check, and calling that a numbering mismatch would assert a defect we never saw.
  const withheldReason = p.regions.every((g) => g.checked === 0)
    ? "no modelled residue overlapped the published span, so there was nothing to compare"
    : "the 2019 residues do not match this protein's sequence at those numbers";

  // Nothing placeable: the source has regions, but none matches this protein's sequence. Reporting "outside"
  // here would publish a test we could not run as a negative result.
  if (p.regions.length && !verified.length) {
    const count = `${unverified} published region${unverified === 1 ? "" : "s"}`;
    return {
      ...base, state: "not-shown", atVariant: null, bands: [],
      headline: `The ${count} in this gene could not be placed on this protein's sequence, so the published test was not checked at this residue.`,
      details: [
        "ClinVar 2019 P/LP and HGMD 2019.2 DM vs gnomAD 2.0.2; validated by de novo neurodevelopmental variants (odds ratio 8.33).",
        `${count} withheld: ${withheldReason}.`,
      ],
    };
  }
  if (!p.regions.length) return { ...base, state: "none", atVariant: null, bands, headline: "Pérez-Palma et al.'s published table carries no pathogenic-enriched region for this gene or its paralog family (2019 data).", details: ["The table lists the genes in which the published analysis drew at least one region; a gene absent from it may simply be one the analysis did not cover, so this is not a tested negative.", "The published test had little power in single genes: 2,639 residues in 215 genes passed gene-wise."] };
  const hit = bands.some((b) => b.hit);
  return {
    ...base, state: "read", atVariant: hit ? "inside" : "outside", bands,
    headline: hit ? `The residue lies inside a published pathogenic-enriched region (${bands.filter((b) => b.hit).map((b) => span(b.start, b.end)).join(", ")}).` : unverified
      ? `The residue lies outside every published region that could be placed on this protein (${unverified} withheld).`
      : "The residue lies outside the published pathogenic-enriched regions.",
    details: [
      "ClinVar 2019 P/LP and HGMD 2019.2 DM vs gnomAD 2.0.2; validated by de novo neurodevelopmental variants (odds ratio 8.33).",
      ...(unverified ? [`${unverified} published region${unverified === 1 ? "" : "s"} withheld: ${withheldReason}.`] : []),
    ],
  };
}

function perRerunRung(ctx: HotspotContext, residue: number): HotspotRung {
  const base = { key: "per-rerun" as const, name: "Enrichment test on current data", grade: "method-unvalidated" as const, source: HOTSPOT_SOURCES.per, explain: "hotspot_per" };
  const p = ctx.perRerun;
  const method = `Pérez-Palma's test as published: ${2 * PER_METHOD.halfWindow + 1}-residue windows every ${PER_METHOD.step}, one-sided Fisher, Bonferroni over ${p.windows} windows, adjusted p < ${PER_METHOD.alpha}.`;
  if (p.status === "unavailable") return { ...base, state: "failed", atVariant: null, bands: [], headline: p.reason ?? "ClinVar or gnomAD could not be read.", details: [] };
  if (p.status === "too-few") return { ...base, state: "none", atVariant: null, bands: [], headline: p.reason ?? "Too few ClinVar P/LP residues to test.", details: [method] };
  const bands = p.regions.map((g) => ({ start: g.start, end: g.end, label: `Enriched (adj. p ${pText(g.minAdjP)})`, hit: g.start <= residue && residue <= g.end }));
  const hit = bands.some((b) => b.hit);
  return {
    ...base, state: "read", atVariant: bands.length ? (hit ? "inside" : "outside") : null, bands,
    headline: bands.length
      ? hit ? `The residue lies inside a window enriched for ClinVar P/LP over gnomAD missense (${bands.filter((b) => b.hit).map((b) => span(b.start, b.end)).join(", ")}).` : "Enriched windows exist, but not at this residue."
      : `No window is enriched${p.best ? ` (best ${span(p.best.start, p.best.end)}: ${p.best.patient} P/LP vs ${p.best.population} gnomAD residues, adjusted p ${pText(p.best.adjP)})` : ""}.`,
    details: [
      method,
      `${p.patientResidues} ClinVar P/LP residues and ${p.populationResidues} gnomAD missense residues of ${p.length}. gnomAD v4 carries missense at most residues, so this test has little power: a negative is not evidence of no hot spot.`,
      "No HGMD (licensed). The method was validated on 2019 data; this re-run is not validated.",
    ],
  };
}

function spatialRung(ctx: HotspotContext, residue: number): HotspotRung {
  const s = ctx.spatial;
  const base = { key: "spatial" as const, name: "3D proximity to pathogenic residues", grade: "method-benchmarked" as const, source: HOTSPOT_SOURCES.sivley, explain: "hotspot_spatial", bands: [] };
  const model = s.model ? `${s.model.entryId}${s.model.version ? ` ${s.model.version}` : ""}` : "the AlphaFold DB model";
  const gate = s.univariate && s.bivariate
    ? `Clustering: P/LP vs random residues p ${pText(s.univariate.p)}; P/LP vs gnomAD residues p ${pText(s.bivariate.p)} (${s.permutations.toLocaleString("en-US")} permutations, both must be < 0.05).`
    : null;
  if (s.status === "error") return { ...base, state: "failed", atVariant: null, headline: s.reason ?? "The 3D reading failed.", details: [] };
  if (s.status !== "ok") {
    return { ...base, state: s.status === "not-clustered" ? "not-shown" : "none", atVariant: null, headline: s.reason ?? "Not computed.", details: gate ? [gate] : [] };
  }
  const score = new Map(s.scores).get(residue) ?? null;
  const ranks = s.scores.map(([, v]) => v).sort((a, b) => a - b);
  const pct = score === null ? null : Math.round((100 * ranks.filter((v) => v <= score).length) / ranks.length);
  const self = s.selfCheck;
  // The benchmark graded its AUROC in genes with at least 10 scored P and 10 N residues
  // (scripts/hotspot_benchmark/thresholds.json, informative_gene). Below that floor the number is not the
  // statistic that was validated, so it is withheld rather than printed to two decimals.
  const selfShown = self !== null && self.pathogenic >= MIN_SELF_CHECK_PER_CLASS && self.neutral >= MIN_SELF_CHECK_PER_CLASS;
  return {
    ...base, state: "read", atVariant: null,
    headline: score === null
      ? `No score at this residue: it is outside the confident part of ${model} (pLDDT < 70).`
      : `PathProx ${score >= 0 ? "+" : ""}${score.toFixed(2)} (higher than ${pct}% of residues): within ${s.thresholdA?.toFixed(1)} Å this residue has ${score > 0 ? "more" : score < 0 ? "fewer" : "as many"} ClinVar P/LP neighbours than gnomAD neighbours, in proportion.`,
    details: [
      ...(gate ? [gate] : []),
      ...(selfShown ? [`In this gene the leave-residue-out score separates P/LP from gnomAD-only residues with an in-sample AUROC ${self!.auroc.toFixed(2)} (${self!.pathogenic} vs ${self!.neutral}). The threshold is chosen on the same labels and the negative set is every counted gnomAD missense, wider than the AC≥2 set the benchmark graded, so the number is optimistic.`] : self ? [`No in-gene AUROC: ${self.pathogenic} P/LP vs ${self.neutral} gnomAD-only residues is below the benchmark's floor of ${MIN_SELF_CHECK_PER_CLASS} of each.`] : []),
      `On ${model}, ${s.confidentResidues} of ${s.structureResidues} residues with pLDDT ≥ 70. A suggestion: the benchmark found it adds to regional O/E only where O/E is flat across the gene.`,
    ],
  };
}

export function buildHotspotEvidence(input: HotspotInput): HotspotEvidence {
  const { context: ctx, residue, residueLabel } = input;
  const codes = (input.engineCriteria ?? []).map((c) => c.code ?? "");
  const engine = { pm1: codes.find((c) => /^PM1(_|$)/.test(c)) ?? null, pp2: codes.find((c) => /^PP2(_|$)/.test(c)) ?? null };
  const pm1Note = `PM1 is still assessed as a critical functional site only${engine.pm1 ? ` (engine record: ${engine.pm1})` : ""}. Nothing on this view changes a criterion; hot-spot PM1 is an open decision.`;
  const noColumns: HotspotEvidence["columns"] = {
    rsa: { state: "unavailable", reason: "Not read yet." }, sites: { state: "unavailable", reason: "Not read yet." }, interface: { state: "unavailable", reason: "Not read yet." },
  };
  const empty = { residue, residueLabel, length: 0, rungs: [], rows: [], nearest3d: null, distribution: null, model: null, engine, pm1Note, finding: { lead: "", rest: "" }, columns: noColumns };
  if (!ctx) {
    return input.loadState === "error"
      ? { ...empty, state: "failed", failure: input.loadError ?? "The hot-spot sources could not be read." }
      : { ...empty, state: "loading", failure: null };
  }

  const rungs = [cspecRung(ctx.cspec, residueLabel), regionalRung(ctx, residue, engine.pp2), perPublishedRung(ctx, residue), perRerunRung(ctx, residue), spatialRung(ctx, residue)];
  const d = ctx.distribution;
  rungs.push({
    key: "distribution", name: "Germline variants along the protein", grade: "measurement", explain: "hotspots",
    state: d.status === "ok" ? "read" : "failed", atVariant: null, bands: [], source: { label: ctx.clinvarSource, url: "https://gnomad.broadinstitute.org/" },
    headline: d.status === "ok"
      ? `${d.plp.reduce((n, x) => n + x.n, 0)} ClinVar P/LP missense at ${d.plp.length} residues; ${d.gnomad.reduce((n, x) => n + x.variants, 0)} gnomAD missense at ${d.gnomad.length} residues.`
      : d.reason ?? "ClinVar or gnomAD could not be read.",
    details: ["ClinVar germline classifications, conflicting records excluded. Shown as counts, with no window or cut-point."],
  });

  // Rows: every residue with a ClinVar P/LP missense, nearest first in 3D when the model allows.
  // On a numbering mismatch the model is intact but its residue labels are not trustworthy, so the
  // distances are withheld by the same rule that withholds the 3D rung. Printing Å next to "positions
  // cannot be trusted" is the contradiction this state exists to prevent.
  const trace = ctx.spatial.status === "numbering-mismatch" ? null : ctx.spatial.trace;
  const tIndex = new Map(trace?.residues.map((r, i) => [r, i]) ?? []);
  const ca = (r: number) => {
    const i = tIndex.get(r);
    return i === undefined || !trace ? null : [trace.coords[3 * i], trace.coords[3 * i + 1], trace.coords[3 * i + 2]];
  };
  const here = ca(residue);
  const scores = new Map(ctx.spatial.status === "ok" ? ctx.spatial.scores : []);
  const gn = new Map(d.gnomad.map((g) => [g.pos, g.variants]));
  const rsaAt = new Map(ctx.accessibility.status === "ok" ? ctx.accessibility.values : []);
  const columns: HotspotEvidence["columns"] = {
    rsa: ctx.accessibility.status === "ok" ? { state: "ok", reason: null } : { state: "unavailable", reason: ctx.accessibility.reason ?? "Accessibility was not measured." },
    sites: input.annotations ? { state: "ok", reason: null } : { state: "unavailable", reason: "The UniProt feature table was not read." },
    interface: input.interfaces && input.interfaces.status !== "unavailable"
      ? { state: "ok", reason: input.interfaces.status === "none" ? "No native solved interface was observed for this protein." : null }
      : { state: "unavailable", reason: input.interfaces?.reason ?? "The assembly was not read." },
  };
  const bandsByRung = rungs.map((r) => [r.key, r.bands] as const);
  const rows: HotspotResidueRow[] = d.plp.map((p) => {
    const there = ca(p.pos);
    const distanceA = here && there ? Math.hypot(here[0] - there[0], here[1] - there[1], here[2] - there[2]) : null;
    const i = tIndex.get(p.pos);
    const ref = p.changes[0]?.match(/^p\.([A-Z][a-z]{2})/)?.[1] ?? "";
    return {
      key: `hs:${p.pos}`, residue: p.pos, label: `${ref}${p.pos}`, plp: p.n, maxStars: p.maxStars, changes: p.changes,
      gnomad: d.status === "ok" ? gn.get(p.pos) ?? 0 : null, sequenceDistance: p.pos - residue,
      distanceA: distanceA === null ? null : Math.round(distanceA * 10) / 10,
      plddt: i === undefined || !trace ? null : trace.plddt[i],
      pathprox: scores.get(p.pos) ?? null,
      rsa: rsaAt.get(p.pos) ?? null,
      // A pair (a disulfide) is two residues, not the span between them.
      sites: (input.annotations ?? []).filter((a) => (a.isPair ? p.pos === a.start || p.pos === a.end : a.start <= p.pos && p.pos <= a.end)).map((a) => ({ name: a.name, evidence: a.evidence })),
      interfaceSupport: [...(input.interfaces?.byResidue.get(p.pos) ?? [])],
      inRegions: bandsByRung.filter(([, b]) => inside(b, p.pos)).map(([k]) => k),
    };
  }).sort((a, b) => (a.distanceA ?? Infinity) - (b.distanceA ?? Infinity) || Math.abs(a.sequenceDistance) - Math.abs(b.sequenceDistance));
  const nearestRow = rows.find((r) => r.residue !== residue && r.distanceA !== null) ?? null;

  const insideRungs = rungs.filter((r) => r.atVariant === "inside");
  // Count only the rungs that returned a verdict at this residue. A rung can be readable and still silent
  // here (the expert text is not parsed; a published region could not be placed on this sequence), and
  // counting it as "answered" would claim a consensus that never happened.
  const answered = rungs.filter((r) => r.atVariant !== null);
  const failed = rungs.filter((r) => r.state === "failed");
  const lead = insideRungs.length
    ? `${residueLabel} lies inside a region defined by ${insideRungs.map((r) => r.name.toLowerCase()).join(" and ")}.`
    : answered.length
      ? `${residueLabel} lies inside no region defined by the ${answered.length} definition${answered.length === 1 ? "" : "s"} that returned a verdict here.`
      : `No definition returned a verdict at ${residueLabel}, so this residue is not placed.`;
  const rest = [
    ctx.cspec.status === "ok" && ctx.cspec.specs.some((s) => s.pm1) ? "The expert panel's PM1 text is the authority; read it below." : "",
    nearestRow ? `Nearest ClinVar P/LP residue in 3D: ${nearestRow.label}, ${nearestRow.distanceA} Å (Cα–Cα on the model).` : "",
    failed.length ? `${failed.length} source${failed.length === 1 ? "" : "s"} did not answer, so this is incomplete.` : "",
  ].filter(Boolean).join(" ");

  return {
    residue, residueLabel, length: d.length ?? Math.max(residue, ...d.plp.map((p) => p.pos), ...d.gnomad.map((g) => g.pos)),
    state: "ready", failure: null, rungs, finding: { lead, rest }, pm1Note, rows,
    nearest3d: nearestRow ? { residue: nearestRow.residue, distanceA: nearestRow.distanceA! } : null,
    distribution: d, model: ctx.spatial.model, engine, columns,
  };
}

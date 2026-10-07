/**
 * splicingEvidence.ts — one model of the splicing evidence, for the RNA Splicing tab and its rail.
 *
 * ONE QUESTION: is this variant predicted to change pre-mRNA splicing, and what would the ClinGen
 * splicing rule make of that?
 *
 * The rule is the ClinGen SVI Splicing Subgroup's (Walker et al. 2023): SpliceAI's max delta score
 * ≥ 0.2 supports PP3, at or below 0.1 supports BP4, between supports neither. The ACMG engine does NOT
 * read splicing — its PP3/BP4 comes from the missense vote alone (owner decision, recorded in
 * doc/SPLICING_TAB_REVIEW.md) — so this model reports the splicing rule as what it WOULD support,
 * beside the engine's own record, and says so whenever the two sit awkwardly together.
 *
 * It replaced a derivation whose surfaces asserted more than the data did:
 *
 *   • a splicing "verdict" printed as "Pathogenic Supporting (PP3)" / "Benign Supporting (BP4)",
 *     although no engine criterion was ever recorded from it — and the Insights banner said the
 *     engine's PP3 vote "includes this splice disruption signal", which it never has;
 *   • that verdict turned pathogenic for ANY variant ≤ 5 bp from a junction and for dbscSNV ≥ 0.6,
 *     and turned benign only at SpliceAI ≤ 0.02 AND > 12 bp from a junction — a rule cited to a
 *     "ClinGen SVI Recommendation (2019)" that does not exist;
 *   • dbscSNV's window was drawn as a symmetric ±12 bp flank; its real windows are −3..+8 (donor)
 *     and −12..+2 (acceptor), so exonic variants 3–12 bp from an acceptor were "inside" it;
 *   • AlphaGenome's signed SHAP contribution was printed ×100 as a percentage, with a "Primary
 *     Driver" badge at an app-defined 0.25;
 *   • a "mechanistic etiology" card declared "pathogenicity is driven by post-translational protein
 *     misfolding" whenever FoldX, AlphaMissense or REVEL crossed a local line — including REVEL's
 *     0.5 heatmap colour break — even when splicing had not been assessed at all;
 *   • a missing SpliceAI score read "No precomputed or runtime SpliceAI delta scores exist for this
 *     position", which is false for any SNV in an annotated gene: SpliceAI scores them all.
 *
 * INVARIANTS
 *   • The splicing call comes from `evaluateSplicePredictor` (SpliceAI only); nothing here re-tests
 *     a score against a literal.
 *   • The engine's PP3/BP4 is READ from its criteria list (via `buildPredictorEvidence`), never
 *     inferred from splicing.
 *   • dbscSNV and junction distance are context. They never make a call.
 *   • Absence is a state with a reason, never 0, never benign.
 *
 * Pure: no React, no fetching.
 */
import type { AnalysisResult } from "./contracts.ts";
import { THRESHOLDS, evaluateSplicePredictor } from "./thresholds/index.ts";
import { refusalReasonFor, resolveEvidenceAvailability, type EvidenceAvailability } from "./evidenceAvailability.ts";
import { ENGINE_STATE_LABELS } from "./engineStatus.ts";
import { buildPredictorEvidence } from "./predictorEvidence.ts";
import { buildAlphaGenomeEvidence, fmtShare, fmtSigned } from "./alphagenomeEvidence.ts";

// ── Sources ─────────────────────────────────────────────────────────────────────────────────────

export const SPLICING_SOURCES = [
  {
    key: "walker2023",
    short: "Walker et al. 2023",
    citation:
      "Walker LC, et al. Using the ACMG/AMP framework to capture evidence related to predicted and observed impact on splicing: recommendations from the ClinGen SVI Splicing Subgroup. Am J Hum Genet 2023;110:1046–1067.",
    doi: "10.1016/j.ajhg.2023.06.002",
  },
  {
    key: "jaganathan2019",
    short: "Jaganathan et al. 2019",
    citation: "Jaganathan K, et al. Predicting splicing from primary sequence with deep learning. Cell 2019;176:535–548.",
    doi: "10.1016/j.cell.2018.12.015",
  },
  {
    key: "jian2014",
    short: "Jian et al. 2014",
    citation:
      "Jian X, Boerwinkle E, Liu X. In silico prediction of splice-altering single nucleotide variants in the human genome. Nucleic Acids Res 2014;42:13534–13544.",
    doi: "10.1093/nar/gku1206",
  },
  {
    key: "aboutayoun2018",
    short: "Abou Tayoun et al. 2018",
    citation:
      "Abou Tayoun AN, et al. Recommendations for interpreting the loss of function PVS1 ACMG/AMP variant criterion. Hum Mutat 2018;39:1517–1524.",
    doi: "10.1002/humu.23626",
  },
] as const;

// ── Types ───────────────────────────────────────────────────────────────────────────────────────

export type SpliceTone = "danger" | "good" | "neutral" | "muted" | "warning" | "accent";

/** The splicing rule's reading of the SpliceAI score. */
export type SplicingRuleState = "pp3" | "bp4" | "between" | "no-score" | "pending";

export interface SpliceBand {
  from: number;
  to: number;
  side: "path" | "benign";
  label: string;
  active: boolean;
}

export interface SpliceTick {
  value: number;
  label: string;
}

export interface SpliceScale {
  min: number;
  max: number;
  /** Walker 2023 bands (SpliceAI max Δ only). */
  bands: SpliceBand[];
  /** The authors' own operating points — ticks, not strengths. */
  ticks: SpliceTick[];
}

export type SpliceGroup = "rule" | "channels" | "context";

export const SPLICE_GROUP_LABEL: Record<SpliceGroup, string> = {
  rule: "Splicing rule input",
  channels: "SpliceAI channels",
  context: "Context",
};

export const SPLICE_GROUP_NOTE: Record<SpliceGroup, string> = {
  rule: "SpliceAI max Δ on the Walker 2023 bands",
  channels: "Which change the maximum came from, and where it lands (bases from the variant, transcript direction)",
  context: "Authors' cut-points and attributions · not counted",
};

export interface SpliceReading {
  key: string;
  group: SpliceGroup;
  name: string;
  description: string;
  score: number | null;
  scoreText: string;
  /** Second line under the number (a position, a unit). */
  sub: string | null;
  scale: SpliceScale | null;
  /** Provenance of the drawn marks, shown under the ruler. */
  scaleSource: string | null;
  /** `unapplied`: what the splicing rule supports, which the engine never records — drawn dashed. */
  call: { label: string; tone: SpliceTone; isCode: boolean; unapplied?: boolean } | null;
  note: string | null;
  availability: EvidenceAvailability;
  knowledgeKey: string | null;
  link: { tab: string; label: string } | null;
}

export type SpliceChannelKey = "ds_ag" | "ds_al" | "ds_dg" | "ds_dl";

export const SPLICE_CHANNEL_NAME: Record<SpliceChannelKey, string> = {
  ds_ag: "Acceptor gain",
  ds_al: "Acceptor loss",
  ds_dg: "Donor gain",
  ds_dl: "Donor loss",
};

/**
 * The one line the four SpliceAI channels share. It used to be appended to each channel's own
 * description ("…; a model signal, not an observed effect."), so the same caveat printed four
 * times; it is stated once for the group now, and each channel carries only what is unique to it.
 */
export const SPLICE_CHANNEL_CAPTION =
  "Each is a model signal, not an observed effect. Gain predicts a splice site created or strengthened; loss predicts one weakened or abolished.";

export interface SpliceGeometry {
  /** Resolver distance: 0 = the boundary exonic base, 1 = the first intronic base. */
  distance: number | null;
  regionType: "exonic" | "intronic" | null;
  junction: "donor" | "acceptor" | "terminal" | "unresolved";
  /** Splice-site position in HGVS convention (no 0): donor exonic −, intronic +; acceptor intronic −, exonic +. */
  position: number | null;
  /** "exon 6, base 26 from its acceptor" etc. Null when orientation is unknown. */
  positionPhrase: string | null;
  /** True at intronic ±1/±2 — the canonical dinucleotide, a PVS1 question rather than PP3. */
  isCanonicalDinucleotide: boolean;
  /** Whether dbscSNV's window reaches this position; null when the position cannot be placed. */
  inDbscsnvWindow: boolean | null;
  exonNumber: number | null;
  totalExons: number | null;
  exonLength: number | null;
  exonStart: number | null;
  exonEnd: number | null;
  intronNumber: number | null;
  strand: "+" | "-" | null;
  transcriptId: string | null;
  refseqTranscriptId: string | null;
  ensemblTranscriptId: string | null;
  exonLabel: string;
  intronLabel: string;
  strandLabel: string;
  junctionLabel: string;
  /** Why no geometry, when there is none. */
  refusal: string | null;
}

/**
 * The splice map: the variant at 0, everything else in bases from it, in TRANSCRIPT direction
 * (5′ → 3′ left to right), so a reverse-strand gene reads the same way as a forward one.
 *
 * What it holds, and where each number comes from:
 *   exon / sites      the resolver's exon length and the variant's splice-site position; the
 *                     annotated donor is the exon's last base and the annotated acceptor its first,
 *                     which is the base SpliceAI itself reports a site at (checked against the live
 *                     service on BRCA1 exon 3: DP_DG −3 and DP_AG +50 land on the Ensembl exon ends);
 *   predictions       SpliceAI's four channels at their delta positions. DP is in GENOMIC
 *                     coordinates, so a reverse-strand gene flips the sign; with no strand nothing
 *                     is placed rather than placed on the wrong side;
 *   dbscSNV window    Jian 2014's −3..+8 donor / −12..+2 acceptor, as a span of bases.
 * It replaced a ±40 bp ruler that showed one junction and the variant, and could not say whether a
 * predicted change lands on a real splice site or makes a new one.
 */
export interface SpliceMapSite {
  type: "donor" | "acceptor";
  /** Offset of the site's exonic base from the variant, in bases. */
  offset: number;
  /** True for the exon's other boundary (the one the variant is not nearest to). */
  far: boolean;
}

export interface SpliceMapPrediction {
  key: SpliceChannelKey;
  name: string;
  type: "donor" | "acceptor";
  kind: "gain" | "loss";
  ds: number;
  /** Bases from the variant, transcript direction. */
  offset: number;
  /** The annotated site of the same type this lands on (±1 base), or null. */
  atSite: "donor" | "acceptor" | null;
  /** At or above the Walker PP3 band. */
  inPp3Band: boolean;
}

/** A neighbouring exon of the same transcript, in offsets from the variant (transcript direction). */
export interface SpliceMapExon {
  number: number;
  start: number;
  end: number;
}

export interface SpliceMap {
  junction: "donor" | "acceptor";
  position: number;
  /** Junction offset (between two bases, so ends in .5). */
  junctionOffset: number;
  /** The exon's extent in offsets; an end is null when the exon length is unknown. */
  exon: { start: number | null; end: number | null };
  sites: SpliceMapSite[];
  /** The other exons of the transcript that fall in reach; empty when the payload does not carry them. */
  neighbours: SpliceMapExon[];
  /** The transcript's exon count, for numbering the introns between. */
  totalExons: number | null;
  /** The nearest exon's number, null when unresolved. */
  exonNumber: number | null;
  /** dbscSNV's window as [from, to] in offsets (edges of the bases it covers). */
  dbscWindow: [number, number];
  predictions: SpliceMapPrediction[];
  /** All available delta scores, including channels that cannot be positioned. */
  maxScore: number | null;
  /** Non-zero signals without delta positions; never silently treated as absent scores. */
  missingPositions: Array<{ key: SpliceChannelKey; name: string; ds: number }>;
  /**
   * Scored channels below the plotting floor. A Δ this close to zero has an arbitrary delta position
   * (SpliceAI's dp is only meaningful when there is a signal), so these are never placed as lollipops.
   * The figure draws them as a compact "no signal" row instead. A non-zero member moves to a lollipop
   * only when the reader asks for small signals; an exactly-zero channel always stays here.
   */
  quiet: Array<{ key: SpliceChannelKey; name: string; kind: "gain" | "loss"; ds: number }>;
  /** Count of channels in `quiet`, kept for surfaces that only need the number. */
  belowFloor: number;
  /** Why predictions are not placed, when they cannot be. */
  predictionsNote: string | null;
  /** Half-width of the drawn window in bases. */
  halfWidth: number;
  /** The variant sits in the exon (true) or the intron (false). */
  exonic: boolean;
}

/** Local display filter, not a biological threshold. Smaller non-zero scores remain inspectable. */
export const SPLICE_MAP_FLOOR = 0.01;
/**
 * The SpliceAI reporting windows a reader can choose (Settings and the inline control share this list).
 * 50 is Illumina's published default, 500 the Broad Lookup's; 2000 is the widest the map draws.
 */
export const SPLICEAI_WINDOWS = [50, 200, 500, 1000, 2000] as const;

/**
 * The map's own zoom steps. NOT the same list as `SPLICEAI_WINDOWS`: the map picks the smallest step that
 * holds what is drawn (a prediction 70 bases out gets 100, though ±100 is not a selectable window), so
 * it has finer steps than the reader's choices.
 */
export const SPLICE_MAP_STEPS = [50, 100, 200, 500, 1000, 2000] as const;

/** Bases from splice-site position `from` to `to` (no 0 in the numbering, so crossing it costs one). */
export function offsetBetweenPositions(from: number, to: number): number {
  const d = to - from;
  return from * to < 0 ? d - Math.sign(d) : d;
}

export interface SpliceEngineRecord {
  /** The payload carries the engine's criteria list at all. */
  known: boolean;
  /** The PP3/BP4 code the engine recorded (from the missense vote), or null. */
  code: string | null;
  /** What the missense vote alone supports, for the "unconfirmed" case. */
  voteCode: string | null;
}

export type SpliceRelation =
  /** Splicing supports PP3 while the engine recorded BP4 from the missense vote. */
  | "conflict"
  /** Both point to PP3: ClinGen counts PP3 once. */
  | "same-pp3"
  /** The engine recorded BP4 and SpliceAI has no score: the splicing side is unchecked. */
  | "bp4-unchecked"
  | "none";

export interface SplicingEvidence {
  rule: {
    state: SplicingRuleState;
    code: "PP3" | "BP4" | null;
    maxDs: number | null;
    /** The channel the maximum came from, and its Δ position. */
    maxChannel: SpliceChannelKey | null;
    maxShift: number | null;
  };
  spliceai: {
    availability: EvidenceAvailability;
    provenance: {
      source: "broad-lookup" | "precomputed-dbnsfp" | "genos";
      distanceBp: number | null;
      masked: number | null;
      computedLive: boolean | null;
      annotationSet: string | null;
    } | null;
    /** One line naming what served the number. */
    sourceText: string;
    windowText: string;
    maskText: string;
  };
  dbscsnv: { ada: number | null; rf: number | null; max: number | null; altering: boolean | null };
  alphagenome: { share: number | null; shap: number | null; availability: EvidenceAvailability };
  /** The coordinate was rejected upstream for a reference-base mismatch (AlphaGenome's message). */
  referenceMismatch: string | null;
  geometry: SpliceGeometry;
  /** Null when the variant cannot be placed at a donor or acceptor. */
  map: SpliceMap | null;
  readings: SpliceReading[];
  engine: SpliceEngineRecord;
  relation: SpliceRelation;
  pending: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fmt3 = (v: number) => v.toFixed(3);

/**
 * A SpliceAI delta score as every surface prints it: two decimals, SpliceAI's own convention.
 * Two exceptions keep the print honest. A non-zero score under 0.005 reads "< 0.01", not "0.00"
 * (the tab printed 0.00 while the rail printed 0.001 for the same score). A score that rounds
 * onto a Walker cut-point it is not on gets a third decimal, so 0.0996 never reads "0.10" while
 * sitting in the BP4 band.
 */
export function formatDelta(v: number): string {
  if (v > 0 && v < 0.005) return "< 0.01";
  const two = v.toFixed(2);
  const S = THRESHOLDS.spliceai;
  const onCut = Number(two) === S.splicingBp4Below || Number(two) === S.splicingPp3;
  return onCut && Number(two) !== v ? v.toFixed(3) : two;
}
/** "a max Δ of 0.34" / "a max Δ under 0.01" — for sentences. */
const deltaPhrase = (v: number) => (v > 0 && v < 0.005 ? "a max Δ under 0.01" : `a max Δ of ${formatDelta(v)}`);
const fmtBp = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)} bp`;
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const SPLICEAI_SCALE_SOURCE = "Bands: Walker 2023 · ticks: authors' 0.5 and 0.8";

/** SpliceAI's 0–1 axis with the Walker bands and the authors' two upper operating points. */
function spliceAiScale(score: number | null, withBands: boolean): SpliceScale {
  const S = THRESHOLDS.spliceai;
  const code = score === null ? null : score >= S.splicingPp3 ? "PP3" : score <= S.splicingBp4Below ? "BP4" : null;
  return {
    min: 0,
    max: 1,
    bands: withBands
      ? [
          { from: 0, to: S.splicingBp4Below, side: "benign", label: `BP4 · splicing: \u2264 ${S.splicingBp4Below.toFixed(1)}`, active: code === "BP4" },
          { from: S.splicingPp3, to: 1, side: "path", label: `PP3 · splicing: ≥ ${S.splicingPp3.toFixed(1)}`, active: code === "PP3" },
        ]
      : [],
    ticks: [
      { value: S.authorsRecommended, label: `Authors' recommended cut-off ${S.authorsRecommended}` },
      { value: S.authorsHighPrecision, label: `Authors' high-precision cut-off ${S.authorsHighPrecision}` },
    ],
  };
}

/**
 * Splice junction orientation.
 *
 * The resolver's `junctionType` decides whenever it is present. The legacy distance-based
 * inference survives ONLY for payloads where the field is absent (`undefined`) — those predate
 * the resolver knowing about junction kinds at all. An EXPLICIT non-junction answer must be
 * honoured: `"terminal"` is a transcript terminus, not a splice site, and `null` is the resolver
 * saying "no boundary identified" — both previously fell through to "donor", drawing a GT donor
 * at a boundary the resolver had just excluded (unmapping defect F-15).
 */
export function resolveJunctionOrientation(
  result: AnalysisResult | null | undefined,
  distance: number | null
): { isDonor: boolean; isAcceptor: boolean; junctionType: string } {
  // A single-exon transcript has no intron-spanning junction, even if a legacy payload
  // mislabels its terminus as a donor/acceptor. Keep it out of splice-site geometry.
  if (result?.conservationData?.spliceProximity?.totalExons === 1) {
    return { isDonor: false, isAcceptor: false, junctionType: "Transcript terminus (not a splice junction)" };
  }
  const raw = result?.conservationData?.spliceProximity?.junctionType;
  const isAcceptor = raw === "acceptor";
  const isDonor = raw === "donor" || (raw === undefined && distance !== null);
  const junctionType = isDonor
    ? "5′ splice site (donor)"
    : isAcceptor
    ? "3′ splice site (acceptor)"
    : raw === "terminal"
    ? "Transcript terminus (not a splice junction)"
    : "Boundary (orientation not resolved)";
  return { isDonor, isAcceptor, junctionType };
}

function buildSpliceMap({
  geometry: g,
  channels,
  strand,
  genomicPos,
  nearby,
  showSmallSignals,
  maxDs,
}: {
  geometry: SpliceGeometry;
  channels: Array<{ key: SpliceChannelKey; ds: number | null; dp: number | null }>;
  strand: "+" | "-" | null;
  genomicPos: number | null;
  nearby: Array<{ number: number; start: number; end: number }> | null;
  showSmallSignals: boolean;
  maxDs: number | null;
}): SpliceMap | null {
  const p = g.position;
  if (p === null || (g.junction !== "donor" && g.junction !== "acceptor") || g.regionType === null) return null;
  const junction = g.junction;
  const exonic = g.regionType === "exonic";
  const k = Math.abs(p);
  // Junction offset from the variant: it lies (k − ½) bases away, downstream of an exonic donor
  // variant, upstream of an intronic one, and the mirror image at an acceptor.
  const junctionOffset = junction === "donor" ? (exonic ? k - 0.5 : -(k - 0.5)) : exonic ? -(k - 0.5) : k - 0.5;
  const L = g.exonLength !== null && g.exonLength > 0 ? g.exonLength : null;

  let start: number | null;
  let end: number | null;
  if (junction === "donor") {
    end = junctionOffset;
    start = L === null ? null : junctionOffset - L;
  } else {
    start = junctionOffset;
    end = L === null ? null : junctionOffset + L;
  }
  // The resolver's own exon list, when the payload carries it, is the truth for every exon's bounds
  // (the derived extent above only needs the nearest exon's length). Genomic edges sit half a base
  // outside the first and last base; a reverse-strand gene flips into transcript direction.
  const neighbours: SpliceMapExon[] = [];
  if (nearby && nearby.length > 0 && genomicPos !== null && strand !== null) {
    const toOffsets = (e: { start: number; end: number }): [number, number] => {
      const a = e.start - 0.5 - genomicPos;
      const b = e.end + 0.5 - genomicPos;
      return strand === "-" ? [-b, -a] : [a, b];
    };
    for (const e of nearby) {
      const [a, b] = toOffsets(e);
      if (g.exonNumber !== null && e.number === g.exonNumber) {
        start = a;
        end = b;
      } else {
        neighbours.push({ number: e.number, start: a, end: b });
      }
    }
    neighbours.sort((x, y) => x.start - y.start);
  }

  const sites: SpliceMapSite[] = [];
  // Exon edges are not automatically splice junctions: terminal exons have only one.
  // For legacy payloads with unknown numbering, only the resolver's known junction is asserted.
  const hasAcceptor = (number: number | null) => number !== null && number > 1;
  const hasDonor = (number: number | null) => number !== null && g.totalExons !== null && number < g.totalExons;
  if (start !== null && (hasAcceptor(g.exonNumber) || (g.exonNumber === null && junction === "acceptor"))) sites.push({ type: "acceptor", offset: start + 0.5, far: junction === "donor" });
  if (end !== null && (hasDonor(g.exonNumber) || (g.totalExons === null && junction === "donor") || (g.exonNumber === null && junction === "donor"))) sites.push({ type: "donor", offset: end - 0.5, far: junction === "acceptor" });
  for (const n of neighbours) {
    if (hasAcceptor(n.number)) sites.push({ type: "acceptor", offset: n.start + 0.5, far: true });
    if (hasDonor(n.number)) sites.push({ type: "donor", offset: n.end - 0.5, far: true });
  }

  const W = THRESHOLDS.dbscsnv.window;
  const [qa, qb] = junction === "donor" ? [-W.donor.exonic, W.donor.intronic] : [-W.acceptor.intronic, W.acceptor.exonic];
  const dbscWindow: [number, number] = [offsetBetweenPositions(p, qa) - 0.5, offsetBetweenPositions(p, qb) + 0.5];

  const predictions: SpliceMapPrediction[] = [];
  const missingPositions: SpliceMap["missingPositions"] = [];
  const quiet: SpliceMap["quiet"] = [];
  let predictionsNote: string | null = null;
  const scored = channels.filter(c => c.ds !== null);
  // A channel at or below the floor is not placed: near zero SpliceAI's delta position is arbitrary, so a
  // lollipop there would assert a predicted site the score does not support. It is retained for the
  // no-signal row. A non-zero score leaves `quiet` only when the reader explicitly asks for small signals.
  const belowFloorQuiet = (ds: number) => ds < SPLICE_MAP_FLOOR && !(showSmallSignals && ds > 0);
  for (const c of scored) {
    const ds = c.ds as number;
    if (belowFloorQuiet(ds)) {
      quiet.push({ key: c.key, name: SPLICE_CHANNEL_NAME[c.key], kind: c.key === "ds_ag" || c.key === "ds_dg" ? "gain" : "loss", ds });
      continue;
    }
    // Positions are reported in genomic coordinates; without a strand they cannot be oriented, so nothing is placed.
    if (strand === null) continue;
    if (c.dp === null) {
      missingPositions.push({ key: c.key, name: SPLICE_CHANNEL_NAME[c.key], ds });
      continue;
    }
    const offset = strand === "-" ? -c.dp : c.dp;
    const type: "donor" | "acceptor" = c.key === "ds_dg" || c.key === "ds_dl" ? "donor" : "acceptor";
    const near = sites.find(x => x.type === type && Math.abs(x.offset - offset) <= 1);
    predictions.push({
      key: c.key,
      name: SPLICE_CHANNEL_NAME[c.key],
      type,
      kind: c.key === "ds_ag" || c.key === "ds_dg" ? "gain" : "loss",
      ds,
      offset,
      atSite: near ? type : null,
      inPp3Band: ds >= THRESHOLDS.spliceai.splicingPp3,
    });
  }
  if (scored.length > 0 && strand === null) {
    predictionsNote = "The strand is not resolved, so SpliceAI's positions (reported in genomic coordinates) are not placed.";
  } else if (missingPositions.length > 0) {
    predictionsNote = `${missingPositions.length === 1 ? "One scored channel has" : `${missingPositions.length} scored channels have`} no delta position, so ${missingPositions.length === 1 ? "it is" : "they are"} not placed on the map. Exact scores are retained in predicted site details.`;
  }
  const belowFloor = quiet.length;

  // The window grows to hold what is drawn: every plotted prediction, and the junction when the
  // variant is far from it. Never past the widest step (2 kb), which matches the widest window offered.
  const need = Math.max(
    SPLICE_MAP_STEPS[0],
    ...predictions.map(x => Math.abs(x.offset) * 1.1),
    Math.min(Math.abs(junctionOffset) * 1.2, 500)
  );
  const halfWidth = SPLICE_MAP_STEPS.find(x => x >= need) ?? SPLICE_MAP_STEPS[SPLICE_MAP_STEPS.length - 1];

  return {
    junction,
    position: p,
    junctionOffset,
    exon: { start, end },
    sites,
    neighbours,
    totalExons: g.totalExons,
    exonNumber: g.exonNumber,
    dbscWindow,
    predictions: predictions.sort((a, b) => a.offset - b.offset),
    maxScore: scored.length > 0 || maxDs !== null ? Math.max(maxDs ?? 0, ...scored.map(c => c.ds!)) : null,
    missingPositions,
    quiet,
    belowFloor,
    predictionsNote,
    halfWidth,
    exonic,
  };
}

/**
 * Splice-site position in HGVS-style numbering (no 0) from the resolver's distance: at a donor the
 * exon runs −1, −2… and the intron +1, +2…; at an acceptor the intron runs −1, −2… and the exon
 * +1, +2…. Null for an intronic distance of 0, which is not a real placement.
 */
export function spliceSitePosition(junction: "donor" | "acceptor", regionType: "exonic" | "intronic", distance: number): number | null {
  const p = junction === "donor" ? (regionType === "exonic" ? -(distance + 1) : distance) : regionType === "exonic" ? distance + 1 : -distance;
  return p === 0 ? null : p;
}

/**
 * How the header words a variant's place at its nearest junction: "−7 donor" when the resolver
 * oriented it, else the bare distance. The header used to call this a red, pulsing "Splice alert"
 * on the app's own ≤ 5 bp flag; a distance is context, so it is stated as one.
 */
export function describeSplicePlacement(
  result: AnalysisResult | null | undefined
): { short: string; long: string } | null {
  const sp = result?.conservationData?.spliceProximity;
  const distance = finite(sp?.distance);
  if (distance === null) return null;
  const { isDonor, isAcceptor } = resolveJunctionOrientation(result, distance);
  const region = sp?.regionType ?? null;
  const junction = isDonor ? "donor" : isAcceptor ? "acceptor" : null;
  const pos = junction && region ? spliceSitePosition(junction, region, distance) : null;
  if (pos !== null && junction) {
    const signed = `${pos > 0 ? "+" : "−"}${Math.abs(pos)}`;
    return { short: `${signed} ${junction}`, long: `${signed} from the ${junction}, ${region}` };
  }
  return { short: `${distance} bp`, long: `${distance} bp from the nearest exon–intron boundary` };
}

const SPLICEAI_FAILURE_LABEL: Record<NonNullable<NonNullable<AnalysisResult["conservationData"]>["spliceaiFailure"]>["kind"], string> = {
  "rate-limited": ENGINE_STATE_LABELS["upstream-busy"],
  "coordinate-rejected": "Coordinate rejected",
  "upstream-error": ENGINE_STATE_LABELS["upstream-error"],
  timeout: ENGINE_STATE_LABELS["upstream-busy"],
  network: ENGINE_STATE_LABELS["upstream-error"],
  unreadable: ENGINE_STATE_LABELS["upstream-error"],
  "no-transcript": ENGINE_STATE_LABELS["no-result"],
};

export function describeSpliceAiFailure(f: NonNullable<NonNullable<AnalysisResult["conservationData"]>["spliceaiFailure"]>): string {
  const said = f.detail ? ` It said: “${f.detail}”.` : "";
  switch (f.kind) {
    case "rate-limited":
      return `The Broad SpliceAI Lookup refused the request (HTTP ${f.httpStatus ?? 429}): it limits interactive use per user. The variant was not scored; retrying shortly usually works.`;
    case "coordinate-rejected":
      return `The Broad SpliceAI Lookup refused this variant (HTTP ${f.httpStatus ?? 400}), most often because the reference base does not match the genome at the coordinate sent.${said}`;
    case "upstream-error":
      return `The Broad SpliceAI Lookup failed on its side (HTTP ${f.httpStatus ?? 500}); the variant was not scored.${said}`;
    case "timeout":
      return "The Broad SpliceAI Lookup did not answer within the request budget; the variant was not scored.";
    case "network":
      return `The Broad SpliceAI Lookup could not be reached; the variant was not scored.${said}`;
    case "unreadable":
      return "The Broad SpliceAI Lookup answered, but not in the shape expected, so nothing could be read from it.";
    case "no-transcript":
      return "The Broad SpliceAI Lookup answered with no scored transcript at this coordinate, so it had nothing to report. For a variant inside an annotated gene that points to the coordinate, not to nothing to score.";
  }
}

function describeSpliceAiSource(p: SplicingEvidence["spliceai"]["provenance"]): string {
  if (!p) return "Source not stated in the payload";
  if (p.source === "broad-lookup") return p.computedLive === false ? "Broad SpliceAI Lookup (served from its table)" : "Broad SpliceAI Lookup (model run for this request)";
  if (p.source === "genos") return "Genos (precomputed)";
  return "dbNSFP (Illumina precomputed, GENCODE v24)";
}

// ── Build ───────────────────────────────────────────────────────────────────────────────────────

export interface SplicingEvidenceInput {
  result: AnalysisResult;
  isLoading?: boolean;
  /** Whether the browser holds an AlphaGenome key. `undefined` = cannot know. */
  alphagenomeConfigured?: boolean;
  /** Display-only: never changes the rule or source scores; zero has no location to plot. */
  showSmallSignals?: boolean;
}

export function buildSplicingEvidence({ result, isLoading = false, alphagenomeConfigured, showSmallSignals = false }: SplicingEvidenceInput): SplicingEvidence {
  const r = result as any;
  const cd = result.conservationData ?? null;
  const sp = cd?.spliceProximity ?? null;
  const sai = cd?.spliceai ?? null;
  const dbsc = cd?.dbscsnv ?? null;
  const refusals = cd?.assemblyRefusals ?? null;

  // ── Geometry ──
  const distance = finite(sp?.distance);
  const regionType: "exonic" | "intronic" | null = sp?.regionType ?? null;
  const rawJunction = sp?.junctionType;
  const { isDonor, isAcceptor, junctionType } = resolveJunctionOrientation(result, distance);
  const junction: SpliceGeometry["junction"] = isDonor ? "donor" : isAcceptor ? "acceptor" : rawJunction === "terminal" || sp?.totalExons === 1 ? "terminal" : "unresolved";
  // Legacy payloads carry no regionType; placement then follows the old exonic default, but no
  // position is claimed for them.
  const oriented = (junction === "donor" || junction === "acceptor") && distance !== null && regionType !== null;
  const position = oriented ? spliceSitePosition(junction as "donor" | "acceptor", regionType, distance as number) : null;
  const W = THRESHOLDS.dbscsnv.window;
  const inDbscsnvWindow =
    position === null
      ? null
      : junction === "donor"
      ? position >= -W.donor.exonic && position <= W.donor.intronic
      : position >= -W.acceptor.intronic && position <= W.acceptor.exonic;
  const isCanonicalDinucleotide = position !== null && regionType === "intronic" && Math.abs(position) <= 2;

  const exonNumber = finite(sp?.exonNumber);
  const totalExons = finite(sp?.totalExons);
  const intronNumber = finite(sp?.intronNumber ?? sp?.adjacentIntronNumber);
  const strand = sp?.strand ?? null;
  const rawRefSeq = result.maneRefSeqId ?? result.predictorData?.maneRefSeqId ?? result.numberingRemap?.from?.maneRefSeqId ?? null;
  const refseqTranscriptId = rawRefSeq?.trim() || null;
  const rawEnsembl = sp?.transcriptId ?? result.transcriptId ?? null;
  const ensemblTranscriptId = rawEnsembl?.trim() || null;
  // RefSeq first for clinical reading; Ensembl when that is all there is.
  const transcriptId = refseqTranscriptId || ensemblTranscriptId || null;
  const exonLabel = exonNumber !== null ? `Exon ${exonNumber}${totalExons ? ` of ${totalExons}` : ""}` : "Exon not resolved";
  const intronLabel = totalExons === 1 ? "Single-exon transcript" : intronNumber !== null ? `Intron ${intronNumber}` : "Intron not resolved";
  const strandLabel = strand ? (strand === "+" ? "Forward (+)" : "Reverse (−)") : "Strand not resolved";

  let positionPhrase: string | null = null;
  if (position !== null && distance !== null) {
    const site = junction === "donor" ? "donor" : "acceptor";
    positionPhrase =
      regionType === "exonic"
        ? `the ${ordinal(distance + 1)} base of ${exonNumber !== null ? `exon ${exonNumber}` : "the exon"} from its ${site} boundary`
        : `the ${ordinal(distance)} intronic base from the ${site}`;
  }

  const geometry: SpliceGeometry = {
    distance,
    regionType,
    junction,
    position,
    positionPhrase,
    isCanonicalDinucleotide,
    inDbscsnvWindow,
    exonNumber,
    totalExons,
    exonLength: finite(sp?.exonLength),
    exonStart: finite(sp?.exonStart),
    exonEnd: finite(sp?.exonEnd),
    intronNumber,
    strand,
    transcriptId,
    refseqTranscriptId,
    ensemblTranscriptId,
    exonLabel,
    intronLabel,
    strandLabel,
    junctionLabel: junctionType,
    refusal: refusalReasonFor(refusals, "splice-proximity"),
  };

  // ── SpliceAI ──
  const maxDs = finite(sai?.max_ds);
  const channels: Array<{ key: SpliceChannelKey; ds: number | null; dp: number | null }> = (
    ["ds_ag", "ds_al", "ds_dg", "ds_dl"] as SpliceChannelKey[]
  ).map(key => ({ key, ds: finite(sai?.[key]), dp: finite(sai?.dp?.[key]) }));
  let maxChannel: SpliceChannelKey | null = null;
  if (maxDs !== null) {
    const top = channels.filter(c => c.ds !== null).sort((a, b) => (b.ds as number) - (a.ds as number))[0];
    maxChannel = top && top.ds === maxDs ? top.key : null;
  }
  // SpliceAI reports delta positions in GENOMIC coordinates; every other number on this tab is in
  // transcript direction (−7 from the donor), so a reverse-strand gene's positions flip here. With no
  // strand they stay genomic, and the row says so.
  const strandKnown = geometry.strand !== null;
  const orient = (dp: number | null): number | null => (dp === null ? null : geometry.strand === "-" ? (dp === 0 ? 0 : -dp) : dp);
  const maxShift = maxChannel ? orient(channels.find(c => c.key === maxChannel)!.dp) : null;

  const saiPending = !sai && isLoading;
  const inGene = regionType === "exonic" || regionType === "intronic";
  const saiAvailability = resolveEvidenceAvailability({ value: maxDs, pending: saiPending });
  const failure = cd?.spliceaiFailure ?? null;
  if (!saiAvailability.hasValue && !saiPending) {
    saiAvailability.reason = sai
      ? "SpliceAI answered without a delta score for any of its four channels."
      : failure
      ? describeSpliceAiFailure(failure)
      : inGene
      ? "Neither the live Broad lookup nor the precomputed tables returned a score, and the payload does not record why. SpliceAI scores every single-nucleotide change in an annotated gene, so this points to a failed or rejected request, not to nothing to score."
      : "Neither the live Broad lookup nor the precomputed tables returned a score for this coordinate.";
    if (failure) {
      // A failed request is a provider fault, not "no result": say so in the state label too.
      saiAvailability.label = SPLICEAI_FAILURE_LABEL[failure.kind];
    }
  }

  const prov = sai?.provenance
    ? {
        source: sai.provenance.source,
        distanceBp: finite(sai.provenance.distanceBp),
        masked: finite(sai.provenance.masked),
        computedLive: typeof sai.provenance.computedLive === "boolean" ? sai.provenance.computedLive : null,
        annotationSet: sai.provenance.annotationSet ?? null,
      }
    : null;

  const signal = evaluateSplicePredictor(sp, sai, dbsc);
  const ruleState: SplicingRuleState = saiPending
    ? "pending"
    : signal === "pathogenic"
    ? "pp3"
    : signal === "benign"
    ? "bp4"
    : signal === "vus"
    ? "between"
    : "no-score";
  const ruleCode = ruleState === "pp3" ? "PP3" : ruleState === "bp4" ? "BP4" : null;

  // ── dbscSNV ──
  const ada = finite(dbsc?.ada_score);
  const rf = finite(dbsc?.rf_score);
  const dbMax = ada === null && rf === null ? null : Math.max(ada ?? -Infinity, rf ?? -Infinity);
  const altering = dbMax === null ? null : dbMax >= THRESHOLDS.dbscsnv.spliceAltering;

  // ── AlphaGenome splicing attribution — the AlphaGenome tab's own reading, not a second one ──
  const ag = buildAlphaGenomeEvidence({ result, configured: alphagenomeConfigured });
  const agShare = ag.splicing?.share ?? null;
  const agShap = ag.splicing?.shap ?? null;
  const agAvailability: EvidenceAvailability =
    ag.availability.state !== "available"
      ? ag.availability
      : agShare !== null
      ? ag.availability
      : {
          ...resolveEvidenceAvailability({ value: null, status: "live" }),
          reason: ag.groups === null
            ? "AlphaGenome scored the variant but returned no feature attributions."
            : "AlphaGenome attributed nothing to its splicing feature for this variant.",
        };
  const agMessage: string | null = cd?.alphagenome?.message ?? null;
  const referenceMismatch = agMessage && /reference base/i.test(agMessage) ? agMessage : null;

  // ── Readings ──
  const readings: SpliceReading[] = [];
  const S = THRESHOLDS.spliceai;

  readings.push({
    key: "spliceai",
    group: "rule",
    name: "SpliceAI max Δ",
    description: "Largest of the four delta scores: how much the model's splice-site probabilities change.",
    score: maxDs,
    scoreText: maxDs !== null ? formatDelta(maxDs) : "—",
    sub: maxChannel ? SPLICE_CHANNEL_NAME[maxChannel].toLowerCase() : null,
    scale: maxDs !== null ? spliceAiScale(maxDs, true) : null,
    scaleSource: SPLICEAI_SCALE_SOURCE,
    call:
      maxDs === null
        ? null
        : ruleState === "pp3"
        ? { label: "PP3 · splicing", tone: "danger", isCode: true, unapplied: true }
        : ruleState === "bp4"
        ? { label: "BP4 · splicing", tone: "good", isCode: true, unapplied: true }
        : { label: "Between bands", tone: "neutral", isCode: false },
    note: maxDs !== null ? describeSpliceAiSource(prov) : null,
    availability: saiAvailability,
    knowledgeKey: "spliceai",
    link: null,
  });

  if (maxDs !== null) {
    for (const c of channels) {
      readings.push({
        key: `spliceai-${c.key}`,
        group: "channels",
        name: SPLICE_CHANNEL_NAME[c.key],
        // The shared caveat lives once on SPLICE_CHANNEL_CAPTION; nothing here is unique to a
        // channel beyond its name, score and position, so no per-channel description is set.
        description: "",
        score: c.ds,
        scoreText: c.ds !== null ? formatDelta(c.ds) : "—",
        // A position is only a location when there is a signal to locate.
        sub: c.dp !== null && ((c.ds ?? 0) >= SPLICE_MAP_FLOOR || (showSmallSignals && (c.ds ?? 0) > 0)) ? `at ${fmtBp(orient(c.dp) as number)} from the variant${strandKnown ? "" : " (genomic)"}` : null,
        scale: c.ds !== null ? spliceAiScale(c.ds, false) : null,
        scaleSource: null,
        call: c.ds === null ? null : c.key === maxChannel ? { label: "Maximum", tone: "accent", isCode: false } : null,
        note: null,
        availability: resolveEvidenceAvailability({ value: c.ds, status: "live" }),
        knowledgeKey: null,
        link: null,
      });
    }
  }

  const dbscAbsence = (value: number | null): EvidenceAvailability => {
    const a = resolveEvidenceAvailability({ value, status: dbsc ? "live" : null });
    if (a.hasValue) return a;
    if (inDbscsnvWindow === false) {
      return {
        ...a,
        state: "not-covered",
        label: ENGINE_STATE_LABELS["not-covered"],
        tone: "muted",
        reason: `dbscSNV scores only −${W.donor.exonic} to +${W.donor.intronic} at a donor and −${W.acceptor.intronic} to +${W.acceptor.exonic} at an acceptor; this variant is at ${position! > 0 ? "+" : "−"}${Math.abs(position!)}.`,
      };
    }
    a.reason =
      inDbscsnvWindow === true
        ? "Inside dbscSNV's window, but no score was returned."
        : "The junction position is not resolved, so whether dbscSNV covers this variant is unknown.";
    return a;
  };
  const dbscCall = (v: number | null): SpliceReading["call"] =>
    v === null ? null : v >= THRESHOLDS.dbscsnv.spliceAltering ? { label: "Altering (authors)", tone: "warning", isCode: false } : { label: "Below cut-point", tone: "neutral", isCode: false };
  const dbscScale = (): SpliceScale => ({ min: 0, max: 1, bands: [], ticks: [{ value: THRESHOLDS.dbscsnv.spliceAltering, label: `Authors' cut-point ${THRESHOLDS.dbscsnv.spliceAltering}` }] });

  readings.push({
    key: "dbscsnv-ada",
    group: "context",
    name: "dbscSNV AdaBoost",
    description: "Consensus-region ensemble (Jian 2014). Defined only near the splice sites.",
    score: ada,
    scoreText: ada !== null ? fmt3(ada) : "—",
    sub: null,
    scale: ada !== null ? dbscScale() : null,
    scaleSource: "Authors' cut-point 0.6 · not ClinGen-calibrated",
    call: dbscCall(ada),
    note: null,
    availability: dbscAbsence(ada),
    knowledgeKey: "dbscsnv",
    link: null,
  });
  readings.push({
    key: "dbscsnv-rf",
    group: "context",
    name: "dbscSNV random forest",
    description: "Second model of the same ensemble, same window.",
    score: rf,
    scoreText: rf !== null ? fmt3(rf) : "—",
    sub: null,
    scale: rf !== null ? dbscScale() : null,
    scaleSource: "Authors' cut-point 0.6 · not ClinGen-calibrated",
    call: dbscCall(rf),
    note: null,
    availability: dbscAbsence(rf),
    knowledgeKey: null,
    link: null,
  });
  readings.push({
    key: "alphagenome-splicing",
    group: "context",
    name: "AlphaGenome splicing share",
    description: "Share of the AVI rank's attribution carried by the splicing feature. An attribution, not a splicing prediction.",
    score: agShare,
    scoreText: agShare !== null ? fmtShare(agShare) : "—",
    sub: agShap !== null ? `SHAP ${fmtSigned(agShap)}` : null,
    scale: null,
    scaleSource: null,
    call: agShare !== null ? { label: "Informational", tone: "muted", isCode: false } : null,
    note: null,
    availability: agAvailability,
    knowledgeKey: "alphagenome",
    link: { tab: "alphagenome", label: "AlphaGenome tracks" },
  });

  // ── Splice map ──
  const map = buildSpliceMap({ geometry, channels, strand: geometry.strand, genomicPos: finite(sp?.genomicPos), nearby: sp?.nearbyExons ?? null, showSmallSignals, maxDs });
  if (map) {
    // A channel whose delta position lands on the annotated site of its type says so in the table.
    for (const pr of map.predictions) {
      if (!pr.atSite) continue;
      const row = readings.find(x => x.key === `spliceai-${pr.key}`);
      if (row) row.note = `Lands on the annotated ${pr.atSite}`;
    }
  }

  // ── Engine record ──
  const predictors = buildPredictorEvidence({ result, alphagenomeConfigured });
  const engine: SpliceEngineRecord = {
    known: predictors.engine.known,
    code: predictors.engine.code,
    voteCode: predictors.vote.code,
  };
  const recordedOrVote = engine.known ? engine.code : engine.voteCode;
  const relation: SpliceRelation =
    ruleCode === "PP3" && recordedOrVote?.startsWith("BP4")
      ? "conflict"
      : ruleCode === "PP3" && recordedOrVote?.startsWith("PP3")
      ? "same-pp3"
      : ruleState === "no-score" && recordedOrVote?.startsWith("BP4")
      ? "bp4-unchecked"
      : "none";

  return {
    rule: { state: ruleState, code: ruleCode, maxDs, maxChannel, maxShift },
    spliceai: {
      availability: saiAvailability,
      provenance: prov,
      sourceText: describeSpliceAiSource(prov),
      windowText: prov?.distanceBp != null ? `±${prov.distanceBp} bp` : "Not stated",
      maskText: prov?.masked === 1 ? "Masked" : prov?.masked === 0 ? "Raw" : "Not stated",
    },
    dbscsnv: { ada, rf, max: dbMax, altering },
    alphagenome: { share: agShare, shap: agShap, availability: agAvailability },
    referenceMismatch,
    geometry,
    map,
    readings,
    engine,
    relation,
    pending: saiPending,
  };
}

/**
 * Readings grouped for the table, in display order. Empty groups are dropped.
 *
 * dbscSNV's two models share one window, so when neither scored and for the same reason they are
 * one row: two rows repeating "dbscSNV scores only −3 to +8…" word for word was the table's
 * largest block of dead space. A scored pair stays two rows, because the models can disagree.
 */
export function groupSpliceReadings(readings: SpliceReading[]): Array<{ group: SpliceGroup; rows: SpliceReading[] }> {
  const ada = readings.find(r => r.key === "dbscsnv-ada");
  const rf = readings.find(r => r.key === "dbscsnv-rf");
  let list = readings;
  if (ada && rf && ada.score === null && rf.score === null && ada.availability.reason === rf.availability.reason) {
    const merged: SpliceReading = {
      ...ada,
      key: "dbscsnv",
      name: "dbscSNV",
      description: "AdaBoost and random-forest ensemble (Jian 2014). Defined only near the splice sites.",
    };
    list = readings.flatMap(r => (r === ada ? [merged] : r === rf ? [] : [r]));
  }
  const order: SpliceGroup[] = ["rule", "channels", "context"];
  return order.map(group => ({ group, rows: list.filter(x => x.group === group) })).filter(g => g.rows.length > 0);
}

/**
 * The finding in words. Never says more than the SpliceAI score and the rule do.
 */
export function splicingFinding(ev: SplicingEvidence): { headline: string; predicate: string } {
  const S = THRESHOLDS.spliceai;
  const { rule } = ev;
  const where = rule.maxChannel
    ? ` (${SPLICE_CHANNEL_NAME[rule.maxChannel].toLowerCase()}${rule.maxShift !== null && (rule.maxDs ?? 0) >= SPLICE_MAP_FLOOR ? ` at ${fmtBp(rule.maxShift)}` : ""})`
    : "";
  switch (rule.state) {
    case "pending":
      return { headline: "SpliceAI is still running", predicate: "the splicing rule is applied once its score arrives" };
    case "no-score":
      return {
        headline: "No SpliceAI score reached this variant",
        predicate: "so the splicing rule cannot be applied. dbscSNV and junction distance are context, not a substitute",
      };
    case "pp3":
      return {
        headline: `SpliceAI predicts a splicing change${where}`,
        predicate: `${deltaPhrase(rule.maxDs!)} is at or above ${S.splicingPp3.toFixed(1)}, which supports PP3 for splicing impact`,
      };
    case "bp4":
      return {
        headline: "SpliceAI's score is below the splicing BP4 threshold",
        predicate: `${deltaPhrase(rule.maxDs!)}${where} is at or below ${S.splicingBp4Below.toFixed(1)}, which supports BP4 for splicing impact`,
      };
    case "between":
      return {
        headline: "SpliceAI's score falls between the bands",
        predicate: `${deltaPhrase(rule.maxDs!)}${where} is above ${S.splicingBp4Below.toFixed(1)} and below ${S.splicingPp3.toFixed(1)}, so the splicing rule supports neither PP3 nor BP4`,
      };
  }
}

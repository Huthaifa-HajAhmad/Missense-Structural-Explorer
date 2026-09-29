/**
 * splicingEvidence.ts — one model of the splicing evidence, for the RNA Splicing tab and its rail.
 *
 * ONE QUESTION: is this variant predicted to change pre-mRNA splicing, and what would the ClinGen
 * splicing rule make of that?
 *
 * The rule is the ClinGen SVI Splicing Subgroup's (Walker et al. 2023): SpliceAI's max delta score
 * ≥ 0.2 supports PP3, below 0.1 supports BP4, between supports neither. The ACMG engine does NOT
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
  channels: "Which change the maximum came from, and where it lands",
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
  call: { label: string; tone: SpliceTone; isCode: boolean } | null;
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
  readings: SpliceReading[];
  engine: SpliceEngineRecord;
  relation: SpliceRelation;
  pending: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fmt3 = (v: number) => v.toFixed(3);
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
  const code = score === null ? null : score >= S.splicingPp3 ? "PP3" : score < S.splicingBp4Below ? "BP4" : null;
  return {
    min: 0,
    max: 1,
    bands: withBands
      ? [
          { from: 0, to: S.splicingBp4Below, side: "benign", label: `BP4 (splicing): < ${S.splicingBp4Below.toFixed(1)}`, active: code === "BP4" },
          { from: S.splicingPp3, to: 1, side: "path", label: `PP3 (splicing): ≥ ${S.splicingPp3.toFixed(1)}`, active: code === "PP3" },
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
}

export function buildSplicingEvidence({ result, isLoading = false, alphagenomeConfigured }: SplicingEvidenceInput): SplicingEvidence {
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
  const junction: SpliceGeometry["junction"] = isDonor ? "donor" : isAcceptor ? "acceptor" : rawJunction === "terminal" ? "terminal" : "unresolved";
  // Legacy payloads carry no regionType; placement then follows the old exonic default, but no
  // position is claimed for them.
  const oriented = (junction === "donor" || junction === "acceptor") && distance !== null && regionType !== null;
  let position: number | null = null;
  if (oriented) {
    const d = distance as number;
    if (junction === "donor") position = regionType === "exonic" ? -(d + 1) : d;
    else position = regionType === "exonic" ? d + 1 : -d;
    if (position === 0) position = null; // an intronic distance of 0 is not a real placement
  }
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
  const maxShift = maxChannel ? channels.find(c => c.key === maxChannel)!.dp : null;

  const saiPending = !sai && isLoading;
  const inGene = regionType === "exonic" || regionType === "intronic";
  const saiAvailability = resolveEvidenceAvailability({ value: maxDs, pending: saiPending });
  if (!saiAvailability.hasValue && !saiPending) {
    saiAvailability.reason = sai
      ? "SpliceAI answered without a delta score for any of its four channels."
      : inGene
      ? "Neither the live Broad lookup nor the precomputed tables returned a score. SpliceAI scores every single-nucleotide change in an annotated gene, so this points to a failed or rejected request, not to nothing to score."
      : "Neither the live Broad lookup nor the precomputed tables returned a score for this coordinate.";
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
    scoreText: maxDs !== null ? maxDs.toFixed(2) : "—",
    sub: maxChannel ? SPLICE_CHANNEL_NAME[maxChannel].toLowerCase() : null,
    scale: maxDs !== null ? spliceAiScale(maxDs, true) : null,
    scaleSource: SPLICEAI_SCALE_SOURCE,
    call:
      maxDs === null
        ? null
        : ruleState === "pp3"
        ? { label: "PP3 (splicing)", tone: "danger", isCode: true }
        : ruleState === "bp4"
        ? { label: "BP4 (splicing)", tone: "good", isCode: true }
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
        description:
          c.key === "ds_ag" ? "A new acceptor is created." : c.key === "ds_al" ? "An existing acceptor is weakened or lost." : c.key === "ds_dg" ? "A new donor is created." : "An existing donor is weakened or lost.",
        score: c.ds,
        scoreText: c.ds !== null ? c.ds.toFixed(2) : "—",
        sub: c.dp !== null ? `at ${fmtBp(c.dp)}` : null,
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
    readings,
    engine,
    relation,
    pending: saiPending,
  };
}

/** Readings grouped for the table, in display order. Empty groups are dropped. */
export function groupSpliceReadings(readings: SpliceReading[]): Array<{ group: SpliceGroup; rows: SpliceReading[] }> {
  const order: SpliceGroup[] = ["rule", "channels", "context"];
  return order.map(group => ({ group, rows: readings.filter(x => x.group === group) })).filter(g => g.rows.length > 0);
}

/**
 * The finding in words. Never says more than the SpliceAI score and the rule do.
 */
export function splicingFinding(ev: SplicingEvidence): { headline: string; predicate: string } {
  const S = THRESHOLDS.spliceai;
  const { rule } = ev;
  const where = rule.maxChannel
    ? ` (${SPLICE_CHANNEL_NAME[rule.maxChannel].toLowerCase()}${rule.maxShift !== null ? ` at ${fmtBp(rule.maxShift)}` : ""})`
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
        predicate: `a max Δ of ${rule.maxDs!.toFixed(2)} is at or above ${S.splicingPp3.toFixed(1)}, which supports PP3 for splicing impact`,
      };
    case "bp4":
      return {
        headline: "SpliceAI predicts no splicing change",
        predicate: `a max Δ of ${rule.maxDs!.toFixed(2)}${where} is below ${S.splicingBp4Below.toFixed(1)}, which supports BP4 for splicing impact`,
      };
    case "between":
      return {
        headline: "SpliceAI's score falls between the bands",
        predicate: `a max Δ of ${rule.maxDs!.toFixed(2)}${where} is at or above ${S.splicingBp4Below.toFixed(1)} and below ${S.splicingPp3.toFixed(1)}, so the splicing rule supports neither PP3 nor BP4`,
      };
  }
}

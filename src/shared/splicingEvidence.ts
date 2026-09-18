/**
 * Splicing Evidence Derivation — single source of truth.
 *
 * The RNA Splicing tab (main column) and the Evidence Inspector (sidebar) render
 * the same evidence in two different places. Deriving labels, severity classes
 * and ACMG rule outcomes separately in each is how the two panes drift apart, so
 * every display decision that must agree lives here.
 *
 * Pure functions only: no React, no fetching.
 */
import type { AnalysisResult } from "./contracts.ts";
import { THRESHOLDS, evaluateSplicePredictor, type PredictorSignal } from "./thresholds/index.ts";

/** SpliceAI ΔScore visual bands. */
export type SpliceAiSeverity = "high" | "moderate" | "low" | "unannotated" | "loading";
/** Splice-junction proximity bands, keyed off the canonical consensus flank. */
export type ProximitySeverity = "critical" | "consensus" | "outside" | "unmapped";
/** dbscSNV ensemble bands. */
export type DbscSeverity = "altering" | "tolerated" | "unmapped";

export interface SpliceRuleOutcome {
  /** ACMG code the rule maps to. */
  code: string;
  /** Short criterion label, e.g. "SpliceAI >= 0.20". */
  label: string;
  /** Human-readable evidence statement. */
  description: string;
  /**
   * true  → criterion satisfied by this variant
   * false → criterion explicitly not satisfied
   * null  → predictor produced no score here, so the criterion cannot be applied
   */
  met: boolean | null;
}

export interface SplicingEvidenceModel {
  // ── Raw inputs, surfaced so callers never re-read conservationData ──
  distance: number | null;
  isNearSpliceSite: boolean;
  maxDs: number | null;
  adaScore: number | null;
  rfScore: number | null;
  maxDbsc: number | null;
  hasDbscsnv: boolean;
  isDbscAltering: boolean;
  /** SpliceAI per-channel delta scores (null when unannotated). */
  spliceai: {
    ds_ag: number | null; ds_al: number | null; ds_dg: number | null; ds_dl: number | null;
    /**
     * Where splicing changes relative to the variant (negative = upstream), per channel.
     *
     * A large |dp| alongside a small delta score is the signature of a variant far from any
     * junction — information the delta score alone cannot convey. The client has produced this
     * since the Broad integration; it was discarded here, so the panes could not show it.
     */
    dp?: { ds_ag: number | null; ds_al: number | null; ds_dg: number | null; ds_dl: number | null };
  } | null;
  /**
   * Where the SpliceAI number came from.
   *
   * Absent means "not stated", which is a real and common state: the precomputed dbNSFP paths
   * stamp no provenance, so a reader must not assume live simply because a score exists. This
   * is the difference between a live model run (500 bp window, masked, current GENCODE) and a
   * frozen table (50 bp, GENCODE v24) — they legitimately disagree on borderline variants, so
   * the panes must be able to say which one answered.
   */
  spliceaiProvenance: {
    source: "broad-lookup" | "precomputed-dbnsfp" | "genos";
    distanceBp?: number | null;
    masked?: number | null;
    computedLive?: boolean;
    annotationSet?: string | null;
  } | null;
  isSpliceAiLoading: boolean;

  // ── AlphaGenome: splicing attribution is NOT the same as the aggregate AVI ──
  /**
   * Splicing-specific SHAP feature attribution (fi_MERGED_SPLICING), 0..1.
   * Null whenever AlphaGenome did not attribute this variant to splicing —
   * which is a real result, not missing data to be papered over.
   */
  splicingAttribution: number | null;
  isSplicingDominant: boolean;
  /**
   * True only when AlphaGenome actually answered. The bridge returns a full object
   * with `status: "unavailable"` for the unconfigured/standby case and for provider
   * errors, so keying this off object presence made "Standby / Unconfigured"
   * unreachable and let the UI assert the model had looked when it had not.
   */
  hasAlphaGenome: boolean;
  /** Raw AlphaGenome availability, surfaced so callers can distinguish standby. */
  alphagenomeStatus: "live" | "unavailable" | "pending" | null;

  // ── Derived bands & labels shared by both panes ──
  dsSeverity: SpliceAiSeverity;
  dsLabel: string;
  dsBadgeClass: string;
  proximitySeverity: ProximitySeverity;
  proximityLabel: string;
  proximityBadgeClass: string;
  dbscSeverity: DbscSeverity;
  dbscLabel: string;
  dbscBadgeClass: string;

  // ── Genomic architecture (shared by the main schematic and the inspector) ──
  exonNumber: number | null;
  totalExons: number | null;
  exonLength: number | null;
  exonStart: number | null;
  exonEnd: number | null;
  intronNumber: number | null;
  strand: "+" | "-" | null;
  transcriptId: string | null;
  regionType: "exonic" | "intronic" | null;
  isExonicVariant: boolean;
  displayExonLabel: string;
  displayIntronLabel: string;
  strandLabel: string;
  isDonor: boolean;
  isAcceptor: boolean;
  junctionType: string;

  // ── Verdict ──
  verdict: PredictorSignal;
  verdictLabel: string;
  verdictBadgeClass: string;
  /** True when no predictor covered this position, so ACMG rules cannot be applied. */
  isPredictorCoverageAbsent: boolean;
  /**
   * True when the variant sits within the critical junction band of a REAL
   * donor/acceptor boundary. Terminal boundaries and single-exon transcripts are
   * excluded, so this must be used instead of a bare `distance <= 5`.
   */
  isCriticalJunctionProximity: boolean;
  /** True when the nearest boundary is a genuine exon/intron junction. */
  isCanonicalJunction: boolean;
  /**
   * True when the SPLICING arm carries positive evidence of disruption: a SpliceAI
   * delta at/above the PP3 threshold, an altering dbscSNV ensemble, or proximity to
   * a canonical junction.
   *
   * Being far from a junction is NOT evidence of preservation, and a missing
   * predictor score is NOT evidence either — that case is `isPredictorCoverageAbsent`.
   * This predicate answers only "is there a positive splicing signal?".
   */
  isSplicingDisrupted: boolean;
  pathogenicRules: SpliceRuleOutcome[];
  benignRules: SpliceRuleOutcome[];
}

const MUTED_BADGE = "cs-badge cs-badge-muted";
const GOOD_BADGE = "cs-badge cs-badge-good";
const WARN_BADGE = "cs-badge cs-badge-warn";
const PATH_BADGE = "cs-badge cs-badge-path";
/**
 * In-flight state. Carries the `cs-badge` base class so the chip keeps its padding,
 * radius and weight when it resolves — previously it changed shape mid-assessment.
 * Uses the house light/dark indigo pairing; a bare `text-indigo-400` fails contrast
 * on the light surface.
 */
export const LOADING_BADGE =
  "cs-badge text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 animate-pulse";

/** minDistance at which the variant is treated as sitting on the junction itself. */
export const PROXIMITY_CRITICAL_BP = THRESHOLDS.spliceai.proximityCriticalBp;
/** Canonical consensus splice flank (±12 bp). */
export const PROXIMITY_CONSENSUS_BP = THRESHOLDS.spliceai.consensusFlankDistance;

/**
 * Accepted featureAttributions keys for the merged-splicing feature, in lookup order.
 * [0] raw key (REST bridge), [1] display name (gRPC client's AVI_FEATURE_DISPLAY_MAP).
 */
export const ALPHAGENOME_SPLICING_FEATURE_KEYS = ["fi_MERGED_SPLICING", "Splicing"] as const;

/** Attribution share at/above which splicing is treated as the dominant modality. */
export const ALPHAGENOME_SPLICING_DOMINANCE = 0.25;

export function deriveSplicingEvidence(
  result: AnalysisResult | null | undefined,
  options: { isLoading?: boolean } = {}
): SplicingEvidenceModel | null {
  if (!result) return null;

  const { isLoading = false } = options;

  const conservation = result.conservationData;
  const spliceai = conservation?.spliceai ?? null;
  const dbscsnv = conservation?.dbscsnv ?? null;
  const spliceProximity = conservation?.spliceProximity ?? null;
  const alphagenome = conservation?.alphagenome ?? null;

  const maxDs = spliceai?.max_ds ?? null;
  const distance = spliceProximity?.distance ?? null;
  const isNearSpliceSite = spliceProximity?.isNearSpliceSite ?? false;
  /**
   * A critical-junction hit requires proximity to a REAL junction. `distance <= 5`
   * alone also matches a transcript terminus (or a single-exon transcript), which the
   * resolver deliberately excludes from `isNearSpliceSite` — so the distance half of
   * the predicate must be gated on the boundary actually being donor/acceptor.
   *
   * When the payload predates `isCanonicalJunction` we fall back to `isNearSpliceSite`,
   * which is the resolver's own guarded answer.
   */
  const isCanonicalJunction = spliceProximity?.isCanonicalJunction ?? isNearSpliceSite;
  const isCriticalJunctionProximity =
    isNearSpliceSite || (isCanonicalJunction && distance !== null && distance <= PROXIMITY_CRITICAL_BP);

  const adaScore = dbscsnv?.ada_score ?? null;
  const rfScore = dbscsnv?.rf_score ?? null;
  const hasDbscsnv = adaScore !== null || rfScore !== null;
  const maxDbsc = hasDbscsnv ? Math.max(adaScore ?? 0, rfScore ?? 0) : null;
  const isDbscAltering = maxDbsc !== null && maxDbsc >= THRESHOLDS.dbscsnv.spliceAltering;

  // SpliceAI is "loading" only when we have no object at all and work is in flight.
  const isSpliceAiLoading = !spliceai && isLoading;

  // ── AlphaGenome splicing attribution (kept strictly separate from AVI Phred) ──
  // Two provider paths name this feature differently: the REST bridge emits the raw
  // key ("fi_MERGED_SPLICING"), while the gRPC client writes the DISPLAY name via
  // AVI_FEATURE_DISPLAY_MAP ("MERGED_SPLICING" -> "Splicing"). Reading only the raw
  // key silently discarded a real attribution on the gRPC path, so both are checked.
  const splicingAttribution: number | null =
    alphagenome?.featureAttributions?.[ALPHAGENOME_SPLICING_FEATURE_KEYS[0]] ??
    alphagenome?.featureAttributions?.[ALPHAGENOME_SPLICING_FEATURE_KEYS[1]] ??
    (alphagenome?.topModality?.toLowerCase().includes("splicing")
      ? alphagenome?.topFeatureImportance ?? null
      : null);

  /**
   * "Splicing is the dominant modality" — requires a MEANINGFUL attribution, not merely
   * that splicing topped a near-zero feature vector. The gRPC client picks topModality by
   * max |value| with MERGED_SPLICING at index 0, so an all-near-zero vector otherwise
   * yields topModality "Splicing" and a "Primary Driver" badge at 0.0%.
   * SHAP attributions are signed, so magnitude is compared.
   */
  const isSplicingDominant =
    splicingAttribution !== null && Math.abs(splicingAttribution) >= ALPHAGENOME_SPLICING_DOMINANCE;

  // ── SpliceAI severity band ──
  let dsSeverity: SpliceAiSeverity = "unannotated";
  let dsLabel = "Unannotated";
  let dsBadgeClass = MUTED_BADGE;
  if (isSpliceAiLoading) {
    dsSeverity = "loading";
    dsLabel = "Evaluating SpliceAI...";
    dsBadgeClass = LOADING_BADGE;
  } else if (maxDs !== null) {
    if (maxDs >= THRESHOLDS.spliceai.pathogenicHigh) {
      dsSeverity = "high";
      dsLabel = "High Disruption Risk";
      dsBadgeClass = PATH_BADGE;
    } else if (maxDs >= THRESHOLDS.spliceai.pathogenicModerate) {
      dsSeverity = "moderate";
      dsLabel = "Moderate Probability";
      dsBadgeClass = WARN_BADGE;
    } else {
      dsSeverity = "low";
      dsLabel = "Low Disruption Risk";
      dsBadgeClass = GOOD_BADGE;
    }
  }

  // ── Proximity band ──
  // NOTE: distance is measured to the nearest exon/intron boundary. Being far
  // from the junction is NOT evidence that the splice motif is intact — it is
  // why SpliceAI/dbscSNV returned no score at all. Labels say what was
  // measured (distance), never what was not tested (motif integrity).
  let proximitySeverity: ProximitySeverity = "unmapped";
  let proximityLabel = "Unmapped";
  let proximityBadgeClass = MUTED_BADGE;
  if (distance !== null) {
    if (isCriticalJunctionProximity) {
      proximitySeverity = "critical";
      proximityLabel = `Critical Junction (<=${PROXIMITY_CRITICAL_BP} bp)`;
      proximityBadgeClass = PATH_BADGE;
    } else if (isCanonicalJunction && distance <= PROXIMITY_CONSENSUS_BP) {
      proximitySeverity = "consensus";
      proximityLabel = `Consensus Flank (<=${PROXIMITY_CONSENSUS_BP} bp)`;
      proximityBadgeClass = WARN_BADGE;
    } else {
      proximitySeverity = "outside";
      proximityLabel = "Outside Consensus Flank";
      proximityBadgeClass = MUTED_BADGE;
    }
  }

  // ── dbscSNV band ──
  let dbscSeverity: DbscSeverity = "unmapped";
  let dbscLabel = "Outside Consensus Zone";
  let dbscBadgeClass = MUTED_BADGE;
  if (hasDbscsnv) {
    if (isDbscAltering) {
      dbscSeverity = "altering";
      dbscLabel = "Splice Altering Candidate";
      dbscBadgeClass = PATH_BADGE;
    } else {
      dbscSeverity = "tolerated";
      dbscLabel = "Tolerated / Unaltered";
      dbscBadgeClass = GOOD_BADGE;
    }
  }

  // ── Genomic architecture labels (schematic + inspector) ──
  const exonNumber = spliceProximity?.exonNumber ?? null;
  const totalExons = spliceProximity?.totalExons ?? null;
  const exonLength = spliceProximity?.exonLength ?? null;
  const exonStart = spliceProximity?.exonStart ?? null;
  const exonEnd = spliceProximity?.exonEnd ?? null;
  const intronNumber = spliceProximity?.intronNumber ?? spliceProximity?.adjacentIntronNumber ?? null;
  const strand = spliceProximity?.strand ?? null;
  const transcriptId = spliceProximity?.transcriptId ?? result.transcriptId ?? null;
  /**
   * Region classification as reported by the resolver. `null` means the position could
   * not be classified — either the payload predates the field or the variant falls
   * outside the transcript span entirely. It is NOT defaulted to "exonic": doing so
   * made an off-transcript variant report "Region Type: Exonic" beside "Exon: unmapped".
   */
  const regionType: "exonic" | "intronic" | null = spliceProximity?.regionType ?? null;
  /**
   * Whether the variant sits inside an exon FOR SCHEMATIC PLACEMENT. Off-transcript
   * positions fall back to the exonic layout so the diagram still renders, but this
   * must not be read as a classification — use `regionType` for that.
   */
  const isExonicVariant = regionType === "exonic" || (regionType === null && distance !== null);

  const { isDonor, isAcceptor, junctionType } = resolveJunctionOrientation(result, distance);

  const displayExonLabel =
    exonNumber !== null
      ? `Exon ${exonNumber}${totalExons ? ` of ${totalExons}` : ""}`
      : "Exon unmapped";
  const displayIntronLabel =
    totalExons === 1
      ? "Single-exon (no introns)"
      : intronNumber !== null
      ? `Intron ${intronNumber}`
      : "Intron unmapped";
  const strandLabel = strand ? (strand === "+" ? "Forward (+)" : "Reverse (-)") : "Strand unmapped";

  // ── ACMG verdict ──
  const verdict = evaluateSplicePredictor(spliceProximity, spliceai, dbscsnv);
  // No SpliceAI score AND no dbscSNV score => predictors did not cover this
  // position. "Unavailable" is the claim; "benign" would not be supportable.
  const hasSpliceAiScore = maxDs !== null;
  const isPredictorCoverageAbsent = !hasSpliceAiScore && !hasDbscsnv;

  // Positive splicing signal, independent of coverage. Uses the SAME threshold the
  // PP3 rule below applies, so the two can never disagree.
  const isSplicingDisrupted =
    (maxDs !== null && maxDs >= THRESHOLDS.spliceai.pathogenicSupporting) ||
    isDbscAltering ||
    isCriticalJunctionProximity;

  let verdictLabel = "VUS / Indeterminate";
  let verdictBadgeClass = WARN_BADGE;
  if (isSpliceAiLoading) {
    verdictLabel = "Evaluating SpliceAI...";
    verdictBadgeClass = LOADING_BADGE;
  } else if (verdict === "pathogenic") {
    verdictLabel = "Pathogenic Supporting (PP3)";
    verdictBadgeClass = PATH_BADGE;
  } else if (verdict === "benign") {
    verdictLabel = "Benign Supporting (BP4)";
    verdictBadgeClass = GOOD_BADGE;
  } else if (verdict === "unavailable") {
    verdictLabel = "Unavailable / Unmapped";
    verdictBadgeClass = MUTED_BADGE;
  }

  // ── ACMG rule outcomes ──
  // Each rule reports met: true/false/null. A null is a predictor that produced
  // no score here, and is rendered as "not applicable", never as "not met" —
  // the two are clinically different.
  const pathogenicRules: SpliceRuleOutcome[] = [
    {
      code: "PP3",
      label: `SpliceAI >= ${THRESHOLDS.spliceai.pathogenicModerate}`,
      description: "Moderate to high probability of causing cryptic donor/acceptor gain or loss.",
      met: hasSpliceAiScore ? maxDs! >= THRESHOLDS.spliceai.pathogenicSupporting : null
    },
    {
      code: "PP3",
      label: `dbscSNV >= ${THRESHOLDS.dbscsnv.spliceAltering}`,
      description: "Ensemble agreement on consensus motif alteration.",
      met: hasDbscsnv ? isDbscAltering : null
    },
    {
      code: "PP3",
      label: `Proximity <= ${PROXIMITY_CRITICAL_BP} bp`,
      /**
       * Gated on a real donor/acceptor boundary: a variant 2 bp from the first exon's
       * start is near a transcript terminus, not a splice junction. The wording no
       * longer claims the variant "sits on the invariant AG/GT dinucleotide" (true only
       * at offset 0-1) and no longer cites PVS1, which is a different code.
       */
      description:
        "Variant lies within the critical junction band flanking a canonical donor/acceptor boundary.",
      met: distance !== null ? isCriticalJunctionProximity : null
    }
  ];

  // Distance alone is NOT a BP4 rule: the evaluator requires benign predictor
  // evidence, so proximity is reported as context rather than as a criterion.
  const benignRules: SpliceRuleOutcome[] = [
    {
      code: "BP4",
      label: `SpliceAI <= ${THRESHOLDS.spliceai.benign}`,
      description: "All four residual channels indicate basal splicing stability.",
      met: hasSpliceAiScore ? maxDs! <= THRESHOLDS.spliceai.benign : null
    },
    {
      code: "BP4",
      label: `dbscSNV < ${THRESHOLDS.dbscsnv.spliceAltering}`,
      description: "Ensemble models predict tolerated splicing behaviour.",
      met: hasDbscsnv ? !isDbscAltering : null
    }
  ];

  return {
    distance,
    isNearSpliceSite,
    maxDs,
    adaScore,
    rfScore,
    maxDbsc,
    hasDbscsnv,
    isDbscAltering,
    spliceai: spliceai
      ? {
          ds_ag: spliceai.ds_ag,
          ds_al: spliceai.ds_al,
          ds_dg: spliceai.ds_dg,
          ds_dl: spliceai.ds_dl,
          ...(spliceai.dp ? { dp: spliceai.dp } : {}),
        }
      : null,
    // Surfaced so the panes can state which source produced the number, instead of hardcoding a
    // tool version and a reporting window that are wrong for two of the three possible sources.
    spliceaiProvenance: spliceai?.provenance
      ? {
          source: spliceai.provenance.source,
          distanceBp: spliceai.provenance.distanceBp ?? null,
          masked: spliceai.provenance.masked ?? null,
          computedLive: spliceai.provenance.computedLive,
          annotationSet: spliceai.provenance.annotationSet ?? null,
        }
      : null,
    isSpliceAiLoading,
    splicingAttribution,
    isSplicingDominant,
    hasAlphaGenome: alphagenome?.status === "live",
    alphagenomeStatus: alphagenome?.status ?? null,
    exonNumber,
    totalExons,
    exonLength,
    exonStart,
    exonEnd,
    intronNumber,
    strand,
    transcriptId,
    regionType,
    isExonicVariant,
    displayExonLabel,
    displayIntronLabel,
    strandLabel,
    isDonor,
    isAcceptor,
    junctionType,
    dsSeverity,
    dsLabel,
    dsBadgeClass,
    proximitySeverity,
    proximityLabel,
    proximityBadgeClass,
    dbscSeverity,
    dbscLabel,
    dbscBadgeClass,
    verdict,
    verdictLabel,
    verdictBadgeClass,
    isPredictorCoverageAbsent,
    isSplicingDisrupted,
    isCriticalJunctionProximity,
    isCanonicalJunction,
    pathogenicRules,
    benignRules
  };
}

/**
 * Splice junction orientation, resolved from the resolver's junctionType when
 * present and otherwise inferred from distance availability (legacy behaviour
 * preserved so the schematic keeps rendering for older payloads).
 */
export function resolveJunctionOrientation(
  result: AnalysisResult | null | undefined,
  distance: number | null
): { isDonor: boolean; isAcceptor: boolean; junctionType: string } {
  const raw = result?.conservationData?.spliceProximity?.junctionType ?? null;
  const isAcceptor = raw === "acceptor";
  const isDonor = raw === "donor" || (!isAcceptor && distance !== null);
  const junctionType = isDonor
    ? "5' Splice Donor (GT)"
    : isAcceptor
    ? "3' Splice Acceptor (AG)"
    : "Splice Junction";
  return { isDonor, isAcceptor, junctionType };
}

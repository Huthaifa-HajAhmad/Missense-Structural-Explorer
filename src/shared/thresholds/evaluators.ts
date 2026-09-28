import { STRING_CONFIDENCE_BANDS, THRESHOLDS, type StringConfidenceBandId } from "./constants.ts";
import { calibratedCall, type CalibratedCall } from "./calibration.ts";

export type PredictorSignal = "pathogenic" | "benign" | "vus" | "unavailable";

/**
 * Maps a STRING-db combined association score onto its published confidence band.
 *
 * Returns `null` for a non-finite score and for a score below STRING's lowest
 * band (0.150): STRING assigns no confidence word there, so neither do we.
 * Callers that need a word for that case must say "unclassified" themselves
 * rather than inheriting a band the score does not qualify for.
 */
export function stringConfidenceTier(
  score: number | null | undefined
): StringConfidenceBandId | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  for (const band of STRING_CONFIDENCE_BANDS) {
    if (score >= band.min) return band.id;
  }
  return null;
}

/** The display word for a band, e.g. "Highest"; `null` when there is no band. */
export function stringConfidenceLabel(score: number | null | undefined): string | null {
  const tier = stringConfidenceTier(score);
  return STRING_CONFIDENCE_BANDS.find((band) => band.id === tier)?.label ?? null;
}

/** A calibrated call collapsed to the three-way vote signal. */
function signalFromCall(call: CalibratedCall | null): PredictorSignal {
  if (call === null) return "unavailable";
  if (call.direction === "PP3") return "pathogenic";
  if (call.direction === "BP4") return "benign";
  return "vus";
}

/**
 * AlphaGenome's AVI "Phred" is −10·log10(1 − q), where q is the CDF quantile AlphaGenome reports
 * for the variant (`alphagenome-client.ts`, `cdfToPhred`). It is a RANK among scored variants, not
 * a likelihood of pathogenicity, and no ClinGen calibration of it exists. Its feature vector also
 * contains AlphaMissense and two conservation tracks, so reading it as a separate pathogenic vote
 * counted AlphaMissense twice.
 *
 * It therefore has no pathogenic or benign call here: an available score is informational ("vus"),
 * and the concordance lists AlphaGenome as informational only. The Phred 15 / 8 cut-points it used
 * to be tested against were labelled "ClinGen SVI-calibrated" and had no source.
 */
export function evaluateAlphaGenomeAvi(
  alphagenome?: {
    aviPhred?: number | null;
    acmgStrength?: string | null;
  } | null
): PredictorSignal {
  if (!alphagenome) return "unavailable";
  const phred = alphagenome.aviPhred;
  if (phred === null || phred === undefined || !Number.isFinite(phred) || phred < 0) return "unavailable";
  return "vus";
}

/** REVEL against the ClinGen bands (Pejaver 2022): PP3 ≥ 0.644, BP4 ≤ 0.290. */
export function evaluateRevel(score: number | null | undefined): PredictorSignal {
  return signalFromCall(calibratedCall("revel", score));
}

/** CADD PHRED against the ClinGen bands (Pejaver 2022): PP3 ≥ 25.3, BP4 ≤ 22.7. */
export function evaluateCadd(phred: number | null | undefined): PredictorSignal {
  return signalFromCall(calibratedCall("cadd", phred));
}

/**
 * AlphaMissense against the ClinGen bands (Bergquist 2025): PP3 ≥ 0.792, BP4 ≤ 0.169.
 *
 * The SCORE decides. AlphaMissense's own class labels (likely_pathogenic > 0.564, likely_benign
 * < 0.34 — Cheng et al. 2023) are the authors' classes, not a calibration, and "likely_pathogenic"
 * spans 0.564–0.792, where the calibrated evidence is indeterminate. A class with no score is
 * reported as available but indeterminate rather than promoted to a call it cannot support.
 */
export function evaluateAlphaMissense(
  score: number | null | undefined,
  cls: string | null | undefined
): PredictorSignal {
  const hasCls = cls !== null && cls !== undefined && cls !== "";
  const call = calibratedCall("alphaMissense", score);
  if (call !== null) return signalFromCall(call);
  return hasCls ? "vus" : "unavailable";
}

/** BayesDel (noAF) against the ClinGen bands (Pejaver 2022): PP3 ≥ 0.13, BP4 ≤ −0.18. */
export function evaluateBayesdel(score: number | null | undefined): PredictorSignal {
  return signalFromCall(calibratedCall("bayesdel", score));
}

export function evaluateEsm(llr: number | null | undefined): PredictorSignal {
  // ESM-2, ESMC / VESM and SaProt have no published clinical cut-points on their own scales,
  // so they are informational: an available score is "vus", never a call.
  if (llr === null || llr === undefined || !Number.isFinite(llr)) return "unavailable";
  return "vus";
}

/**
 * ESM1b against the ClinGen bands (Bergquist 2025): PP3 ≤ −10.7, BP4 ≥ −6.3.
 *
 * These replace −7.5 / −5.0. −7.5 is Brandes et al.'s (2023) own operating point; −5.0 had no
 * source. ESM1b is still informational in the concordance.
 */
export function evaluateEsm1b(llr: number | null | undefined): PredictorSignal {
  return signalFromCall(calibratedCall("esm1b", llr));
}

/**
 * GPN-Star has no published clinical cut-point. The −2.5 / 0.0 pair is local and is labelled as
 * such wherever it is drawn; the tool is informational in the concordance.
 */
export function evaluateGpnStar(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unavailable";
  if (score <= THRESHOLDS.gpnStar.pathogenic) return "pathogenic";
  if (score >= THRESHOLDS.gpnStar.benign) return "benign";
  return "vus";
}

/** MetaRNN — the authors' 0.5 cut (Li et al. 2022). Uncalibrated, and its features include gnomAD AF. */
export function evaluateMetaRnn(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unavailable";
  if (score >= THRESHOLDS.metaRnn.pathogenic) return "pathogenic";
  return "benign";
}

/** ClinPred — the authors' 0.5 cut (Alirezaie et al. 2018). Uncalibrated, and its features include gnomAD AF. */
export function evaluateClinPred(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unavailable";
  if (score >= THRESHOLDS.clinPred.pathogenic) return "pathogenic";
  return "benign";
}

/**
 * Eigen and DANN have no published clinical cut-point for missense classification. The 4.0 and
 * 0.96 / 0.50 cut-points they were tested against had no source, so both are informational:
 * an available score is "vus", never a vote.
 */
export function evaluateEigen(phred: number | null | undefined): PredictorSignal {
  if (phred === null || phred === undefined || !Number.isFinite(phred)) return "unavailable";
  return "vus";
}

export function evaluateDann(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unavailable";
  return "vus";
}

/**
 * popEVE against its authors' published thresholds (Orenbuch et al., Nat Genet 2025): a score
 * ≤ −4.617 is at least "moderately deleterious" (99% posterior of the deleterious component of a
 * two-component mixture; ≤ −5.056 is "highly deleterious", 99.99%).
 *
 * popEVE publishes no benign threshold, so no popEVE score is a benign call. The −2.0 "supporting"
 * and −1.0 "benign" cut-points, and a 0–1 "normalised" branch, previously used here had no source
 * — they turned a −3.9 score, which the authors would not call deleterious, into a pathogenic vote.
 */
export function evaluatePopEve(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unavailable";
  if (score <= THRESHOLDS.popEve.pathogenic) return "pathogenic";
  return "vus";
}

export function evaluateSplicePredictor(
  spliceProximity?: { distance: number; isNearSpliceSite: boolean } | null,
  spliceai?: { ds_ag: number | null; ds_al: number | null; ds_dg: number | null; ds_dl: number | null; max_ds: number | null } | null,
  dbscsnv?: { ada_score: number | null; rf_score: number | null } | null
): PredictorSignal {
  const isNear = spliceProximity?.isNearSpliceSite ?? false;
  const maxDs = spliceai?.max_ds ?? null;
  const isSpliceAIPathogenic = maxDs !== null && maxDs >= THRESHOLDS.spliceai.pathogenicSupporting;
  const isDbscsnvPathogenic = (dbscsnv?.ada_score != null && dbscsnv.ada_score >= THRESHOLDS.dbscsnv.spliceAltering) ||
                             (dbscsnv?.rf_score != null && dbscsnv.rf_score >= THRESHOLDS.dbscsnv.spliceAltering);

  if (isNear || isSpliceAIPathogenic || isDbscsnvPathogenic) {
    return "pathogenic";
  }

  if ((spliceProximity === undefined || spliceProximity === null) &&
      (spliceai === undefined || spliceai === null) &&
      (dbscsnv === undefined || dbscsnv === null)) {
    return "unavailable";
  }

  const dist = spliceProximity?.distance ?? Infinity;
  const hasSpliceAI = spliceai?.max_ds != null;
  const isSpliceAIBenign = hasSpliceAI ? (spliceai!.max_ds! <= THRESHOLDS.spliceai.benign) : null;

  const hasDbscsnv = dbscsnv?.ada_score != null || dbscsnv?.rf_score != null;
  const isDbscsnvBenign = hasDbscsnv
    ? ((dbscsnv?.ada_score ?? 0) < THRESHOLDS.dbscsnv.spliceAltering && (dbscsnv?.rf_score ?? 0) < THRESHOLDS.dbscsnv.spliceAltering)
    : null;

  const consensusFlank = THRESHOLDS.spliceai?.consensusFlankDistance ?? 12;
  if (dist > consensusFlank && isSpliceAIBenign !== false && isDbscsnvBenign !== false
      && (isSpliceAIBenign === true || isDbscsnvBenign === true)) {
    return "benign";
  }

  if (isSpliceAIBenign === null && isDbscsnvBenign === null) {
    return "unavailable";
  }

  return "vus";
}

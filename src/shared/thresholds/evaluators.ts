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
 * for the variant (`alphagenome-client.ts`, `cdfToPhred`). It is a RANK among all possible hg38 SNVs, not
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

/**
 * The splicing half of PP3/BP4: SpliceAI's max delta score on the ClinGen SVI Splicing Subgroup
 * bands (Walker et al. 2023) — ≥ 0.2 supports PP3, below 0.1 supports BP4, between is neither.
 *
 * ONE input decides it. The previous rule also returned "pathogenic" for any variant within 5 bp of
 * a junction and for a dbscSNV score ≥ 0.6, required > 12 bp from the junction before anything
 * could be benign, and called BP4 only at ≤ 0.02. None of those has a published basis: Walker 2023
 * names a SpliceAI score, distance alone is not PP3 (a canonical ±1/2 change is a PVS1 question),
 * and dbscSNV's 0.6 is its authors' cut-point, not a ClinGen band.
 *
 * `spliceProximity` and `dbscsnv` stay in the signature for callers written against the old rule;
 * they are deliberately ignored. The ACMG engine does not call this — splicing is not an engine
 * input (owner decision, doc/SPLICING_TAB_REVIEW.md); the Splicing tab reports it as
 * "what the splicing rule would support" beside the engine's own record.
 */
export function evaluateSplicePredictor(
  _spliceProximity?: { distance: number; isNearSpliceSite: boolean } | null,
  spliceai?: { max_ds: number | null; ds_ag?: number | null; ds_al?: number | null; ds_dg?: number | null; ds_dl?: number | null } | null,
  _dbscsnv?: { ada_score: number | null; rf_score: number | null } | null
): PredictorSignal {
  const maxDs = spliceai?.max_ds;
  if (maxDs === null || maxDs === undefined || !Number.isFinite(maxDs)) return "unavailable";
  if (maxDs >= THRESHOLDS.spliceai.splicingPp3) return "pathogenic";
  if (maxDs < THRESHOLDS.spliceai.splicingBp4Below) return "benign";
  return "vus";
}

/**
 * The engine's PP2 gene-constraint rule, one function for the server (`gnomad.ts`) and every
 * surface that describes it: missense Z ≥ 3.09 AND o/e < 0.6 (`THRESHOLDS.pp2Constraint`).
 * `null` when either input is missing — an unknown is not "unconstrained".
 */
export function isPp2Constrained(missenseZ: number | null | undefined, oeMis: number | null | undefined): boolean | null {
  if (missenseZ === null || missenseZ === undefined || !Number.isFinite(missenseZ)) return null;
  if (oeMis === null || oeMis === undefined || !Number.isFinite(oeMis)) return null;
  return missenseZ >= THRESHOLDS.pp2Constraint.missenseZ && oeMis < THRESHOLDS.pp2Constraint.oeMisBelow;
}

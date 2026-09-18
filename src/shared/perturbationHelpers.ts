import { THRESHOLDS } from "./thresholds";
import { classifyLlr, isCalibrated, type ModelCalibration } from "./modelCalibration";

/**
 * Fallback spread threshold, used only when the caller cannot supply model families.
 * Family membership is the primary signal (see `computeMultiModelLlr`); this value is a
 * coarse backstop, not a calibrated boundary. See src/shared/modelCalibration.ts.
 */
const MIXED_SCALE_SPREAD_NATS = 2.0;

export interface LPSResult {
  score: number | null;
  level: "low" | "moderate" | "severe";
  color: string;
  badgeClass: string;
  labelText: string;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Computes the Experimental Local Perturbation Score (LPS) from 0 to 100
 * utilizing dynamically normalized weights over active sub-scores.
 */
export function calculateLps(
  llr: number | null | undefined,
  vdwDelta: number | null | undefined,
  clashDelta: number | null | undefined,
  maxDisplacement: number | null | undefined
): number | null {
  let weightedSum = 0;
  let weightSum = 0;

  if (llr !== null && llr !== undefined && !isNaN(llr)) {
    const llrScore = clamp((-llr - 2) / 8, 0, 1);
    weightedSum += 0.30 * llrScore;
    weightSum += 0.30;
  }

  if (vdwDelta !== null && vdwDelta !== undefined && !isNaN(vdwDelta)) {
    const vdwScore = clamp(vdwDelta / 3, 0, 1);
    weightedSum += 0.25 * vdwScore;
    weightSum += 0.25;
  }

  if (clashDelta !== null && clashDelta !== undefined && !isNaN(clashDelta)) {
    const clashScore = clamp(clashDelta / 5, 0, 1);
    weightedSum += 0.20 * clashScore;
    weightSum += 0.20;
  }

  if (maxDisplacement !== null && maxDisplacement !== undefined && !isNaN(maxDisplacement)) {
    const dispScore = clamp(maxDisplacement / 1.5, 0, 1);
    weightedSum += 0.25 * dispScore;
    weightSum += 0.25;
  }

  if (weightSum === 0) return null;
  return (weightedSum / weightSum) * 100;
}

export function getLpsDetails(score: number | null): LPSResult {
  if (score === null || score === undefined || isNaN(score)) {
    return {
      score: null,
      level: "low",
      color: "var(--cs-text-muted)",
      badgeClass: "bg-slate-500/10 text-slate-500 border-slate-500/20",
      labelText: "Insufficient Data"
    };
  }

  if (score < 35) {
    return {
      score,
      level: "low",
      color: "var(--cs-text-success)",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      labelText: "Low Disruption"
    };
  } else if (score <= 65) {
    return {
      score,
      level: "moderate",
      color: "var(--cs-text-warning)",
      badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      labelText: "Moderate Disruption"
    };
  } else {
    return {
      score,
      level: "severe",
      color: "var(--cs-text-danger)",
      badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      labelText: "Severe Disruption"
    };
  }
}

/**
 * Computes a synthesized sequence LLR across all valid deep language models,
 * filtering out any degenerate uniform distributions.
 *
 * The pooled mean is retained for continuity, but it is only meaningful when the
 * contributing models share a score scale. `mixedScale` reports when they do not, so
 * callers can decline to describe the pool in calibrated language. Values are reported
 * exactly as the models returned them — no rescaling is applied, because no defensible
 * cross-family transform exists without a calibration study.
 */
export function computeMultiModelLlr(
  evaluations: any[],
  /**
   * Model families parallel to the values that survive filtering, when known.
   *
   * Family membership is a property of the model, so it is the defensible signal for
   * "do these scores share a scale". The nats spread is retained as reported context but
   * is not used to decide: it is constant-true for the observed values (every pair spans
   * more than the old 2.0-nat threshold) and it false-negatives when two different
   * families happen to agree on one variant.
   */
  options?: { families?: (string | null | undefined)[] }
): { llr: number | null; count: number; details: string; mixedScale: boolean; spread: number | null; uncalibrated: boolean; mixedScaleBasis: "family" | "spread" } {
  const list = Array.isArray(evaluations) ? evaluations : [];
  const validModels: { name: string; llr: number }[] = [];
  for (const ev of list) {
    if (!ev || typeof ev.llr !== "number" || isNaN(ev.llr)) continue;
    // Guard against degenerate uniform distributions (e.g. llr === 0 with perfectly flat prefs)
    if (Math.abs(ev.llr) < 1e-4 && Array.isArray(ev.preferences) && ev.preferences.length >= 20) {
      const firstProb = ev.preferences[0]?.prob;
      if (typeof firstProb === "number" && !isNaN(firstProb)) {
        const allEqual = ev.preferences.every((p: any) => typeof p?.prob === "number" && Math.abs(p.prob - firstProb) < 1e-4);
        if (allEqual) continue;
      }
    }
    const rawName = (ev.provenance || "").split(" ")[0]?.replace(/[()]/g, "") || "Model";
    validModels.push({ name: rawName, llr: ev.llr });
  }

  if (validModels.length === 0) {
    return { llr: null, count: 0, details: "No valid sequence model data", mixedScale: false, spread: null, uncalibrated: false, mixedScaleBasis: "family" };
  }

  const meanLlr = validModels.reduce((acc, m) => acc + m.llr, 0) / validModels.length;
  const details = validModels.map(m => `${m.name}: ${m.llr.toFixed(1)}`).join(", ");

  const values = validModels.map(m => m.llr);
  const spread = Math.max(...values) - Math.min(...values);

  const families = (options?.families ?? []).filter((f): f is string => typeof f === "string");
  /**
   * A single model cannot be internally inconsistent, so only a genuine mixture is
   * flagged. When family identity is available it decides outright; the spread check is
   * the fallback for callers that cannot supply families.
   */
  const distinctFamilies = new Set(families);
  const mixedScale =
    validModels.length > 1 &&
    (families.length === validModels.length
      ? distinctFamilies.size > 1
      : spread > MIXED_SCALE_SPREAD_NATS);
  const mixedScaleBasis: "family" | "spread" =
    families.length === validModels.length ? "family" : "spread";

  /**
   * A pool of several models is never a calibrated score: the cut-points in the registry
   * are per-model and cannot be applied to a mean. Callers must not attach calibrated
   * language to this number even when the members happen to share a scale.
   */
  const uncalibrated = validModels.length > 1 || mixedScale;

  return { llr: meanLlr, count: validModels.length, details, mixedScale, spread, uncalibrated, mixedScaleBasis };
}

/**
 * Returns structural interpretation text for the summary bullets.
 *
 * Strength is only asserted when the score being described is on a scale that supports
 * the claim: either the caller supplied a calibration for the model, or the input is a
 * pool whose members demonstrably share a scale. Otherwise the LLR is reported as a
 * model-native value with its rank context, which is the strongest honest statement.
 */
export function getSequenceEvidenceText(
  llr: number | null | undefined,
  modelName = "ESMC",
  multiModel?: { llr: number | null; count: number; details: string; mixedScale?: boolean; spread?: number | null; uncalibrated?: boolean },
  calibration?: ModelCalibration | null
): string {
  const effectiveLlr = (multiModel && multiModel.llr !== null) ? multiModel.llr : llr;
  if (effectiveLlr === null || effectiveLlr === undefined || isNaN(effectiveLlr)) {
    return "Sequence evidence: no prediction model data available.";
  }

  // A pooled mean across families is not a calibrated score, whatever the number says.
  const poolIsMixed = Boolean(multiModel && multiModel.mixedScale);

  if (multiModel && multiModel.count > 1) {
    if (poolIsMixed) {
      return `Sequence-model pool (${multiModel.count} models): values span ${multiModel.spread?.toFixed(1)} nats and are not on a shared scale, so no pooled strength classification is reported (${multiModel.details})`;
    }
    if (!isCalibrated(calibration)) {
      return `Sequence-model pool (${multiModel.count} models): pooled ΔLLR ${effectiveLlr.toFixed(1)} nats — a mean across models, with no calibrated cut-point (${multiModel.details})`;
    }
    const verdict = classifyLlr(effectiveLlr, calibration);
    const strength = verdict === "pathogenic" ? "strong" : verdict === "intermediate" ? "moderate" : "minimal";
    return `Sequence-model consensus (${multiModel.count} models): ${strength} perturbation (${multiModel.details})`;
  }

  if (!isCalibrated(calibration)) {
    return `Sequence-model evidence: model-native ΔLLR ${effectiveLlr.toFixed(1)} nats from ${modelName}, which has no established cut-point — read against its within-model residue rank`;
  }

  const verdict = classifyLlr(effectiveLlr, calibration);
  const strength = verdict === "pathogenic" ? "strong" : verdict === "intermediate" ? "moderate" : "minimal";
  return `Sequence-model evidence: ${strength} perturbation (${modelName} LLR ${effectiveLlr.toFixed(1)})`;
}

export function getEnergeticEvidenceText(vdw: number | null | undefined, sd?: number | null): string {
  if (vdw === null || vdw === undefined || isNaN(vdw)) {
    return "Energetic evidence: sidechain packing stability analysis unavailable.";
  }
  const strength = vdw >= THRESHOLDS.vdwClash.significantClash ? "severe steric clash" : vdw >= 1.0 ? "moderate destabilization" : "neutral stability";
  const sdSuffix = sd !== undefined && sd !== null && !isNaN(sd) ? ` ± ${sd.toFixed(2)}` : "";
  return `Energetic evidence: ${strength} (${vdw >= 0 ? "+" : ""}${vdw.toFixed(2)}${sdSuffix} kcal/mol)`;
}

export function getGeometricEvidenceText(maxDisp: number | null | undefined): string {
  if (maxDisp === null || maxDisp === undefined || isNaN(maxDisp)) {
    return "Geometric evidence: structural overlay displacements unavailable.";
  }
  const strength = maxDisp >= 1.5 ? "severe" : maxDisp >= 0.5 ? "mild" : "negligible";
  return `Geometric evidence: ${strength} local backbone displacement (max ${maxDisp.toFixed(2)} Å)`;
}

export function getOverallInterpretationText(maxDisp: number | null | undefined, ddG: number | null | undefined): string {
  if (maxDisp === null || maxDisp === undefined || isNaN(maxDisp)) {
    if (ddG !== null && ddG !== undefined && ddG >= THRESHOLDS.vdwClash.significantClash) {
      return "likely induces side-chain steric clashes with local residues.";
    }
    return "insufficient coordinate alignment data to form structural interpretation.";
  }

  if (maxDisp >= 1.5) {
    return "severe local folding disruption; likely triggers a large-scale conformational rearrangement or local collapse.";
  } else if (maxDisp >= 0.5 || (ddG !== null && ddG !== undefined && ddG >= THRESHOLDS.vdwClash.significantClash)) {
    return "moderate local folding shift or high steric strain; likely disrupts native packing and local conformation.";
  } else if (maxDisp >= 0.2) {
    return "likely affects local packing without evidence for a large conformational rearrangement.";
  } else {
    return "minimal structural disruption; local conformation is predicted to remain stable.";
  }
}

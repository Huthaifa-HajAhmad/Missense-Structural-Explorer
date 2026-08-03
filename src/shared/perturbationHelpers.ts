import { THRESHOLDS } from "./thresholds";

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
 * Returns structural interpretation text for the summary bullets
 */
export function getSequenceEvidenceText(llr: number | null | undefined, modelName = "ESMC"): string {
  if (llr === null || llr === undefined || isNaN(llr)) {
    return "Sequence evidence: no prediction model data available.";
  }
  const isDangerous = llr <= THRESHOLDS.esm.pathogenic; // -5.0
  const isModerate = llr <= THRESHOLDS.esm.benign; // -2.0
  const strength = isDangerous ? "strong" : isModerate ? "moderate" : "minimal";
  return `Sequence-model evidence: ${strength} perturbation (${modelName} LLR ${llr.toFixed(1)})`;
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

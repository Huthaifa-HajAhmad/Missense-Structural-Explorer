import stackingConfig from "../stacking_config.json" with { type: "json" };
import { getResidueContext, getCalibration } from "../uncertainty.ts";
import { THRESHOLDS } from "./constants.ts";

/**
 * Normalizes any raw predictor score into a canonical positive destabilization magnitude vector (H-4).
 * Canonical Rule: Positive magnitude (> 0) indicates destabilization.
 */
export function normalizeDestabilizationMagnitude(
  tool: "foldx" | "dynamut2" | "ddmut" | "rasp" | "thermompnn" | "stabilityoracle",
  score: number | null
): { magnitude: number | null; isDestabilizing: boolean } {
  if (score === null || score === undefined || isNaN(score)) {
    return { magnitude: null, isDestabilizing: false };
  }

  switch (tool) {
    case "foldx": {
      // FoldX: Positive score = destabilizing (threshold >= 1.5)
      const isDestab = score >= THRESHOLDS.foldxDdG.destabilizingStrong;
      return { magnitude: score, isDestabilizing: isDestab };
    }
    case "dynamut2": {
      // DynaMut2: Negative score = destabilizing (threshold <= -1.0)
      const isDestab = score <= THRESHOLDS.dynamut2.destabilizing;
      return { magnitude: -score, isDestabilizing: isDestab };
    }
    case "ddmut": {
      // DDMut: Negative score = destabilizing (threshold <= -1.0)
      const isDestab = score <= THRESHOLDS.ddmut.destabilizing;
      return { magnitude: -score, isDestabilizing: isDestab };
    }
    case "rasp": {
      // RaSP: Positive score = destabilizing (threshold >= 1.0)
      const isDestab = score >= THRESHOLDS.rasp.destabilizing;
      return { magnitude: score, isDestabilizing: isDestab };
    }
    case "stabilityoracle": {
      // StabilityOracle: Positive score = destabilizing (threshold >= 1.0)
      const isDestab = score >= THRESHOLDS.stabilityoracle.destabilizing;
      return { magnitude: score, isDestabilizing: isDestab };
    }
    case "thermompnn": {
      // ThermoMPNN: Positive score = destabilizing (threshold >= 1.0 kcal/mol, deltaG = mutant - WT)
      const isDestab = score >= THRESHOLDS.thermompnn.destabilizing;
      return { magnitude: score, isDestabilizing: isDestab };
    }
    default:
      return { magnitude: score, isDestabilizing: false };
  }
}

export interface CalibratedScore {
  p: number;
  lower: number;
  upper: number;
}

/**
 * Maps a raw ddG score from a specific tool to its calibrated probability,
 * lower conformal bound, and upper conformal bound by interpolating pre-fit curves.
 */
export function calibrateRawScore(
  tool: "foldx" | "dynamut2" | "ddmut" | "rasp" | "thermompnn" | "stabilityoracle",
  score: number | null
): CalibratedScore | null {
  if (score === null || score === undefined || isNaN(score)) {
    return null;
  }

  const config = (stackingConfig as any)[tool];
  if (!config || !config.bins || config.bins.length === 0) {
    return null;
  }

  const bins = config.bins;
  
  // Edge cases (clipping)
  if (score <= bins[0].raw) {
    return { p: bins[0].p, lower: bins[0].lower, upper: bins[0].upper };
  }
  if (score >= bins[bins.length - 1].raw) {
    return { p: bins[bins.length - 1].p, lower: bins[bins.length - 1].lower, upper: bins[bins.length - 1].upper };
  }

  // Linear interpolation between matching bin edges
  for (let i = 0; i < bins.length - 1; i++) {
    const binA = bins[i];
    const binB = bins[i + 1];
    if (score >= binA.raw && score <= binB.raw) {
      const denom = binB.raw - binA.raw;
      const ratio = denom === 0 ? 0 : (score - binA.raw) / denom;
      return {
        p: binA.p + ratio * (binB.p - binA.p),
        lower: binA.lower + ratio * (binB.lower - binA.lower),
        upper: binA.upper + ratio * (binB.upper - binA.upper),
      };
    }
  }

  return { p: bins[0].p, lower: bins[0].lower, upper: bins[0].upper };
}

export interface CalibratedConsensusResult {
  consensusProbability: number | null;
  consensusConfMin: number | null;
  consensusConfMax: number | null;
  consensusVerdict: string;
}

/**
 * Every string `computeCalibratedConsensus` can return.
 *
 * Exported so the verdict is a *closed set* rather than free text. Surfaces used to compare it
 * against literals they had invented — `SplicingTab` tested `consensusVerdict === "destabilizing"`,
 * which the function can never produce, so that branch was dead and a variant whose only evidence
 * was a destabilizing prediction was reported "Thermodynamically Tolerated". A guard test now
 * rejects any literal that is not a fragment of a real verdict.
 */
export const CONSENSUS_VERDICTS = {
  insufficient: "Insufficient Biophysical Data",
  lowNeutral: "Low Misfolding Risk (Neutral Stability)",
  high: "High Misfolding Risk (Destabilizing Consensus)",
  moderate: "Moderate Misfolding Risk (Conflicting Stability)",
  elevatedSingle: "Elevated Misfolding Risk (Single-Tool Estimate)",
  lowSingle: "Low Misfolding Risk (Single-Tool Estimate)"
} as const;

/** All verdict strings, for exhaustive iteration in tests and guards. */
export const CONSENSUS_VERDICT_VALUES: readonly string[] = Object.values(CONSENSUS_VERDICTS);

/**
 * True when `literal` is a legitimate way to inspect a verdict — either a whole verdict or a
 * fragment of one (so `includes("High")`, `includes("Moderate")` and `includes("Insufficient")`
 * remain valid), matched case-sensitively as the string comparisons are.
 */
export function isConsensusVerdictFragment(literal: string): boolean {
  if (!literal) return false;
  return CONSENSUS_VERDICT_VALUES.some(verdict => verdict.includes(literal));
}

/**
 * Calculates consensus probability and conformal intervals from available predictors
 * by doing a weighted average of individual calibrated probabilities.
 */
export function computeCalibratedConsensus(
  energetics: {
    foldxMean?: number | null;
    foldx?: number | null;
    dynamut2?: number | null;
    ddmut?: number | null;
    rasp?: number | null;
    thermompnn?: number | null;
    stabilityoracle?: number | null;
    foldxRepairFailed?: boolean;
    foldxBinaryMissing?: boolean;
  } | null,
  uniprotFeatures?: any[],
  residueIndex?: number,
  plddt?: number | null
): CalibratedConsensusResult {
  if (!energetics) {
    return {
      consensusProbability: null,
      consensusConfMin: null,
      consensusConfMax: null,
      consensusVerdict: CONSENSUS_VERDICTS.insufficient
    };
  }

  const isFoldxExcluded = !!energetics.foldxRepairFailed || !!energetics.foldxBinaryMissing;
  const foldxVal = isFoldxExcluded ? null : (energetics.foldxMean ?? energetics.foldx ?? null);
  const dynamut2 = energetics.dynamut2 ?? null;
  const ddmut = energetics.ddmut ?? null;
  const rasp = energetics.rasp ?? null;
  const thermompnn = energetics.thermompnn ?? null;

  const stabilityoracle = energetics.stabilityoracle ?? null;

  const tools: Array<{ name: "foldx" | "dynamut2" | "ddmut" | "rasp" | "thermompnn" | "stabilityoracle"; val: number | null }> = [
    { name: "foldx", val: foldxVal },
    { name: "dynamut2", val: dynamut2 },
    { name: "ddmut", val: ddmut },
    { name: "rasp", val: rasp },
    { name: "thermompnn", val: thermompnn },
    { name: "stabilityoracle", val: stabilityoracle }
  ];

  const context = getResidueContext(uniprotFeatures, residueIndex ?? 0);

  // Structural confidence damping for structure-dependent predictors (SCI-004)
  const plddtVal = (plddt !== null && plddt !== undefined) ? plddt : 100;
  const structureConfidenceFactor = plddtVal >= 70 ? 1.0 : (plddtVal >= 50 ? 0.5 : 0.1);
  /**
   * Identifies atomic-coordinate-sensitive engines (FoldX, ThermoMPNN, StabilityOracle).
   * These engines rely on precise atomic packing, rotamer orientations, and 3D graph topologies;
   * their ΔΔG estimates degrade rapidly in low-confidence/disordered regions (pLDDT < 70),
   * requiring proportional down-weighting. In contrast, sequence-inferred or distance-invariant
   * methods are less sensitive to coordinate jitter.
   */
  const isStructureTool = (name: string) => ["foldx", "thermompnn", "stabilityoracle"].includes(name);

  let totalWeight = 0;
  let weightedProbSum = 0;
  let weightedLowerSum = 0;
  let weightedUpperSum = 0;
  let availableCount = 0;

  for (const tool of tools) {
    if (tool.val !== null) {
      const cal = calibrateRawScore(tool.name, tool.val);
      if (cal !== null) {
        const baseWeight = (stackingConfig as any)[tool.name]?.weight ?? 1.0;
        const calInfo = getCalibration(tool.name, context);
        const weight = baseWeight * calInfo.weightMultiplier * (isStructureTool(tool.name) ? structureConfidenceFactor : 1.0);

        totalWeight += weight;
        weightedProbSum += weight * cal.p;
        weightedLowerSum += weight * cal.lower;
        weightedUpperSum += weight * cal.upper;
        availableCount++;
      }
    }
  }

  if (availableCount === 0 || totalWeight === 0) {
    return {
      consensusProbability: null,
      consensusConfMin: null,
      consensusConfMax: null,
      consensusVerdict: CONSENSUS_VERDICTS.insufficient
    };
  }

  const consensusProbability = weightedProbSum / totalWeight;
  const consensusConfMin = weightedLowerSum / totalWeight;
  const consensusConfMax = weightedUpperSum / totalWeight;

  // Probability-based consensus threshold mapping
  let consensusVerdict: string = CONSENSUS_VERDICTS.lowNeutral;
  if (consensusProbability >= THRESHOLDS.biophysicalConsensus.highRiskProbability) {
    consensusVerdict = CONSENSUS_VERDICTS.high;
  } else if (consensusProbability >= THRESHOLDS.biophysicalConsensus.moderateRiskProbability) {
    consensusVerdict = CONSENSUS_VERDICTS.moderate;
  }

  // Handle single-predictor fallback label schema
  if (availableCount === 1) {
    if (consensusProbability >= THRESHOLDS.biophysicalConsensus.highRiskProbability) {
      consensusVerdict = CONSENSUS_VERDICTS.elevatedSingle;
    } else {
      consensusVerdict = CONSENSUS_VERDICTS.lowSingle;
    }
  }

  return {
    consensusProbability,
    consensusConfMin,
    consensusConfMax,
    consensusVerdict
  };
}

/**
 * Unified calculation of structural energetics consensus stability verdict.
 * Kept for backward compatibility.
 */
export function computeConsensusVerdict(
  energetics: {
    foldxMean?: number | null;
    foldx?: number | null;
    dynamut2?: number | null;
    ddmut?: number | null;
    rasp?: number | null;
    thermompnn?: number | null;
    stabilityoracle?: number | null;
    foldxRepairFailed?: boolean;
    foldxBinaryMissing?: boolean;
  } | null,
  uniprotFeatures?: any[],
  residueIndex?: number,
  plddt?: number | null
): string {
  return computeCalibratedConsensus(energetics, uniprotFeatures, residueIndex, plddt).consensusVerdict;
}

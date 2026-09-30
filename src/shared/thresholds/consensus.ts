/**
 * consensus.ts — the ΔΔG stability consensus, as an agreement count.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACED (read before adding a "probability" back)
 * ─────────────────────────────────────────────────────────────────────────────
 * This module used to map each engine's ΔΔG to a "calibrated probability of destabilization" through
 * `stacking_config.json`, weight them, attach a "conformal interval", and threshold the average into
 * "High / Moderate / Low Misfolding Risk". The curves were typed by hand in `tools/train_stacker.py`
 * (its download, homology-filter and Venn-ABERS steps were `pass` or "simulation"), and the weights were
 * further scaled by per-context AUCs in `protein_class_calibration.json` that had no source either.
 * Nothing in it was fitted to data, so every number it produced was presented with a precision it did
 * not have. It was removed, not relabelled (doc/ENERGETICS_TAB_REVIEW.md, "Calibration retired").
 *
 * What it computes now is what the Energetics tab shows: how many engines that returned a value sit
 * past their OWN destabilizing mark (`shared/engineStatus.ts`), their median ΔΔG and range, and a
 * verdict from the closed set `STABILITY_VERDICTS`. The rule lives in `shared/energeticsEvidence.ts`;
 * this module is the server-safe entry point to it, so the stored verdict, the export and the screen
 * cannot disagree.
 *
 * If a calibrated probability is ever wanted, it must come from a fitted, reproducible model with a
 * held-out evaluation checked into the repository — not a table of literals.
 */

import {
  STABILITY_VERDICTS,
  buildEnergeticsEvidence,
  type StabilityVerdict,
} from "../energeticsEvidence.ts";

/** The closed set of verdicts. Kept under this name for the closed-set guard and older imports. */
export const CONSENSUS_VERDICTS = STABILITY_VERDICTS;

/** The closed set of verdicts, as a type. A comparison with any other literal fails `tsc` (TS2367). */
export type ConsensusVerdict = StabilityVerdict;

/** All verdict strings, for exhaustive iteration in tests and guards. */
export const CONSENSUS_VERDICT_VALUES: readonly string[] = Object.values(CONSENSUS_VERDICTS);

/**
 * True when `literal` is a legitimate way to inspect a verdict — a whole verdict or a fragment of one
 * (`includes("Disagree")`), matched case-sensitively as string comparisons are.
 */
export function isConsensusVerdictFragment(literal: string): boolean {
  if (!literal) return false;
  return CONSENSUS_VERDICT_VALUES.some(verdict => verdict.includes(literal));
}

/** The engine values the consensus reads. Raw provider values: the sign is normalized per engine. */
export interface StabilityConsensusInput {
  foldxMean?: number | null;
  foldx?: number | null;
  dynamut2?: number | null;
  ddmut?: number | null;
  rasp?: number | null;
  thermompnn?: number | null;
  stabilityoracle?: number | null;
  foldxRepairFailed?: boolean;
  foldxBinaryMissing?: boolean;
}

export interface StabilityConsensusResult {
  consensusVerdict: ConsensusVerdict;
  /** Engines whose value is counted (an excluded FoldX value is shown elsewhere, never counted). */
  enginesCounted: number;
  /** Counted engines at or past their own destabilizing mark. */
  enginesDestabilizing: number;
  /** Median canonical ΔΔG of the counted engines, kcal/mol (positive = destabilizing). */
  medianDdg: number | null;
  minDdg: number | null;
  maxDdg: number | null;
}

/**
 * The stability consensus for one set of engine values.
 *
 * Deliberately takes VALUES only: statuses (running, provider busy…) describe the run, not the verdict,
 * and the screen adds them itself. With no engine counted the verdict is "Insufficient Biophysical Data".
 */
export function computeStabilityConsensus(energetics: StabilityConsensusInput | null): StabilityConsensusResult {
  const ev = buildEnergeticsEvidence({ foldingEnergetics: (energetics ?? null) as Record<string, any> | null });
  const a = ev.agreement;
  return {
    consensusVerdict: a.verdict,
    enginesCounted: a.nCounted,
    enginesDestabilizing: a.destabilizing.length,
    medianDdg: a.median,
    minDdg: a.min,
    maxDdg: a.max,
  };
}

/** The verdict alone. */
export function computeConsensusVerdict(energetics: StabilityConsensusInput | null): ConsensusVerdict {
  return computeStabilityConsensus(energetics).consensusVerdict;
}

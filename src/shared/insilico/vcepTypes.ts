import type { CalibratedToolKey, EvidenceStrength } from "../thresholds/calibration.ts";

export type VcepToolKey = Extract<CalibratedToolKey, "revel" | "bayesdel" | "alphaMissense" | "cadd">;

export interface ThresholdBound {
  threshold: number;
  /** True: >= / <=; false: strict > / <. */
  inclusive: boolean;
  /** Defaults to "higher" (all four VCEP missense tools increase with pathogenicity). */
  orientation?: "higher" | "lower";
}

export type VcepStrengthBounds = Partial<Record<EvidenceStrength, ThresholdBound>>;

export interface VcepToolSpec {
  tool: VcepToolKey;
  pp3: VcepStrengthBounds;
  /** Missing side (e.g. VHL, DDC) excludes missense BP4. */
  bp4: VcepStrengthBounds;
}

export interface VcepSpliceSpec {
  /** Tighter VCEP BP4 ceiling; never weakens Walker 2023 >= 0.20. */
  bp4Block?: ThresholdBound;
  /**
   * Missense splicing PP3 cutoff (e.g. >= 0.5 for PAH/Congenital Myopathies/LGMD/Platelet, >= 0.38 for RUNX1,
   * Moderate >= 0.8 + Supporting >= 0.2 for ABCA4, "nf1", or "none" when excluded). Defaults to Walker 2023 >= 0.20.
   */
  pp3Missense?: "none" | "nf1" | {
    Moderate?: ThresholdBound;
    Supporting?: ThresholdBound;
  };
}

export type VcepRuleKind =
  /** Ordered single-tool list: first tool with a finite score decides (no unauthorized fallback beyond list). */
  | { kind: "ordered-tools"; tools: readonly VcepToolSpec[] }
  /** All listed tools must have finite scores and agree in the same direction (CTLA4, PIK3CD, PIK3R1). */
  | { kind: "all-of"; tools: readonly VcepToolSpec[] }
  /** At least `minAgree` tools of `tools` must agree in the same direction (BMPR2: 2 of 3). */
  | { kind: "k-of-n"; minAgree: number; tools: readonly VcepToolSpec[] }
  /** Missense computational predictors are excluded by the VCEP (e.g. PALB2, APC, SCID, GFAP). */
  | { kind: "exclude-missense" }
  /**
   * Clauses require inputs we do not compute (Align-GVGD, functional domain gating, or multiple competing
   * disease-specific VCEPs): default chain runs, while full VCEP rules display as explicit curator notes.
   */
  | { kind: "advisory" };

export interface VcepSpecRef {
  cspecId: string;
  version: string;
  vcep: string;
}

export interface VcepInsilicoRule {
  gene: string;
  cspecId: string;
  version: string;
  vcep: string;
  /** Additional Released specs covering the same gene (ACTA1 GN169; RYR1 GN150/GN179). */
  alternateSpecs?: readonly VcepSpecRef[];
  rule: VcepRuleKind;
  splice?: VcepSpliceSpec;
  /** Human-readable summary of the VCEP rule. */
  summary: string;
  /** Explicit caveats, typo corrections, uncomputable clauses, or exclusions. */
  notes?: readonly string[];
}

export function meetsHighBound(score: number, bound: ThresholdBound): boolean {
  return bound.inclusive ? score >= bound.threshold : score > bound.threshold;
}

export function meetsLowBound(score: number, bound: ThresholdBound): boolean {
  return bound.inclusive ? score <= bound.threshold : score < bound.threshold;
}

export function matchesThresholdBound(
  score: number,
  bound: ThresholdBound,
  direction: "PP3" | "BP4",
): boolean {
  const higherIsPathogenic = (bound.orientation ?? "higher") === "higher";
  const wantsHigh = (direction === "PP3") === higherIsPathogenic;
  return wantsHigh ? meetsHighBound(score, bound) : meetsLowBound(score, bound);
}

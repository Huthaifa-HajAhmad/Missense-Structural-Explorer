/**
 * src/thresholds.ts — Frontend mirror of server/services/thresholds.ts
 *
 * Keep in sync with the server module. Used by badge functions,
 * threshold tables, and the Substitutional Class Impact Grid.
 *
 * DO NOT hard-code score cut-points anywhere else in the frontend.
 */

export const THRESHOLDS = {
  revel: {
    pathogenicStrong:      0.75,
    pathogenicSupporting:  0.50,
    benign:                0.15,
  },
  cadd: {
    pathogenicStrong:      25,
    pathogenicSupporting:  20,
    benign:                10,
    moderate:              15,
  },
  alphaMissense: {
    pathogenicStrong:      0.90,
    pathogenicSupporting:  0.70,
    benign:                0.30,
    benignStrong:          0.10,
    pathogenicClass:       "pathogenic",
    benignClass:           "benign",
  },
  eve: {
    pathogenic:            0.75,
    benign:                0.25,
    pathogenicClass:       "pathogenic",
    benignClass:           "benign",
  },
  foldxDdG: {
    destabilizingStrong:      1.5,
    destabilizingSupporting:  0.5,
    neutralLow:               -0.5,
    neutralHigh:              0.5,
    stabilizing:              -0.5,
  },
  gerp:   { conserved: 2.0 },
  phylop: { conserved: 1.5 },
  vdwClash: { significantClash: 2.0 },
} as const;

export const THRESHOLD_NOTES: Record<string, string> = {
  revel:
    "REVEL (Ioannidis 2016). PP3 strong ≥ 0.75, supporting ≥ 0.50; BP4 < 0.15.",
  cadd:
    "CADD (Kircher 2014). PP3 strong PHRED ≥ 25, supporting ≥ 20; BP4 ≤ 10.",
  alphaMissense:
    "AlphaMissense (Cheng 2023). Operational thresholds — NOT ClinGen-calibrated. " +
    "ClinGen values: path ≈ 0.983, benign ≈ 0.063 (Pejaver 2022).",
  eve:
    "EVE (Evolutionary Model of Variant Effect, Frazer 2021). Pathogenic ≥ 0.75, Benign ≤ 0.25.",
  foldxDdG:
    "FoldX ΔΔG > 1.5 kcal/mol = strong destabilization. " +
    "NOTE: Destabilization ≠ Pathogenicity.",
};

export type PredictorSignal = "pathogenic" | "benign" | "vus" | "unavailable";

export function evaluateRevel(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score >= THRESHOLDS.revel.pathogenicSupporting) return "pathogenic";
  if (score <= THRESHOLDS.revel.benign) return "benign";
  return "vus";
}

export function evaluateCadd(phred: number | null | undefined): PredictorSignal {
  if (phred === null || phred === undefined) return "unavailable";
  if (phred >= THRESHOLDS.cadd.pathogenicSupporting) return "pathogenic";
  if (phred <= THRESHOLDS.cadd.benign) return "benign";
  return "vus";
}

export function evaluateAlphaMissense(
  score: number | null | undefined,
  cls: string | null | undefined
): PredictorSignal {
  const hasCls = cls !== null && cls !== undefined && cls !== "";
  const hasScore = score !== null && score !== undefined;
  if (!hasCls && !hasScore) return "unavailable";

  if (cls) {
    const lc = cls.toLowerCase();
    if (lc.includes(THRESHOLDS.alphaMissense.pathogenicClass)) return "pathogenic";
    if (lc.includes(THRESHOLDS.alphaMissense.benignClass)) return "benign";
  }
  if (score !== null && score !== undefined) {
    if (score >= THRESHOLDS.alphaMissense.pathogenicSupporting) return "pathogenic";
    if (score <= THRESHOLDS.alphaMissense.benign) return "benign";
  }
  return "vus";
}

export function evaluateEve(
  score: number | null | undefined,
  cls: string | null | undefined
): PredictorSignal {
  const hasCls = cls !== null && cls !== undefined && cls !== "";
  const hasScore = score !== null && score !== undefined;
  if (!hasCls && !hasScore) return "unavailable";

  if (cls) {
    const lc = cls.toLowerCase();
    if (lc.includes(THRESHOLDS.eve.pathogenicClass)) return "pathogenic";
    if (lc.includes(THRESHOLDS.eve.benignClass)) return "benign";
  }
  if (score !== null && score !== undefined) {
    if (score >= THRESHOLDS.eve.pathogenic) return "pathogenic";
    if (score <= THRESHOLDS.eve.benign) return "benign";
  }
  return "vus";
}

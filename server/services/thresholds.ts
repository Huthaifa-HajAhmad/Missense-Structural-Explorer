/**
 * thresholds.ts — Canonical score thresholds for all in-silico predictors.
 *
 * This is the SINGLE SOURCE OF TRUTH for cut-points used by:
 *   - acmg.ts  (rule engine)
 *   - routes.ts (consensus logic)
 *   - EvidenceDashboardCard.tsx (via the mirrored src/thresholds.ts)
 *
 * DO NOT hard-code predictor thresholds anywhere else.
 *
 * References
 * ----------
 * REVEL   : Ioannidis et al. 2016; ClinGen calibration Richards 2015 §6.
 * CADD    : Kircher et al. 2014; ACMG/AMP SVI working group 2018.
 * AM      : Cheng et al. 2023 (AlphaMissense); Pejaver et al. 2022 ClinGen calibration.
 *           NOTE: ClinGen-calibrated thresholds for AM are 0.983 (pathogenic) / 0.063 (benign).
 *           The values below are operationally conservative pending per-gene calibration.
 *           Label them clearly as UNCALIBRATED until a gene-specific calibration is applied.
 * FoldX   : Schymkowitz et al. 2005; ΔΔG > 1.5 kcal/mol: Guerois et al. 2002.
 * GERP++  : Cooper et al. 2010.
 * phyloP  : Pollard et al. 2010.
 */

export const THRESHOLDS = {
  revel: {
    /** REVEL ≥ 0.75 → PP3 (Strong) per ClinGen SVI recommendation */
    pathogenicStrong: 0.75,
    /** REVEL ≥ 0.50 → PP3 (Supporting) */
    pathogenicSupporting: 0.50,
    /** REVEL < 0.15 → BP4 */
    benign: 0.15,
  },

  cadd: {
    /** CADD PHRED ≥ 25 → PP3 (Strong) per ACMG/AMP SVI */
    pathogenicStrong: 25,
    /** CADD PHRED ≥ 20 → PP3 (Supporting) */
    pathogenicSupporting: 20,
    /** CADD PHRED ≤ 10 → BP4 */
    benign: 10,
    /** UI display moderate band */
    moderate: 15,
  },

  alphaMissense: {
    /**
     * Operational thresholds — NOT ClinGen-calibrated.
     * ClinGen published values (Pejaver 2022): path ~0.983, benign ~0.063.
     * These are conservative operational proxies until gene-specific calibration.
     */
    pathogenicStrong: 0.90,   // surrogate for "pathogenic" class
    pathogenicSupporting: 0.70, // surrogate for "likely_pathogenic" class
    benign: 0.30,
    benignStrong: 0.10,
    /** Class string matching — use .toLowerCase().includes() */
    pathogenicClass: "pathogenic",  // matches "pathogenic" and "likely_pathogenic"
    benignClass: "benign",          // matches "benign" and "likely_benign"
  },

  eve: {
    /** EVE score ≥ 0.75 → Pathogenic */
    pathogenic: 0.75,
    /** EVE score ≤ 0.25 → Benign */
    benign: 0.25,
    /** Class string matching — use .toLowerCase().includes() */
    pathogenicClass: "pathogenic",
    benignClass: "benign",
  },

  foldxDdG: {
    /** ΔΔG > 1.5 kcal/mol: strong destabilization */
    destabilizingStrong: 1.5,
    /** ΔΔG > 0.5 kcal/mol: supporting destabilization */
    destabilizingSupporting: 0.5,
    /** ΔΔG within ±0.5: neutral / well-tolerated */
    neutralLow: -0.5,
    neutralHigh: 0.5,
    /** ΔΔG < -0.5: stabilizing variant */
    stabilizing: -0.5,
  },

  gerp: {
    /** GERP++ RS ≥ 2.0 → conserved position */
    conserved: 2.0,
  },

  phylop: {
    /** phyloP ≥ 1.5 → conserved position */
    conserved: 1.5,
  },

  vdwClash: {
    /** FoldX VdW energy delta > 2.0 kcal/mol → steric clash */
    significantClash: 2.0,
  },
} as const;

/**
 * Human-readable citation strings for display in the UI.
 * Shown in threshold tables and tooltips to direct researchers to primary sources.
 */
export const THRESHOLD_NOTES: Record<string, string> = {
  revel:
    "REVEL (Ioannidis 2016). PP3 strong ≥ 0.75, supporting ≥ 0.50; BP4 < 0.15. " +
    "Source: ClinGen SVI Recommendation v1.0 (2018).",
  cadd:
    "CADD (Kircher 2014). PP3 strong PHRED ≥ 25, supporting ≥ 20; BP4 ≤ 10. " +
    "Source: ACMG/AMP SVI Working Group (2018).",
  alphaMissense:
    "AlphaMissense (Cheng 2023). Operational thresholds — NOT ClinGen-calibrated. " +
    "ClinGen values: path ≈ 0.983, benign ≈ 0.063 (Pejaver 2022). " +
    "Class matching: includes('pathogenic') / includes('benign').",
  eve:
    "EVE (Evolutionary Model of Variant Effect, Frazer 2021). " +
    "Pathogenic ≥ 0.75, Benign ≤ 0.25, or class includes('pathogenic') / includes('benign').",
  foldxDdG:
    "FoldX BuildModel ΔΔG (Schymkowitz 2005). Destabilizing > 1.5 kcal/mol (strong). " +
    "NOTE: Destabilization ≠ Pathogenicity. GOF/neomorphic/gain-of-interaction variants " +
    "may be pathogenic without destabilization.",
  gerp:
    "GERP++ RS ≥ 2.0 → conserved position (Cooper 2010).",
  phylop:
    "phyloP 100-way vertebrate ≥ 1.5 → conserved (Pollard 2010).",
};

/**
 * Evaluate a single predictor's signal against canonical thresholds.
 * Returns "pathogenic" | "benign" | "vus" | "unavailable".
 */
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

/**
 * Count concordant predictor signals given the standard inputs.
 * Returns counts and named availability for partial-evidence disclosure.
 */
export interface PredictorConcordance {
  nPathogenic: number;
  nBenign:     number;
  nVus:        number;
  available:   string[];
  unavailable: string[];
  signals: {
    cadd:  PredictorSignal;
    revel: PredictorSignal;
    am:    PredictorSignal;
    eve:   PredictorSignal;
  };
}

export function countPredictorConcordance(
  caddPhred: number | null | undefined,
  revel:     number | null | undefined,
  amScore:   number | null | undefined,
  amClass:   string | null | undefined,
  eveScore?:  number | null | undefined,
  eveClass?:  string | null | undefined
): PredictorConcordance {
  const signals = {
    cadd:  evaluateCadd(caddPhred),
    revel: evaluateRevel(revel),
    am:    evaluateAlphaMissense(amScore, amClass),
    eve:   evaluateEve(eveScore, eveClass),
  };

  const available: string[]   = [];
  const unavailable: string[] = [];
  let nPathogenic = 0, nBenign = 0, nVus = 0;

  for (const [name, sig] of Object.entries(signals) as [string, PredictorSignal][]) {
    if (sig === "unavailable") {
      unavailable.push(name.toUpperCase());
    } else {
      available.push(name.toUpperCase());
      if (sig === "pathogenic") nPathogenic++;
      else if (sig === "benign") nBenign++;
      else nVus++;
    }
  }

  return { nPathogenic, nBenign, nVus, available, unavailable, signals };
}

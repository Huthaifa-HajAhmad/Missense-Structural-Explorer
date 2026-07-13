/**
 * thresholds.ts — Canonical score thresholds for all in-silico predictors.
 *
 * This is the SINGLE SOURCE OF TRUTH for cut-points used by:
 *   - acmg.ts  (rule engine)
 *   - routes.ts (consensus logic)
 *   - EvidenceDashboardCard.tsx
 *
 * DO NOT hard-code predictor thresholds anywhere else.
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
     * ClinGen-calibrated thresholds (Pejaver et al. 2022).
     * Pathogenic: ≥ 0.983, Supporting: ≥ 0.564, Benign: ≤ 0.063.
     */
    pathogenicStrong: 0.983,
    pathogenicSupporting: 0.564,
    benign: 0.063,
    benignStrong: 0.063,
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
  dynamut2: {
    /** Negative value indicates destabilisation: ≤ -1.0 kcal/mol */
    destabilizing: -1.0,
  },
  ddmut: {
    /** Negative value indicates destabilisation: ≤ -1.0 kcal/mol */
    destabilizing: -1.0,
  },
  ddgun: {
    /** Negative value indicates destabilisation: ≤ -1.0 kcal/mol */
    destabilizing: -1.0,
  },
  bayesdel: {
    pathogenic: 0.133,
    benign: -0.0404,
  },
  esm: {
    pathogenic: -5.0,
    benign: -2.0,
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
    "AlphaMissense (Cheng 2023). ClinGen-calibrated thresholds (Pejaver 2022): path ≥ 0.983, benign ≤ 0.063. " +
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
  dynamut2:
    "DynaMut2 (Rodrigues 2021). Destabilizing ΔΔG ≤ -1.0 kcal/mol.",
  ddmut:
    "DDMut (BioSig 2022). Destabilizing ΔΔG ≤ -1.0 kcal/mol.",
  ddgun:
    "DDGun-Seq (Montanucci 2019/2022). Destabilizing ΔΔG ≤ -1.0 kcal/mol.",
  bayesdel:
    "BayesDel (noAF, Feng 2021). PP3 supporting ≥ 0.133, BP4 supporting ≤ -0.0404.",
  esm:
    "VESM Co-distilled LLR (ntranoslab, unpublished preprint). Informational only — no validated clinical threshold is applied, and it is excluded from concordance voting.",
};

export type PredictorSignal = "pathogenic" | "benign" | "vus" | "unavailable";

export function evaluateRevel(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score >= THRESHOLDS.revel.pathogenicStrong) return "pathogenic";
  if (score <= THRESHOLDS.revel.benign) return "benign";
  return "vus";
}

export function evaluateCadd(phred: number | null | undefined): PredictorSignal {
  if (phred === null || phred === undefined) return "unavailable";
  if (phred >= THRESHOLDS.cadd.pathogenicStrong) return "pathogenic";
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
    if (score >= THRESHOLDS.alphaMissense.pathogenicStrong) return "pathogenic";
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

export function evaluateBayesdel(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score >= THRESHOLDS.bayesdel.pathogenic) return "pathogenic";
  if (score <= THRESHOLDS.bayesdel.benign) return "benign";
  return "vus";
}

export function evaluateEsm(llr: number | null | undefined): PredictorSignal {
  if (llr === null || llr === undefined) return "unavailable";
  if (llr <= THRESHOLDS.esm.pathogenic) return "pathogenic";
  if (llr >= THRESHOLDS.esm.benign) return "benign";
  return "vus";
}

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
    bayesdel: PredictorSignal;
    esm:   PredictorSignal;
  };
}

export function countPredictorConcordance(
  caddPhred: number | null | undefined,
  revel:     number | null | undefined,
  amScore:   number | null | undefined,
  amClass:   string | null | undefined,
  eveScore?:  number | null | undefined,
  eveClass?:  string | null | undefined,
  bayesdel?:  number | null | undefined,
  esmLlr?:    number | null | undefined
): PredictorConcordance {
  const signals = {
    cadd:  evaluateCadd(caddPhred),
    revel: evaluateRevel(revel),
    am:    evaluateAlphaMissense(amScore, amClass),
    eve:   evaluateEve(eveScore, eveClass),
    bayesdel: evaluateBayesdel(bayesdel),
    esm:   evaluateEsm(esmLlr),
  };

  const available: string[]   = [];
  const unavailable: string[] = [];
  let nPathogenic = 0, nBenign = 0, nVus = 0;

  for (const [name, sig] of Object.entries(signals) as [string, PredictorSignal][]) {
    if (sig === "unavailable") {
      unavailable.push(name.toUpperCase());
    } else {
      available.push(name.toUpperCase());
      // Exclude ESM co-distilled model from active consensus voting counts to prevent artificial inflation
      if (name !== "esm") {
        if (sig === "pathogenic") nPathogenic++;
        else if (sig === "benign") nBenign++;
        else nVus++;
      }
    }
  }

  return { nPathogenic, nBenign, nVus, available, unavailable, signals };
}

/**
 * Unified calculation of structural energetics consensus stability verdict.
 */
export function computeConsensusVerdict(
  energetics: {
    foldxMean?: number | null;
    foldx?: number | null;
    dynamut2?: number | null;
    ddmut?: number | null;
    rasp?: number | null;
    ddgun?: number | null;
  } | null
): string {
  if (!energetics) return "Low-Risk (Neutral Stability)";
  const foldxVal = energetics.foldxMean ?? energetics.foldx ?? null;
  const dynamut2 = energetics.dynamut2 ?? null;
  const ddmut = energetics.ddmut ?? null;
  const rasp = energetics.rasp ?? null;
  const ddgun = energetics.ddgun ?? null;

  const foldxDestab = foldxVal !== null && foldxVal >= THRESHOLDS.foldxDdG.destabilizingStrong;
  const dynamutDestab = dynamut2 !== null && dynamut2 <= THRESHOLDS.dynamut2.destabilizing;
  const ddmutDestab = ddmut !== null && ddmut <= THRESHOLDS.ddmut.destabilizing;
  const raspDestab = rasp !== null && rasp <= -1.0; // RaSP destabilization threshold is <= -1.0
  const ddgunDestab = ddgun !== null && ddgun <= THRESHOLDS.ddgun.destabilizing;

  const destabCount = [foldxDestab, dynamutDestab, ddmutDestab, raspDestab, ddgunDestab].filter(Boolean).length;
  const availableCount = [foldxVal, dynamut2, ddmut, rasp, ddgun].filter(v => v !== null).length;

  if (destabCount >= 2) {
    return "High-Risk Destabilizing (Consensus)";
  } else if (destabCount === 1 && availableCount >= 2) {
    return "Moderate-Risk Conflicting Stability";
  }
  return "Low-Risk (Neutral Stability)";
}

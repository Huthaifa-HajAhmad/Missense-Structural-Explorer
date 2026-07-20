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
    likelyBenign: 0.34,
    benign: 0.063,
    benignStrong: 0.063,
    /** Class string matching — use .toLowerCase().includes() */
    pathogenicClass: "pathogenic",  // matches "pathogenic" and "likely_pathogenic"
    benignClass: "benign",          // matches "benign" and "likely_benign"
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
    /** GERP++ RS ≥ 4.0 → highly conserved, ≥ 2.0 → moderately conserved */
    high: 4.0,
    moderate: 2.0,
    /** Binary classification threshold used for ClinGen rules and guideline badges */
    conserved: 2.0,
  },

  phylop: {
    /** phyloP ≥ 4.0 → highly conserved, ≥ 1.5 → moderately conserved */
    high: 4.0,
    moderate: 1.5,
    /** Binary classification threshold used for ClinGen rules and guideline badges */
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
  metaRnn: {
    pathogenic: 0.5,
    benign: 0.5,
  },
  clinPred: {
    pathogenic: 0.5,
    benign: 0.5,
  },
  eigen: {
    pathogenic: 4.0,
    benign: 4.0,
  },
  dann: {
    pathogenic: 0.96,
    benign: 0.96,
  },
  esm1b: {
    pathogenic: -7.5,
    benign: -5.0,
  },
  popEve: {
    /** Severe Pathogenicity Threshold (99.99% likelihood, 15-fold case enrichment): LLR ≤ -5.056 */
    severePathogenic: -5.056,
    /** Moderate Pathogenicity Threshold (99% likelihood, 5-fold case enrichment): LLR ≤ -4.617 */
    pathogenic: -4.617,
    /** Supporting Pathogenicity LLR threshold */
    pathogenicSupporting: -2.0,
    /** Benign LLR threshold */
    benignLlr: -1.0,
    /** 0 to 1 normalized scale cutoffs */
    pathogenicNormalized: 0.75,
    benignNormalized: 0.25,
  },
  misZ: {
    pathogenicStrong: 3.09,
    pathogenicSupporting: 2.0,
  },
  loeuf: {
    pathogenicStrong: 0.35,
    pathogenicSupporting: 0.60,
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
  metaRnn:
    "MetaRNN (dbNSFP, score ≥ 0.5 deleterious).",
  clinPred:
    "ClinPred (dbNSFP, score ≥ 0.5 deleterious).",
  eigen:
    "Eigen (coding Phred score ≥ 4.0 deleterious).",
  dann:
    "DANN (deep learning score ≥ 0.96 deleterious).",
  esm1b:
    "ESM-1b (evolutionary LMs, score ≤ -7.5 deleterious, ≥ -5.0 benign).",
  popEve:
    "popEVE (Population-calibrated EVE, Nature 2024). Severe pathogenic LLR ≤ -5.056 (99.99% likelihood), " +
    "Moderate pathogenic LLR ≤ -4.617 (99% likelihood), Supporting LLR ≤ -2.0; Benign LLR ≥ -1.0. " +
    "Normalized probability scale: Pathogenic ≥ 0.75, Benign ≤ 0.25.",
  misZ:
    "gnomAD Missense Z-score (positive = depletion of missense variants; strong constraint ≥ 3.09, supporting ≥ 2.0).",
  loeuf:
    "gnomAD LOEUF (observed/expected loss-of-function ratio; severe intolerance < 0.35, moderate < 0.60).",
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

export function evaluateMetaRnn(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score >= THRESHOLDS.metaRnn.pathogenic) return "pathogenic";
  if (score < THRESHOLDS.metaRnn.benign) return "benign";
  return "vus";
}

export function evaluateClinPred(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score >= THRESHOLDS.clinPred.pathogenic) return "pathogenic";
  if (score < THRESHOLDS.clinPred.benign) return "benign";
  return "vus";
}

export function evaluateEigen(phred: number | null | undefined): PredictorSignal {
  if (phred === null || phred === undefined) return "unavailable";
  if (phred >= THRESHOLDS.eigen.pathogenic) return "pathogenic";
  if (phred < THRESHOLDS.eigen.benign) return "benign";
  return "vus";
}

export function evaluateDann(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score >= THRESHOLDS.dann.pathogenic) return "pathogenic";
  if (score <= 0.5) return "benign";
  return "vus";
}

export function evaluatePopEve(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score < 0) {
    if (score <= THRESHOLDS.popEve.pathogenicSupporting) return "pathogenic";
    if (score >= THRESHOLDS.popEve.benignLlr) return "benign";
    return "vus";
  }
  if (score >= THRESHOLDS.popEve.pathogenicNormalized) return "pathogenic";
  if (score <= THRESHOLDS.popEve.benignNormalized) return "benign";
  return "vus";
}

export interface PredictorToolDetails {
  key: string;
  name: string;
  signal: PredictorSignal;
  scoreLabel: string;
  isInformationalOnly?: boolean;
}

export interface PredictorConcordance {
  nPathogenic: number;
  nBenign:     number;
  nDeleterious: number;
  nTolerated:  number;
  nVus:        number;
  available:   string[];
  unavailable: string[];
  pathogenicTools: PredictorToolDetails[];
  benignTools:     PredictorToolDetails[];
  vusTools:        PredictorToolDetails[];
  signals: Record<string, PredictorSignal>;
}

export function countPredictorConcordance(
  caddPhred: number | null | undefined,
  revel:     number | null | undefined,
  amScore:   number | null | undefined,
  amClass:   string | null | undefined,
  bayesdel?:  number | null | undefined,
  esmLlr?:    number | null | undefined,
  extra?: {
    metarnn?: number | null;
    clinpred?: number | null;
    eigenPhred?: number | null;
    dann?: number | null;
    popeve?: number | null;
  }
): PredictorConcordance {
  const toolDefs: PredictorToolDetails[] = [
    {
      key: "cadd",
      name: "CADD",
      signal: evaluateCadd(caddPhred),
      scoreLabel: caddPhred !== null && caddPhred !== undefined ? `${caddPhred.toFixed(1)}` : "—",
    },
    {
      key: "revel",
      name: "REVEL",
      signal: evaluateRevel(revel),
      scoreLabel: revel !== null && revel !== undefined ? `${revel.toFixed(3)}` : "—",
    },
    {
      key: "am",
      name: "AlphaMissense",
      signal: evaluateAlphaMissense(amScore, amClass),
      scoreLabel: amClass ? amClass : amScore !== null && amScore !== undefined ? `${amScore.toFixed(3)}` : "—",
    },
    {
      key: "bayesdel",
      name: "BayesDel",
      signal: evaluateBayesdel(bayesdel),
      scoreLabel: bayesdel !== null && bayesdel !== undefined ? `${bayesdel.toFixed(3)}` : "—",
    },
    {
      key: "metarnn",
      name: "MetaRNN",
      signal: evaluateMetaRnn(extra?.metarnn),
      scoreLabel: extra?.metarnn !== null && extra?.metarnn !== undefined ? `${extra.metarnn.toFixed(3)}` : "—",
    },
    {
      key: "clinpred",
      name: "ClinPred",
      signal: evaluateClinPred(extra?.clinpred),
      scoreLabel: extra?.clinpred !== null && extra?.clinpred !== undefined ? `${extra.clinpred.toFixed(3)}` : "—",
    },
    {
      key: "eigen",
      name: "Eigen",
      signal: evaluateEigen(extra?.eigenPhred),
      scoreLabel: extra?.eigenPhred !== null && extra?.eigenPhred !== undefined ? `${extra.eigenPhred.toFixed(1)}` : "—",
    },
    {
      key: "dann",
      name: "DANN",
      signal: evaluateDann(extra?.dann),
      scoreLabel: extra?.dann !== null && extra?.dann !== undefined ? `${extra.dann.toFixed(3)}` : "—",
    },
    {
      key: "popeve",
      name: "popEVE",
      signal: evaluatePopEve(extra?.popeve),
      scoreLabel: extra?.popeve !== null && extra?.popeve !== undefined ? `${extra.popeve.toFixed(3)}` : "—",
    },
    {
      key: "esm",
      name: "ESM",
      signal: evaluateEsm(esmLlr),
      scoreLabel: esmLlr !== null && esmLlr !== undefined ? `${esmLlr.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
  ];

  const available: string[]   = [];
  const unavailable: string[] = [];
  const signals: Record<string, PredictorSignal> = {};
  const pathogenicTools: PredictorToolDetails[] = [];
  const benignTools: PredictorToolDetails[]     = [];
  const vusTools: PredictorToolDetails[]        = [];

  let nPathogenic = 0, nBenign = 0, nVus = 0;

  for (const tool of toolDefs) {
    signals[tool.key] = tool.signal;
    if (tool.signal === "unavailable") {
      unavailable.push(tool.name.toUpperCase());
    } else {
      available.push(tool.name.toUpperCase());
      if (tool.signal === "pathogenic") {
        pathogenicTools.push(tool);
        if (!tool.isInformationalOnly) nPathogenic++;
      } else if (tool.signal === "benign") {
        benignTools.push(tool);
        if (!tool.isInformationalOnly) nBenign++;
      } else {
        vusTools.push(tool);
        if (!tool.isInformationalOnly) nVus++;
      }
    }
  }

  return {
    nPathogenic,
    nBenign,
    nDeleterious: nPathogenic,
    nTolerated: nBenign,
    nVus,
    available,
    unavailable,
    pathogenicTools,
    benignTools,
    vusTools,
    signals
  };
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
  if (!energetics) return "Low Misfolding Risk (Neutral Stability)";
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
    return "High Misfolding Risk (Destabilizing Consensus)";
  } else if (destabCount === 1 && availableCount >= 2) {
    return "Moderate Misfolding Risk (Conflicting Stability)";
  }
  return "Low Misfolding Risk (Neutral Stability)";
}

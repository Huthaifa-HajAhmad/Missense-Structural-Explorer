import stackingConfig from "./stacking_config.json" with { type: "json" };
import { getResidueContext, getCalibration } from "./uncertainty.ts";
import type { AlphaGenomeAviData } from "./contracts.ts";

/**
 * THRESHOLDS_METADATA — Audit and citation metadata for predictor cut-points (P3-2).
 */
export const THRESHOLDS_METADATA = {
  lastReviewed: "2026-07-22",
  citations: {
    revel: "Ioannidis et al. Am J Hum Genet (2016) & ClinGen SVI Recommendation",
    alphaMissense: "Cheng et al. Science (2023) & Pejaver et al. Am J Hum Genet (2022)",
    cadd: "Rentzsch et al. Nucleic Acids Res (2019) & ACMG/AMP SVI Guidance",
    foldxDdG: "Schymkowitz et al. Nucleic Acids Res (2005)",
    popEVE: "Frazer et al. Nature (2021)",
    dbscsnv: "Jian et al. Hum Mutat (2014)",
    alphagenome: "Google DeepMind (2024) & ClinGen SVI Bayesian Recommendation (Pejaver et al. 2022)"
  }
};

export const THRESHOLDS = {
  dbscsnv: {
    /** dbscSNV ADA/RF score ≥ 0.60 → high probability of altering splicing */
    spliceAltering: 0.6,
  },
  revel: {
    /** REVEL ≥ 0.75 → PP3 (Strong) per ClinGen SVI recommendation (Ioannidis et al. 2016) */
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
  thermompnn: {
    /** ΔΔG° ≥ 1.0 kcal/mol: predicted destabilization (ThermoMPNN ΔΔG = mutant - WT) */
    destabilizing: 1.0,
  },
  rasp: {
    /** ΔΔG ≥ 1.0 kcal/mol: predicted destabilization */
    destabilizing: 1.0,
  },
  stabilityoracle: {
    /** ΔΔG ≥ 1.0 kcal/mol: predicted destabilization */
    destabilizing: 1.0,
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
  gpnStar: {
    pathogenic: -2.5,
    benign: 0.0,
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
    benign: -1.0,
    /** 0 to 1 normalized scale cutoffs */
    pathogenicNormalized: 0.75,
    benignNormalized: 0.25,
  },
  eve: {
    severePathogenic: -5.056,
    pathogenic: -4.617,
    pathogenicSupporting: -2.0,
    benignLlr: -1.0,
    benign: -1.0,
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
  biophysicalConsensus: {
    highRiskProbability: 0.42,
    moderateRiskProbability: 0.20,
  },
  alphagenome: {
    /** ClinGen SVI-calibrated AVI Phred cut-points (DeepMind 2024 / Tavtigian 2018) */
    pathogenicStrong: 35.0,
    pathogenicModerate: 25.0,
    pathogenicSupporting: 15.0,
    pathogenic: 15.0,
    benign: 8.0,
    benignModerate: 5.0,
  },
} as const;

export const LOCAL_STRUCTURAL_WINDOW = 5;


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
  thermompnn:
    "ThermoMPNN (Pei 2024 / Tamarind Bio). Destabilizing ΔΔG ≥ +1.0 kcal/mol (ΔΔG = mutant - WT).",
  bayesdel:
    "BayesDel (noAF, Feng 2021). PP3 supporting ≥ 0.133, BP4 supporting ≤ -0.0404.",
  vesm:
    "VESM-150M (Ntranos Lab 2024). Co-distilled lightweight LM compressing ESM-2 and ESM-3 representations, fine-tuned on ProteinGym. Informational only.",
  esm:
    "ESM-1b (Brandes et al. 2023, Nature Genetics; score ≤ -7.5 pathogenic, ≥ -5.0 benign).",
  esm1b:
    "ESM-1b (Brandes et al. 2023, Nature Genetics; score ≤ -7.5 pathogenic, ≥ -5.0 benign).",
  esm2:
    "ESM-2 (Meta FAIR, Lin et al. 2023 Science). Evolutionary scale masked protein language model.",
  gpnStar:
    "GPN-Star (Song Lab, bioRxiv 2025). Phylogeny-aware zero-shot LLR across 100+ vertebrate alignments. Severe evolutionary constraint LLR < -2.5 (Pathogenic Prior); Tolerated LLR ≥ 0.0.",
  metaRnn:
    "MetaRNN (dbNSFP, score ≥ 0.5 deleterious).",
  clinPred:
    "ClinPred (dbNSFP, score ≥ 0.5 deleterious).",
  eigen:
    "Eigen (coding Phred score ≥ 4.0 deleterious).",
  dann:
    "DANN (deep learning score ≥ 0.96 deleterious).",
  popEve:
    "popEVE (Population-calibrated EVE, Nature 2024). Severe pathogenic LLR ≤ -5.056 (99.99% likelihood), " +
    "Moderate pathogenic LLR ≤ -4.617 (99% likelihood), Supporting LLR ≤ -2.0; Benign LLR ≥ -1.0. " +
    "Normalized probability scale: Pathogenic ≥ 0.75, Benign ≤ 0.25.",
  misZ:
    "gnomAD Missense Z-score (positive = depletion of missense variants; strong constraint ≥ 3.09, supporting ≥ 2.0).",
  loeuf:
    "gnomAD LOEUF (observed/expected loss-of-function ratio; severe intolerance < 0.35, moderate < 0.60).",
  alphagenome:
    "AlphaGenome Variant Impact (Google DeepMind 2024). Whole-genome multimodal foundation model. " +
    "ClinGen SVI-calibrated cutoffs: PP3 strong Phred ≥ 35.0, moderate ≥ 25.0, supporting ≥ 15.0; " +
    "BP4 supporting Phred ≤ 8.0, moderate ≤ 5.0.",
};

export type PredictorSignal = "pathogenic" | "benign" | "vus" | "unavailable";

export function evaluateAlphaGenomeAvi(
  alphagenome?: {
    aviPhred?: number | null;
    acmgStrength?: string | null;
  } | null
): PredictorSignal {
  if (!alphagenome) return "unavailable";
  const phred = alphagenome.aviPhred;
  if (phred === null || phred === undefined || isNaN(phred) || phred < 0) return "unavailable";
  if (phred >= THRESHOLDS.alphagenome.pathogenicSupporting) return "pathogenic";
  if (phred <= THRESHOLDS.alphagenome.benign) return "benign";
  return "vus";
}

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
  // ESM-2 3B, ESM-C, and SaProt 650M do not have peer-reviewed clinical classification thresholds,
  // so they are treated as purely informational VUS signals.
  if (llr === null || llr === undefined) return "unavailable";
  return "vus";
}

export function evaluateEsm1b(llr: number | null | undefined): PredictorSignal {
  // ESM-1b clinical thresholds sourced from Brandes et al., 2023 (Nature Genetics)
  if (llr === null || llr === undefined) return "unavailable";
  if (llr <= THRESHOLDS.esm1b.pathogenic) return "pathogenic";
  if (llr >= THRESHOLDS.esm1b.benign) return "benign";
  return "vus";
}

export function evaluateGpnStar(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score <= THRESHOLDS.gpnStar.pathogenic) return "pathogenic";
  if (score >= THRESHOLDS.gpnStar.benign) return "benign";
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

export function evaluateSplicePredictor(
  spliceProximity?: { distance: number; isNearSpliceSite: boolean } | null,
  spliceai?: { ds_ag: number | null; ds_al: number | null; ds_dg: number | null; ds_dl: number | null; max_ds: number | null } | null,
  dbscsnv?: { ada_score: number | null; rf_score: number | null } | null
): PredictorSignal {
  const isNear = spliceProximity?.isNearSpliceSite ?? false;
  const maxDs = spliceai?.max_ds ?? 0;
  const isSpliceAIPathogenic = maxDs >= 0.10;
  const isDbscsnvPathogenic = (dbscsnv?.ada_score != null && dbscsnv.ada_score >= THRESHOLDS.dbscsnv.spliceAltering) ||
                             (dbscsnv?.rf_score != null && dbscsnv.rf_score >= THRESHOLDS.dbscsnv.spliceAltering);

  if (isNear || isSpliceAIPathogenic || isDbscsnvPathogenic) {
    return "pathogenic";
  }

  if ((spliceProximity === undefined || spliceProximity === null) &&
      (spliceai === undefined || spliceai === null) &&
      (dbscsnv === undefined || dbscsnv === null)) {
    return "unavailable";
  }

  const dist = spliceProximity?.distance ?? Infinity;
  const hasSpliceAI = spliceai?.max_ds != null;
  const isSpliceAIBenign = hasSpliceAI ? (spliceai!.max_ds! <= 0.02) : null;

  const hasDbscsnv = dbscsnv?.ada_score != null || dbscsnv?.rf_score != null;
  const isDbscsnvBenign = hasDbscsnv
    ? ((dbscsnv?.ada_score ?? 0) < THRESHOLDS.dbscsnv.spliceAltering && (dbscsnv?.rf_score ?? 0) < THRESHOLDS.dbscsnv.spliceAltering)
    : null;

  if (dist > 10 && isSpliceAIBenign !== false && isDbscsnvBenign !== false
      && (isSpliceAIBenign === true || isDbscsnvBenign === true)) {
    return "benign";
  }

  if (isSpliceAIBenign === null && isDbscsnvBenign === null) {
    return "unavailable";
  }

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
    esm2Llr?: number | null;
    saprotLlr?: number | null;
    vesmLlr?: number | null;
    gpnStar?: number | null;
    spliceProximity?: { distance: number; isNearSpliceSite: boolean } | null;
    spliceai?: { ds_ag: number | null; ds_al: number | null; ds_dg: number | null; ds_dl: number | null; max_ds: number | null } | null;
    dbscsnv?: { ada_score: number | null; rf_score: number | null } | null;
    alphagenome?: AlphaGenomeAviData | null;
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
      key: "splice",
      name: "Splicing",
      signal: evaluateSplicePredictor(extra?.spliceProximity, extra?.spliceai, extra?.dbscsnv),
      scoreLabel: (() => {
        const prox = extra?.spliceProximity;
        const sai = extra?.spliceai;
        const dbsc = extra?.dbscsnv;
        if (!prox && !sai && !dbsc) return "—";
        let parts: string[] = [];
        if (prox) parts.push(`${prox.distance} bp`);
        if (sai && sai.max_ds !== null) parts.push(`SpliceAI: ${sai.max_ds.toFixed(2)}`);
        if (dbsc && (dbsc.ada_score != null || dbsc.rf_score != null)) {
          const maxDbsc = Math.max(dbsc.ada_score ?? 0, dbsc.rf_score ?? 0);
          parts.push(`dbscSNV: ${maxDbsc.toFixed(2)}`);
        }
        return parts.length > 0 ? parts.join(" ") : "—";
      })()
    },
    {
      key: "alphagenome",
      name: "AlphaGenome",
      signal: evaluateAlphaGenomeAvi(extra?.alphagenome),
      scoreLabel: extra?.alphagenome?.aviPhred !== null && extra?.alphagenome?.aviPhred !== undefined
        ? `${extra.alphagenome.aviPhred.toFixed(1)} Phred`
        : "—",
      isInformationalOnly: false,
    },
    {
      key: "esm",
      name: "ESM-1b",
      signal: evaluateEsm1b(esmLlr),
      scoreLabel: esmLlr !== null && esmLlr !== undefined ? `${esmLlr.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
    {
      key: "vesm",
      name: "VESM-150M",
      signal: evaluateEsm(extra?.vesmLlr),
      scoreLabel: extra?.vesmLlr !== null && extra?.vesmLlr !== undefined ? `${extra.vesmLlr.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
    {
      key: "esm2_3b",
      name: "ESM-2 3B",
      signal: evaluateEsm(extra?.esm2Llr),
      scoreLabel: extra?.esm2Llr !== null && extra?.esm2Llr !== undefined ? `${extra.esm2Llr.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
    {
      key: "saprot",
      name: "SaProt 650M",
      signal: evaluateEsm(extra?.saprotLlr),
      scoreLabel: extra?.saprotLlr !== null && extra?.saprotLlr !== undefined ? `${extra.saprotLlr.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
    {
      key: "gpn_star",
      name: "GPN-Star",
      signal: evaluateGpnStar(extra?.gpnStar),
      scoreLabel: extra?.gpnStar !== null && extra?.gpnStar !== undefined ? `${extra.gpnStar.toFixed(2)}` : "—",
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
      consensusVerdict: "Insufficient Biophysical Data"
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
      consensusVerdict: "Insufficient Biophysical Data"
    };
  }

  const consensusProbability = weightedProbSum / totalWeight;
  const consensusConfMin = weightedLowerSum / totalWeight;
  const consensusConfMax = weightedUpperSum / totalWeight;

  // Probability-based consensus threshold mapping
  let consensusVerdict = "Low Misfolding Risk (Neutral Stability)";
  if (consensusProbability >= THRESHOLDS.biophysicalConsensus.highRiskProbability) {
    consensusVerdict = "High Misfolding Risk (Destabilizing Consensus)";
  } else if (consensusProbability >= THRESHOLDS.biophysicalConsensus.moderateRiskProbability) {
    consensusVerdict = "Moderate Misfolding Risk (Conflicting Stability)";
  }

  // Handle single-predictor fallback label schema
  if (availableCount === 1) {
    if (consensusProbability >= THRESHOLDS.biophysicalConsensus.highRiskProbability) {
      consensusVerdict = "Elevated Misfolding Risk (Single-Tool Estimate)";
    } else {
      consensusVerdict = "Low Misfolding Risk (Single-Tool Estimate)";
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

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
    spliceai: "Jaganathan et al. Cell (2019) & ClinGen SVI Recommendation",
    alphagenome: "Google DeepMind (2024) & ClinGen SVI Bayesian Recommendation (Pejaver et al. 2022)"
  }
};

export const THRESHOLDS = {
  spliceai: {
    /** SpliceAI ΔScore ≥ 0.50: high risk of splice alteration */
    pathogenicHigh: 0.50,
    /** SpliceAI ΔScore ≥ 0.20: moderate risk (PP3 supporting per ClinGen SVI) */
    pathogenicModerate: 0.20,
    pathogenicSupporting: 0.20,
    /** SpliceAI ΔScore ≤ 0.02: minimal / negligible splice alteration risk (BP4) */
    benign: 0.02,
  },
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
  spliceai:
    "SpliceAI (Jaganathan 2019). ΔScore ≥ 0.50 high disruption risk, ≥ 0.20 moderate (PP3 supporting); " +
    "≤ 0.02 benign (BP4). Source: ClinGen SVI Recommendation (2019).",
  dbscsnv:
    "dbscSNV (Jian 2014). ADA/RF ensemble probability ≥ 0.60 indicates splice altering candidate.",
  alphagenome:
    "AlphaGenome Variant Impact (Google DeepMind 2024). Whole-genome multimodal foundation model. " +
    "ClinGen SVI-calibrated cutoffs: PP3 strong Phred ≥ 35.0, moderate ≥ 25.0, supporting ≥ 15.0; " +
    "BP4 supporting Phred ≤ 8.0, moderate ≤ 5.0.",
};

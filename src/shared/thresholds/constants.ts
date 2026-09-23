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
    /**
     * Perijunctional consensus region: ±12 bp (donor -3..+8, acceptor -12..+2).
     *
     * This describes the region dbscSNV is TRAINED over — it is NOT SpliceAI's
     * window. SpliceAI reads ~10,000 bp of flanking context but, per its `-D`
     * parameter, reports delta scores only within 50 bp (default) of a gained or
     * lost splice site. The two must not be presented as one window: doing so
     * implies a coverage limit that does not exist, since 50 bp reporting covers
     * anything inside this ±12 bp region.
     */
    consensusFlankDistance: 12,
    /**
     * Proximity at which a variant is treated as sitting on the invariant splice
     * junction itself, qualifying for PP3/PVS1-style proximity evidence.
     * Single source of truth for BOTH the backend resolver
     * (isNearSpliceSite) and the Splicing tab UI — these drifted apart before.
     */
    proximityCriticalBp: 5,
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

  /**
   * ACMG/AMP population-frequency evidence (PM2 / BS1 / BA1).
   *
   * These are the numbers the RULE ENGINE actually branches on
   * (`server/services/prediction/acmg/criteria.ts` §2). They live here, in the module the server
   * already imports, so the engine and every surface that *describes* the engine read one value.
   *
   * They did not, before: the engine tested BS1 at `> 0.01` (1%) while the Evidence Lineage card
   * printed "MAF > 0.1%" beside it, and the All-of-Us/tab copy said nothing at all. A threshold
   * stated in the provenance panel is a claim about the classifier next to it, so a hand-written
   * copy of it is a claim nothing checks — the same failure mode as the hardcoded genome build
   * this panel used to certify.
   */
  populationFrequency: {
    /** BA1 — stand-alone benign evidence. ACMG/AMP: allele frequency > 5%. */
    standAloneBenign: 0.05,
    /** BS1 — frequency greater than expected for the disorder. Local policy: > 1%. */
    tooCommonForDisorder: 0.01,
    /**
     * PM2 — "extremely low frequency in population databases".
     *
     * Inherited as a CEILING, not a floor: the criterion fires at or BELOW this value. The ceiling
     * is inheritance-aware because a recessive disorder tolerates far more standing variation —
     * 0.01% for dominant/unknown, 0.1% when the gene reads recessive.
     */
    extremelyRare: 0.0001,
    /** PM2 ceiling used when the gene is read as recessive (pLI < {@link recessivePlI}). */
    extremelyRareRecessive: 0.001,
    /** pLI below this is read as recessive, which raises the PM2 ceiling tenfold. */
    recessivePlI: 0.9,
  },

  /**
   * STRING-db association-confidence bands over its combined score.
   *
   * STRING publishes four bands (https://string-db.org/help/getting_started/,
   * Szklarczyk et al. Nucleic Acids Res 2023): low ≥ 0.150, medium ≥ 0.400,
   * high ≥ 0.700, highest ≥ 0.900. Nothing below 0.150 carries a band at all.
   *
   * These live here because the PPI table's row badges and the inspector's tier
   * legend are two descriptions of one classifier. They were not shared before,
   * and the table had no floor: every score under 0.700 was labelled "Medium",
   * so a 0.200 partner — which STRING calls LOW confidence — was reported to the
   * user as medium-confidence evidence of a functional interaction.
   */
  stringDb: {
    /** ≥ 0.900 — highest confidence. */
    highest: 0.9,
    /** ≥ 0.700 — high confidence. */
    high: 0.7,
    /** ≥ 0.400 — medium confidence. */
    medium: 0.4,
    /** ≥ 0.150 — low confidence. Below this STRING assigns no band. */
    low: 0.15,
  },

  /**
   * OpenBind-0 interface binding-affinity cut-points (ΔΔG_bind, kcal/mol).
   *
   * The server uses these two numbers to fall back to a classification when the
   * model returns none (`japanfold-client.ts`), and the PPI tab used the same two
   * numbers again to colour the value. Two hand-written copies of one classifier:
   * changing either alone makes the chip's word disagree with the value beside it.
   * Declared here so both read one pair.
   */
  openBind: {
    /** ΔΔG ≥ 1.5 — complex docking is disrupted. */
    disruptive: 1.5,
    /** ΔΔG ≥ 0.5 — allosteric perturbation of the interface. */
    allosteric: 0.5,
  },
} as const;

export const LOCAL_STRUCTURAL_WINDOW = 5;

/**
 * STRING confidence bands, strongest first — the single ordered list the PPI
 * table's row badges and the inspector's tier legend both render from, so a
 * legend can never describe bands the rows do not use.
 *
 * `label` is the word STRING itself prints for the band, and is display copy:
 * "Highest", not "≥ 0.900".
 */
export const STRING_CONFIDENCE_BANDS = [
  { id: "highest", min: THRESHOLDS.stringDb.highest, label: "Highest" },
  { id: "high", min: THRESHOLDS.stringDb.high, label: "High" },
  { id: "medium", min: THRESHOLDS.stringDb.medium, label: "Medium" },
  { id: "low", min: THRESHOLDS.stringDb.low, label: "Low" },
] as const;

export type StringConfidenceBandId = (typeof STRING_CONFIDENCE_BANDS)[number]["id"];

/**
 * The band boundaries that sit BETWEEN two bands — the three scores the strength
 * rail draws a tick at.
 *
 * Named here rather than derived with `slice(0, -1)`, which produced the right
 * answer only because the band list happens to be ordered strongest-first with
 * the lowest band last: dropping the `low` band would have silently removed the
 * 0.400 boundary instead of the 0.150 floor, leaving the rail looking correct.
 *
 * 0.150 is deliberately absent: it is the floor below which STRING assigns no
 * band at all, and the table says "Unclassified" there rather than drawing a
 * fourth band edge on the rail.
 */
export const STRING_CONFIDENCE_CUTS = [
  { id: "highest", min: THRESHOLDS.stringDb.highest },
  { id: "high", min: THRESHOLDS.stringDb.high },
  { id: "medium", min: THRESHOLDS.stringDb.medium },
] as const;

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
    "≤ 0.02 benign (BP4). Consensus splice region flank: ±12 bp. Source: ClinGen SVI Recommendation (2019).",
  dbscsnv:
    "dbscSNV (Jian 2014). ADA/RF ensemble probability ≥ 0.60 indicates splice altering candidate.",
  alphagenome:
    "AlphaGenome Variant Impact (Google DeepMind 2024). Whole-genome multimodal foundation model. " +
    "ClinGen SVI-calibrated cutoffs: PP3 strong Phred ≥ 35.0, moderate ≥ 25.0, supporting ≥ 15.0; " +
    "BP4 supporting Phred ≤ 8.0, moderate ≤ 5.0.",
  stringDb:
    "STRING-db combined association score (Szklarczyk et al. Nucleic Acids Res 2023). " +
    "Confidence bands: highest ≥ 0.900, high ≥ 0.700, medium ≥ 0.400, low ≥ 0.150. " +
    "A functional association is not a physical interaction — co-expression and shared-pathway " +
    "evidence contribute to the score alongside direct binding evidence.",
};

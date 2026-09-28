/**
 * THRESHOLDS_METADATA — Audit and citation metadata for predictor cut-points (P3-2).
 */
export const THRESHOLDS_METADATA = {
  lastReviewed: "2026-07-22",
  citations: {
    revel: "Ioannidis et al. Am J Hum Genet (2016); PP3/BP4 bands: Pejaver et al. Am J Hum Genet (2022)",
    alphaMissense: "Cheng et al. Science (2023); PP3/BP4 bands: Bergquist et al. Genet Med (2025)",
    cadd: "Rentzsch et al. Nucleic Acids Res (2019); PP3/BP4 bands: Pejaver et al. Am J Hum Genet (2022)",
    foldxDdG: "Schymkowitz et al. Nucleic Acids Res (2005)",
    popEVE: "Orenbuch et al. Nat Genet (2025)",
    dbscsnv: "Jian et al. Hum Mutat (2014)",
    spliceai: "Jaganathan et al. Cell (2019) & ClinGen SVI Recommendation",
    alphagenome: "Avsec et al., AlphaGenome (Google DeepMind, 2025). AVI bands are app-defined, not ClinGen-calibrated"
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
  /**
   * REVEL, CADD and AlphaMissense display bands for the residue landscape heatmaps ONLY.
   *
   * These are colour breaks, not ACMG evidence. The PP3/BP4 evaluators read the published bands in
   * `calibration.ts` (Pejaver 2022, Bergquist 2025). The names below are kept so the heatmaps keep
   * their colours; their old comments called them "ClinGen SVI" cut-points, which they are not
   * (ClinGen's REVEL Strong band starts at 0.932, CADD reaches Moderate at most).
   */
  revel: {
    /** Heatmap colour break (Ioannidis 2016 discussed 0.5 / 0.75 as operating points). */
    pathogenicStrong: 0.75,
    pathogenicSupporting: 0.50,
    benign: 0.15,
  },

  cadd: {
    /** Heatmap colour breaks only — see the note above `revel`. */
    pathogenicStrong: 25,
    pathogenicSupporting: 20,
    benign: 10,
    /** UI display moderate band */
    moderate: 15,
  },

  alphaMissense: {
    /**
     * Heatmap colour breaks only. 0.34 / 0.564 are AlphaMissense's own class boundaries (Cheng et
     * al. 2023); 0.983 / 0.063 have no published source. ClinGen's calibrated bands (Bergquist 2025:
     * PP3 ≥ 0.792, BP4 ≤ 0.169) live in `calibration.ts`.
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
  /** Retained for legacy readers; no evaluator uses it. ESM-family scores other than ESM1b are uncalibrated. */
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
  /** Brandes et al. 2023 operating point (−7.5). The PP3/BP4 evaluator reads Bergquist 2025 in `calibration.ts`. */
  esm1b: {
    pathogenic: -7.5,
    benign: -5.0,
  },
  /** Local cut-points — GPN-Star publishes none. Informational only. */
  gpnStar: {
    pathogenic: -2.5,
    benign: 0.0,
  },
  /**
   * popEVE (Orenbuch et al., Nat Genet 2025). The authors publish two cut-points, both on the
   * deleterious side: ≤ −5.056 "highly deleterious" (99.99% posterior) and ≤ −4.617 "moderately
   * deleterious" (99%). There is no published benign cut-point.
   *
   * `pathogenicSupporting` (−2.0), `benignLlr`/`benign` (−1.0) and the 0–1 `…Normalized` pair had no
   * source and are no longer read by any evaluator; they remain only so an old import still compiles.
   */
  popEve: {
    severePathogenic: -5.056,
    pathogenic: -4.617,
    /** @deprecated unsourced — not read by any evaluator. */
    pathogenicSupporting: -2.0,
    /** @deprecated unsourced — not read by any evaluator. */
    benignLlr: -1.0,
    /** @deprecated unsourced — not read by any evaluator. */
    benign: -1.0,
    /** @deprecated unsourced — not read by any evaluator. */
    pathogenicNormalized: 0.75,
    /** @deprecated unsourced — not read by any evaluator. */
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
    /**
     * App-defined bands on the AVI rank-Phred (−10·log10 of the tail quantile). NOT a ClinGen
     * calibration — none exists for AlphaGenome — and no longer read by the PP3/BP4 vote or the
     * engine's strength. The AlphaGenome tab still uses them to shade its own track view.
     */
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
    /**
     * Minimum allele number for an ancestry group to contribute to `groupMaxAF`.
     *
     * This is a DATA-QUALITY floor the server's gnomAD query applies
     * (`external-api/gnomad.ts`), not an ACMG cut-point — but the UI describes it ("at least 2,000
     * alleles observed"), and a number stated in two places is a number that drifts in two places.
     * It lives here so the server filters on it and the surface reads it from one declaration.
     */
    groupMinAn: 2000,
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
    "REVEL (Ioannidis 2016). ClinGen PP3/BP4 bands (Pejaver 2022): PP3 supporting ≥ 0.644, moderate ≥ 0.773, strong ≥ 0.932; " +
    "BP4 supporting ≤ 0.290, moderate ≤ 0.183, strong ≤ 0.016, very strong ≤ 0.003.",
  cadd:
    "CADD PHRED (Rentzsch 2019). ClinGen PP3/BP4 bands (Pejaver 2022): PP3 supporting ≥ 25.3, moderate ≥ 28.1 (no strong band); " +
    "BP4 supporting ≤ 22.7, moderate ≤ 17.3, strong ≤ 0.15. Genome-wide model: its features include conservation.",
  alphaMissense:
    "AlphaMissense (Cheng 2023). ClinGen PP3/BP4 bands (Bergquist 2025): PP3 supporting ≥ 0.792, moderate ≥ 0.906, strong ≥ 0.990; " +
    "BP4 supporting ≤ 0.169, moderate ≤ 0.099. The authors' own classes (likely benign < 0.34, likely pathogenic > 0.564) are not a calibration.",
  foldxDdG:
    "FoldX BuildModel ΔΔG (Schymkowitz 2005). Destabilizing > 1.5 kcal/mol (strong). " +
    "NOTE: Destabilization ≠ Pathogenicity. GOF/neomorphic/gain-of-interaction variants " +
    "may be pathogenic without destabilization.",
  gerp:
    "GERP++ RS (Davydov 2010). Conservation, not pathogenicity. ClinGen bands (Pejaver 2022): no PP3 band; BP4 supporting ≤ 2.70, moderate ≤ −4.54.",
  phylop:
    "phyloP (Pollard 2010). Conservation, not pathogenicity. ClinGen bands (Pejaver 2022): PP3 supporting ≥ 7.367, moderate ≥ 9.741; BP4 supporting ≤ 1.879, moderate ≤ 0.021.",
  dynamut2:
    "DynaMut2 (Rodrigues 2021). Destabilizing ΔΔG ≤ -1.0 kcal/mol.",
  ddmut:
    "DDMut (BioSig 2022). Destabilizing ΔΔG ≤ -1.0 kcal/mol.",
  thermompnn:
    "ThermoMPNN (Pei 2024 / Tamarind Bio). Destabilizing ΔΔG ≥ +1.0 kcal/mol (ΔΔG = mutant - WT).",
  bayesdel:
    "BayesDel without allele frequency (Feng 2017). ClinGen PP3/BP4 bands (Pejaver 2022): PP3 supporting ≥ 0.13, moderate ≥ 0.27, strong ≥ 0.50; " +
    "BP4 supporting ≤ −0.18, moderate ≤ −0.36.",
  vesm:
    "VESM (Ntranos lab, UCSF). A compact protein language model distilled from the ESM family. No published clinical cut-point — informational only.",
  esm:
    "ESM1b log-likelihood ratio (Brandes 2023). ClinGen PP3/BP4 bands (Bergquist 2025): PP3 supporting ≤ −10.7, moderate ≤ −12.2, strong ≤ −24.0; BP4 supporting ≥ −6.3, moderate ≥ −3.1. Informational in the vote.",
  esm1b:
    "ESM1b log-likelihood ratio (Brandes 2023). ClinGen PP3/BP4 bands (Bergquist 2025): PP3 supporting ≤ −10.7, moderate ≤ −12.2, strong ≤ −24.0; BP4 supporting ≥ −6.3, moderate ≥ −3.1. Informational in the vote.",
  esm2:
    "ESM-2 (Meta FAIR, Lin et al. 2023 Science). Evolutionary scale masked protein language model.",
  gpnStar:
    "GPN-Star (Song lab, bioRxiv 2025). Phylogeny-aware genomic language model LLR over a vertebrate alignment. No published clinical cut-point; the −2.5 / 0.0 marks are local. Informational only.",
  metaRnn:
    "MetaRNN (Li 2022). Authors' cut: ≥ 0.5 deleterious. Not ClinGen-calibrated; trained on ClinVar and uses gnomAD allele frequency as a feature.",
  clinPred:
    "ClinPred (Alirezaie 2018). Authors' cut: ≥ 0.5 pathogenic. Not ClinGen-calibrated; trained on ClinVar and uses gnomAD allele frequency as a feature.",
  eigen:
    "Eigen (Ionita-Laza 2016). Unsupervised genome-wide functional score. No published clinical cut-point — informational only.",
  dann:
    "DANN (Quang 2015). Genome-wide deep-network score trained on the CADD data set. No published clinical cut-point — informational only.",
  popEve:
    "popEVE (Orenbuch 2025, Nat Genet). EVE + ESM-1v, placed on one proteome-wide scale with human population data. " +
    "Authors' cut-points: ≤ −5.056 highly deleterious, ≤ −4.617 moderately deleterious. No benign cut-point is published.",
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
    "AlphaGenome variant impact (Google DeepMind 2025). The AVI Phred is −10·log10 of the variant's tail quantile — a rank, " +
    "not a calibrated probability. Its features include AlphaMissense and conservation. No ClinGen calibration exists; informational only.",
  stringDb:
    "STRING-db combined association score (Szklarczyk et al. Nucleic Acids Res 2023). " +
    "Confidence bands: highest ≥ 0.900, high ≥ 0.700, medium ≥ 0.400, low ≥ 0.150. " +
    "A functional association is not a physical interaction — co-expression and shared-pathway " +
    "evidence contribute to the score alongside direct binding evidence.",
};

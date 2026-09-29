/**
 * THRESHOLDS_METADATA — Audit and citation metadata for predictor cut-points (P3-2).
 */
export const THRESHOLDS_METADATA = {
  lastReviewed: "2026-07-22",
  citations: {
    revel: "Ioannidis et al. Am J Hum Genet (2016); PP3/BP4 bands: Pejaver et al. Am J Hum Genet (2022)",
    alphaMissense: "Cheng et al. Science (2023); PP3/BP4 bands: Bergquist et al. Genet Med (2025)",
    cadd: "Rentzsch et al. Nucleic Acids Res (2019); PP3/BP4 bands: Pejaver et al. Am J Hum Genet (2022)",
    foldxDdG: "Schymkowitz et al. Nucleic Acids Res (2005) — force field only; the 0.5 / 1.5 kcal/mol marks are local (FoldX publishes no threshold)",
    popEVE: "Orenbuch et al. Nat Genet (2025)",
    dbscsnv: "Jian et al. Nucleic Acids Res (2014) — authors' cut-point 0.6, not ClinGen-calibrated",
    spliceai: "Jaganathan et al. Cell (2019); splicing PP3/BP4 bands: Walker et al. Am J Hum Genet (2023), ClinGen SVI Splicing Subgroup",
    alphagenome: "Avsec et al., AlphaGenome (Google DeepMind, 2025). AVI bands are app-defined, not ClinGen-calibrated"
  }
};

export const THRESHOLDS = {
  spliceai: {
    /**
     * ClinGen SVI Splicing Subgroup (Walker et al. 2023, doi:10.1016/j.ajhg.2023.06.002): SpliceAI
     * max delta score ≥ 0.2 supports PP3 for predicted splicing impact; a score below 0.1 supports
     * BP4 (and BP7). Verified 2026-09 against the ClinGen Criteria Specification Registry text that
     * cites Walker 2023 ("a score equal to or >0.2" / "based on a score <0.1"); the paper's own
     * full text could not be fetched in that review. Between the two, neither criterion.
     *
     * These replaced `pathogenicSupporting: 0.20` / `benign: 0.02`. The 0.02 was cited to a "ClinGen
     * SVI Recommendation (2019)" that does not exist; it made BP4 five times harder to reach than
     * the published rule and called 0.02–0.1 "low disruption risk" instead of a BP4 reading.
     */
    splicingPp3: 0.2,
    /** BP4 needs a score strictly BELOW this (Walker 2023, as quoted by the ClinGen registry: "<0.1"). */
    splicingBp4Below: 0.1,
    /**
     * The authors' characterised operating points (Jaganathan 2019; Illumina SpliceAI README: "0.2
     * (high recall), 0.5 (recommended), and 0.8 (high precision)"). Drawn as the authors' ticks —
     * they are not ACMG strengths and nothing tests a criterion against them.
     */
    authorsHighRecall: 0.2,
    authorsRecommended: 0.5,
    authorsHighPrecision: 0.8,
    /**
     * Distance from an exon/intron boundary (resolver units: 0 = the boundary exonic base, 1 = the
     * first intronic base) at or below which the resolver sets `isNearSpliceSite`.
     *
     * APP-DEFINED. It is a proximity flag for the resolver and the Insights banner, not evidence:
     * no ACMG/ClinGen rule applies PP3 for distance alone. It previously made the splicing
     * "verdict" pathogenic on its own and was drawn as a red "critical junction zone".
     */
    proximityCriticalBp: 5,
  },
  dbscsnv: {
    /**
     * dbscSNV ADA/RF: the authors' cut-point (Jian et al., Nucleic Acids Res 2014;42:13534,
     * doi:10.1093/nar/gku1206 — "a cutoff value of 0.6"). Not ClinGen-calibrated; displayed as the
     * authors' reading, never as PP3.
     */
    spliceAltering: 0.6,
    /**
     * The consensus regions dbscSNV is defined over (Jian 2014): −3 to +8 at the 5′ (donor) splice
     * site and −12 to +2 at the 3′ (acceptor) splice site, in HGVS splice-site positions (exonic
     * bases negative at the donor and positive at the acceptor; no position 0).
     *
     * This replaced a symmetric "±12 bp consensus flank", which called an exonic variant 5 bp from
     * an acceptor "inside the consensus flank" when dbscSNV's acceptor window reaches only 2 exonic
     * bases.
     */
    window: {
      donor: { exonic: 3, intronic: 8 },
      acceptor: { exonic: 2, intronic: 12 },
    },
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
    /**
     * FoldX van der Waals clash-term delta > 2.0 kcal/mol → flagged as a steric clash.
     * APP-DEFINED reading mark: FoldX publishes no cut-point for this single term, and it is one
     * component of ΔΔG, not a stability estimate. Surfaces must draw it dashed and call it local.
     */
    significantClash: 2.0,
  },
  esm3Drift: {
    /**
     * Bands over the maximum per-residue cosine distance between wild-type and mutant ESM3
     * sequence embeddings (server/services/external-api/esm3_forge.ts). APP-DEFINED, unsourced:
     * below `none` → "none", below `minor` → "minor", below `moderate` → "moderate", else "major".
     * Previously literals in the server, where the tab could not show them.
     */
    none: 0.08,
    minor: 0.22,
    moderate: 0.38,
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
  // `esm` (-5.0 / -2.0) and `esm1b` (-7.5 / -5.0) were removed: nothing read them, the -5.0/-2.0 pair
  // was published for no model, and -7.5 is Brandes 2023's own operating point. ESM1b's PP3/BP4
  // bands are in `calibration.ts` (Bergquist 2025); every other ESM-family LLR is uncalibrated.
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
  /**
   * The engine's PP2 rule (`gnomad.ts` → `criteria.ts` §3): a gene is read as missense-constrained
   * when gnomAD's missense Z ≥ 3.09 AND observed/expected missense < 0.6. APP-DEFINED proxy for
   * ACMG's "low rate of benign missense variation" — ClinGen publishes no genome-wide cut. The
   * Threshold Guide used to show PP2 at Z ≥ 2.0 with a "strong ≥ 3.09" tier (PP2 has no Strong
   * strength) and BP1 for anything below 2.0: neither was the rule the engine ran.
   */
  pp2Constraint: {
    missenseZ: 3.09,
    oeMisBelow: 0.6,
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

  /**
   * Complex-prediction interface confidence (ipTM), read on the Multimer assembly tab.
   *
   * AUTHORS' GUIDANCE, NOT A CALIBRATION. EMBL-EBI's AlphaFold course ("Confidence scores in
   * AlphaFold-Multimer"): "Values higher than 0.8 represent confident high-quality predictions",
   * "values below 0.6 suggest likely a failed prediction", and 0.6–0.8 "are a grey zone where
   * predictions could be correct or wrong". The tab's model is Boltz-2, which reports ipTM on the
   * same scale but publishes no cut-points of its own, so the surface labels these as AlphaFold's.
   * The previous rail printed "ipTM ≥ 0.80 indicates high-confidence" with no source and coloured
   * every ipTM green, 0.3 included.
   */
  complexConfidence: {
    /** ipTM > 0.8 — confident interface. */
    iptmConfident: 0.8,
    /** ipTM < 0.6 — likely a failed prediction. */
    iptmLow: 0.6,
  },
} as const;

/**
 * ±residues around the variant over which per-residue Cα displacements, and the "local" Cα RMSD, are
 * reported (`structural-diff/aligner.ts`). The 3D inspector printed "±15 residue" beside this ±5
 * number; the 15 is {@link LOCAL_ALIGNMENT_FIT_WINDOW}, a different quantity.
 */
export const LOCAL_STRUCTURAL_WINDOW = 5;

/**
 * ±residues whose Cα atoms fit the Kabsch superposition when the alignment scope is "local". It was a
 * literal in the aligner and a second literal in the toolbar tooltip. The local RMSD
 * ({@link LOCAL_STRUCTURAL_WINDOW}) sits INSIDE this fitted window, so under a local fit it is small
 * by construction and says little about the mutation.
 */
export const LOCAL_ALIGNMENT_FIT_WINDOW = 15;

/**
 * Colour bands of the 3D view, each with its provenance. The Mol* themes and the on-canvas legend
 * both read these, so what is drawn and what the key says cannot drift apart.
 */
export const STRUCTURE_COLOUR_BANDS = {
  /**
   * PUBLISHED. AlphaFold DB's pLDDT bands and colours (Jumper et al. 2021; Varadi et al. 2022):
   * very high > 90, confident 70–90, low 50–70, very low < 50. The edges are exclusive below, as in
   * Mol*'s own pLDDT theme: a value must EXCEED `min` (exactly 90 is "confident", exactly 50 "very low").
   */
  plddt: [
    { min: 90, label: "Very high", range: "> 90", color: 0x0053d6 },
    { min: 70, label: "Confident", range: "70–90", color: 0x65cbf3 },
    { min: 50, label: "Low", range: "50–70", color: 0xffdb13 },
    { min: -Infinity, label: "Very low", range: "≤ 50", color: 0xff7d45 },
  ],
  /**
   * RELATIVE, not a cut-point. Crystallographic B-factors depend on resolution, refinement and
   * crystal packing, so absolute B values are not comparable between entries (Sun et al. 2019,
   * Chem Rev). The theme colours each atom by the quartile of ITS OWN entry's Cα B-factors. The old
   * theme banded raw B at 20/40/60 Å² with no source.
   */
  bFactorQuartile: [
    { label: "Lowest quarter", color: 0x3f5f8a },
    { label: "Second quarter", color: 0x8aa6c1 },
    { label: "Third quarter", color: 0xd9b26a },
    { label: "Highest quarter", color: 0xc4683f },
  ],
  /**
   * APP-DEFINED, unsourced: per-residue Cα displacement after superposition, in Å. Drawn with a
   * dashed key and labelled as this app's own marks.
   */
  displacement: [
    { max: 0.2, label: "< 0.2 Å", color: 0x3b6ea5 },
    { max: 0.5, label: "0.2–0.5 Å", color: 0x7fb0d6 },
    { max: 1.0, label: "0.5–1.0 Å", color: 0xb8c98a },
    { max: 2.5, label: "1.0–2.5 Å", color: 0xe0a458 },
    { max: Infinity, label: "≥ 2.5 Å", color: 0xc4523a },
  ],
  /**
   * ESM3 embedding shift, four steps over the engine's own bands `THRESHOLDS.esm3Drift`
   * (none / minor / moderate / major). The heatmap used to band at 0.05 / 0.15 / 0.35 while the
   * engine classified the same score at 0.08 / 0.22 / 0.38.
   */
  esm3Shift: [0x9fb8cf, 0x8fb996, 0xe0a458, 0xc4523a],
  /** Residues the channel does not cover (no score, outside the model, non-atomic). */
  none: 0xa8a29e,
} as const;

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
    "ThermoMPNN (Dieckhaus et al. PNAS 2024). Local mark: ΔΔG ≥ +1.0 kcal/mol read as destabilising (canonical sign, positive = destabilising). No published clinical cut-point.",
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
    "gnomAD missense Z (positive = fewer missense variants than expected). The engine reads a gene as missense-constrained for PP2 at Z ≥ 3.09 with o/e < 0.6 — a local proxy, not a ClinGen cut-point. Gene-level: the same for every variant in the gene.",
  loeuf:
    "gnomAD LOEUF (upper bound of observed/expected loss-of-function). gnomAD suggests < 0.6 as constrained. Loss-of-function constraint, not missense evidence; no ACMG criterion in this engine reads it.",
  spliceai:
    "SpliceAI (Jaganathan 2019). Splicing PP3 at max ΔScore ≥ 0.20, BP4 below 0.10 (ClinGen SVI Splicing " +
    "Subgroup, Walker 2023). The authors characterise 0.2 (high recall), 0.5 (recommended) and 0.8 (high precision); " +
    "those are operating points, not ACMG strengths. A delta score is not a probability.",
  dbscsnv:
    "dbscSNV (Jian 2014). ADA/RF score ≥ 0.6 is the authors' splice-altering cut-point, defined only within " +
    "−3 to +8 of a donor and −12 to +2 of an acceptor. Not ClinGen-calibrated.",
  alphagenome:
    "AlphaGenome variant impact (Google DeepMind 2025). The AVI Phred is −10·log10 of the variant's tail quantile — a rank, " +
    "not a calibrated probability. Its features include AlphaMissense and conservation. No ClinGen calibration exists; informational only.",
  stringDb:
    "STRING-db combined association score (Szklarczyk et al. Nucleic Acids Res 2023). " +
    "Confidence bands: highest ≥ 0.900, high ≥ 0.700, medium ≥ 0.400, low ≥ 0.150. " +
    "A functional association is not a physical interaction — co-expression and shared-pathway " +
    "evidence contribute to the score alongside direct binding evidence.",
};

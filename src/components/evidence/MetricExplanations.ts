/**
 * MetricExplanations.ts — Static metadata describing each bioinformatics predictor/metric.
 *
 * Extracted from EvidenceDashboardCard.tsx to keep pure data separate from rendering logic.
 * No React imports needed.
 */

export interface MetricExplanation {
  name: string;
  category: string;
  description: string;
  interpretation: string;
  paperTitle: string;
  paperUrl: string;
  architecture?: string;
  modality?: string;
  strengths?: string[];
  weaknesses?: string[];
  provider?: string;
  citation?: string;
}

export const METRIC_EXPLANATIONS: Record<string, MetricExplanation> = {
  gpn_star: {
    name: "GPN-Star",
    category: "Phylogeny-Informed Genomic LM",
    architecture: "Phylogeny-Aware Cross-Attention Transformer (100+ Vertebrate Alignments)",
    modality: "Genomic DNA + Multispecies Whole-Genome Alignments (WGA)",
    description: "Genomic Pretrained Network with Species Trees and Alignment Representation (GPN-Star) integrates explicit phylogenetic trees and multi-species vertebrate alignments to learn evolutionary conservation and substitution constraints directly at nucleotide resolution.",
    interpretation: "Log-likelihood ratio (LLR = log(P(alt)/P(ref))). More negative values mean the alternate base is less expected given the vertebrate alignment. GPN-Star publishes no clinical cut-point; the −2.5 and 0 marks drawn in this app are local reference lines, and the score is informational — it is not counted toward PP3/BP4.",
    strengths: [
      "Top-tier zero-shot classification on ClinVar pathogenic vs. benign variants across both coding and non-coding regions.",
      "Explicitly models phylogenetic branch lengths and species divergence over >400 million years of vertebrate evolution.",
      "Eliminates reference genome bias by cross-attending across all aligned species simultaneously.",
      "Ultra-fast genome-wide lookup availability via precomputed hg38 BigWig/Parquet score tracks."
    ],
    weaknesses: [
      "Operates at the nucleotide alignment level; lacks 3D atomic coordinate modeling or rotamer packing forcefields.",
      "Confidence degrades in genomic loci with low alignment depth or high sequence divergence across vertebrate clades.",
      "Does not directly compute biophysical free energy changes (ΔΔG)."
    ],
    provider: "Song Lab @ UC Berkeley / Hugging Face",
    paperTitle: "Benegas et al. bioRxiv (2025)",
    paperUrl: "https://doi.org/10.1101/2024.11.08.622668",
    citation: "Benegas, G., et al. (2025). Phylogeny-aware genomic language models predict variant effects across vertebrate genomes. bioRxiv."
  },
  vesm: {
    name: "VESM",
    category: "Co-distilled Protein Language Model",
    architecture: "150M Parameter Distilled Transformer (Trained on ESM2-3B + ESM3 representations)",
    modality: "Amino Acid Sequences (Character-Level Protein Alphabet)",
    description: "Variant Effect ESM (VESM) is a co-distilled protein language model that compresses the deep evolutionary representation of massive foundation models (ESM2-3B and ESM3) into a lightweight 150M parameter model specifically fine-tuned on deep mutational scanning (ProteinGym) benchmarks.",
    interpretation: "Log-likelihood ratio (LLR = log(P(mut)/P(wt))). More negative means less expected. VESM publishes no clinical cut-point, so the score is informational and not counted toward PP3/BP4. In this app the same slot is filled by ESMC when the remote tier answers; the card names which model served it.",
    strengths: [
      "Ultra-low latency inference with minimal memory footprint (~150M parameters), suitable for local sidecar execution.",
      "High spearman correlation on ProteinGym deep mutational scanning assays.",
      "Synthesizes cross-entropy representations from both ESM-2 and ESM-3 foundation architectures."
    ],
    weaknesses: [
      "Single-sequence amino acid model (blind to non-coding, transcriptional, or splicing consequences).",
      "No explicit 3D tertiary structure coordinate input (unlike SaProt or FoldX).",
      "Informational research metric; excluded from clinical ACMG concordance voting."
    ],
    provider: "Ntranos lab, UCSF",
    paperTitle: "Dinh et al. Nat Methods (2026)",
    paperUrl: "https://doi.org/10.1038/s41592-026-03050-9",
    citation: "Dinh, T., et al. (2026). Compressing the collective knowledge of ESM into a single protein language model. Nature Methods."
  },
  am: {
    name: "AlphaMissense",
    category: "AI Pathogenicity Predictor",
    architecture: "AlphaFold-derived Transformer with Structural Embeddings & Evolutionary Language Modeling",
    modality: "Protein Sequence + AlphaFold 3D Structural Priors",
    description: "AlphaMissense adapts AlphaFold structural representation learning to predict the pathogenicity of missense variants. It leverages an unsupervised protein language model trained on evolutionary sequences alongside structural embeddings to score candidate substitutions.",
    interpretation: "Scores range from 0 to 1. The authors' classes are likely benign (< 0.34), ambiguous, and likely pathogenic (> 0.564) — classes, not a calibration. ClinGen's calibrated PP3/BP4 bands (Bergquist et al. 2025) are PP3 supporting ≥ 0.792, moderate ≥ 0.906, strong ≥ 0.990; BP4 supporting ≤ 0.169, moderate ≤ 0.099. This app votes on those bands.",
    strengths: [
      "Precomputed across all 216 million possible human single amino acid substitutions with high accuracy.",
      "Calibrated by ClinGen for PP3/BP4 (Bergquist et al. 2025), reaching Strong for pathogenicity.",
      "Leverages AlphaFold structural embeddings implicitly in its attention layers."
    ],
    weaknesses: [
      "Restricted strictly to single amino acid missense substitutions (no indels, synonymous, or non-coding variants).",
      "May overestimate deleteriousness in intrinsically disordered or non-globular protein domains.",
      "Does not calculate physical free energy changes (ΔΔG) or identify specific atomic clash mechanisms."
    ],
    provider: "Google DeepMind",
    paperTitle: "Cheng et al. Science (2023)",
    paperUrl: "https://doi.org/10.1126/science.adg7492",
    citation: "Cheng, J., et al. (2023). Accurate proteome-wide missense variant effect prediction with AlphaMissense. Science, 381(6664), eadg7492."
  },
  cadd: {
    name: "CADD PHRED",
    category: "Genomic Annotation Integrator",
    description: "Combined Annotation Dependent Depletion (CADD) is a framework for integrating diverse genomic annotations (conservation, epigenetic, functional) into a single score of relative deleteriousness.",
    interpretation: "PHRED-scaled rank of deleteriousness: ≥ 20 is the top 1% of possible substitutions genome-wide, ≥ 30 the top 0.1%. ClinGen's calibrated bands (Pejaver et al. 2022): PP3 supporting ≥ 25.3, moderate ≥ 28.1 (CADD reaches no Strong band); BP4 supporting ≤ 22.7, moderate ≤ 17.3.",
    paperTitle: "Kircher et al. Nat Genet (2014)",
    paperUrl: "https://doi.org/10.1038/ng.2892"
  },
  revel: {
    name: "REVEL",
    category: "Ensemble Pathogenicity Predictor",
    description: "Rare Exome Variant Ensemble Learner (REVEL) is an ensemble method that integrates pathogenicity predictions from 13 individual in-silico predictors (including SIFT, PolyPhen, MutationTaster, and GERP++).",
    interpretation: "Scores range from 0 to 1. ClinGen's calibrated bands (Pejaver et al. 2022): PP3 supporting ≥ 0.644, moderate ≥ 0.773, strong ≥ 0.932; BP4 supporting ≤ 0.290, moderate ≤ 0.183, strong ≤ 0.016, very strong ≤ 0.003. REVEL has no allele-frequency feature, so it may be combined with PM2/BS1 at these strengths. It is one of the four tools ClinGen names for use on its own.",
    paperTitle: "Ioannidis et al. Am J Hum Genet (2016)",
    paperUrl: "https://doi.org/10.1016/j.ajhg.2016.08.016"
  },
  eve: {
    name: "EVE Model",
    category: "Evolutionary Generative Model",
    description: "Evolutionary Model of Variant Effect (EVE) uses deep generative models (variational autoencoders) trained on evolutionary sequence families to model the fitness landscape and predict pathogenicity.",
    interpretation: "Continuous score from 0 (benign) to 1 (pathogenic), alongside classification classes: 'Benign' (≤ 0.25), 'Uncertain', or 'Pathogenic' (≥ 0.75).",
    paperTitle: "Frazer et al. Nature (2021)",
    paperUrl: "https://doi.org/10.1038/s41586-021-04043-8"
  },
  esm2: {
    name: "ESM-2 Foundation LM",
    category: "Evolutionary Scale Protein Language Model",
    architecture: "650M / 3B Parameter Masked Transformer (UniRef50 Pretrained)",
    modality: "Amino Acid Sequence",
    description: "ESM-2 is a general-purpose protein language model developed by Meta FAIR. It computes zero-shot log-likelihood ratios (LLR) using masked marginals, capturing deep evolutionary conservation and fitness constraints across sequence space.",
    interpretation: "LLR = log(P(mut)/P(wt)); more negative means less expected. ESM-2 has no published clinical cut-point (the −7.5 figure often quoted is ESM1b's, from Brandes et al. 2023), so the score is informational and not counted toward PP3/BP4.",
    paperTitle: "Lin et al. Science (2023)",
    paperUrl: "https://doi.org/10.1126/science.ade2574",
    citation: "Lin, Z., et al. (2023). Evolutionary-scale prediction of atomic-level protein structure with a language model. Science, 379(6637), 1123-1130."
  },
  foldx: {
    name: "FoldX ddG",
    category: "Force-Field Biophysics",
    description: "FoldX uses an empirical atomic force field to estimate the change in free energy (ΔΔG) upon mutation. It performs local sidechain repacking on a rigid backbone approximation of the protein structure.",
    interpretation: "Positive ΔΔG means destabilizing. FoldX publishes no clinical threshold: this app marks ≥ +1.5 kcal/mol as destabilizing and ≥ +0.5 as moderately destabilizing (local marks). The authors recommend RepairPDB before BuildModel. Destabilization is not pathogenicity: gain-of-function variants may be stable.",
    paperTitle: "Schymkowitz et al. Nucleic Acids Res (2005)",
    paperUrl: "https://doi.org/10.1093/nar/gki387"
  },
  dynamut2: {
    name: "DynaMut2",
    category: "Normal Mode Analysis / Machine Learning",
    description: "DynaMut2 predicts stability changes (ΔΔG) by combining normal mode analysis (NMA) metrics of protein flexibility and dynamics (using ENM models) with machine learning models trained on experimental stability data.",
    interpretation: "DynaMut2 reports negative ΔΔG for destabilizing mutations; this app negates it so positive means destabilizing everywhere. The ±1.0 kcal/mol mark is local, not published by the authors.",
    paperTitle: "Rodrigues et al. Protein Science (2021)",
    paperUrl: "https://doi.org/10.1002/pro.3942"
  },
  ddmut: {
    name: "DDMut (Deep Learning)",
    category: "Graph Deep Learning / Transformers",
    description: "DDMut uses a Siamese neural network combining graph-based structural representations, convolutional layers, and Transformer encoders to predict free energy changes (ΔΔG) for single and multiple point mutations.",
    interpretation: "DDMut reports negative ΔΔG for destabilizing mutations; this app negates it so positive means destabilizing. The ±1.0 kcal/mol mark is local. The authors report Pearson r 0.70 and RMSE 1.84 kcal/mol on their SM420 blind test.",
    paperTitle: "Zhou et al. Nucleic Acids Res (2023)",
    paperUrl: "https://doi.org/10.1093/nar/gkad472"
  },
  rasp: {
    name: "RaSP (Rapid Stability Prediction)",
    category: "3D Convolutional Network / Rosetta Surrogate",
    description: "RaSP learns a representation of each residue's 3D environment with a self-supervised convolutional network, then a small supervised network predicts Rosetta cartesian_ddg values from it. It reproduces Rosetta at a fraction of the cost, and inherits Rosetta's errors. This app reads the authors' precomputed values; it does not run RaSP. The default install holds their experimental-structure table (1,345 human proteins); a deployment can add their AlphaFold predictions for the whole proteome (23,391 proteins, UniProt-numbered), which are preferred when both hold a variant.",
    // RaSP is a positive-native engine: a LARGER score means destabilization (see
    // `shared/engineStatus.ts`, whose per-engine cut is +1.0). This rule was previously written
    // with the opposite sign, so this explanation contradicted both the app's own maths and the
    // Energetics tab's copy for the same method.
    interpretation: "Positive ΔΔG means destabilizing. The +1.0 kcal/mol mark is local, not published by the authors. A missing value usually means the protein is outside the bundled table, not that the variant is neutral.",
    paperTitle: "Blaabjerg et al. eLife (2023)",
    paperUrl: "https://doi.org/10.7554/eLife.82593"
  },
  bayesdel: {
    name: "BayesDel (noAF)",
    category: "Meta-Predictor Integration",
    description: "BayesDel is a meta-predictor that integrates multiple individual in-silico tools (including conservation and functional annotations) using a Bayesian approach. We use the version without allele frequency (noAF) to prevent double-counting frequency evidence.",
    interpretation: "ClinGen's calibrated bands for BayesDel without allele frequency (Pejaver et al. 2022): PP3 supporting ≥ 0.13, moderate ≥ 0.27, strong ≥ 0.50; BP4 supporting ≤ −0.18, moderate ≤ −0.36.",
    paperTitle: "Feng. Hum Mutat (2017)",
    paperUrl: "https://doi.org/10.1002/humu.23158"
  },
  rmsd: {
    name: "Sidechain RMSD",
    category: "Structural Packing Deviation",
    description: "Root-Mean-Square Deviation (RMSD) of the mutated sidechain relative to the wildtype conformation. It reflects the degree of local packing adjustments and steric displacement needed to accommodate the mutant residue.",
    interpretation: "Values in Angstroms (Å). RMSD > 1.5 Å indicates substantial conformational repacking or steric displacements, signaling local structural rearrangement.",
    paperTitle: "Guerois et al. J Mol Biol (2002)",
    paperUrl: "https://doi.org/10.1006/jmbi.2002.5729"
  },
  vdw: {
    name: "VdW Clash Delta",
    category: "Steric Interaction Energy",
    description: "Van der Waals (VdW) Clash Delta measures the change in steric repulsion (Lennard-Jones potentials) upon sidechain repacking. It identifies clashes when larger or bulkier residues are introduced into confined spaces.",
    interpretation: "Delta values > 2.0 kcal/mol indicate significant steric clashes, suggesting local backbone distortion may be required to accommodate the mutant residue.",
    paperTitle: "Schymkowitz et al. Nucleic Acids Res (2005)",
    paperUrl: "https://doi.org/10.1093/nar/gki387"
  },
  electrostatics: {
    name: "Electrostatic Delta",
    category: "Coulombic Interaction Energy",
    description: "Electrostatic Delta calculates changes in Coulombic electrostatic interactions (such as salt bridges, hydrogen bonds, and charge-charge interactions) resulting from the mutation.",
    interpretation: "Significant negative/positive deviations indicate disrupted salt bridges or altered local hydrogen bonding networks.",
    paperTitle: "Schymkowitz et al. Nucleic Acids Res (2005)",
    paperUrl: "https://doi.org/10.1093/nar/gki387"
  },
  contact_density: {
    name: "Cα Contact Density",
    category: "Local Structural Density",
    description: "Contact density counts the number of Cα atoms within a 10Å radius of the mutation site, a coordination number that loosely tracks how buried the residue is.",
    interpretation: "A reading only: it does not decide the burial word, which comes from measured solvent accessibility. The app used to band it (≥ 15 core, ≤ 7 surface) with no published source, and those bands called most exposed residues boundary. Chain neighbours alone contribute about six, and buried residues typically have well over fifteen.",
    paperTitle: "Hamelryck. Proteins (2005): half-sphere exposure and coordination number",
    paperUrl: "https://doi.org/10.1002/prot.20379"
  },
  thermompnn: {
    name: "ThermoMPNN",
    category: "Neural Backbone Stability (ProteinMPNN)",
    description: "ThermoMPNN adds a stability head to ProteinMPNN's structure embeddings and is trained on the mega-scale cDNA-display stability dataset (Tsuboyama et al. 2023).",
    interpretation: "Negative ΔΔG means stabilizing (the authors call ΔΔG < −0.5 kcal/mol stabilizing), so positive means destabilizing. The +1.0 kcal/mol destabilizing mark is local.",
    paperTitle: "Dieckhaus et al. PNAS (2024)",
    paperUrl: "https://doi.org/10.1073/pnas.2314853121"
  },
  stabilityoracle: {
    name: "StabilityOracle",
    category: "Graph-Transformer / Structure-Aware ML",
    description: "Stability Oracle is a structure-based graph-transformer that scores a substitution from a single wild-type structure, trained with 'thermodynamic permutation' augmentation. It was built to find stabilizing mutations.",
    interpretation: "Negative ΔΔG means stabilizing (the authors use ΔΔG < −0.5 kcal/mol), so positive means destabilizing. The +1.0 kcal/mol destabilizing mark is local.",
    paperTitle: "Diaz et al. Nat Commun (2024)",
    paperUrl: "https://doi.org/10.1038/s41467-024-49780-2"
  },
  metarnn: {
    name: "MetaRNN",
    category: "Recurrent Neural Network Ensemble",
    description: "MetaRNN integrates 28 deep learning, evolutionary conservation, and structural features using recurrent neural networks (RNN) to model positional inter-dependencies across amino acid sequences.",
    interpretation: "Scores range from 0 to 1; the authors call ≥ 0.5 deleterious. This cut is not ClinGen-calibrated. MetaRNN takes gnomAD allele frequency as a feature and is trained on ClinVar, so its vote overlaps with PM2/BS1 and is partly circular for variants already in ClinVar.",
    paperTitle: "Li et al. Genome Med (2022)",
    paperUrl: "https://doi.org/10.1186/s13073-022-01069-0"
  },
  clinpred: {
    name: "ClinPred",
    category: "Clinical Machine Learning Ensemble",
    description: "ClinPred uses a gradient boosted decision tree classifier trained specifically on ClinVar confirmed pathogenic vs benign variants, incorporating allele frequency alongside multiple in-silico predictors.",
    interpretation: "Scores range from 0 to 1; the authors call ≥ 0.5 pathogenic. This cut is not ClinGen-calibrated. ClinPred uses gnomAD allele frequency as a feature and is trained on ClinVar, so its vote overlaps with PM2/BS1 and is partly circular for variants already in ClinVar.",
    paperTitle: "Alirezaie et al. Am J Hum Genet (2018)",
    paperUrl: "https://doi.org/10.1016/j.ajhg.2018.07.028"
  },
  eigen: {
    name: "Eigen / Eigen-PC",
    category: "Unsupervised Functional Annotation",
    description: "Eigen integrates functional annotations (conservation, functional genomics, chromatin state) without requiring labeled training sets, using spectral decomposition of annotation covariance.",
    interpretation: "PHRED-scaled; higher means more likely functional. Eigen has no published clinical cut-point, so it is informational and not counted toward PP3/BP4.",
    paperTitle: "Ionita-Laza et al. Nat Genet (2016)",
    paperUrl: "https://doi.org/10.1038/ng.3477"
  },
  dann: {
    name: "DANN (Deep Neural Network)",
    category: "Deep Artificial Neural Network",
    description: "DANN trains a deep feed-forward neural network on the same comprehensive feature sets as CADD to capture non-linear annotation relationships.",
    interpretation: "Scores range from 0 to 1; higher means more deleterious. DANN has no published clinical cut-point, so it is informational and not counted toward PP3/BP4.",
    paperTitle: "Quang et al. Bioinformatics (2015)",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btu703"
  },
  spliceai: {
    name: "SpliceAI",
    category: "Deep Residual Splicing Network",
    description: "SpliceAI is a deep residual neural network that predicts, for each position, the probability of being a splice donor or acceptor from 10,000 nt of surrounding sequence (5,000 each side). A variant's delta scores are the change in those probabilities for acceptor gain, acceptor loss, donor gain and donor loss.",
    interpretation: "Delta scores run from 0 to 1 and are changes in probability, not probabilities of disruption. The ClinGen SVI Splicing Subgroup (Walker 2023) applies PP3 for splicing at a max Δ ≥ 0.2 and BP4 below 0.1. The authors characterise 0.2 (high recall), 0.5 (recommended) and 0.8 (high precision) as operating points, not strengths. This app's ACMG engine does not apply splicing criteria.",
    paperTitle: "Jaganathan et al. Cell (2019)",
    paperUrl: "https://doi.org/10.1016/j.cell.2018.12.015"
  },
  dbscsnv: {
    name: "dbscSNV (Ada / RF)",
    category: "Splicing Consensus Ensemble",
    description: "dbscSNV integrates splice site sequence features and multiple regional conservation metrics across splicing consensus regions (-3 to +8 for donor, -12 to +2 for acceptor) using AdaBoost and Random Forest.",
    interpretation: "Scores run from 0 to 1 and exist only inside the consensus regions. The authors' cut-point for a splice-altering prediction is 0.6; it is not ClinGen-calibrated, so this app shows dbscSNV as context and never as PP3.",
    paperTitle: "Jian et al. Nucleic Acids Res (2014)",
    paperUrl: "https://doi.org/10.1093/nar/gku1206"
  },
  popeve: {
    name: "popEVE",
    category: "Proteome-wide Evolutionary Model",
    architecture: "EVE (alignment VAE) and ESM-1v, placed on one proteome-wide scale using human population variation",
    modality: "Multiple sequence alignments + protein language model + human population variants (UK Biobank or gnomAD)",
    description: "popEVE combines two evolutionary models — EVE and ESM-1v — and uses human population data to make scores comparable across genes, so a score can rank variants proteome-wide rather than only within one protein.",
    interpretation: "More negative is more deleterious. The authors publish two cut-points, both deleterious: ≤ −4.617 (moderately deleterious, 99% posterior) and ≤ −5.056 (highly deleterious, 99.99%). No benign cut-point is published, so a score above −4.617 is not a benign call. Not ClinGen-calibrated.",
    strengths: [
      "Scores are comparable across genes, which suits ranking variants in a whole exome.",
      "Enriched in severe developmental-disorder cases at its published thresholds."
    ],
    weaknesses: [
      "Uses human population data in training, so it overlaps in part with frequency evidence.",
      "No benign threshold, and no ClinGen PP3/BP4 calibration."
    ],
    provider: "Marks lab, Harvard Medical School",
    paperTitle: "Orenbuch et al. Nat Genet (2025)",
    paperUrl: "https://doi.org/10.1038/s41588-025-02400-1",
    citation: "Orenbuch, R., et al. (2025). Proteome-wide model for human disease genetics. Nature Genetics 57, 3165–3174."
  },
  saprot: {
    name: "SaProt",
    category: "Structure-Aware Protein Language Model",
    architecture: "35M / 650M Parameter Transformer with Foldseek 3Di Structural Token Interleaving",
    modality: "Amino Acid Sequence + 3D Backbone Foldseek 3Di Tokens (Structure-Sequence Alphabet)",
    description: "Structure-aware Protein Language Model (SaProt) represents protein tertiary folds by encoding both the 20 amino acid sequence and Foldseek 3Di geometric discrete structural tokens into a joint alphabet, enabling simultaneous modeling of sequence evolution and 3D backbone topology.",
    interpretation: "Log-Likelihood Ratio (LLR). Negative values indicate that the mutation is unfavorable in the context of the specific 3D tertiary fold environment.",
    strengths: [
      "Explicitly conditions likelihood predictions on the AlphaFold 3D backbone coordinate conformation.",
      "State-of-the-art zero-shot performance on structure-sensitive deep mutational scanning benchmarks.",
      "Provides both sequence-level and conformation-conditioned perturbation metrics."
    ],
    weaknesses: [
      "Requires accurate 3D backbone PDB structures (AlphaFold/ESMFold/experimental PDB); errors in predicted structure propagate to logits.",
      "Computationally heavier than sequence-only models during tokenization due to Foldseek structure discretization."
    ],
    provider: "Westlake University / Hugging Face",
    paperTitle: "Su et al. bioRxiv / ICLR (2024)",
    paperUrl: "https://doi.org/10.1101/2023.10.01.560349",
    citation: "Su, J., et al. (2024). SaProt: Protein Language Modeling with Structure-aware Vocabulary. bioRxiv / ICLR."
  },
  alphagenome: {
    name: "AlphaGenome AVI",
    category: "Genome-wide Sequence-to-Function Model",
    architecture: "DNA sequence model predicting thousands of functional-genomics tracks from up to 1 Mb of sequence",
    modality: "DNA sequence → RNA-seq, CAGE, PRO-cap, DNase, ATAC, ChIP, splicing, contact maps",
    description: "AlphaGenome predicts functional-genomics tracks from sequence. The AVI score this app shows is a composite of 18 variant features — including AlphaMissense and two conservation tracks — returned by the AlphaGenome service.",
    interpretation: "The AVI Phred is −10·log10(1 − q), where q is the variant's quantile among all ~9 billion possible hg38 SNVs: 20 means the top 1%, 30 the top 0.1%. It is a rank, not a calibrated probability of pathogenicity, and no ClinGen calibration exists. Because AlphaMissense is one of its features, it is informational here and not counted toward PP3/BP4.",
    strengths: [
      "Reaches regulatory and splicing effects that protein-level models cannot see.",
      "Feature attributions show which modality drives the score."
    ],
    weaknesses: [
      "A rank, not a likelihood: a top-percentile score is not evidence of a given strength.",
      "Contains AlphaMissense, so it is not independent of the protein-level tools.",
      "Requires GRCh38 genomic coordinates and a configured service."
    ],
    provider: "Google DeepMind",
    paperTitle: "Avsec et al. bioRxiv (2025)",
    paperUrl: "https://doi.org/10.1101/2025.06.25.661532",
    citation: "Avsec, Ž., et al. (2025). AlphaGenome: advancing regulatory variant effect prediction with a unified DNA sequence model. bioRxiv."
  },
  burial_status: {
    name: "Solvent Accessibility & Burial Status (RSA)",
    category: "Surface Topology & Hydrophobic Core",
    architecture: "Shrake-Rupley / Lee-Richards Rolling Sphere SASA Algorithm",
    modality: "3D Macromolecular Coordinates",
    description: "Calculates the Relative Solvent Accessibility (RSA) of the wild-type residue in the 3D model relative to an extended Gly-X-Gly tripeptide reference conformation using a 1.4Å water probe sphere.",
    interpretation: "Core residues have RSA ≤ 15% (buried, where a polar or charged substitution pays a desolvation cost). Surface residues have RSA ≥ 35% (solvent-exposed). Boundary residues fall between those cutoffs. The cut-points are this app's own, not a published classification, and they are the ones the SASA engine applies. When accessibility is not measured, no burial word is given.",
    strengths: [
      "Gold standard biophysical descriptor for identifying hydrophobic core integrity.",
      "Directly correlates with evolutionary conservation and tolerance to charge alterations."
    ],
    weaknesses: [
      "Sensitive to coordinate resolution, crystal packing artifacts, or flexible loop conformational changes."
    ],
    paperTitle: "Tien et al. PLoS ONE (2013)",
    paperUrl: "https://doi.org/10.1371/journal.pone.0080635"
  },
  p2rank: {
    name: "P2Rank Ligand-Binding Pocket Predictor",
    category: "Machine Learning Cavity Detection",
    architecture: "Random Forest Classifier on Connolly Surface Points",
    modality: "3D Macromolecular Coordinates",
    description: "P2Rank is a template-free machine learning algorithm that identifies and ranks ligand-binding pockets directly from 3D protein structures. It maps chemical and geometric features onto molecular surface points and groups high-probability points into pocket cavities.",
    /*
     * This text is the user-facing legend for the Spatial Classification badge, so
     * it must describe the four values that badge can take and must not re-assert
     * claims the panel itself now qualifies. Corrected from an earlier version
     * that documented only ACTIVE_SITE_PROXIMATE / DISTAL_SURFACE and called the
     * ranking index a "ligand-binding affinity probability".
     */
    interpretation: "Distance is measured from the variant residue to P2Rank's cavity centre, or to the centroid of the pocket's residues when no centre was reported (that quantity grows with pocket size, and the label says which). The app's own bands: lining when the residue is one of P2Rank's pocket residues, within 8 Å, rim within 12 Å, otherwise distal. The probability, from 0 to 1, is P2Rank's estimate that the cavity is a ligand-binding site, calibrated per model profile: it is not an affinity, and values from different profiles are not comparable. Cavity volume is shown only when the engine reported a measured volume; a surface-point count is never presented as a volume.",
    strengths: [
      "Fast, template-free ligand pocket detection directly from coordinate files.",
      "Predicts specific pocket lining residues and distances to cavity centroids."
    ],
    weaknesses: [
      "Depends on accurate 3D apo or holo conformations; large induced-fit motions may alter cavity geometry.",
      "The default model profile uses B-factor as a feature and is intended for X-ray structures. For AlphaFold/ESMFold models (pLDDT in the B-factor column) P2Rank recommends its `-c alphafold` profile, so probability values here may not be optimal for modelled input.",
      "Probability calibration is specific to the model profile, so scores must not be compared across profiles or against other detectors' scores."
    ],
    paperTitle: "Krivak & Hoksza. J Cheminform (2018)",
    paperUrl: "https://doi.org/10.1186/s13321-018-0285-8"
  }
};

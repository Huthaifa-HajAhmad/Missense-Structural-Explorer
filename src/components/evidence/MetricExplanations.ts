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
    interpretation: "Log-likelihood ratio (LLR = log(P(mut)/P(wt))). Highly negative LLR values (< -2.5) indicate intense evolutionary constraint across vertebrate lineages (pathogenic prior). Values close to 0 or positive indicate neutral or tolerated evolutionary substitutions.",
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
    name: "VESM++ (Co-distilled Ensemble)",
    category: "Co-distilled Protein Language Model",
    architecture: "150M Parameter Distilled Transformer (Trained on ESM2-3B + ESM3 representations)",
    modality: "Amino Acid Sequences (Character-Level Protein Alphabet)",
    description: "Variant Effect ESM (VESM) is a co-distilled protein language model that compresses the deep evolutionary representation of massive foundation models (ESM2-3B and ESM3) into a lightweight 150M parameter model specifically fine-tuned on deep mutational scanning (ProteinGym) benchmarks.",
    interpretation: "Log-Likelihood Ratio (LLR = log(P(mut)/P(wt))). LLR ≤ -5.0 indicates significant fitness depletion; ≥ -2.0 indicates tolerated/neutral substitutions. Informational prior.",
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
    provider: "Ntranos Lab / GitHub",
    paperTitle: "Ntranos Lab, bioRxiv (2024)",
    paperUrl: "https://github.com/ntranoslab/vesm",
    citation: "Ntranos Lab (2024). VESM: Co-distilled Variant Effect Language Models for Efficient Fitness Prediction."
  },
  am: {
    name: "AlphaMissense",
    category: "AI Pathogenicity Predictor",
    architecture: "AlphaFold-derived Transformer with Structural Embeddings & Evolutionary Language Modeling",
    modality: "Protein Sequence + AlphaFold 3D Structural Priors",
    description: "AlphaMissense adapts AlphaFold structural representation learning to predict the pathogenicity of missense variants. It leverages an unsupervised protein language model trained on evolutionary sequences alongside structural embeddings to score candidate substitutions.",
    interpretation: "Scores range from 0 (benign) to 1 (pathogenic). Classifications include 'likely_benign' (≤ 0.340), 'uncertain', and 'likely_pathogenic' (≥ 0.564). ClinGen-calibrated thresholds are 0.983 (pathogenic) and 0.063 (benign).",
    strengths: [
      "Precomputed across all 216 million possible human single amino acid substitutions with high accuracy.",
      "Calibrated against curated ClinVar and gnomAD datasets with high area under the ROC curve (AUROC ~0.94).",
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
    interpretation: "PHRED-scaled scores range from 0 to 99. A score ≥ 20 indicates the variant is predicted to be in the top 1% of most deleterious substitutions; ≥ 30 indicates the top 0.1%.",
    paperTitle: "Kircher et al. Nat Genet (2014)",
    paperUrl: "https://doi.org/10.1038/ng.2892"
  },
  revel: {
    name: "REVEL",
    category: "Ensemble Pathogenicity Predictor",
    description: "Rare Exome Variant Ensemble Learner (REVEL) is an ensemble method that integrates pathogenicity predictions from 13 individual in-silico predictors (including SIFT, PolyPhen, MutationTaster, and GERP++).",
    interpretation: "Scores range from 0 to 1. ClinGen SVI guidelines recommend REVEL ≥ 0.75 as strong evidence of pathogenicity (PP3_Strong), and < 0.15 as benign evidence (BP4).",
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
    interpretation: "LLR = log(P(mut)/P(wt)). LLR ≤ -7.5 indicates significant evolutionary depletion; ≥ -5.0 indicates tolerated/neutral substitutions. Informational prior.",
    paperTitle: "Lin et al. Science (2023)",
    paperUrl: "https://doi.org/10.1126/science.ade2574",
    citation: "Lin, Z., et al. (2023). Evolutionary-scale prediction of atomic-level protein structure with a language model. Science, 379(6637), 1123-1130."
  },
  foldx: {
    name: "FoldX ddG",
    category: "Force-Field Biophysics",
    description: "FoldX uses an empirical atomic force field to estimate the change in free energy (ΔΔG) upon mutation. It performs local sidechain repacking on a rigid backbone approximation of the protein structure.",
    interpretation: "ΔΔG > 1.5 kcal/mol indicates strong structural destabilization (high risk of misfolding/degradation). Note that gain-of-function variants may not be destabilizing.",
    paperTitle: "Schymkowitz et al. Nucleic Acids Res (2005)",
    paperUrl: "https://doi.org/10.1093/nar/gki387"
  },
  dynamut2: {
    name: "DynaMut2",
    category: "Normal Mode Analysis / Machine Learning",
    description: "DynaMut2 predicts stability changes (ΔΔG) by combining normal mode analysis (NMA) metrics of protein flexibility and dynamics (using ENM models) with machine learning models trained on experimental stability data.",
    interpretation: "ΔΔG ≤ -1.0 kcal/mol indicates structural destabilization; positive scores represent stabilizing variants.",
    paperTitle: "Rodrigues et al. Bioinformatics (2020)",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btaa784"
  },
  ddmut: {
    name: "DDMut (Deep Learning)",
    category: "Graph Deep Learning / Transformers",
    description: "DDMut uses a Siamese neural network combining graph-based structural representations, convolutional layers, and Transformer encoders to predict free energy changes (ΔΔG) for single and multiple point mutations.",
    interpretation: "ΔΔG ≤ -1.0 kcal/mol indicates structural destabilization; positive scores represent stabilizing variants.",
    paperTitle: "Zhou et al. Nucleic Acids Res (2022)",
    paperUrl: "https://doi.org/10.1093/nar/gkac394"
  },
  rasp: {
    name: "RaSP (Rapid Stability Prediction)",
    category: "Structural Embeddings / MLP Stability Head",
    description: "RaSP predicts thermodynamic stability changes (ΔΔG) using ESM-IF1 structural embeddings combined with a pre-trained multi-layer perceptron head trained on ~350k experimental stability datapoints. It operates directly on 3D structure.",
    // RaSP is a positive-native engine: a LARGER score means destabilization (see
    // `shared/engineStatus.ts`, whose per-engine cut is +1.0). This rule was previously written
    // with the opposite sign, so this explanation contradicted both the app's own maths and the
    // Energetics tab's copy for the same method.
    interpretation: "ΔΔG ≥ +1.0 kcal/mol indicates structural destabilization; lower/negative scores represent neutral or stabilizing variants. Pearson r ≈ 0.57 on held-out S461 benchmark.",
    paperTitle: "Blaabjerg et al. Cell Systems (2023)",
    paperUrl: "https://doi.org/10.1016/j.cels.2023.01.001"
  },
  bayesdel: {
    name: "BayesDel (noAF)",
    category: "Meta-Predictor Integration",
    description: "BayesDel is a meta-predictor that integrates multiple individual in-silico tools (including conservation and functional annotations) using a Bayesian approach. We use the version without allele frequency (noAF) to prevent double-counting frequency evidence.",
    interpretation: "Scores range from -1.0 to 1.0. A score ≥ 0.133 indicates pathogenic support (PP3_Supporting), and ≤ -0.0404 indicates benign support (BP4).",
    paperTitle: "Feng et al. Hum Mutat (2021)",
    paperUrl: "https://doi.org/10.1002/humu.24155"
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
    description: "Contact density counts the number of Cα atoms within a 10Å radius of the mutation site. This quantifies whether the residue is located in a densely packed core or a flexible surface loop.",
    interpretation: "Core residues have ≥ 15 neighbors, boundary residues have 8-14, and surface residues have < 8 neighbors.",
    paperTitle: "Pejaver et al. Nat Methods (2020)",
    paperUrl: "https://doi.org/10.1038/s41592-020-0962-8"
  },
  thermompnn: {
    name: "ThermoMPNN",
    category: "Neural Backbone Stability (ProteinMPNN)",
    description: "ThermoMPNN predicts thermodynamic stability changes (ΔΔG° = mutant - wildtype) using ProteinMPNN structural embeddings trained on >770,000 experimental measurements.",
    interpretation: "ΔΔG ≥ +1.0 kcal/mol indicates structural destabilization; negative scores represent predicted stabilizing variants.",
    paperTitle: "Pei et al. bioRxiv / Tamarind Bio (2024)",
    paperUrl: "https://docs.tamarind.bio/tools/thermompnn"
  },
  stabilityoracle: {
    name: "StabilityOracle",
    category: "Graph-Transformer / Structure-Aware ML",
    description: "StabilityOracle evaluates stability changes (ΔΔG) by combining geometric graph-transformer representations of 3D protein coordinate structures with multi-task thermodynamic training.",
    interpretation: "ΔΔG ≥ +1.0 kcal/mol indicates structural destabilization; scores < +0.5 kcal/mol indicate neutral or stabilizing variants.",
    paperTitle: "StabilityOracle Consortium (2024)",
    paperUrl: "https://github.com/Huthaifa-HajAhmad/Missense-Structural-Explorer"
  },
  metarnn: {
    name: "MetaRNN",
    category: "Recurrent Neural Network Ensemble",
    description: "MetaRNN integrates 28 deep learning, evolutionary conservation, and structural features using recurrent neural networks (RNN) to model positional inter-dependencies across amino acid sequences.",
    interpretation: "Scores range from 0 to 1. A score ≥ 0.5 indicates pathogenic evidence (PP3), and < 0.5 indicates benign/tolerated evidence.",
    paperTitle: "Li et al. Genome Med (2022)",
    paperUrl: "https://doi.org/10.1186/s13073-022-01069-0"
  },
  clinpred: {
    name: "ClinPred",
    category: "Clinical Machine Learning Ensemble",
    description: "ClinPred uses a gradient boosted decision tree classifier trained specifically on ClinVar confirmed pathogenic vs benign variants, incorporating allele frequency alongside multiple in-silico predictors.",
    interpretation: "Scores range from 0 to 1. ClinPred ≥ 0.5 indicates pathogenic evidence; < 0.5 indicates benign evidence.",
    paperTitle: "Alirezaie et al. Am J Hum Genet (2018)",
    paperUrl: "https://doi.org/10.1016/j.ajhg.2018.07.028"
  },
  eigen: {
    name: "Eigen / Eigen-PC",
    category: "Unsupervised Functional Annotation",
    description: "Eigen integrates functional annotations (conservation, functional genomics, chromatin state) without requiring labeled training sets, using spectral decomposition of annotation covariance.",
    interpretation: "PHRED-scaled scores range from 0 to 35+. Higher scores indicate increased functional constraint and deleteriousness.",
    paperTitle: "Ionita-Laza et al. Nat Genet (2016)",
    paperUrl: "https://doi.org/10.1038/ng.3477"
  },
  dann: {
    name: "DANN (Deep Neural Network)",
    category: "Deep Artificial Neural Network",
    description: "DANN trains a deep feed-forward neural network on the same comprehensive feature sets as CADD to capture non-linear annotation relationships.",
    interpretation: "Scores range from 0 to 1. Scores > 0.95 indicate high predicted deleteriousness.",
    paperTitle: "Quang et al. Bioinformatics (2015)",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btu703"
  },
  spliceai: {
    name: "SpliceAI",
    category: "Deep Residual Splicing Network",
    description: "SpliceAI uses a 32-layer deep residual neural network to predict splice donor and acceptor gain/loss from primary pre-mRNA genomic sequence contexts up to 10,000 bp.",
    interpretation: "Delta scores (DS) range from 0 to 1. A max DS ≥ 0.5 indicates high probability of splice alteration; 0.2–0.5 indicates moderate probability.",
    paperTitle: "Jaganathan et al. Cell (2019)",
    paperUrl: "https://doi.org/10.1016/j.cell.2018.12.015"
  },
  dbscsnv: {
    name: "dbscSNV (Ada / RF)",
    category: "Splicing Consensus Ensemble",
    description: "dbscSNV integrates splice site sequence features and multiple regional conservation metrics across splicing consensus regions (-3 to +8 for donor, -12 to +2 for acceptor) using AdaBoost and Random Forest.",
    interpretation: "Ensemble scores range from 0 to 1. Score ≥ 0.6 indicates high probability of altering splicing consensus.",
    paperTitle: "Jian et al. Nucleic Acids Res (2014)",
    paperUrl: "https://doi.org/10.1093/nar/gku1206"
  },
  popeve: {
    name: "popEVE",
    category: "Population Constraint & Evolutionary Model",
    architecture: "Variational Autoencoder (EVE) integrated with UK Biobank 450k Exome Constraint",
    modality: "Evolutionary Alignments + Human Population Allele Frequencies",
    description: "popEVE combines evolutionary generative modeling (EVE variational autoencoder) with human population-scale exome sequencing from the UK Biobank (450,000 individuals) to quantify human-specific purifying selection against missense variation.",
    interpretation: "Normalized scores from 0 (benign) to 1 (pathogenic), or log-likelihood ratio (LLR). Scores ≥ 0.75 indicate strong human-specific purifying constraint.",
    strengths: [
      "Directly captures human-specific natural selection without assuming conservation across distant species always applies.",
      "Calibrated against true population allele depletion across 450,000 human exomes.",
      "Distinguishes variants that are conserved in mammals but tolerated specifically in modern humans."
    ],
    weaknesses: [
      "Statistical power is limited in low-coverage genes or genes with low baseline mutation rates.",
      "Population demographic history (bottlenecks/expansions) can introduce background noise.",
      "Blind to non-coding and structural atomic clash geometry."
    ],
    provider: "Marks Lab @ Harvard University",
    paperTitle: "Frazer et al. Nature (2021) / popEVE (2024)",
    paperUrl: "https://doi.org/10.1038/s41586-021-04043-8",
    citation: "Frazer, J., et al. (2021). Disease variant prediction with deep generative models of evolutionary data. Nature, 599, 91–99."
  },
  saprot: {
    name: "SaProt 650M AF2",
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
    category: "Whole-Genome Multimodal Foundation Model",
    architecture: "Multimodal Deep Genomic Transformer (9,440 functional tracks, 18 biological modalities)",
    modality: "Whole-Genome DNA Sequence + Epigenomics + Transcriptomics + Chromatin Architecture",
    description: "AlphaGenome Variant Impact (AVI) is Google DeepMind's foundation model for whole-genome variant effect prediction. Trained across 9,440 functional genomic tracks spanning 18 biological modalities, AlphaGenome unifies non-coding regulatory, transcriptional, and coding protein impacts into a single continuous Phred-scaled score with single-base resolution.",
    interpretation: "AlphaGenome Variant Impact (AVI) Phred score (0–60 scale, where Phred = -10 * log10(1 - percentile/100)). Calibrated tiers: Phred ≥ 35.0 (Top 0.03%, PP3 Strong), Phred ≥ 25.0 (Top 0.316%, PP3 Moderate), Phred ≥ 15.0 (Top 3.16%, PP3 Supporting); Phred ≤ 8.0 (Bottom 84%, BP4 Supporting), Phred ≤ 5.0 (Bottom 68%, BP4 Moderate).",
    strengths: [
      "Truly multimodal foundation architecture predicting 9,440 functional tracks simultaneously across 18 modalities (CAGE, RNA-seq, DNase, ATAC, ChIP-seq, Hi-C, polyA).",
      "Unified single-nucleotide resolution across both coding missense variants and non-coding regulatory elements.",
      "Calibrated across 3 billion base pairs of the human reference genome (GRCh38).",
      "Provides granular SHAP/integrated gradients attribution pointing to the exact driving biological mechanism."
    ],
    weaknesses: [
      "Statistical epigenetic and functional genomic priors do not substitute for explicit 3D atomic forcefield energetics (FoldX/ThermoMPNN) or rotamer clash modeling.",
      "Requires valid genomic coordinates (chromosome, position, ref/alt alleles); cannot score protein-only annotations without genomic mapping.",
      "Cloud-based sovereign foundation model requiring network connectivity or local cache availability."
    ],
    provider: "Google DeepMind",
    paperTitle: "DeepMind AlphaGenome Team (2024)",
    paperUrl: "https://deepmind.google.com/science/alphagenome/atlas",
    citation: "Google DeepMind AlphaGenome Team (2024). AlphaGenome: A Multimodal Foundation Model for Genomic Biology and Variant Interpretation."
  },
  burial_status: {
    name: "Solvent Accessibility & Burial Status (RSA)",
    category: "Surface Topology & Hydrophobic Core",
    architecture: "Shrake-Rupley / Lee-Richards Rolling Sphere SASA Algorithm",
    modality: "3D Macromolecular Coordinates",
    description: "Calculates the Relative Solvent Accessibility (RSA) of the wild-type residue in the 3D model relative to an extended Gly-X-Gly tripeptide reference conformation using a 1.4Å water probe sphere.",
    interpretation: "Core residues have RSA < 15% (deeply buried within the hydrophobic core, where polar substitutions disrupt thermodynamic stability). Surface residues have RSA > 35% (accessible to solvent and ligand interactions). Boundary residues range from 15% to 35%.",
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
    interpretation: "Distance is measured from the variant residue to the centroid of the pocket's own residues — not to the cavity's geometric centre — so it grows with pocket size. Spatial classification: ACTIVE_SITE_LINING when the residue is one of P2Rank's returned pocket residues; ACTIVE_SITE_PROXIMATE within 8 Å; POCKET_PERIPHERAL within 12 Å; otherwise DISTAL_SURFACE. The 0–100 ranking index is P2Rank's calibrated probability that the cavity is a true binding site, per model profile: it is not an affinity, and values from different profiles are not comparable. Cavity volume is shown only when the engine reported a measured volume; a surface-point count is never presented as a volume.",
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

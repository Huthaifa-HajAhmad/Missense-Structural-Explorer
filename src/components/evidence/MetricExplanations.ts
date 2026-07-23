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
}

export const METRIC_EXPLANATIONS: Record<string, MetricExplanation> = {
  am: {
    name: "AlphaMissense",
    category: "AI Pathogenicity Predictor",
    description: "AlphaMissense adapts AlphaFold structural representation learning to predict the pathogenicity of missense variants. It leverages an unsupervised protein language model trained on evolutionary sequences alongside structural embeddings to score candidate substitutions.",
    interpretation: "Scores range from 0 (benign) to 1 (pathogenic). Classifications include 'likely_benign' (≤ 0.340), 'uncertain', and 'likely_pathogenic' (≥ 0.564). ClinGen-calibrated thresholds are 0.983 (pathogenic) and 0.063 (benign).",
    paperTitle: "Cheng et al. Science (2023)",
    paperUrl: "https://doi.org/10.1126/science.adg7492"
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
    name: "VESM Co-distilled LLR",
    category: "Protein Language Model",
    description: "VESM (Variant Effect ESM) is a co-distilled protein language model that compresses the collective knowledge of the ESM family. It computes a log-likelihood ratio (LLR) reflecting variant effect predictions on ProteinGym without external structural or evolutionary inputs.",
    interpretation: "LLR values range from -20 to +5. Informational only — no validated clinical threshold is applied, and it is excluded from ACMG concordance voting.",
    paperTitle: "Ntranos Lab, bioRxiv (2024)",
    paperUrl: "https://github.com/ntranoslab/vesm"
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
    interpretation: "ΔΔG ≤ -1.0 kcal/mol indicates structural destabilization; positive scores represent stabilizing variants. Pearson r ≈ 0.57 on held-out S461 benchmark.",
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
  }
};

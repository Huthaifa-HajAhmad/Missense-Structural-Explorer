/** Citation metadata only. Rendered teaching text lives in shared/researchGuides.ts. */
export interface MetricExplanation { name: string; paperTitle: string; paperUrl: string; citation?: string }
export const METRIC_EXPLANATIONS: Record<string, MetricExplanation> = {
  gpn_star: {
    name: "GPN-Star",
    paperTitle: "Ye et al. bioRxiv (2025)",
    paperUrl: "https://doi.org/10.1101/2025.09.21.677619",
    citation: "Ye, C., Benegas, G., et al. (2025). Predicting functional constraints across evolutionary timescales with phylogeny-informed genomic language models. bioRxiv.",
  },
  vesm: {
    name: "VESM",
    paperTitle: "Dinh et al. Nat Methods (2026)",
    paperUrl: "https://doi.org/10.1038/s41592-026-03050-9",
    citation: "Dinh, T., et al. (2026). Compressing the collective knowledge of ESM into a single protein language model. Nature Methods.",
  },
  am: {
    name: "AlphaMissense",
    paperTitle: "Cheng et al. Science (2023)",
    paperUrl: "https://doi.org/10.1126/science.adg7492",
    citation: "Cheng, J., et al. (2023). Accurate proteome-wide missense variant effect prediction with AlphaMissense. Science, 381(6664), eadg7492.",
  },
  cadd: {
    name: "CADD PHRED",
    paperTitle: "Kircher et al. Nat Genet (2014)",
    paperUrl: "https://doi.org/10.1038/ng.2892",
  },
  revel: {
    name: "REVEL",
    paperTitle: "Ioannidis et al. Am J Hum Genet (2016)",
    paperUrl: "https://doi.org/10.1016/j.ajhg.2016.08.016",
  },
  eve: {
    name: "EVE Model",
    paperTitle: "Frazer et al. Nature (2021)",
    paperUrl: "https://doi.org/10.1038/s41586-021-04043-8",
  },
  esm2: {
    name: "ESM-2 Foundation LM",
    paperTitle: "Lin et al. Science (2023)",
    paperUrl: "https://doi.org/10.1126/science.ade2574",
    citation: "Lin, Z., et al. (2023). Evolutionary-scale prediction of atomic-level protein structure with a language model. Science, 379(6637), 1123-1130.",
  },
  foldx: {
    name: "FoldX ddG",
    paperTitle: "Schymkowitz et al. Nucleic Acids Res (2005)",
    paperUrl: "https://doi.org/10.1093/nar/gki387",
  },
  dynamut2: {
    name: "DynaMut2",
    paperTitle: "Rodrigues et al. Protein Science (2021)",
    paperUrl: "https://doi.org/10.1002/pro.3942",
  },
  ddmut: {
    name: "DDMut (Deep Learning)",
    paperTitle: "Zhou et al. Nucleic Acids Res (2023)",
    paperUrl: "https://doi.org/10.1093/nar/gkad472",
  },
  rasp: {
    name: "RaSP (Rapid Stability Prediction)",
    paperTitle: "Blaabjerg et al. eLife (2023)",
    paperUrl: "https://doi.org/10.7554/eLife.82593",
  },
  protvar: {
    name: "ProtVar FoldX (precomputed, EBI)",
    paperTitle: "Stephenson et al. Nucleic Acids Res (2024)",
    paperUrl: "https://doi.org/10.1093/nar/gkae413",
  },
  bayesdel: {
    name: "BayesDel (noAF)",
    paperTitle: "Feng. Hum Mutat (2017)",
    paperUrl: "https://doi.org/10.1002/humu.23158",
  },
  rmsd: {
    name: "Neighbour side-chain RMSD",
    paperTitle: "Schymkowitz et al. Nucleic Acids Res (2005)",
    paperUrl: "https://doi.org/10.1093/nar/gki387",
  },
  vdw: {
    name: "VdW Clash Delta",
    paperTitle: "Schymkowitz et al. Nucleic Acids Res (2005)",
    paperUrl: "https://doi.org/10.1093/nar/gki387",
  },
  electrostatics: {
    name: "Electrostatic Delta",
    paperTitle: "Schymkowitz et al. Nucleic Acids Res (2005)",
    paperUrl: "https://doi.org/10.1093/nar/gki387",
  },
  contact_density: {
    name: "Cα Contact Density",
    paperTitle: "Hamelryck. Proteins (2005): half-sphere exposure and coordination number",
    paperUrl: "https://doi.org/10.1002/prot.20379",
  },
  thermompnn: {
    name: "ThermoMPNN",
    paperTitle: "Dieckhaus et al. PNAS (2024)",
    paperUrl: "https://doi.org/10.1073/pnas.2314853121",
  },
  stabilityoracle: {
    name: "StabilityOracle",
    paperTitle: "Diaz et al. Nat Commun (2024)",
    paperUrl: "https://doi.org/10.1038/s41467-024-49780-2",
  },
  metarnn: {
    name: "MetaRNN",
    paperTitle: "Li et al. Genome Med (2022)",
    paperUrl: "https://doi.org/10.1186/s13073-022-01120-z",
  },
  clinpred: {
    name: "ClinPred",
    paperTitle: "Alirezaie et al. Am J Hum Genet (2018)",
    paperUrl: "https://doi.org/10.1016/j.ajhg.2018.08.005",
  },
  eigen: {
    name: "Eigen / Eigen-PC",
    paperTitle: "Ionita-Laza et al. Nat Genet (2016)",
    paperUrl: "https://doi.org/10.1038/ng.3477",
  },
  dann: {
    name: "DANN (Deep Neural Network)",
    paperTitle: "Quang et al. Bioinformatics (2015)",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btu703",
  },
  spliceai: {
    name: "SpliceAI",
    paperTitle: "Jaganathan et al. Cell (2019)",
    paperUrl: "https://doi.org/10.1016/j.cell.2018.12.015",
  },
  dbscsnv: {
    name: "dbscSNV (Ada / RF)",
    paperTitle: "Jian et al. Nucleic Acids Res (2014)",
    paperUrl: "https://doi.org/10.1093/nar/gku1206",
  },
  popeve: {
    name: "popEVE",
    paperTitle: "Orenbuch et al. Nat Genet (2025)",
    paperUrl: "https://doi.org/10.1038/s41588-025-02400-1",
    citation: "Orenbuch, R., et al. (2025). Proteome-wide model for human disease genetics. Nature Genetics 57, 3165–3174.",
  },
  saprot: {
    name: "SaProt",
    paperTitle: "Su et al. bioRxiv / ICLR (2024)",
    paperUrl: "https://doi.org/10.1101/2023.10.01.560349",
    citation: "Su, J., et al. (2024). SaProt: Protein Language Modeling with Structure-aware Vocabulary. bioRxiv / ICLR.",
  },
  alphagenome: {
    name: "AlphaGenome AVI",
    paperTitle: "Avsec et al. bioRxiv (2025)",
    paperUrl: "https://doi.org/10.1101/2025.06.25.661532",
    citation: "Avsec, Ž., et al. (2025). AlphaGenome: advancing regulatory variant effect prediction with a unified DNA sequence model. bioRxiv.",
  },
  burial_status: {
    name: "Solvent Accessibility & Burial Status (RSA)",
    paperTitle: "Tien et al. PLoS ONE (2013)",
    paperUrl: "https://doi.org/10.1371/journal.pone.0080635",
  },
  p2rank: {
    name: "P2Rank Ligand-Binding Pocket Predictor",
    paperTitle: "Krivak & Hoksza. J Cheminform (2018)",
    paperUrl: "https://doi.org/10.1186/s13321-018-0285-8",
  },
};

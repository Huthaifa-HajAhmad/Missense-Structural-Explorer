/** Citation metadata only. Rendered teaching text lives in shared/researchGuides.ts. */
export interface MetricExplanation { name: string; paperTitle: string; paperUrl: string; citation?: string }
export const METRIC_EXPLANATIONS: Record<string, MetricExplanation> = {
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
  spliceai: {
    name: "SpliceAI",
    paperTitle: "Jaganathan et al. Cell (2019)",
    paperUrl: "https://doi.org/10.1016/j.cell.2018.12.015",
  },
  popeve: {
    name: "popEVE",
    paperTitle: "Orenbuch et al. Nat Genet (2025)",
    paperUrl: "https://doi.org/10.1038/s41588-025-02400-1",
    citation: "Orenbuch, R., et al. (2025). Proteome-wide model for human disease genetics. Nature Genetics 57, 3165–3174.",
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

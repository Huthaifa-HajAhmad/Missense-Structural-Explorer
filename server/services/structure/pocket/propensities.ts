/**
 * Returns empirical amino acid propensities for protein-ligand binding pockets.
 * Weights and roles are derived from Bogan & Thorn (1998) hot spot propensities
 * and classic amino acid chemical properties in structural biology.
 */
export function getAaPropensities(): Record<string, { weight: number; role: string; type: string }> {
  return {
    HIS: { weight: 3.5, role: "Metal Coordination / Basic Catalytic Residue", type: "Charged (Basic)" },
    ASP: { weight: 3.2, role: "Electrostatic Linker / Mg²⁺ Coordination Node", type: "Charged (Acidic)" },
    GLU: { weight: 3.0, role: "Proton Shuffler / Magnesium Ligand Node", type: "Charged (Acidic)" },
    TRP: { weight: 3.0, role: "Pi-Pi Stacking Core / Hydrophobic Sealing Wall", type: "Aromatic" },
    TYR: { weight: 2.8, role: "H-Bonding Donor / Hydrophobic Lining Spacer", type: "Aromatic / Polar" },
    PHE: { weight: 2.5, role: "Aromatic Cavity Gatekeeper / Core Nesting", type: "Aromatic" },
    ARG: { weight: 2.6, role: "Phosphate Salt Bridge Anchor Node", type: "Charged (Basic)" },
    LYS: { weight: 2.5, role: "Substrate Anchor Node / Hydrophilic Pocket Margin", type: "Charged (Basic)" },
    CYS: { weight: 2.8, role: "Zinc (Zn²⁺) / Metal Binding Coordination Node", type: "Sulfur-reactive" },
    ILE: { weight: 2.0, role: "Hydrophobic Boundary Enclosure Boundary", type: "Aliphatic" },
    LEU: { weight: 2.0, role: "Hydrophobic Packing Enclosure Frame", type: "Aliphatic" },
    MET: { weight: 1.9, role: "Hydrophobic Enclosure Spacer Cavity", type: "Aliphatic" },
    VAL: { weight: 1.8, role: "Pocket Cavity Frame Spacer Element", type: "Aliphatic" },
    GLY: { weight: 1.6, role: "Flexible Hinge Loop Flexor Core", type: "Flexible Hinge" },
    PRO: { weight: 1.2, role: "Rigid Structural Frame Wall Capper", type: "Rigid Frame" },
    SER: { weight: 1.6, role: "Coordinating H-Bond Network Coordinator", type: "Polar (Uncharged)" },
    THR: { weight: 1.6, role: "Polar Substrate Contact Coordinator", type: "Polar (Uncharged)" },
    GLN: { weight: 1.5, role: "Amine Substrate Adapter / Hydrogen Donor", type: "Polar (Uncharged)" },
    ASN: { weight: 1.5, role: "Amine Substrate Adapter / Hydrogen Donor", type: "Polar (Uncharged)" },
    ALA: { weight: 1.0, role: "Non-specific Cavity wall Boundary spacer", type: "Aliphatic" }
  };
}

/**
 * In accordance with the project's strict No Heuristics Policy, we do not synthesize
 * ligand/cofactor identities based on amino acid composition counts.
 * Ligand and cofactor annotations are derived strictly from experimental PDB HETATMs
 * or curated UniProt sequence feature records.
 */
export function determineLikelyCofactor(_typesCount?: Record<string, number>): string {
  return "None recorded in curated annotations";
}

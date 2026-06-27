import { VariantPreset } from "./types";

export const VARIANT_PRESETS: VariantPreset[] = [
  {
    gene: "PAH",
    variant: "p.Arg408Trp",
    uniprotId: "P00439",
    description: "Phenylalanine-4-hydroxylase (Disrupts oligomerization and catalytic stability, causing severe classical Phenylketonuria)."
  },
  {
    gene: "FGFR3",
    variant: "p.Gly380Arg",
    uniprotId: "P22607",
    description: "Fibroblast growth factor receptor 3 (Stabilizes transmembrane helix dimerization, causing constitutive activation and Achondroplasia dwarfism)."
  },
  {
    gene: "GBA1",
    variant: "p.Leu483Pro",
    uniprotId: "P04062",
    description: "Lysosomal acid glucosylceramidase (Beta-sheet breaker in Domain II causing enzyme misfolding and Gaucher disease)."
  }
];

export const FALLBACK_ANALYSES: Record<string, string> = {
  "P00439_p.Arg408Trp": `### 🧬 Molecular and Chemical Shift
The wild-type residue **Arginine (Arg - R)** at position 408 is a highly basic, positively charged amino acid with a hydrophilic side chain. Replacing it with **Tryptophan (Trp - W)** introduces a bulky, neutral, hydrophobic aromatic indole ring. This swap completely alters the local electrostatic profile and introduces severe steric bulk.

### 🧱 Structural Context & Disruptive Potential
Arg408 is located in the C-terminal catalytic domain of **PAH** and is crucial for stabilizing inter-subunit interactions:
1. **Disruption of Hydrogen Bonding**: Arg408 forms key salt-bridges/hydrogen bonds with Asp315 and Asp320 in the neighboring monomer of the PAH tetramer. The neutral Tryptophan cannot form these ionic links, destabilizing the quaternary tetramer structure.
2. **Steric Overcrowding**: The large size of Tryptophan (volume 228 Å³ vs Arginine's 173 Å³) cannot be accommodated in the tightly packed monomer interface, leading to local packing strain and structural misfolding.
3. **Misfolding and Aggregation**: Quaternary disruption exposes hydrophobic patches, accelerating intracellular aggregation and leading to rapid degradation of the enzyme.

### 🏥 Clinical and Pathogenicity Interpretation
Classified as a **Pathogenic** mutation.
- **Disease Association**: This is the most common mutation causing severe classical **Phenylketonuria (PKU)** in many populations.
- **Biological Impact**: Results in near-zero residual phenylalanine hydroxylase activity, causing toxic systemic accumulation of phenylalanine and severe intellectual disability if untreated.

### 🔬 Recommended 3D Visualization Landmarks
1. **Mutation Site Residue 408**: Inspect Arg408 to visualize the hydrogen bonds extending to adjacent monomers.
2. **Subunit Interface**: Observe the close packing at the interface of the tetramer where residue 408 resides.
3. **Aromatic Clashes**: Visualize the steric clash introduced when modeling the bulky Tryptophan ring at this site.`,

  "P22607_p.Gly380Arg": `### 🧬 Molecular and Chemical Shift
The wild-type residue **Glycine (Gly - G)** at position 380 has only a hydrogen atom side chain, providing maximum flexibility and no charge. Replacing it with **Arginine (Arg - R)** introduces a long, basic, positively charged side chain that is highly hydrophilic.

### 🧱 Structural Context & Disruptive Potential
Gly380 resides in the single-pass transmembrane domain of **FGFR3**:
1. **Transmembrane Dimer Stabilization**: The transmembrane domain contains a conserved GXXXG-like motif that regulates receptor dimerization. Introducing the positively charged Arginine side chain allows it to form new hydrogen-bonds/salt-bridges with the phosphate headgroups or neighboring chains in the lipid bilayer.
2. **Constitutive Activation**: This electrostatic stabilization locks the receptor in a dimerized (active) state even in the absence of fibroblast growth factors (FGF ligands).
3. **Signal Hyper-activation**: The locked dimer continuously sends downstream tyrosine kinase signals (via STAT and MAPK pathways) that inhibit chondrocyte proliferation in the growth plate.

### 🏥 Clinical and Pathogenicity Interpretation
Classified as a **Pathogenic (High Penetrance)** variant.
- **Disease Association**: Responsible for over 98% of cases of **Achondroplasia**, the most common form of human dwarfism.
- **Genetic Dominance**: Activating mutation with complete dominance. A single copy of the mutant gene is sufficient to cause the phenotype.

### 🔬 Recommended 3D Visualization Landmarks
1. **Transmembrane Helix**: Zoom into residue 380 to see its position in the center of the hydrophobic transmembrane helix.
2. **Helix Dimerization Face**: Examine the GXXXG motif region to see how the Gly380Arg substitution faces the neighboring transmembrane helix.
3. **Charge Projection**: Notice the basic Arginine side chain trying to reach the polar interface of the lipid bilayer.`,

  "P04062_p.Leu483Pro": `### 🧬 Molecular and Chemical Shift
The wild-type residue **Leucine (Leu - L)** at position 483 (historically referred to as L444 in literature lacking the signal peptide) is a hydrophobic, branched-chain amino acid. Replacing it with **Proline (Pro - P)** introduces a rigid, cyclic imino acid that constrains backbone dihedral angles and cannot act as a hydrogen bond donor.

### 🧱 Structural Context & Disruptive Potential
Leu483 is located in Domain II (an immunoglobulin-like beta-sandwich domain) of **acid beta-glucosidase (GBA1)**:
1. **Beta-Sheet Disruption**: Leu483 lies in an outer beta-strand of Domain II. Proline is a well-known "beta-sheet breaker" because its cyclic structure prevents standard backbone hydrogen bonding.
2. **Local Misfolding**: The introduction of Proline forces a local backbone kink, destabilizing the beta-sandwich assembly.
3. **ER Retention & Degradation**: Although the catalytic site in Domain III is not directly mutated, the local folding defect in Domain II causes the protein to be recognized as misfolded in the Endoplasmic Reticulum (ER), leading to ER-associated degradation (ERAD) and severe deficiency of lysosomal enzyme trafficking.

### 🏥 Clinical and Pathogenicity Interpretation
Classified as a **Pathogenic** variant.
- **Disease Association**: A major mutation responsible for **Gaucher Disease** (Types 1, 2, and 3) and is also a significant genetic risk factor for Parkinson's disease.
- **Biological Impact**: Reduces active lysosomal glucocerebrosidase levels to less than 10-20% of normal, leading to accumulation of glucosylceramide in macrophages (Gaucher cells).

### 🔬 Recommended 3D Visualization Landmarks
1. **Domain II Beta-Strand**: Locate residue 483 in the beta-sheet structure of Domain II.
2. **Backbone Hydrogen Bonds**: Examine the hydrogen-bonding network stabilizing this beta-strand.
3. **Proline Kink**: Visualize how replacing Leucine with Proline disrupts the sheet planarity and introduces steric constraint.`
};

export const FALLBACK_INSIGHTS: Record<string, any> = {
  "P00439_p.Arg408Trp": {
    biochemicalShift: "Basic, positively charged Arginine (Arg) replaced by a neutral, bulky hydrophobic aromatic Tryptophan (Trp), causing a major change in charge and molecular volume (+55 Å³).",
    structuralImpact: "Abolishes key inter-subunit salt-bridges with Asp315/Asp320 on neighboring monomers, destabilizing the PAH tetramer and driving protein aggregation.",
    acmgCriteria: [
      { code: "PM1", reason: "Residue 408 is located in the critical catalytic domain of phenylalanine hydroxylase." },
      { code: "PP3", reason: "Multiple computational tools predict a highly deleterious biophysical outcome on folding stability." }
    ]
  },
  "P22607_p.Gly380Arg": {
    biochemicalShift: "Small, flexible neutral Glycine (Gly) replaced by a basic, positively charged Arginine (Arg), introducing hydrophilic charge into the hydrophobic transmembrane core.",
    structuralImpact: "Stabilizes ligand-independent transmembrane helix dimerization, locking the FGFR3 receptor in a constitutively active signaling state.",
    acmgCriteria: [
      { code: "PM1", reason: "Residue 380 lies in the highly conserved transmembrane dimerization motif of FGFR3." },
      { code: "PP3", reason: "Computational models predict TM helix distortion and aberrant dimerization energy." }
    ]
  },
  "P04062_p.Leu483Pro": {
    biochemicalShift: "Hydrophobic branched-chain Leucine (Leu) replaced by a rigid cyclic Proline (Pro), disrupting polypeptide backbone conformation.",
    structuralImpact: "Acts as a beta-sheet breaker in Domain II, forcing a local structural kink that destabilizes the fold and triggers ER-associated degradation.",
    acmgCriteria: [
      { code: "PM1", reason: "Residue 483 is located in the conserved Domain II Ig-like fold of acid beta-glucosidase." },
      { code: "PP3", reason: "In silico tools yield unanimous predictions of structural damage due to proline sheet disruption." }
    ]
  }
};

import { NearestResidue } from "./types";

const PRESET_NEIGHBORS: Record<string, NearestResidue[]> = {
  "P00439_p.Arg408Trp": [
    {
      name: "Asp315",
      distance: "2.9 Å",
      properties: "Acidic, Negatively Charged",
      role: "Normally forms a direct inter-subunit salt-bridge stabilizing the positive charge of Arg408. Trp substitution abolishes this ionic lock, destabilizing tetramer assembly.",
      classBadge: "bg-red-500/10 text-red-300 border-red-500/20"
    },
    {
      name: "Asp320",
      distance: "3.1 Å",
      properties: "Acidic, Negatively Charged",
      role: "Forms a secondary stabilizing salt-bridge on the adjacent monomer. The basic-to-neutral swap completely cancels this electrostatic anchor.",
      classBadge: "bg-red-500/10 text-red-300 border-red-500/20"
    },
    {
      name: "Phe397",
      distance: "3.6 Å",
      properties: "Hydrophobic, Aromatic",
      role: "Lies in the core of the monomer-monomer interface. Introduction of the bulky Tryptophan side chain triggers severe steric clashes with this aromatic ring.",
      classBadge: "bg-amber-500/10 text-amber-300 border-amber-500/20"
    },
    {
      name: "Lys409",
      distance: "3.8 Å",
      properties: "Basic, Positively Charged",
      role: "Adjacent residue in the tetramerization motif. Helps establish surface charge density on the dimer interface.",
      classBadge: "bg-blue-500/10 text-blue-300 border-blue-500/20"
    }
  ],
  "P22607_p.Gly380Arg": [
    {
      name: "Val381",
      distance: "3.2 Å",
      properties: "Hydrophobic, Aliphatic",
      role: "Adjacent residue in the transmembrane helix. The introduction of Arginine's positive charge alters the local packing with this hydrophobic residue.",
      classBadge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
    },
    {
      name: "Ala376",
      distance: "3.5 Å",
      properties: "Hydrophobic, Small",
      role: "Sits on the same face of the transmembrane helix. Replacing Gly380 with the bulky Arginine disrupts the transmembrane helix-helix crossing angle.",
      classBadge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
    },
    {
      name: "PO4 Headgroup",
      distance: "4.0 Å",
      properties: "Curated Membrane-Headgroup Marker (Non-residue)",
      role: "Curated membrane-headgroup marker, not a protein residue. The mutated basic Arginine side chain forms strong electrostatic interactions with the lipid bilayer headgroups, locking the dimer state.",
      classBadge: "bg-purple-500/10 text-purple-300 border-purple-500/20"
    },
    {
      name: "Phe384",
      distance: "4.5 Å",
      properties: "Hydrophobic, Aromatic",
      role: "Aromatic residue in the transmembrane domain that contributes to lipid-facing membrane stabilization.",
      classBadge: "bg-amber-500/10 text-amber-300 border-amber-500/20"
    }
  ],
  "P04062_p.Leu483Pro": [
    {
      name: "Val484",
      distance: "3.2 Å",
      properties: "Hydrophobic, Aliphatic",
      role: "Next residue in the outer beta-strand of Domain II. Proline insertion at 483 disrupts the linear peptide direction and changes Val484 exposure.",
      classBadge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
    },
    {
      name: "Asp481",
      distance: "3.6 Å",
      properties: "Acidic, Negatively Charged",
      role: "Lies on the neighboring loop that stabilizes Domain II's outer shell. Destabilized by the local backbone distortion induced by Proline.",
      classBadge: "bg-red-500/10 text-red-300 border-red-500/20"
    },
    {
      name: "Tyr485",
      distance: "3.8 Å",
      properties: "Hydrophobic, Aromatic",
      role: "Core aromatic residue in the beta-sandwich domain. The proline-induced kink changes the packing alignment with Tyr485, causing fold destabilization.",
      classBadge: "bg-amber-500/10 text-amber-300 border-amber-500/20"
    },
    {
      name: "Glu430",
      distance: "4.2 Å",
      properties: "Acidic, Negatively Charged",
      role: "Lies in Domain II, helping anchor the loop structure. Local folding collapse alters its orientation.",
      classBadge: "bg-red-500/10 text-red-300 border-red-500/20"
    }
  ]
};

const AMINO_ACID_TYPES = [
  { name: "Asp", prop: "Acidic, Negatively Charged", badge: "bg-red-500/10 text-red-300 border-red-500/20", role: "Often participates in critical salt bridge partners or positive charge neutralization." },
  { name: "Arg", prop: "Basic, Positively Charged", badge: "bg-blue-500/10 text-blue-300 border-blue-500/20", role: "Provides outward basic projection, critical for maintaining pocket electrostatics." },
  { name: "Leu", prop: "Hydrophobic, Aliphatic", badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", role: "Supplies stable inner-core hydrophobic surface area and supports local sheet packing." },
  { name: "Phe", prop: "Hydrophobic, Aromatic", badge: "bg-amber-500/10 text-amber-300 border-amber-500/20", role: "Forms rigid aromatic shielding, providing heavy van der Waals interactions." },
  { name: "Ser", prop: "Polar, Uncharged", badge: "bg-sky-500/10 text-sky-300 border-sky-500/20", role: "Forms native hydrogen bonding linkages to stabilize the outer peptide boundary." },
  { name: "Lys", prop: "Basic, Positively Charged", badge: "bg-blue-500/10 text-blue-300 border-blue-500/20", role: "Participates in outward polar networks or coordinating neighboring cofactors." },
  { name: "Glu", prop: "Acidic, Negatively Charged", badge: "bg-red-500/10 text-red-300 border-red-500/20", role: "Interacts electrostatically with adjacent basic residues to lock local secondary loop folds." },
  { name: "Val", prop: "Hydrophobic, Aliphatic", badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", role: "Provides compact hydrophobic scaffolding within the local lipid or core alignment." },
  { name: "Tyr", prop: "Hydrophobic, Aromatic", badge: "bg-amber-500/10 text-amber-300 border-amber-500/20", role: "Coordinates active site binding with hydrogen bonding through its phenolic hydroxyl group." },
  { name: "Ile", prop: "Hydrophobic, Aliphatic", badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", role: "Supplies heavy aliphatic packaging inside hydrophobic cores and protein-protein boundaries." }
];

export function getNearestResidues(uniprotId: string, variant: string, residueIndexNum: number | null): NearestResidue[] {
  const cleanVariant = variant.replace(/^p\./i, "");
  const presetKey = `${uniprotId}_p.${cleanVariant}`;
  
  if (PRESET_NEIGHBORS[presetKey]) {
    return PRESET_NEIGHBORS[presetKey].map(item => ({ ...item, source: "curated" }));
  }
  
  return [];
}


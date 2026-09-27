/**
 * Curated rare-disease missense controls.
 *
 * Shared by the onboarding tour and the Search workspace's empty state. Each preset is a COMPLETE,
 * runnable query (gene + protein notation + accession) — unlike the notation-format examples, which
 * fill a single field and cannot be submitted on their own.
 */
export interface OnboardingPreset {
  gene: string;
  variant: string;
  uniprotId: string;
  tag: string;
  description: string;
}

export const ONBOARDING_BENCHMARK_PRESETS: OnboardingPreset[] = [
  {
    gene: "PAH",
    variant: "p.Arg408Trp",
    uniprotId: "P00439",
    tag: "Inborn Error of Metabolism",
    description: "Phenylketonuria (PKU): Catalytic domain substitution abolishing salt bridges with Asp315/Asp320, disrupting tetramer stability."
  },
  {
    gene: "FGFR3",
    variant: "p.Gly380Arg",
    uniprotId: "P22607",
    tag: "Skeletal Dysplasia",
    description: "Achondroplasia: Transmembrane domain mutation stabilizing ligand-independent helix dimerization and constitutive kinase arrest."
  },
  {
    gene: "GBA1",
    variant: "p.Leu483Pro",
    uniprotId: "P04062",
    tag: "Lysosomal Storage Disorder",
    description: "Gaucher Disease: Beta-sheet breaker in the Ig-like domain triggering structural folding collapse and glucocerebrosidase deficiency."
  },
  {
    gene: "CNNM2",
    variant: "p.Glu357Lys",
    uniprotId: "Q9H8M5",
    tag: "Ion Channelopathy",
    description: "Familial Hypomagnesemia: Bateman domain cyclic nucleotide-binding homology salt-bridge loss, impairing renal Mg²⁺ reabsorption."
  }
];


import { VariantPreset, NearestResidue } from "./types";

export const VARIANT_PRESETS: VariantPreset[] = [];

export const FALLBACK_ANALYSES: Record<string, string> = {};

export const FALLBACK_INSIGHTS: Record<string, any> = {};

export const AMINO_ACID_TYPES = [
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


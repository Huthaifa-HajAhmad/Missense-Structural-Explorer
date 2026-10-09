/**
 * sequenceConstants.ts — Pure constants and utilities for sequence visualization.
 *
 * Extracted from SequenceVisualizer.tsx to keep data-only code separate from React rendering.
 * No React imports needed.
 */

export const AMINO_ACID_MAP_FULL: Record<string, { name: string; property: string; color: string }> = {
  A: { name: "Alanine", property: "Hydrophobic, Aliphatic", color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
  K: { name: "Lysine", property: "Basic, Positively Charged", color: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
  R: { name: "Arginine", property: "Basic, Positively Charged", color: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
  D: { name: "Aspartate", property: "Acidic, Negatively Charged", color: "text-rose-500 bg-rose-500/10 border-rose-500/20" },
  E: { name: "Glutamate", property: "Acidic, Negatively Charged", color: "text-rose-500 bg-rose-500/10 border-rose-500/20" },
  N: { name: "Asparagine", property: "Polar, Uncharged", color: "text-sky-500 bg-sky-500/10 border-sky-500/20" },
  Q: { name: "Glutamine", property: "Polar, Uncharged", color: "text-sky-500 bg-sky-500/10 border-sky-500/20" },
  S: { name: "Serine", property: "Polar, Uncharged", color: "text-sky-500 bg-sky-500/10 border-sky-500/20" },
  T: { name: "Threonine", property: "Polar, Uncharged", color: "text-sky-500 bg-sky-500/10 border-sky-500/20" },
  G: { name: "Glycine", property: "Small, Non-polar", color: "text-purple-500 bg-purple-500/10 border-purple-500/20" },
  P: { name: "Proline", property: "Conformationally Rigid", color: "text-purple-500 bg-purple-500/10 border-purple-500/20" },
  C: { name: "Cysteine", property: "Sulfhydryl, Polar", color: "text-teal-500 bg-teal-500/10 border-teal-500/20" },
  V: { name: "Valine", property: "Hydrophobic, Aliphatic", color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
  I: { name: "Isoleucine", property: "Hydrophobic, Aliphatic", color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
  L: { name: "Leucine", property: "Hydrophobic, Aliphatic", color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
  M: { name: "Methionine", property: "Thioether, Non-polar", color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
  F: { name: "Phenylalanine", property: "Hydrophobic, Aromatic", color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
  Y: { name: "Tyrosine", property: "Hydrophobic, Aromatic", color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
  W: { name: "Tryptophan", property: "Hydrophobic, Aromatic", color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
  H: { name: "Histidine", property: "Weakly Basic / Aromatic", color: "text-blue-500 bg-blue-500/10 border-blue-500/20" }
};

export const AMINO_ACID_MAP_3_TO_1: Record<string, string> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
  LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V"
};

/** One-letter code for a one- or three-letter amino acid; "" when a three-letter name is not recognised (e.g. "Ter"). */
export function toOneLetter(value: string | null | undefined): string {
  const t = (value ?? "").trim();
  return t.length === 3 ? AMINO_ACID_MAP_3_TO_1[t.toUpperCase()] || "" : t.toUpperCase();
}

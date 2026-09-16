
import { AMINO_ACID_3_TO_1, AMINO_ACID_1_TO_3 } from "./aminoAcids";
import { z } from "zod";
import { parseVariantCoordinate, type VariantCoordinate } from "./shared/variantCoordinate.ts";
import { isGenomicOrCdnaNotation } from "./shared/variantNotation.ts";

import {
  finiteNumber,
  nullableFiniteNumber,
  analyzeVariantResponseSchema,
  generateMutantResponseSchema,
  nearestResiduesResponseSchema,
  pocketFinderResponseSchema,
  resolveGeneResponseSchema,
  translateVariantResponseSchema,
  type EnergeticsData
} from "./shared/contracts.ts";

export {
  finiteNumber,
  nullableFiniteNumber,
  analyzeVariantResponseSchema,
  generateMutantResponseSchema,
  nearestResiduesResponseSchema,
  pocketFinderResponseSchema,
  resolveGeneResponseSchema,
  translateVariantResponseSchema
};

// Request deduplication cache for in-flight fetch promises (F-A2)
const inFlightRequests = new Map<string, Promise<any>>();

export function getDeduplicatedPromise<T>(key: string, promiseCreator: () => Promise<T>): Promise<T> {
  let existing = inFlightRequests.get(key);
  if (!existing) {
    existing = promiseCreator().finally(() => {
      inFlightRequests.delete(key);
    });
    inFlightRequests.set(key, existing);
  }
  return existing;
}

export function buildEnergeticsQueryString(energetics: EnergeticsData | null): string {
  if (!energetics) return "";
  const q = new URLSearchParams();
  const foldxVal = energetics.foldxMean ?? energetics.foldx;
  if (foldxVal !== null && foldxVal !== undefined) q.set("foldx", foldxVal.toString());
  if (energetics.rasp !== null && energetics.rasp !== undefined) q.set("rasp", energetics.rasp.toString());
  if (energetics.ddmut !== null && energetics.ddmut !== undefined) q.set("ddmut", energetics.ddmut.toString());
  if (energetics.dynamut2 !== null && energetics.dynamut2 !== undefined) q.set("dynamut2", energetics.dynamut2.toString());
  if (energetics.thermompnn !== null && energetics.thermompnn !== undefined) q.set("thermompnn", energetics.thermompnn.toString());
  if (energetics.foldxRepairFailed) q.set("foldxRepairFailed", "true");
  return q.toString();
}


export function getErrorMessage(data: any, defaultMsg = "Request failed"): string {
  if (!data) return defaultMsg;
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error.message === "string") return data.error.message;
  if (typeof data === "string") return data;
  return defaultMsg;
}

// Local storage key for non-sensitive public variant history cache (non-PHI)
export const STORAGE_KEY = "variantHistory";

// Coordinate pattern checkers for VCF and cDNA (F-3)
//
// The grammar itself lives in src/shared/variantNotation.ts. This thin delegate is kept
// so existing imports keep resolving.
export function isVcfOrCdnaNotation(input: string): boolean {
  return isGenomicOrCdnaNotation(input);
}

export const AMINO_ACID_NAMES_MAP: Record<string, string> = {
  A: "Alanine [Ala]",
  R: "Arginine [Arg]",
  N: "Asparagine [Asn]",
  D: "Aspartate [Asp]",
  C: "Cysteine [Cys]",
  Q: "Glutamine [Gln]",
  E: "Glutamate [Glu]",
  G: "Glycine [Gly]",
  H: "Histidine [His]",
  I: "Isoleucine [Ile]",
  L: "Leucine [Leu]",
  K: "Lysine [Lys]",
  M: "Methionine [Met]",
  F: "Phenylalanine [Phe]",
  P: "Proline [Pro]",
  S: "Serine [Ser]",
  T: "Threonine [Thr]",
  W: "Tryptophan [Trp]",
  Y: "Tyrosine [Tyr]",
  V: "Valine [Val]"
};

/**
 * Normalized physical and biochemical properties of amino acids (0-100 scale).
 * 
 * Citations & Scientific Sourcing:
 * - Hydrophobicity: Derived from the Kyte-Doolittle hydropathy scale.
 *   Kyte J, Doolittle RF. "A simple method for displaying the hydropathic character of a protein." 
 *   J Mol Biol. 1982 May 5;157(1):105-32. PMID: 7108955.
 * - Charge / Polarity: Standard biochemical classification of residues at physiological pH.
 * - Size: Based on amino acid van der Waals volume measurements, normalized.
 * - Grantham Scale comparisons are referenced downstream in the biochemical shift descriptions.
 *   Grantham R. "Amino acid difference formula to help explain protein evolution."
 *   Science. 1974 Sep 6;185(4154):862-4. PMID: 4843792.
 */
export const AMINO_ACID_PROPERTIES: Record<string, { hydrophobicity: number; charge: number; size: number; polarity: number }> = {
  A: { hydrophobicity: 60, charge: 50, size: 25, polarity: 15 },
  R: { hydrophobicity: 5,  charge: 100,size: 85, polarity: 100 },
  N: { hydrophobicity: 20, charge: 50, size: 50, polarity: 75 },
  D: { hydrophobicity: 10, charge: 0,  size: 45, polarity: 100 },
  C: { hydrophobicity: 70, charge: 35, size: 40, polarity: 60 },
  E: { hydrophobicity: 10, charge: 0,  size: 60, polarity: 100 },
  Q: { hydrophobicity: 20, charge: 50, size: 65, polarity: 75 },
  G: { hydrophobicity: 45, charge: 50, size: 10, polarity: 15 },
  H: { hydrophobicity: 25, charge: 75, size: 75, polarity: 85 },
  I: { hydrophobicity: 100,charge: 50, size: 75, polarity: 10 },
  L: { hydrophobicity: 95, charge: 50, size: 75, polarity: 10 },
  K: { hydrophobicity: 5,  charge: 95, size: 80, polarity: 100 },
  M: { hydrophobicity: 75, charge: 50, size: 75, polarity: 15 },
  F: { hydrophobicity: 85, charge: 50, size: 90, polarity: 10 },
  P: { hydrophobicity: 55, charge: 52, size: 55, polarity: 15 },
  S: { hydrophobicity: 30, charge: 45, size: 30, polarity: 70 },
  T: { hydrophobicity: 40, charge: 45, size: 45, polarity: 70 },
  W: { hydrophobicity: 65, charge: 48, size: 100,polarity: 20 },
  Y: { hydrophobicity: 50, charge: 45, size: 95, polarity: 50 },
  V: { hydrophobicity: 90, charge: 50, size: 60, polarity: 10 }
};

export function parseMutationResidues(variantStr: string): { wt: string; mut: string } {
  const coord = parseVariantCoordinate(variantStr);
  return { wt: coord.wt1, mut: coord.mut1 };
}

export const getAlternativeVariants = (currentGene: string): string[] => {
  const normalized = currentGene.toUpperCase();
  if (normalized === "PAH") {
    return ["p.Arg408Trp", "p.Arg261Gln", "p.Ala259Thr", "p.Gly272Cys"];
  }
  if (normalized === "FGFR3") {
    return ["p.Gly380Arg", "p.Ala391Glu", "p.Lys650Glu", "p.Asn540Lys"];
  }
  if (normalized === "GBA1" || normalized === "GBA") {
    return ["p.Leu483Pro", "p.Asn409Ser", "p.Asp448His", "p.Glu365Lys"];
  }
  if (normalized === "KIF1A") {
    return ["p.Arg254Trp", "p.Val8Met", "p.Ala255Val", "p.Thr99Met"];
  }
  return ["p.Ala40Val", "p.Leu100Pro", "p.Glu150Lys"];
};

export function mapMutationToFoldXFormat(variantStr: string): string {
  const coord = parseVariantCoordinate(variantStr);
  return coord.foldxCode;
}



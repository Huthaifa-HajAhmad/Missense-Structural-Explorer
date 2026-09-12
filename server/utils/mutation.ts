export interface Mutation {
  chain: string;
  position: number;
  wt: string; // 1-letter code
  mt: string; // 1-letter code
}

export interface ThermoResult {
  wt_sequence: string;
  mutation: Mutation;
  ddG: number;
}

/**
 * Applies a mutation to a wildtype protein sequence, returning the mutated sequence.
 * Expects 1-indexed residue position.
 */
export function applyMutation(wtSequence: string, mutation: Mutation): string {
  const { position, wt, mt } = mutation;
  
  if (position < 1 || position > wtSequence.length) {
    throw new Error(`Mutation position ${position} is out of bounds for sequence of length ${wtSequence.length}`);
  }

  // Double check that the wildtype residue matches what is in the sequence (if specified)
  if (wt) {
    const actualWt = wtSequence[position - 1];
    if (actualWt.toUpperCase() !== wt.toUpperCase()) {
      console.warn(`[Mutation Utility] Warning: WT residue mismatch at position ${position}. Sequence has '${actualWt}', mutation specifies '${wt}'.`);
    }
  }

  return wtSequence.substring(0, position - 1) + mt.toUpperCase() + wtSequence.substring(position);
}

import { AMINO_ACID_3_TO_1 } from "../../src/shared/aminoAcids.ts";

export function parseMutationParam(mutation: string): { wtLetter: string; mutLetter: string; posNum: number; chainParam: string } | null {
  if (!mutation || typeof mutation !== "string" || mutation.length > 80) return null;
  let clean = mutation;
  const parenMatch = mutation.match(/\((p\.[^)]+)\)/);
  if (parenMatch) {
    clean = parenMatch[1];
  }
  clean = clean.replace(/^p\./i, "").trim();

  // 1. FoldX 4-part format: e.g. RA408W (WT=R, Chain=A, Pos=408, Mut=W)
  const foldxMatch = clean.match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$/);
  if (foldxMatch) {
    return {
      wtLetter: foldxMatch[1].toUpperCase(),
      chainParam: foldxMatch[2].toUpperCase(),
      posNum: parseInt(foldxMatch[3], 10),
      mutLetter: foldxMatch[4].toUpperCase()
    };
  }

  // 2. Standard 1-letter missense: e.g. R408W (WT=R, Pos=408, Mut=W)
  const standard1Match = clean.match(/^([a-zA-Z])(\d+)([a-zA-Z])$/);
  if (standard1Match) {
    return {
      wtLetter: standard1Match[1].toUpperCase(),
      chainParam: "",
      posNum: parseInt(standard1Match[2], 10),
      mutLetter: standard1Match[3].toUpperCase()
    };
  }

  // 3. 3-letter HGVS format: e.g. Arg408Trp
  const standard3Match = clean.match(/^([a-zA-Z]{3})(\d+)([a-zA-Z]{3})$/);
  if (standard3Match) {
    const wtLetter = AMINO_ACID_3_TO_1[standard3Match[1].toUpperCase()];
    const mutLetter = AMINO_ACID_3_TO_1[standard3Match[3].toUpperCase()];
    if (wtLetter && mutLetter) {
      return {
        wtLetter,
        chainParam: "",
        posNum: parseInt(standard3Match[2], 10),
        mutLetter
      };
    }
  }

  return null;
}


import { CLINVAR_AA_MAP } from "../../../../src/shared/aminoAcids.ts";

/**
 * Normalizes a variant representation (e.g. p.Arg408Trp or r408w) to uppercase 1-letter format (R408W).
 */
export function normalizeProteinChangeTo1Letter(variantStr: string): string | null {
  const clean = variantStr.replace(/^p\./i, "").trim().toLowerCase();

  // Try 3-letter match e.g. arg408trp
  const match3 = clean.match(/^([a-z]{3})(\d+)([a-z]{3})$/);
  if (match3) {
    const wt1 = CLINVAR_AA_MAP[match3[1]];
    const pos = match3[2];
    const mut1 = CLINVAR_AA_MAP[match3[3]];
    if (wt1 && mut1) {
      return `${wt1.toUpperCase()}${pos}${mut1.toUpperCase()}`;
    }
  }

  // Try 1-letter match e.g. r408w
  const match1 = clean.match(/^([a-z])(\d+)([a-z])$/);
  if (match1) {
    return `${match1[1].toUpperCase()}${match1[2]}${match1[3].toUpperCase()}`;
  }

  return null;
}

/**
 * Checks if a variant syntax indicates a truncating/null mutation (stop, frameshift, deletion, insertion).
 */
export function isNullVariant(variantStr: string): boolean {
  if (!variantStr || typeof variantStr !== "string") return false;
  const clean = variantStr.replace(/^p\./i, "").trim().toLowerCase();
  return clean.includes("ter") || 
         clean.includes("stop") || 
         clean.includes("fs") || 
         clean.endsWith("*") || 
         clean.endsWith("x") || 
         clean.includes("del") || 
         clean.includes("ins") || 
         clean.includes("dup");
}

/**
 * Checks if a variant syntax indicates an in-frame indel (del/ins/dup without frameshift).
 */
export function isInFrameIndel(variantStr: string): boolean {
  if (!variantStr || typeof variantStr !== "string") return false;
  const clean = variantStr.replace(/^p\./i, "").trim().toLowerCase();
  return (clean.includes("del") || clean.includes("ins") || clean.includes("dup")) && !clean.includes("fs");
}

/**
 * Checks if an indel position resides in a repetitive sequence motif (homopolymer / 3+ repeats).
 */
export function isIndelInRepeatRegion(sequence: string, pos: number): boolean {
  if (!sequence || isNaN(pos) || pos < 3 || pos > sequence.length - 2) return false;
  const local = sequence.slice(pos - 3, pos + 2);
  return /(.)\1\1/.test(local);
}

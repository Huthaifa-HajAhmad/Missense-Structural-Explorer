// Regex patterns (V-1, V-2, V-4)
//
// ── NOTATION GRAMMAR LIVES IN src/shared/variantNotation.ts ──────────────────
// Protein / genomic / cDNA notation patterns are declared exactly once there and are
// re-exported below to preserve this module's public import surface. Never re-declare
// them locally: the duplicated copies that used to live here drifted out of sync, which
// caused valid genomic queries (e.g. "Chr1(GRCh38):g.25484258G>A") to be rejected with a
// 400 even though Ensembl VEP accepts them.
import {
  HGVS_PATTERN,
  MUTATION_FOLDX_PATTERN,
  CDNA_PATTERN,
  DASHED_GENOMIC_PATTERN,
  GENOMIC_HGVS_PATTERN,
  isGenomicOrCdnaNotation,
} from "../../src/shared/variantNotation.ts";

export {
  HGVS_PATTERN,
  MUTATION_FOLDX_PATTERN,
  CDNA_PATTERN,
  DASHED_GENOMIC_PATTERN,
};

export const GENE_PATTERN = /^[A-Z0-9\-]{1,20}$/i;

export const UNIPROT_PATTERN = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;

/**
 * Strict genomic HGVS, including optional inline assembly annotations
 * ("Chr1(GRCh38):g.25484258G>A") and RefSeq accessions ("NC_000001.11:g.25484258G>A").
 * Alias of {@link GENOMIC_HGVS_PATTERN}.
 *
 * @deprecated Import `GENOMIC_HGVS_PATTERN` from `src/shared/variantNotation.ts` instead.
 * This alias exists only so pre-existing imports keep resolving.
 */
export const VCF_GENOMIC_PATTERN = GENOMIC_HGVS_PATTERN;
export const NONSENSE_PATTERN = /^(?:p\.)?(?:[A-Za-z]{1,4}|\*)(\d{1,6})(?:Ter|\*|Stop|X)$/i;
export const FRAMESHIFT_PATTERN = /^(?:p\.)?(?:[A-Za-z]{1,4})(\d{1,6})(?:[A-Za-z*]+)?(?:fs(?:\*|\w+)?\d*)$/i;
export const INDEL_PATTERN = /^(?:p\.)?(?:[A-Za-z]{1,4}\d{1,6}(?:_[A-Za-z]{1,4}\d{1,6})?)(?:del|ins|dup|delins|inv).*$/i;

const AA_3_TO_1: Record<string, string> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C",
  GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
  LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P",
  SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V"
};

function to1Letter(aa: string): string {
  const upper = aa.toUpperCase();
  if (upper.length === 1) return upper;
  return AA_3_TO_1[upper] || "";
}

export function validateGene(gene: any): string {
  if (!gene || typeof gene !== "string") {
    throw new Error("Gene symbol must be a non-empty string.");
  }
  const trimmed = gene.trim();
  if (!GENE_PATTERN.test(trimmed)) {
    throw new Error(`Invalid gene symbol format: "${trimmed}".`);
  }
  return trimmed.toUpperCase();
}

export function validateVariant(variant: any): string {
  if (!variant || typeof variant !== "string") {
    throw new Error("Variant must be a non-empty string.");
  }
  const trimmed = variant.replace(/[()]/g, "").trim();
  // HGVS "no change" notation, e.g. VariantValidator's `p.(=)` for a UTR / synonymous
  // coordinate. HGVS_PATTERN can never match it, so without this branch it fell through
  // to the generic "Invalid variant format" message, which hid the real diagnosis: the
  // reference translators predict NO amino-acid change, so no missense analysis exists.
  // The word "Synonymous" routes the message to the NON_MISSENSE_VARIANT classifier.
  if (/^(?:p\.)?(?:[A-Za-z]{1,4}\d{1,6})?=$/.test(trimmed)) {
    throw new Error(
      `Synonymous / no-change variant detected: "${trimmed}". The reference translators predict no amino-acid change for this coordinate (e.g. a UTR or synonymous coding change), so no missense analysis is possible.`
    );
  }
  const match = trimmed.match(HGVS_PATTERN);
  if (!match) {
    if (NONSENSE_PATTERN.test(trimmed)) {
      throw new Error(`Nonsense / stop-gain variant detected: "${trimmed}". MissenseResolve specializes in single amino acid substitutions (missense mutations). Truncation and termination variants cannot be modeled with missense biophysical stability predictors (FoldX/DynaMut2).`);
    }
    if (FRAMESHIFT_PATTERN.test(trimmed)) {
      throw new Error(`Frameshift variant detected: "${trimmed}". MissenseResolve specializes in single amino acid substitutions (missense mutations).`);
    }
    if (INDEL_PATTERN.test(trimmed)) {
      throw new Error(`Insertion/deletion variant detected: "${trimmed}". MissenseResolve specializes in single amino acid substitutions (missense mutations).`);
    }
    throw new Error(`Invalid variant format: "${trimmed}". Must match HGVS protein nomenclature (e.g., p.Arg215Trp or R215W).`);
  }

  let wt = match[1];
  const pos = match[2];
  let mut = match[3];

  if (wt.length === 3) {
    wt = wt.charAt(0).toUpperCase() + wt.slice(1).toLowerCase();
  } else {
    wt = wt.toUpperCase();
  }

  if (mut.length === 3) {
    mut = mut.charAt(0).toUpperCase() + mut.slice(1).toLowerCase();
  } else {
    mut = mut.toUpperCase();
  }

  const hasP = trimmed.toLowerCase().startsWith("p.");
  const normalized = (hasP ? "p." : "") + wt + pos + mut;

  const wt1 = to1Letter(wt);
  const mut1 = to1Letter(mut);
  if (wt1 && mut1 && wt1 === mut1) {
    throw new Error(`Synonymous variant detected: "${normalized}". The wild-type and mutant residues are identical.`);
  }
  return normalized;
}

export function validateUniProt(uniprotId: any): string {
  if (!uniprotId || typeof uniprotId !== "string") {
    throw new Error("UniProt accession ID must be a non-empty string.");
  }
  const trimmed = uniprotId.trim();
  if (!UNIPROT_PATTERN.test(trimmed)) {
    throw new Error(`Invalid UniProt accession ID format: "${trimmed}".`);
  }
  return trimmed.toUpperCase();
}

/**
 * True for genomic / cDNA coordinate notations that must first be resolved through the
 * Ensembl VEP translator. Delegates to the shared notation grammar so the audit-log
 * anonymizer, the request router and the UI can never disagree about what counts as a
 * genomic coordinate.
 *
 * Previously this pattern list missed assembly-annotated notations
 * ("Chr1(GRCh38):g.25484258G>A"), which meant those coordinates were written to audit
 * logs WITHOUT pseudonymization.
 */
export function isGenomicCoordinate(val: string): boolean {
  if (typeof val !== "string") return false;
  return isGenomicOrCdnaNotation(val);
}

export function formatZodError(error: any): string {
  if (error && Array.isArray(error.issues)) {
    return error.issues.map((e: any) => `${e.path.join(".")}: ${e.message}`).join(", ");
  }
  return "Invalid request body format.";
}

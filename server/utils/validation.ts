// Regex patterns (V-1, V-2, V-4)
export const GENE_PATTERN = /^[A-Z0-9\-]{1,20}$/i;

const IUPAC_3 = "(?:Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val)";
const IUPAC_1 = "[ARNDCQEGHILKMFPSTWYV]";
export const HGVS_PATTERN = new RegExp(`^(?:p\\.)?(${IUPAC_3}|${IUPAC_1})(\\d{1,6})(${IUPAC_3}|${IUPAC_1})$`, "i");

export const UNIPROT_PATTERN = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;
export const MUTATION_FOLDX_PATTERN = /^[ARNDCQEGHILKMFPSTWYV][A-Z]\d+[ARNDCQEGHILKMFPSTWYV]$/i;
export const VCF_GENOMIC_PATTERN = /^(?:chr)?[0-9XYMT]+:g\.\d+[A-Z]>[A-Z]$/i;
export const CDNA_PATTERN = /^(?:[A-Z0-9_.]+:)?c\.\d+[A-Z]>[A-Z]$/i;
export const DASHED_GENOMIC_PATTERN = /^(?:chr)?([0-9XYMT]+)-(\d+)-([ACGTN]+)-([ACGTN]+)$/i;
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

export function isGenomicCoordinate(val: string): boolean {
  if (typeof val !== "string") return false;
  const trimmed = val.trim();
  return (
    /^(?:chr)?[0-9XYMT]+:g\./i.test(trimmed) ||
    /^(?:chr)?[0-9XYMT]+-\d+-[ACGTN]+-[ACGTN]+/i.test(trimmed) ||
    /^(?:[A-Z0-9_.]+:)?c\.\d+/i.test(trimmed) ||
    /^(?:[A-Z0-9_.]+:)?g\.\d+/i.test(trimmed) ||
    /^(?:chr)?[0-9XYMT]+:\d+/i.test(trimmed)
  );
}

export function formatZodError(error: any): string {
  if (error && Array.isArray(error.issues)) {
    return error.issues.map((e: any) => `${e.path.join(".")}: ${e.message}`).join(", ");
  }
  return "Invalid request body format.";
}

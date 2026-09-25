/**
 * UniProt accession normalisation.
 *
 * The sequence endpoint accepts an accession case-insensitively, so every consumer that compares
 * two accession strings has to fold them the same way or a keyed cache silently misses.
 */
export function normalizeUniprotAccession(accession: string | null | undefined): string {
  return (accession || "").trim().toUpperCase();
}

/** What the sequence route accepts: letters, digits and the fragment hyphen. */
export const UNIPROT_ACCESSION_PATTERN = /^[A-Z0-9-]+$/;

export function isUsableUniprotAccession(accession: string | null | undefined): boolean {
  return UNIPROT_ACCESSION_PATTERN.test(normalizeUniprotAccession(accession));
}

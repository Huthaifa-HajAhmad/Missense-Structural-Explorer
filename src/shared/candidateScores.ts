/**
 * candidateScores.ts — single-allele scores on a run with several candidate alleles.
 *
 * CADD scores one exact nucleotide allele, and G>A and G>C at the same base get different scores.
 * On a protein-only input that several alleles can produce, no allele is selected, so the run has no
 * single CADD and CADD does not vote. Each candidate's own score is still shown, with its source.
 * Pure.
 */
import { candidateNucleotideChange } from "./candidateFrequency.ts";
import type { AlleleCandidate } from "./locusResolution.ts";

/** The note the CADD reading carries on a candidate run; null when there are no candidates. */
export function candidateCaddNote(candidates: ReadonlyArray<AlleleCandidate> | null | undefined): string | null {
  if (!candidates?.length) return null;
  const each = candidates.map(c => {
    const name = candidateNucleotideChange(c) ?? c.id ?? c.grch37Id ?? "allele";
    return typeof c.caddPhred === "number" ? `${name} ${c.caddPhred} from ${c.caddSource ?? "a source not stated"}` : `${name} not reported`;
  });
  return `Each candidate allele has its own CADD: ${each.join("; ")}. No single allele was selected, so CADD does not vote.`;
}

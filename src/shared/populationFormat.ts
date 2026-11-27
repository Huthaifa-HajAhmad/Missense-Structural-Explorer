/**
 * populationFormat.ts — the one sentence for a ClinVar review-star count, shared by every surface that
 * prints one. The 0–4 value itself comes from `reviewStars` in components/evidence/population/populationFormat.ts.
 */

/** A review-star count as a sentence: "2 of 4 review stars". */
export function reviewStarsText(stars: number): string {
  return `${stars} of 4 review stars`;
}

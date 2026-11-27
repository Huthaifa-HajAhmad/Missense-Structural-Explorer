/**
 * plddtFormat.ts — how an AlphaFold pLDDT (a 0–100 confidence score for each residue) is printed.
 *
 * One decimal on every surface. Whole numbers can cross the 50, 70 and 90 band edges: 69.6 would read
 * "70", which is the confident band, so a residue that is just below the edge would look confident.
 */

/** A pLDDT with one decimal place: 69.6 → "69.6", 94 → "94.0". */
export function formatPlddt(value: number): string {
  return value.toFixed(1);
}

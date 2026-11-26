/**
 * Which solved structures have coordinates for a residue, in UniProt numbering.
 *
 * PDBe (`graph-api/uniprot/unipdb/{accession}`) gives, for each entry's best chain, the residue ranges
 * the model has atoms for ("observed"). An entry that holds the protein but has no atoms at a residue
 * says nothing about that residue, so it must not count in "k of n structures" there, and "no
 * coordinates" must never read as a negative ("not at the interface", "covers the site").
 *
 * Shared by the server (which reads PDBe) and the browser (which reads the ranges stored on the
 * assembly payload), so both count the same way.
 */

/** Observed residue ranges of one entry, inclusive, UniProt numbering. */
export type ObservedRanges = ReadonlyArray<readonly [number, number]>;

/**
 * Of `entries`, those that model `position`. An entry with no ranges listed is kept: nothing says it
 * lacks the residue, and dropping it would invent a "not modelled".
 */
export function entriesModelling(ranges: ReadonlyMap<string, ObservedRanges>, entries: readonly string[], position: number): string[] {
  return entries.filter(e => {
    const observed = ranges.get(e.toLowerCase());
    return !observed || observed.some(([start, end]) => start <= position && position <= end);
  });
}

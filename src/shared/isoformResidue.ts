/** Residues each side of the variant that must match, so 21 in all. */
const FLANK = 10;

/**
 * The same residue's number on another isoform, found by its neighbourhood: the 21 residues around
 * it (fewer at a protein end) must occur exactly once in the other sequence, and the wild type must
 * be the variant's. Anything else gives null, never a guess. Shared by popEVE (scores published on
 * another isoform) and the ortholog alignment (Ensembl Compara aligns one human isoform per gene).
 */
export function mapIsoformResidue(fromSeq: string, toSeq: string, pos: number, wt: string): number | null {
  const i = pos - 1;
  if (fromSeq[i] !== wt) return null;
  const start = Math.max(0, i - FLANK);
  const window = fromSeq.slice(start, i + FLANK + 1);
  const first = toSeq.indexOf(window);
  if (first === -1 || toSeq.indexOf(window, first + 1) !== -1) return null;
  const mapped = first + (i - start);
  return toSeq[mapped] === wt ? mapped + 1 : null;
}

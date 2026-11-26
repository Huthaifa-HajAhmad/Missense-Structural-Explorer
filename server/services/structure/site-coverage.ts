/**
 * Whether a solved structure has coordinates at the variant residue, from what PDBe reports.
 *
 * `best_structures` gives each chain's construct range, which says nothing about unresolved residues.
 * `unipdb` (see `pdbe-coverage.ts`) says which residues have atoms, but only for the best chain of each
 * entry. Another copy of the chain can resolve a few residues more at the edge of a gap, so there the
 * answer is "cannot say" and the coordinates themselves must be read.
 */
import type { ResidueCoverage } from "../external-api/pdbe-coverage.ts";
import { entriesModelling } from "../../../src/shared/residueCoverage.ts";

/**
 * How far past the best chain's last observed residue another copy may still have coordinates.
 * Measured 2026-11-26 by comparing the copies inside 193 multi-chain entries of six proteins: every
 * residue only another copy resolved lay within 3 residues of one the best chain resolved.
 */
export const GAP_EDGE_RESIDUES = 5;

interface ChainRow {
  pdb_id: string;
  chain_id: string;
}

/** Distinct chains of the protein per entry (lower-case PDB id). */
export function chainCounts(rows: ReadonlyArray<ChainRow>): Map<string, number> {
  const chains = new Map<string, Set<string>>();
  for (const row of rows) {
    const id = row.pdb_id.toLowerCase();
    chains.set(id, (chains.get(id) ?? new Set()).add(row.chain_id));
  }
  return new Map([...chains].map(([id, set]) => [id, set.size]));
}

/** True or false when PDBe's coverage settles it; undefined when it cannot say. */
export function entryModelsSite(coverage: ResidueCoverage, pdbId: string, position: number, chains: number): boolean | undefined {
  const observed = coverage.entries.get(pdbId.toLowerCase());
  if (!observed) return undefined;
  if (entriesModelling(coverage.entries, [pdbId], position).length) return true;
  const atGapEdge = chains > 1 && observed.some(([start, end]) => position >= start - GAP_EDGE_RESIDUES && position <= end + GAP_EDGE_RESIDUES);
  return atGapEdge ? undefined : false;
}

/** The rows worth examining at `position`: all but those whose entry certainly has no coordinates there. */
export function rowsModellingSite<T extends ChainRow>(rows: ReadonlyArray<T>, coverage: ResidueCoverage, position: number): T[] {
  const counts = chainCounts(rows);
  return rows.filter(row => entryModelsSite(coverage, row.pdb_id, position, counts.get(row.pdb_id.toLowerCase()) ?? 1) !== false);
}

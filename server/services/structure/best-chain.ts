/**
 * Chooses the experimental chain to model a variant on, by local quality (STRUCTURE_SELECTION_RULE.md).
 *
 * The caller passes PDBe `best_structures` rows that cover the variant and a `verify` step that returns
 * the chain numbered by UniProt (or null when it does not verify). Only the first MAX_CHAINS_EXAMINED
 * rows in a fixed order (resolution, coverage, PDB ID, chain ID) are downloaded, so the result is the
 * best chain examined, and the number left out is reported.
 */
import { compareChainCandidates, scoreLocalQuality, type ChainCandidate } from "./chain-quality.ts";

export const MAX_CHAINS_EXAMINED = 4;

/** The fields of a PDBe `best_structures` row this choice reads. */
export interface BestStructureRow {
  pdb_id: string;
  chain_id: string;
  resolution?: number | null;
  coverage?: number | null;
  unp_start: number;
  unp_end: number;
  start: number;
}

export interface BestChainChoice {
  row: BestStructureRow;
  quality: ChainCandidate;
  examined: number;
  omitted: number;
}

const measured = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** The examination order fixed by the rule; it never depends on the order PDBe returned. */
function examinationOrder(a: BestStructureRow, b: BestStructureRow): number {
  const res = (r: BestStructureRow) => measured(r.resolution) ?? Number.POSITIVE_INFINITY;
  return res(a) - res(b)
    || (measured(b.coverage) ?? -1) - (measured(a.coverage) ?? -1)
    || (a.pdb_id < b.pdb_id ? -1 : a.pdb_id > b.pdb_id ? 1 : 0)
    || (a.chain_id < b.chain_id ? -1 : a.chain_id > b.chain_id ? 1 : 0);
}

export async function chooseBestChain(
  rows: BestStructureRow[],
  position: number,
  wildType: string,
  verify: (row: BestStructureRow) => Promise<string | null>
): Promise<BestChainChoice | null> {
  const distinct = [...new Map(rows.map(r => [`${r.pdb_id.toLowerCase()}:${r.chain_id}`, r])).values()].sort(examinationOrder);
  const examined = distinct.slice(0, MAX_CHAINS_EXAMINED);
  const scored = await Promise.all(examined.map(async row => {
    const pdbText = await verify(row).catch(() => null);
    const quality = pdbText ? scoreLocalQuality(pdbText, row.chain_id, position, wildType) : null;
    return quality ? { row, quality: { ...quality, pdbId: row.pdb_id.toLowerCase(), chainId: row.chain_id, resolution: measured(row.resolution), coverage: measured(row.coverage) } } : null;
  }));
  const eligible = scored.filter((s): s is { row: BestStructureRow; quality: ChainCandidate } => s !== null);
  if (!eligible.length) return null;
  const best = eligible.sort((a, b) => compareChainCandidates(a.quality, b.quality))[0];
  return { ...best, examined: examined.length, omitted: distinct.length - examined.length };
}

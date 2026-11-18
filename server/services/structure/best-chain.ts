/**
 * Chooses the experimental chain to model a variant on, by local quality (STRUCTURE_SELECTION_RULE.md).
 *
 * The caller passes PDBe `best_structures` rows that cover the variant and a `verify` step that returns
 * the chain numbered by UniProt (or null when it does not verify). Rows are examined in a fixed order
 * (resolution, coverage, PDB ID, chain ID) until MAX_CHAINS_EXAMINED eligible chains are found or
 * MAX_CHAINS_DOWNLOADED have been downloaded, so the result is the best chain examined; the number
 * left out and the number refused as not the wild type are reported.
 */
import { compareChainCandidates, scoreLocalQuality, type ChainCandidate } from "./chain-quality.ts";

/** Eligible chains to compare before choosing. */
export const MAX_CHAINS_EXAMINED = 4;
/** Chains downloaded at most, when many are not the wild type (TP53: the sharpest are engineered constructs). */
export const MAX_CHAINS_DOWNLOADED = 12;

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
  /** Chains downloaded and checked. */
  examined: number;
  /** Covering chains never downloaded. */
  omitted: number;
  /** Examined chains refused because their sequence differs from the UniProt wild type. */
  notWildType: number;
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
  verify: (row: BestStructureRow) => Promise<string | null>,
  isWildType: (row: BestStructureRow, pdbText: string) => boolean = () => true
): Promise<BestChainChoice | null> {
  const distinct = [...new Map(rows.map(r => [`${r.pdb_id.toLowerCase()}:${r.chain_id}`, r])).values()].sort(examinationOrder);
  const eligible: { row: BestStructureRow; quality: ChainCandidate }[] = [];
  let examined = 0;
  let notWildType = 0;
  // In batches, in the fixed order, until enough eligible chains are found or the download cap is reached.
  while (eligible.length < MAX_CHAINS_EXAMINED && examined < Math.min(distinct.length, MAX_CHAINS_DOWNLOADED)) {
    const batch = distinct.slice(examined, Math.min(examined + MAX_CHAINS_EXAMINED, MAX_CHAINS_DOWNLOADED));
    examined += batch.length;
    const results = await Promise.all(batch.map(async row => {
      const pdbText = await verify(row).catch(() => null);
      if (!pdbText) return null;
      if (!isWildType(row, pdbText)) { notWildType += 1; return null; }
      const quality = scoreLocalQuality(pdbText, row.chain_id, position, wildType);
      return quality ? { row, quality: { ...quality, pdbId: row.pdb_id.toLowerCase(), chainId: row.chain_id, resolution: measured(row.resolution), coverage: measured(row.coverage) } } : null;
    }));
    for (const r of results) if (r) eligible.push(r);
  }
  if (!eligible.length) return null;
  const best = eligible.sort((a, b) => compareChainCandidates(a.quality, b.quality))[0];
  return { ...best, examined, omitted: distinct.length - examined, notWildType };
}

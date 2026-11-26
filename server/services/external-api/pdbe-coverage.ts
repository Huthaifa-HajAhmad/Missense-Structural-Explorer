/**
 * pdbe-coverage.ts — which residues each solved structure actually models, in UniProt numbering.
 *
 * Endpoint: https://www.ebi.ac.uk/pdbe/graph-api/uniprot/unipdb/{accession} (PDBe aggregated API).
 * One call per protein. For every PDB entry it gives the best chain's residues as ranges flagged
 * `observed: "Y"` (atoms in the model) or `"N"` (in the construct, no coordinates). A residue that no
 * range covers is not in the construct at all, so it is not modelled either.
 *
 * WHY THIS EXISTS. PDBe-KB's interface list names every entry that holds a pair of proteins, whether
 * or not a given residue has coordinates in it. ABCG1 p.Gly358Arg read "not at the interface in 0 of
 * 5 solved structures" while Gly358 sits in a linker that none of the five resolves (7OZ1 models
 * 96–345 and 398–676; residue 358 has `observed_ratio` 0). "No coordinates" is not "no contact":
 * an entry counts towards a residue's denominator only when it models that residue
 * (doc/INTERFACES_PPI_AUDIT_2026-11-26.md, C1).
 *
 * Limit: PDBe reports the best chain of each entry. In a homodimer both chains are usually built
 * from the same construct, so one chain stands for the entry.
 */
import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";

/** Observed residue ranges per entry (lower-case PDB id), and the protein's length. */
export interface ResidueCoverage {
  length: number | null;
  entries: ReadonlyMap<string, ReadonlyArray<readonly [number, number]>>;
}

const cache = new LRUCache<string, ResidueCoverage>({ max: 500, ttl: 7 * 24 * 60 * 60 * 1000 });

export function clearResidueCoverageCache(): void {
  cache.clear();
}

/** Parse a PDBe `unipdb` payload. Exported for tests. */
export function parseUnipdbCoverage(json: unknown, accession: string): ResidueCoverage {
  const root = (json as Record<string, any> | null)?.[accession] ?? (json as Record<string, any> | null)?.[accession.toLowerCase()];
  const entries = new Map<string, Array<readonly [number, number]>>();
  for (const item of Array.isArray(root?.data) ? root.data : []) {
    if (typeof item?.accession !== "string") continue;
    const ranges = (Array.isArray(item.residues) ? item.residues : [])
      .filter((r: any) => r?.observed === "Y" && Number.isInteger(r.startIndex) && Number.isInteger(r.endIndex) && r.endIndex >= r.startIndex)
      .map((r: any) => [r.startIndex, r.endIndex] as const);
    entries.set(item.accession.toLowerCase(), ranges);
  }
  const length = Number(root?.length);
  return { length: Number.isInteger(length) && length > 0 ? length : null, entries };
}

/**
 * Of `entries`, those that model `position`. An entry PDBe did not list is kept: nothing says it
 * lacks the residue, and dropping it would invent a "not modelled".
 */
export function entriesModelling(coverage: ResidueCoverage, entries: readonly string[], position: number): string[] {
  return entries.filter(e => {
    const ranges = coverage.entries.get(e);
    return !ranges || ranges.some(([start, end]) => start <= position && position <= end);
  });
}

/** Stretches of the protein that none of `entries` models (only entries PDBe listed are read). */
export function unmodelledStretches(coverage: ResidueCoverage, entries: readonly string[]): Array<{ start: number; end: number }> {
  const known = entries.map(e => coverage.entries.get(e)).filter((r): r is ReadonlyArray<readonly [number, number]> => Boolean(r));
  if (!known.length || coverage.length === null) return [];
  const modelled = new Uint8Array(coverage.length + 2);
  for (const ranges of known) {
    for (const [start, end] of ranges) for (let p = Math.max(1, start); p <= Math.min(coverage.length, end); p++) modelled[p] = 1;
  }
  const out: Array<{ start: number; end: number }> = [];
  for (let p = 1; p <= coverage.length; p++) {
    if (modelled[p]) continue;
    const start = p;
    while (p < coverage.length && !modelled[p + 1]) p++;
    out.push({ start, end: p });
  }
  return out;
}

/** The coverage of every entry of `accession`, or null when PDBe did not answer (never cached). */
export async function fetchResidueCoverage(accession: string, signal?: AbortSignal): Promise<ResidueCoverage | null> {
  const hit = cache.get(accession);
  if (hit) return hit;
  try {
    const res = await fetchWithRetry(
      `https://www.ebi.ac.uk/pdbe/graph-api/uniprot/unipdb/${accession}`,
      { headers: { Accept: "application/json", "User-Agent": "Missense-Structural-Explorer/1.0" }, timeout: 15000, signal },
      2
    );
    if (!res.ok) return null;
    const coverage = parseUnipdbCoverage(await res.json(), accession);
    if (!coverage.entries.size) return null;
    cache.set(accession, coverage);
    return coverage;
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    return null;
  }
}

/**
 * pdbe-entries.ts — what a binding-change estimate needs from one solved structure: its method and
 * resolution, where the variant residue sits in it (chain and AUTHOR number, which can differ from
 * UniProt numbering), and its coordinates.
 *
 *   • experiment     https://www.ebi.ac.uk/pdbe/api/pdb/entry/experiment/{id}
 *   • SIFTS mapping  https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/{id}  (UniProt → entity sequence)
 *   • residues       https://www.ebi.ac.uk/pdbe/api/pdb/entry/residue_listing/{id}/chain/{chain}
 *                    (entity sequence number → author number, residue name, observed or not)
 *   • coordinates    https://files.rcsb.org/download/{ID}.pdb  (large entries exist only as mmCIF;
 *                    those answer 404 and are skipped, never converted by guesswork)
 *
 * Every lookup can fail on its own; a failure returns null and the caller tries the next entry.
 */
import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";
import { AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";

const HEADERS = { Accept: "application/json", "User-Agent": "Missense-Structural-Explorer/1.0" };
const jsonCache = new LRUCache<string, any>({ max: 300, ttl: 7 * 24 * 60 * 60 * 1000 });
const pdbCache = new LRUCache<string, string>({
  max: 20,
  maxSize: 80 * 1024 * 1024,
  sizeCalculation: v => v.length || 1,
  ttl: 24 * 60 * 60 * 1000,
});

async function getJson(url: string, signal?: AbortSignal): Promise<any | null> {
  const hit = jsonCache.get(url);
  if (hit !== undefined) return hit;
  try {
    const res = await fetchWithRetry(url, { headers: HEADERS, timeout: 15000, signal });
    if (!res.ok) return null;
    const body = await res.json();
    jsonCache.set(url, body);
    return body;
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    return null;
  }
}

export interface EntryExperiment {
  method: string | null;
  resolution: number | null;
}

export async function fetchEntryExperiment(pdbId: string, signal?: AbortSignal): Promise<EntryExperiment | null> {
  const id = pdbId.toLowerCase();
  const body = await getJson(`https://www.ebi.ac.uk/pdbe/api/pdb/entry/experiment/${id}`, signal);
  const e = body?.[id]?.[0];
  if (!e) return null;
  const resolution = Number(e.resolution);
  return {
    method: typeof e.experimental_method === "string" ? e.experimental_method : null,
    resolution: Number.isFinite(resolution) && resolution > 0 ? resolution : null,
  };
}

export interface ResidueLocation {
  chain: string;
  authorResidue: number;
  residueName: string;
  /** One-letter code of the residue the entry has there. */
  residueLetter: string | null;
}

/**
 * Where UniProt residue `position` of `accession` sits in entry `pdbId`: the first chain that has it
 * OBSERVED (modelled, not just in the sequence) with no insertion code. Null when no chain does.
 */
export async function locateResidue(
  pdbId: string,
  accession: string,
  position: number,
  signal?: AbortSignal
): Promise<ResidueLocation | null> {
  const id = pdbId.toLowerCase();
  const acc = accession.toUpperCase().replace(/-\d+$/, "");
  const sifts = await getJson(`https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/${id}`, signal);
  const segments: any[] = sifts?.[id]?.UniProt?.[acc]?.mappings ?? [];
  const candidates = segments
    .filter(m => Number(m.unp_start) <= position && position <= Number(m.unp_end) && Number.isFinite(Number(m.start?.residue_number)))
    .map(m => ({ chain: String(m.chain_id), seqNumber: position - Number(m.unp_start) + Number(m.start.residue_number) }));

  for (const c of candidates) {
    const listing = await getJson(`https://www.ebi.ac.uk/pdbe/api/pdb/entry/residue_listing/${id}/chain/${encodeURIComponent(c.chain)}`, signal);
    const residues: any[] = listing?.[id]?.molecules?.flatMap((m: any) => m.chains ?? []).flatMap((ch: any) => ch.residues ?? []) ?? [];
    const r = residues.find(x => Number(x.residue_number) === c.seqNumber);
    if (!r || !(Number(r.observed_ratio) > 0) || r.author_insertion_code || !Number.isInteger(Number(r.author_residue_number))) continue;
    const name = String(r.residue_name ?? "").toUpperCase();
    return {
      chain: c.chain,
      authorResidue: Number(r.author_residue_number),
      residueName: name,
      residueLetter: AMINO_ACID_3_TO_1[name] ?? null,
    };
  }
  return null;
}

/** The entry in legacy PDB format, or null when it exists only as mmCIF or cannot be read. */
export async function fetchPdbFormat(pdbId: string, signal?: AbortSignal): Promise<string | null> {
  const id = pdbId.toUpperCase();
  const hit = pdbCache.get(id);
  if (hit) return hit;
  try {
    const res = await fetchWithRetry(`https://files.rcsb.org/download/${id}.pdb`, { timeout: 30000, signal });
    if (!res.ok) return null;
    const text = await res.text();
    if (!/^ATOM/m.test(text)) return null;
    pdbCache.set(id, text);
    return text;
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    return null;
  }
}

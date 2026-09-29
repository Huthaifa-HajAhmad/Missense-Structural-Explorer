/**
 * pdbe-interfaces.ts — protein–protein interface residues observed in solved PDB structures,
 * aggregated per UniProt accession by PDBe-KB.
 *
 * Endpoint: https://www.ebi.ac.uk/pdbe/graph-api/uniprot/interface_residues/{accession}
 * (PDBe aggregated API; Varadi et al., Bioinformatics 2021, 10.1093/bioinformatics/btab424).
 * The response is `{ [accession]: { data: [{ accession, name, residues: [{ startIndex, endIndex,
 * allPDBEntries? }], allPDBEntries? }] } }`, residue numbers in UniProt numbering.
 *
 * Why the Multimer tab reads it: a solved complex answers "is this residue at an interface" by
 * observation, where a Boltz-2 model can only predict it — and it covers heteromers (NAE1–UBA3),
 * which the prediction path cannot always build.
 *
 * Absence is typed: a 404 means PDBe holds no interface for this accession ("none"); anything else
 * that fails is "error" and is never reported as "no interface".
 */
import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";

export interface PdbeInterfacePartner {
  /** Partner UniProt accession; the query's own accession for a homomeric interface. */
  accession: string;
  /** Partner name as PDBe gives it. */
  name: string;
  /** Interface residues on the QUERY protein, UniProt numbering, sorted, unique. */
  residues: number[];
  /** PDB entries showing this interface (lower-case ids), when PDBe lists them. */
  pdbEntries: string[];
}

export type PdbeInterfaceLookup =
  | { status: "ok"; partners: PdbeInterfacePartner[] }
  | { status: "none"; partners: [] }
  | { status: "error"; partners: []; reason: string };

const cache = new LRUCache<string, PdbeInterfaceLookup>({ max: 500, ttl: 7 * 24 * 60 * 60 * 1000 });

export function clearPdbeInterfaceCache(): void {
  cache.clear();
}

const ACCESSION_RE = /^[A-Z0-9]{6,10}(?:-\d+)?$/;

/** Parse a PDBe interface_residues payload. Exported for tests; tolerant of missing optional keys. */
export function parsePdbeInterfaces(json: unknown, accession: string): PdbeInterfacePartner[] {
  const root = (json as Record<string, any> | null)?.[accession] ?? (json as Record<string, any> | null)?.[accession.toLowerCase()];
  const items: any[] = Array.isArray(root?.data) ? root.data : [];
  const partners: PdbeInterfacePartner[] = [];
  for (const item of items) {
    const partnerAcc = typeof item?.accession === "string" ? item.accession.trim() : "";
    if (!partnerAcc) continue;
    const residues = new Set<number>();
    const entries = new Set<string>();
    for (const e of Array.isArray(item?.allPDBEntries) ? item.allPDBEntries : []) {
      if (typeof e === "string") entries.add(e.toLowerCase());
    }
    for (const r of Array.isArray(item?.residues) ? item.residues : []) {
      const start = Number(r?.startIndex);
      const end = Number.isFinite(Number(r?.endIndex)) ? Number(r.endIndex) : start;
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start || end - start > 5000) continue;
      for (let p = start; p <= end; p++) residues.add(p);
      for (const e of Array.isArray(r?.allPDBEntries) ? r.allPDBEntries : []) {
        if (typeof e === "string") entries.add(e.toLowerCase());
      }
      for (const e of Array.isArray(r?.interactingPDBEntries) ? r.interactingPDBEntries : []) {
        if (typeof e?.pdbId === "string") entries.add(e.pdbId.toLowerCase());
      }
    }
    if (residues.size === 0) continue;
    partners.push({
      accession: partnerAcc,
      name: typeof item?.name === "string" && item.name.trim() ? item.name.trim() : partnerAcc,
      residues: [...residues].sort((a, b) => a - b),
      pdbEntries: [...entries].sort(),
    });
  }
  // Most-observed interface first: the reader's first row is the best-attested one.
  return partners.sort((a, b) => b.pdbEntries.length - a.pdbEntries.length || b.residues.length - a.residues.length);
}

export async function fetchPdbeInterfaces(uniprotId: string, signal?: AbortSignal): Promise<PdbeInterfaceLookup> {
  const accession = uniprotId.trim().toUpperCase();
  if (!ACCESSION_RE.test(accession)) {
    return { status: "error", partners: [], reason: "The UniProt accession is not in a form PDBe accepts." };
  }
  const hit = cache.get(accession);
  if (hit) return hit;

  try {
    const response = await fetchWithRetry(
      `https://www.ebi.ac.uk/pdbe/graph-api/uniprot/interface_residues/${accession}`,
      { headers: { Accept: "application/json", "User-Agent": "Missense-Structural-Explorer/1.0" }, timeout: 15000, signal }
    );
    if (response.status === 404) {
      const none: PdbeInterfaceLookup = { status: "none", partners: [] };
      cache.set(accession, none);
      return none;
    }
    if (!response.ok) {
      return { status: "error", partners: [], reason: `PDBe answered HTTP ${response.status}.` };
    }
    const partners = parsePdbeInterfaces(await response.json(), accession);
    const result: PdbeInterfaceLookup = partners.length ? { status: "ok", partners } : { status: "none", partners: [] };
    cache.set(accession, result);
    return result;
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    return { status: "error", partners: [], reason: "PDBe did not answer." };
  }
}

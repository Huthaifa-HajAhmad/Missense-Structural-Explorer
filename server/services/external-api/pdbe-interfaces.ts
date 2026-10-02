/**
 * pdbe-interfaces.ts — protein–protein interface residues observed in solved PDB structures,
 * aggregated per UniProt accession by PDBe-KB.
 *
 * Endpoint: https://www.ebi.ac.uk/pdbe/graph-api/uniprot/interface_residues/{accession}
 * (PDBe aggregated API; Varadi et al., Bioinformatics 2021, 10.1093/bioinformatics/btab424).
 * The response is `{ [accession]: { data: [{ accession, name, residues: [{ startIndex, endIndex,
 * allPDBEntries, interactingPDBEntries: [{ pdbId, entityId, chainIds }] }] }] } }`, residue numbers
 * in UniProt numbering.
 *
 * Two lists per residue, and they mean different things:
 *   • `allPDBEntries`         — every structure that contains this pair of proteins;
 *   • `interactingPDBEntries` — the structures in which THIS residue is at the interface.
 * The earlier reader merged both into one partner-level set, so "Gln867 is at the interface in 8
 * solved structures" was printed for a residue at the SLC12A4 dimer interface in one of eight (7AIQ).
 * Support is now kept per residue: `support[i]` of `pdbEntries.length`.
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
  /** Interacting entries per residue (lower-case ids), same order as `residues`. */
  residueEntries: string[][];
  /** Structures that contain this pair (lower-case ids). */
  pdbEntries: string[];
  /** Set when the partner is a construct tag, with the tag's name. */
  artefact: string | null;
}

export type PdbeInterfaceLookup =
  | { status: "ok"; partners: PdbeInterfacePartner[] }
  | { status: "none"; partners: [] }
  | { status: "error"; partners: []; reason: string };

/**
 * Proteins fused or co-crystallised to help a structure solve. An interface with one of these is a
 * property of the construct, not of the protein's biology (NAE1 shows an interface with E. coli
 * maltose-binding protein in PDBe-KB). Matched by accession only.
 */
export const CONSTRUCT_TAGS: Record<string, string> = {
  P0AEX9: "maltose-binding protein fusion tag",
  P0AEY0: "maltose-binding protein fusion tag",
  P00720: "T4 lysozyme fusion",
  P0ABE7: "BRIL (cytochrome b562) fusion",
  P42212: "green fluorescent protein tag",
  P08515: "glutathione S-transferase tag",
  P0AA25: "thioredoxin fusion tag",
};

const cache = new LRUCache<string, PdbeInterfaceLookup>({ max: 500, ttl: 7 * 24 * 60 * 60 * 1000 });

export function clearPdbeInterfaceCache(): void {
  cache.clear();
}

const ACCESSION_RE = /^[A-Z0-9]{6,10}(?:-\d+)?$/;

const ids = (xs: unknown): string[] =>
  Array.isArray(xs) ? xs.filter((e): e is string => typeof e === "string").map(e => e.toLowerCase()) : [];

/** Parse a PDBe interface_residues payload. Exported for tests; tolerant of missing optional keys. */
export function parsePdbeInterfaces(json: unknown, accession: string): PdbeInterfacePartner[] {
  const root = (json as Record<string, any> | null)?.[accession] ?? (json as Record<string, any> | null)?.[accession.toLowerCase()];
  const items: any[] = Array.isArray(root?.data) ? root.data : [];
  const partners: PdbeInterfacePartner[] = [];
  for (const item of items) {
    const partnerAcc = typeof item?.accession === "string" ? item.accession.trim() : "";
    if (!partnerAcc) continue;
    const byResidue = new Map<number, Set<string>>();
    const entries = new Set<string>(ids(item?.allPDBEntries));
    for (const r of Array.isArray(item?.residues) ? item.residues : []) {
      const start = Number(r?.startIndex);
      const end = Number.isFinite(Number(r?.endIndex)) ? Number(r.endIndex) : start;
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start || end - start > 5000) continue;
      for (const e of ids(r?.allPDBEntries)) entries.add(e);
      const interacting = (Array.isArray(r?.interactingPDBEntries) ? r.interactingPDBEntries : [])
        .map((e: any) => (typeof e?.pdbId === "string" ? e.pdbId.toLowerCase() : null))
        .filter((e: string | null): e is string => Boolean(e));
      for (const e of interacting) entries.add(e);
      for (let p = start; p <= end; p++) {
        const set = byResidue.get(p) ?? new Set<string>();
        // A residue PDBe lists without saying which entries is at the interface in at least one.
        for (const e of interacting) set.add(e);
        byResidue.set(p, set);
      }
    }
    if (byResidue.size === 0) continue;
    const residues = [...byResidue.keys()].sort((a, b) => a - b);
    const bare = partnerAcc.toUpperCase().replace(/-\d+$/, "");
    partners.push({
      accession: partnerAcc,
      name: typeof item?.name === "string" && item.name.trim() ? item.name.trim() : partnerAcc,
      residues,
      residueEntries: residues.map(r => [...byResidue.get(r)!].sort()),
      pdbEntries: [...entries].sort(),
      artefact: CONSTRUCT_TAGS[bare] ?? null,
    });
  }
  // Biological partners first, then the best-attested interface: the reader's first row is the strongest.
  return partners.sort(
    (a, b) => Number(Boolean(a.artefact)) - Number(Boolean(b.artefact)) || b.pdbEntries.length - a.pdbEntries.length || b.residues.length - a.residues.length
  );
}

/** One partner's interface as a variant sees it: per-residue support counts and the variant's own entries. */
export function observedFor(
  p: PdbeInterfacePartner,
  ownAccession: string,
  position: number | null
): {
  accession: string;
  name: string;
  residues: number[];
  support: number[];
  pdbEntries: string[];
  homomeric: boolean;
  artefact: string | null;
  variantAtInterface: boolean;
  variantEntries: string[];
} {
  const own = ownAccession.toUpperCase().replace(/-\d+$/, "");
  const idx = position === null ? -1 : p.residues.indexOf(position);
  // A residue PDBe lists with no interacting entry named still counts once: it is at the interface somewhere.
  const support = p.residueEntries.map(e => Math.max(1, e.length));
  return {
    accession: p.accession,
    name: p.name,
    residues: p.residues,
    support,
    pdbEntries: p.pdbEntries,
    homomeric: p.accession.toUpperCase().replace(/-\d+$/, "") === own,
    artefact: p.artefact,
    variantAtInterface: idx >= 0,
    variantEntries: idx >= 0 ? p.residueEntries[idx] : [],
  };
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

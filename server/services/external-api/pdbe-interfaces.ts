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
 *
 * Three readings PDBe-KB does not separate, and the tab must (doc/INTERFACES_PPI_REVIEW.md, SOD1):
 *   • AMYLOID FIBRILS. In a fibril every chain stacks on the next, so PDBe lists most of the core as
 *     "interface" with another copy of the protein. All four entries that put SOD1 Ala5 "at the
 *     interface with the other SOD1 chain" are fibril cryo-EM structures (7VZF, 9JBO, 9JBP, 9LI1);
 *     none of the 142 native structures has it there, yet the screen drew it on the dimer seam and
 *     planned a binding-energy estimate on a fibril. Entries are classed by RCSB keyword and title,
 *     and a partner's fibril entries become their own `context: "fibril"` partner.
 *   • NON-PROTEIN PARTNERS. For a chain with no UniProt record PDBe puts a label in the accession
 *     slot and types it (`additionalData.type`: "AB" antibody or nanobody, "OTHER"). These were
 *     counted as partners ("NB1", "Other"). They are set aside like construct tags.
 *   • OTHER SPECIES. Mouse SOD1 (P08228) and yeast CCS1 (P40202) appear beside human CCS. Each
 *     partner's gene and organism come from UniProt, so an ortholog is named as one.
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
  /** Set when the partner is not biological: a construct tag, a tool antibody, a chain with no UniProt record. */
  artefact: string | null;
  /** "fibril": this pair as seen in amyloid fibril structures only; "native": every other structure. */
  context: "native" | "fibril";
  /** UniProt gene name of the partner, when read. */
  gene: string | null;
  /** The partner's organism (UniProt common name) when it is not human; null for human or unread. */
  organism: string | null;
}

export type PdbeInterfaceLookup =
  /** `entryKinds`: whether fibril entries could be told apart (RCSB answered). */
  | { status: "ok"; partners: PdbeInterfacePartner[]; entryKinds: "ok" | "failed" }
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

/** PDBe's types for a partner that is not a UniProt protein (`additionalData.type`). */
const NON_PROTEIN_TYPES: Record<string, string> = {
  AB: "antibody or nanobody, a tool binder",
  OTHER: "chain with no UniProt record",
};

const cache = new LRUCache<string, PdbeInterfaceLookup>({ max: 500, ttl: 7 * 24 * 60 * 60 * 1000 });
/** Per PDB id: true for an amyloid fibril entry. */
const fibrilCache = new LRUCache<string, boolean>({ max: 20000, ttl: 30 * 24 * 60 * 60 * 1000 });
const speciesCache = new LRUCache<string, { gene: string | null; organism: string | null }>({ max: 5000, ttl: 30 * 24 * 60 * 60 * 1000 });

export function clearPdbeInterfaceCache(): void {
  cache.clear();
  fibrilCache.clear();
  speciesCache.clear();
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
    const type = typeof item?.additionalData?.type === "string" ? item.additionalData.type.toUpperCase() : null;
    // A label in the accession slot ("IG-heavy chain", "Other") is not a UniProt protein, whatever the type says.
    const nonProtein = (type ? NON_PROTEIN_TYPES[type] : undefined) ?? (ACCESSION_RE.test(bare) ? null : NON_PROTEIN_TYPES.OTHER);
    partners.push({
      accession: partnerAcc,
      name: typeof item?.name === "string" && item.name.trim() ? item.name.trim() : partnerAcc,
      residues,
      residueEntries: residues.map(r => [...byResidue.get(r)!].sort()),
      pdbEntries: [...entries].sort(),
      artefact: CONSTRUCT_TAGS[bare] ?? nonProtein,
      context: "native",
      gene: null,
      organism: null,
    });
  }
  // Biological partners first, then the best-attested interface: the reader's first row is the strongest.
  return partners.sort(
    (a, b) => Number(Boolean(a.artefact)) - Number(Boolean(b.artefact)) || b.pdbEntries.length - a.pdbEntries.length || b.residues.length - a.residues.length
  );
}

/** RCSB's reading of an entry: an amyloid fibril by keyword ("PROTEIN FIBRIL") or by title. */
export function isFibrilEntry(entry: { struct?: { title?: string | null } | null; struct_keywords?: { pdbx_keywords?: string | null } | null }): boolean {
  const keywords = entry.struct_keywords?.pdbx_keywords ?? "";
  const title = entry.struct?.title ?? "";
  // Whole words: "fibrillin" is not amyloid, and actin "filaments" are not matched at all.
  return /\bFIBRIL\b/i.test(keywords) || /\bamyloid\b|\bfibrils?\b/i.test(title);
}

/**
 * Split each partner whose structures include amyloid fibrils into a native partner and a fibril
 * partner. Support is recounted on each side, so the native denominator excludes fibrils and a
 * residue seen at the interface only in fibrils leaves the native interface. Exported for tests.
 */
export function splitFibrilEntries(partners: PdbeInterfacePartner[], fibrils: ReadonlySet<string>): PdbeInterfacePartner[] {
  if (!fibrils.size) return partners;
  const out: PdbeInterfacePartner[] = [];
  for (const p of partners) {
    if (!p.pdbEntries.some(e => fibrils.has(e))) {
      out.push(p);
      continue;
    }
    for (const context of ["native", "fibril"] as const) {
      const keep = (e: string) => (context === "fibril") === fibrils.has(e);
      const pdbEntries = p.pdbEntries.filter(keep);
      if (!pdbEntries.length) continue;
      const residues: number[] = [];
      const residueEntries: string[][] = [];
      p.residues.forEach((r, i) => {
        const own = p.residueEntries[i];
        const kept = own.filter(keep);
        // A residue listed with no entry named stays native: nothing says it came from a fibril.
        if (kept.length || (!own.length && context === "native")) {
          residues.push(r);
          residueEntries.push(kept);
        }
      });
      if (residues.length) out.push({ ...p, context, residues, residueEntries, pdbEntries });
    }
  }
  return out;
}

const RCSB_HEADERS = { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Missense-Structural-Explorer/1.0" };

/** The fibril entries among `ids` (lower-case), or null when RCSB could not be read. */
async function readFibrilEntries(ids: string[], signal?: AbortSignal): Promise<Set<string> | null> {
  const unknown = ids.filter(id => !fibrilCache.has(id));
  for (let i = 0; i < unknown.length; i += 400) {
    const batch = unknown.slice(i, i + 400);
    const query = `{entries(entry_ids:${JSON.stringify(batch.map(id => id.toUpperCase()))}){rcsb_id struct{title} struct_keywords{pdbx_keywords}}}`;
    try {
      const res = await fetchWithRetry("https://data.rcsb.org/graphql", { method: "POST", headers: RCSB_HEADERS, body: JSON.stringify({ query }), timeout: 15000, signal }, 2);
      if (!res.ok) return null;
      const body: any = await res.json();
      const entries: any[] = Array.isArray(body?.data?.entries) ? body.data.entries : [];
      if (!entries.length) return null;
      for (const e of entries) if (typeof e?.rcsb_id === "string") fibrilCache.set(e.rcsb_id.toLowerCase(), isFibrilEntry(e));
      // An id RCSB does not return (obsoleted) reads as native: nothing says it is a fibril.
      for (const id of batch) if (!fibrilCache.has(id)) fibrilCache.set(id, false);
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      return null;
    }
  }
  return new Set(ids.filter(id => fibrilCache.get(id)));
}

/** Gene and non-human organism per partner accession, from UniProt. An accession not read stays unnamed. */
async function readSpecies(accessions: string[], signal?: AbortSignal): Promise<void> {
  const unknown = accessions.filter(a => !speciesCache.has(a)).slice(0, 100);
  if (!unknown.length) return;
  try {
    const res = await fetchWithRetry(
      `https://rest.uniprot.org/uniprotkb/accessions?accessions=${unknown.join(",")}&fields=accession,gene_primary,organism_name,organism_id&format=json`,
      { headers: { Accept: "application/json", "User-Agent": "Missense-Structural-Explorer/1.0" }, timeout: 15000, signal },
      2
    );
    if (!res.ok) return;
    const body: any = await res.json();
    for (const r of Array.isArray(body?.results) ? body.results : []) {
      if (typeof r?.primaryAccession !== "string") continue;
      const taxon = Number(r?.organism?.taxonId);
      const name = r?.organism?.commonName ?? r?.organism?.scientificName;
      speciesCache.set(r.primaryAccession.toUpperCase(), {
        gene: typeof r?.genes?.[0]?.geneName?.value === "string" ? r.genes[0].geneName.value : null,
        organism: taxon === 9606 || typeof name !== "string" ? null : name,
      });
    }
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
  }
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
  context: "native" | "fibril";
  gene: string | null;
  organism: string | null;
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
    context: p.context,
    gene: p.gene,
    organism: p.organism,
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
    const parsed = parsePdbeInterfaces(await response.json(), accession);
    if (!parsed.length) {
      const none: PdbeInterfaceLookup = { status: "none", partners: [] };
      cache.set(accession, none);
      return none;
    }
    const bareOf = (a: string) => a.toUpperCase().replace(/-\d+$/, "");
    const [fibrils] = await Promise.all([
      readFibrilEntries([...new Set(parsed.flatMap(p => p.pdbEntries))], signal),
      readSpecies([...new Set(parsed.filter(p => !p.artefact).map(p => bareOf(p.accession)))], signal),
    ]);
    const named = parsed.map(p => {
      const sp = speciesCache.get(bareOf(p.accession));
      return sp ? { ...p, gene: sp.gene, organism: sp.organism } : p;
    });
    const result: PdbeInterfaceLookup = { status: "ok", partners: splitFibrilEntries(named, fibrils ?? new Set()), entryKinds: fibrils ? "ok" : "failed" };
    // Cached only when the fibril check answered: an unchecked list would hide fibrils for a week.
    if (fibrils) cache.set(accession, result);
    return result;
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    return { status: "error", partners: [], reason: "PDBe did not answer." };
  }
}

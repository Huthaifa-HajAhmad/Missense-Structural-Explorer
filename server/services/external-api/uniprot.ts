import { LRUCache } from "lru-cache";
import { uniprotCache, uniprotFeaturesCache, getCachedOrFetch, defaultCacheRegistry } from "../infra/cache.ts";
import { normalizeGeneSymbol, fetchWithRetry } from "../infra/http-client.ts";
import { buildUniprotFeaturesKey, buildUniprotSequenceKey, buildUniprotIdKey } from "../infra/cache-keys.ts";

export interface UniprotCacheOptions {
  l1Cache?: LRUCache<string, any>;
  bypassSqlite?: boolean;
}

export async function resolveGeneToUniprot(gene: string, options?: UniprotCacheOptions): Promise<string | null> {
  const normGene = normalizeGeneSymbol(gene).toUpperCase();

  const geneToUniprotStatic: Record<string, string> = {
    PAH: "P00439",
    FGFR3: "P22607",
    GBA1: "P04062",
    NAE1: "Q13564",
  };
  
  const cache = options?.l1Cache ?? uniprotCache;

  if (geneToUniprotStatic[normGene]) {
    const staticId = geneToUniprotStatic[normGene];
    cache.set(normGene, staticId);
    cache.set(buildUniprotIdKey(normGene), staticId);
    return staticId;
  }

  return getCachedOrFetch({
    key: buildUniprotIdKey(normGene),
    source: "UniProt Search API",
    l1Cache: cache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    fetcher: async () => {
      try {
        const searchUrl = `https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${encodeURIComponent(normGene)}+AND+organism_id:9606+AND+reviewed:true&format=json&size=1`;
        console.log(`[UniProt] Resolving gene symbol ${normGene} via search API...`);
        const res = await fetchWithRetry(searchUrl, {
          headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
          timeout: 15000
        });
        if (!res.ok) {
          console.warn(`[UniProt] Gene lookup failed with status: ${res.status}`);
          return null;
        }
        const data = await res.json() as any;
        if (data.results && data.results.length > 0) {
          const uniprotId = data.results[0].primaryAccession;
          return uniprotId;
        }
      } catch (err) {
        console.error(`[UniProt] Gene lookup error:`, err);
      }
      return null;
    }
  });
}

export const uniprotSeqCache = new LRUCache<string, string>({ max: 500 });
defaultCacheRegistry.registerCache("uniprotSeqCache", uniprotSeqCache, { ttlDesc: "30d" });

/** One annotated isoform of a UniProt entry, with the sequence its residue numbers refer to. */
export interface UniprotIsoform {
  /** Isoform accession: `Q9Y305` (canonical) or `Q9Y305-4`. */
  id: string;
  sequence: string;
  /** Entry mnemonic from the FASTA header (`ACOT9_HUMAN`) — its first field is the gene symbol. */
  entryName?: string;
}

export const uniprotIsoformsCache = new LRUCache<string, UniprotIsoform[]>({ max: 300 });
defaultCacheRegistry.registerCache("uniprotIsoformsCache", uniprotIsoformsCache, {
  ttlDesc: "30d (immutable)",
});

/**
 * Every isoform sequence of a UniProt entry, canonical first.
 *
 * WHY: a protein notation's residue numbers belong to whichever protein the reporting pipeline
 * used, and MANE Select routinely follows a NON-canonical isoform (ACOT9: MANE `NP_001032248.1`
 * = `Q9Y305-4`, whose numbering differs from canonical `Q9Y305` by a 9-residue insertion).
 * Mapping a position onto the canonical sequence requires both sequences, so both are fetched
 * here and cached — they are immutable reference data.
 */
export async function fetchUniprotIsoforms(
  accession: string,
  options?: UniprotCacheOptions
): Promise<UniprotIsoform[]> {
  const key = accession.toUpperCase();
  const cache = options?.l1Cache ?? uniprotIsoformsCache;

  return getCachedOrFetch({
    key: `uniprot_isoforms_${key}`,
    source: "UniProt FASTA (isoforms)",
    l1Cache: cache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    fetcher: async () => {
      // MUST use the `stream` resolver: the single-entry `/uniprotkb/{acc}.fasta` endpoint
      // silently IGNORES `includeIsoform=true` and returns only the canonical record, which made
      // every isoform-numbered notation look like an unknown isoform. Verified live — this
      // endpoint returns all records (`Q9Y305`, `-2`, `-3`, `-4`).
      const url =
        `https://rest.uniprot.org/uniprotkb/stream?query=accession:${encodeURIComponent(key)}` +
        `&format=fasta&includeIsoform=true`;
      const response = await fetchWithRetry(url, { timeout: 20000 });
      if (!response.ok) {
        throw new Error(`Failed to fetch UniProt isoforms for ${key} (status ${response.status})`);
      }
      const text = await response.text();
      const isoforms: UniprotIsoform[] = [];
      let current: UniprotIsoform | null = null;
      for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith(">")) {
          // `sp|Q9Y305-4|ACOT9_HUMAN ...` -> Q9Y305-4 / ACOT9_HUMAN
          const parts = line.slice(1).split("|");
          const id = parts[1]?.trim();
          current = id ? { id, sequence: "", entryName: parts[2]?.trim().split(" ")[0] } : null;
          if (current) isoforms.push(current);
          continue;
        }
        if (current) current.sequence += line;
      }
      return isoforms.filter((iso) => iso.sequence.length > 0);
    },
  });
}

/** Where a RefSeq protein accession sits in UniProt's isoform model. */
export interface RefSeqProteinMapping {
  /** Parent (canonical) UniProt accession, e.g. `Q9Y305`. */
  accession: string;
  proteinId: string;
  /** Isoform whose sequence that protein is: `Q9Y305-1` for canonical, else e.g. `Q9Y305-4`. */
  isoformId?: string;
  /** RefSeq transcript this protein is the product of (`NM_…`). */
  transcriptId?: string;
  /** HGNC symbol when UniProt reports one. */
  geneSymbol?: string;
}

/**
 * Cached as a wrapper because LRUCache's value type excludes null: a definitive "UniProt has no
 * entry for this accession" is still worth caching, so it is stored as `{ mapping: null }`.
 */
export const refSeqProteinCache = new LRUCache<string, { mapping: RefSeqProteinMapping | null }>({
  max: 500,
});
defaultCacheRegistry.registerCache("refSeqProteinCache", refSeqProteinCache, {
  ttlDesc: "30d (immutable)",
});

/**
 * Maps a RefSeq protein accession (`NP_001032248.1`) to its UniProt entry AND isoform.
 *
 * UniProt's RefSeq cross-references carry `isoformId`, so this is exact — no sequence comparison
 * and no second provider. Without it, a lab notation like `NP_001032248.1:p.Lys281Asn` has no
 * route into the pipeline at all: the numbering basis is the whole point of the notation.
 *
 * Returns null (cached) when UniProt has no reviewed entry carrying that accession.
 */
export async function resolveRefSeqProtein(
  proteinAccession: string,
  options?: UniprotCacheOptions
): Promise<RefSeqProteinMapping | null> {
  const key = proteinAccession.trim().toUpperCase();
  const cache = options?.l1Cache ?? refSeqProteinCache;
  if (!/^NP_\d+(\.\d+)?$/.test(key)) return null;

  // Wrapped so the (definitive) "no such accession" answer is cacheable: the cache helper's
  // generic rejects `null`, and caching a negative here saves a lookup per query.
  const lookup = await getCachedOrFetch<{ mapping: RefSeqProteinMapping | null }>({
    key: `refseq_protein_${key}`,
    source: "UniProt Search API (RefSeq xref)",
    l1Cache: cache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    fetcher: async () => {
      const url =
        `https://rest.uniprot.org/uniprotkb/search?query=xref:refseq-${encodeURIComponent(key)}` +
        `&fields=xref_refseq,gene_primary&format=json&size=1`;
      const response = await fetchWithRetry(url, {
        headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
        timeout: 15000,
      });
      if (!response.ok) return { mapping: null };

      const data = (await response.json()) as any;
      const entry = data?.results?.[0];
      if (!entry?.primaryAccession) return { mapping: null };

      const xrefs: any[] = entry.uniProtKBCrossReferences ?? [];
      const versionless = key.split(".")[0];
      const match =
        xrefs.find((x) => x?.database === "RefSeq" && x?.id?.toUpperCase() === key) ??
        xrefs.find(
          (x) => x?.database === "RefSeq" && x?.id?.toUpperCase()?.split(".")[0] === versionless
        );

      const transcriptId = match?.properties?.find(
        (p: any) => p?.key === "NucleotideSequenceId"
      )?.value;

      return {
        mapping: {
          accession: String(entry.primaryAccession).toUpperCase(),
          proteinId: match?.id ?? key,
          isoformId: match?.isoformId ? String(match.isoformId).toUpperCase() : undefined,
          transcriptId: transcriptId ? String(transcriptId) : undefined,
          geneSymbol: entry?.genes?.[0]?.geneName?.value,
        },
      };
    },
  });

  return lookup.mapping;
}

export async function fetchUniprotSequence(uniprotId: string, options?: UniprotCacheOptions): Promise<string> {
  const key = uniprotId.toUpperCase();
  const cache = options?.l1Cache ?? uniprotSeqCache;

  return getCachedOrFetch({
    key: buildUniprotSequenceKey(key),
    source: "UniProt FASTA",
    l1Cache: cache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    fetcher: async () => {
      const url = `https://rest.uniprot.org/uniprotkb/${key}.fasta`;
      const response = await fetchWithRetry(url, { timeout: 15000 });
      if (!response.ok) {
        throw new Error(`Failed to fetch UniProt sequence for ${key} (status ${response.status})`);
      }
      const text = await response.text();
      const lines = text.split("\n");
      const sequenceLines = lines.filter(line => !line.startsWith(">") && line.trim() !== "");
      const seq = sequenceLines.join("").replace(/\s/g, "");
      return seq;
    }
  });
}

export interface UniprotFeature {
  type: string;            // e.g. "Active site", "Binding site", "Region", "Domain"
  description: string;
  /** Residue positions (1-indexed, inclusive) */
  start: number;
  end: number;
  interproId?: string;
}

export interface UniprotFeaturesResult {
  features: UniprotFeature[];
  /** Gene name as reported by UniProt */
  geneName: string;
  subunitComment?: string | null;
  isMultimer?: boolean;
  sequenceLength?: number;
}

/** Feature types we care about for clinical/functional/domain annotation */
const RELEVANT_FEATURE_TYPES = new Set([
  "Active site",
  "Binding site",
  "Metal binding",
  "Site",
  "Domain",
  "Region",
  "Motif",
  "Repeat",
  "Zinc finger",
  "DNA binding",
  "Transmembrane",
  "Compositional bias",
  "Coiled coil",
  "Disulfide bond",
  "Modified residue",
  "Mutagenesis",
]);

export async function fetchUniprotFeatures(
  uniprotId: string,
  options?: UniprotCacheOptions
): Promise<UniprotFeaturesResult | null> {
  const key = uniprotId.toUpperCase();
  const cache = options?.l1Cache ?? uniprotFeaturesCache;

  return getCachedOrFetch({
    key: buildUniprotFeaturesKey(key),
    source: "UniProt Features API",
    l1Cache: cache,
    ttlSeconds: 14 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    fetcher: async () => {
      try {
        const resp = await fetchWithRetry(
          `https://rest.uniprot.org/uniprotkb/${key}.json`,
          {
            headers: { "Accept": "application/json" },
            timeout: 12000,
          },
          2,
          1200
        );

        if (!resp.ok) {
          console.warn(`[UniProt Features] API ${resp.status} for ${key}`);
          return null;
        }

        const json = await resp.json();
        const rawFeatures: any[] = json?.features ?? [];

        // Extract gene name
        const geneName: string =
          json?.genes?.[0]?.geneName?.value ?? json?.entryType ?? key;

        // Build InterPro cross-reference map for domain annotation enrichment
        const interproMap = new Map<string, string>();
        function normalizeDomainText(str: string): string {
          let s = (str || "").toLowerCase().trim();
          s = s.replace(/[_\-]+/g, " ");
          s = s.replace(/\bprot\b/g, "protein");
          s = s.replace(/\bdom\b/g, "domain");
          s = s.replace(/\bsf\b/g, "superfamily");
          s = s.replace(/\bpk\b/g, "protein kinase");
          s = s.replace(/\bc[- ]?term(inal)?\b/g, "c terminal");
          s = s.replace(/\bn[- ]?term(inal)?\b/g, "n terminal");
          s = s.replace(/\s+c$/g, " c terminal");
          s = s.replace(/\s+n$/g, " n terminal");
          return s.replace(/\s+/g, " ").trim();
        }

        const rawXrefs = json?.uniProtKBCrossReferences ?? [];
        for (const xref of rawXrefs) {
          if (xref?.database === "InterPro" && xref?.id) {
            const entryName = xref.properties?.find((p: any) => p.key === "EntryName")?.value || "";
            if (entryName) {
              interproMap.set(entryName.toLowerCase().trim(), xref.id);
              const normEntry = normalizeDomainText(entryName);
              if (normEntry) {
                interproMap.set(normEntry, xref.id);
              }
            }
          }
        }

        const features: UniprotFeature[] = rawFeatures
          .filter((f: any) => RELEVANT_FEATURE_TYPES.has(f.type))
          .map((f: any) => {
            const ligandInfo = f.ligand?.name ? `Ligand: ${f.ligand.name}` : (f.ligandPart?.name ? `Ligand: ${f.ligandPart.name}` : "");
            const desc = f.description && ligandInfo && !f.description.includes(f.ligand?.name)
              ? `${f.description} (${ligandInfo})`
              : f.description || ligandInfo || "";
            const posVal = f.location?.position?.value;
            const start = f.location?.start?.value ?? posVal ?? 0;
            const end = f.location?.end?.value ?? posVal ?? start;

            let interproId: string | undefined;
            if (f.type === "Domain") {
              const descLower = (f.description || "").toLowerCase().trim();
              const descNorm = normalizeDomainText(f.description || "");
              if (descLower.length >= 2) {
                // Pass 1: Exact or direct suffix match against raw or normalized map
                for (const [iprName, id] of interproMap.entries()) {
                  if (
                    descLower === iprName ||
                    descNorm === iprName ||
                    `${descLower} domain` === iprName ||
                    `${descNorm} domain` === iprName ||
                    descLower === `${iprName} domain` ||
                    descNorm === `${iprName} domain`
                  ) {
                    interproId = id;
                    break;
                  }
                }
                // Pass 2: Normalized prefix / substring match (minimum 4 chars, not generic "domain")
                if (!interproId && descNorm.length >= 4 && descNorm !== "domain") {
                  for (const [iprName, id] of interproMap.entries()) {
                    if (iprName.length >= 4 && iprName !== "domain") {
                      if (
                        iprName.startsWith(descNorm) ||
                        descNorm.startsWith(iprName) ||
                        iprName.includes(descNorm) ||
                        descNorm.includes(iprName)
                      ) {
                        interproId = id;
                        break;
                      }
                    }
                  }
                }
              }
            }

            return {
              type:        f.type,
              description: desc,
              start,
              end,
              interproId
            };
          })
          .filter((f) => f.start > 0 && f.end > 0);

        // Extract subunit comment and check isMultimer
        const subunitCommentBlock = json?.comments?.find((c: any) => c.commentType === "SUBUNIT");
        const subunitComment = subunitCommentBlock?.note?.texts?.[0]?.value ?? null;
        const isMultimer = subunitComment 
          ? /homo|hetero|dimer|trimer|tetramer|pentamer|hexamer|heptamer|octamer|oligomer|complex/i.test(subunitComment)
          : false;

        const sequenceLength = typeof json?.sequence?.length === "number" ? json.sequence.length : undefined;

        const result: UniprotFeaturesResult = { features, geneName, subunitComment, isMultimer, sequenceLength };
        return result;
      } catch (err: any) {
        console.error(`[UniProt Features] Error fetching ${key}:`, err.message);
        return null;
      }
    }
  });
}

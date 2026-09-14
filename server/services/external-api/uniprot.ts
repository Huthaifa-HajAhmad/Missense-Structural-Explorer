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

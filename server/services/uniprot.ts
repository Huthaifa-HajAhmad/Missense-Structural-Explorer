import { LRUCache } from "lru-cache";
import { uniprotCache, uniprotFeaturesCache, getCachedOrFetch } from "./cache.ts";
import { normalizeGeneSymbol, fetchWithRetry } from "./http-client.ts";
import { buildUniprotFeaturesKey, buildUniprotSequenceKey, buildUniprotIdKey } from "./cache-keys.ts";

export async function resolveGeneToUniprot(gene: string): Promise<string | null> {
  const normGene = normalizeGeneSymbol(gene).toUpperCase();

  const geneToUniprotStatic: Record<string, string> = {
    PAH: "P00439",
    FGFR3: "P22607",
    GBA1: "P04062",
    NAE1: "Q13564",
  };
  
  if (geneToUniprotStatic[normGene]) {
    uniprotCache.set(normGene, geneToUniprotStatic[normGene]);
    return geneToUniprotStatic[normGene];
  }

  return getCachedOrFetch({
    key: buildUniprotIdKey(normGene),
    source: "UniProt Search API",
    l1Cache: uniprotCache,
    ttlSeconds: 30 * 24 * 60 * 60,
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

export async function fetchUniprotSequence(uniprotId: string): Promise<string> {
  const key = uniprotId.toUpperCase();

  return getCachedOrFetch({
    key: buildUniprotSequenceKey(key),
    source: "UniProt FASTA",
    l1Cache: uniprotSeqCache,
    ttlSeconds: 30 * 24 * 60 * 60,
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
  type: string;            // e.g. "Active site", "Binding site", "Region"
  description: string;
  /** Residue positions (1-indexed, inclusive) */
  start: number;
  end: number;
}

export interface UniprotFeaturesResult {
  features: UniprotFeature[];
  /** Gene name as reported by UniProt */
  geneName: string;
  subunitComment?: string | null;
  isMultimer?: boolean;
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
  uniprotId: string
): Promise<UniprotFeaturesResult | null> {
  const key = uniprotId.toUpperCase();

  return getCachedOrFetch({
    key: buildUniprotFeaturesKey(key),
    source: "UniProt Features API",
    l1Cache: uniprotFeaturesCache,
    ttlSeconds: 14 * 24 * 60 * 60,
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
            return {
              type:        f.type,
              description: desc,
              start,
              end,
            };
          })
          .filter((f) => f.start > 0 && f.end > 0);

        // Extract subunit comment and check isMultimer
        const subunitCommentBlock = json?.comments?.find((c: any) => c.commentType === "SUBUNIT");
        const subunitComment = subunitCommentBlock?.note?.texts?.[0]?.value ?? null;
        const isMultimer = subunitComment 
          ? /homo|hetero|dimer|trimer|tetramer|pentamer|hexamer|heptamer|octamer|oligomer|complex/i.test(subunitComment)
          : false;

        const result: UniprotFeaturesResult = { features, geneName, subunitComment, isMultimer };
        return result;
      } catch (err: any) {
        console.error(`[UniProt Features] Error fetching ${key}:`, err.message);
        return null;
      }
    }
  });
}

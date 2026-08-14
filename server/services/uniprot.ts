import { LRUCache } from "lru-cache";
import { uniprotCache, uniprotFeaturesCache } from "./cache.ts";
import { normalizeGeneSymbol, fetchWithRetry } from "./http-client.ts";

export async function resolveGeneToUniprot(gene: string): Promise<string | null> {
  const geneUpper = gene.trim().toUpperCase();
  if (uniprotCache.has(geneUpper)) {
    return uniprotCache.get(geneUpper) || null;
  }
  
  const geneToUniprotStatic: Record<string, string> = {
    PAH: "P00439",
    FGFR3: "P22607",
    GBA1: "P04062",
    NAE1: "Q13564",
  };
  
  if (geneToUniprotStatic[geneUpper]) {
    uniprotCache.set(geneUpper, geneToUniprotStatic[geneUpper]);
    return geneToUniprotStatic[geneUpper];
  }
  
  try {
    const searchUrl = `https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${geneUpper}+AND+organism_id:9606+AND+reviewed:true&format=json&size=1`;
    console.log(`[UniProt] Resolving gene symbol ${geneUpper} via search API...`);
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
      uniprotCache.set(geneUpper, uniprotId);
      return uniprotId;
    }
  } catch (err) {
    console.error(`[UniProt] Gene lookup error:`, err);
  }
  return null;
}

export const uniprotSeqCache = new LRUCache<string, string>({ max: 500 });

export async function fetchUniprotSequence(uniprotId: string): Promise<string> {
  const key = uniprotId.toUpperCase();
  const cached = uniprotSeqCache.get(key);
  if (cached) return cached;

  const url = `https://rest.uniprot.org/uniprotkb/${key}.fasta`;
  const response = await fetchWithRetry(url, { timeout: 15000 });
  if (!response.ok) {
    throw new Error(`Failed to fetch UniProt sequence for ${key} (status ${response.status})`);
  }
  const text = await response.text();
  const lines = text.split("\n");
  const sequenceLines = lines.filter(line => !line.startsWith(">") && line.trim() !== "");
  const seq = sequenceLines.join("").replace(/\s/g, "");
  uniprotSeqCache.set(key, seq);
  return seq;
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

/** Feature types we care about for clinical/functional annotation */
const RELEVANT_FEATURE_TYPES = new Set([
  "Active site",
  "Binding site",
  "Metal binding",
  "Site",
  "Region",
  "Motif",
  "Disulfide bond",
  "Modified residue",
]);

export async function fetchUniprotFeatures(
  uniprotId: string
): Promise<UniprotFeaturesResult | null> {
  const key = uniprotId.toUpperCase();
  const cached = uniprotFeaturesCache.get(key);
  if (cached !== undefined) return cached;

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
      .map((f: any) => ({
        type:        f.type,
        description: f.description ?? "",
        start:       f.location?.start?.value ?? 0,
        end:         f.location?.end?.value   ?? 0,
      }))
      .filter((f) => f.start > 0 && f.end > 0);

    // Extract subunit comment and check isMultimer
    const subunitCommentBlock = json?.comments?.find((c: any) => c.commentType === "SUBUNIT");
    const subunitComment = subunitCommentBlock?.note?.texts?.[0]?.value ?? null;
    const isMultimer = subunitComment 
      ? /homo|hetero|dimer|trimer|tetramer|pentamer|hexamer|heptamer|octamer|oligomer|complex/i.test(subunitComment)
      : false;

    const result: UniprotFeaturesResult = { features, geneName, subunitComment, isMultimer };
    uniprotFeaturesCache.set(key, result);
    return result;
  } catch (err: any) {
    console.error(`[UniProt Features] Error fetching ${key}:`, err.message);
    return null;
  }
}

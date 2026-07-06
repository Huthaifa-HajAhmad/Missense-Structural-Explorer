import { LRUCache } from "lru-cache";
import { CLINVAR_AA_MAP, CLINVAR_REV_AA_MAP, AMINO_ACID_1_TO_3_TITLE } from "../../src/aminoAcids.ts";
import { validateUniProt } from "../utils.ts";
import { z } from "zod";

function normalizeGeneSymbol(gene: string): string {
  const g = gene.trim().toUpperCase();
  if (g === "GBA1") return "GBA";
  return g;
}

async function fetchWithRetry(url: string, options: RequestInit & { timeout?: number } = {}, retries = 3, delay = 1000): Promise<Response> {
  const timeoutMs = options.timeout ?? 15000;
  let lastStatus = 200;
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      
      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(id);
      
      if (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503) {
        lastStatus = res.status;
        let backoff = delay * (2 ** i);
        if (res.status === 429) {
          const retryAfterHeader = res.headers.get("Retry-After");
          if (retryAfterHeader) {
            const seconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(seconds)) {
              backoff = seconds * 1000;
            } else {
              const date = Date.parse(retryAfterHeader);
              if (!isNaN(date)) {
                backoff = Math.max(0, date - Date.now());
              }
            }
          }
        }
        console.warn(`[Upstream Fetch ${res.status}] error/limit on ${url}. Retrying after ${backoff}ms (attempt ${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      return res;
    } catch (err: any) {
      if (i === retries - 1) {
        err.statusCode = lastStatus;
        throw err;
      }
      console.warn(`[Upstream Fetch Error] Failed to fetch ${url} (attempt ${i + 1}/${retries}): ${err.message}. Retrying in ${delay * 2 ** i}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay * 2 ** i));
    }
  }
  const errObj = new Error(`Failed to fetch ${url} after ${retries} attempts.`);
  (errObj as any).statusCode = lastStatus;
  throw errObj;
}

function normalizeVariantTo3Letter(variant: string): string {
  const clean = variant.replace(/^p\./i, "").trim();
  const match = clean.match(/^([a-zA-Z]{3}|[a-zA-Z])(\d+)([a-zA-Z]{3}|[a-zA-Z])$/);
  if (!match) return clean;

  let wt = match[1];
  const pos = match[2];
  let mut = match[3];

  if (wt.length === 1) {
    wt = AMINO_ACID_1_TO_3_TITLE[wt.toUpperCase()] || wt;
  } else {
    wt = wt.charAt(0).toUpperCase() + wt.slice(1).toLowerCase();
  }

  if (mut.length === 1) {
    mut = AMINO_ACID_1_TO_3_TITLE[mut.toUpperCase()] || mut;
  } else {
    mut = mut.charAt(0).toUpperCase() + mut.slice(1).toLowerCase();
  }

  return `${wt}${pos}${mut}`;
}

// Caching storage (P-1) (CRIT-3)
export const pdbCache = new LRUCache<string, string>({
  max: 100, // Maximum of 100 structures
  maxSize: 100 * 1024 * 1024, // Maximum of 100MB of PDB content
  sizeCalculation: (value) => value.length
});

export const uniprotCache = new LRUCache<string, string>({
  max: 1000 // Maximum of 1000 resolved gene-to-uniprot mappings
});

export const clinvarCache = new LRUCache<string, any>({
  max: 500,
  ttl: 60 * 60 * 1000 // 1 hour TTL
});

export const predictorCache = new LRUCache<string, any>({
  max: 500,
  ttl: 60 * 60 * 1000 // 1 hour TTL
});

export const conservationCache = new LRUCache<string, any>({
  max: 500,
  ttl: 60 * 60 * 1000 // 1 hour TTL
});

export const stringCache = new LRUCache<string, any>({
  max: 500,
  ttl: 60 * 60 * 1000 // 1 hour TTL
});

export function clearAllCaches() {
  pdbCache.clear();
  uniprotCache.clear();
  clinvarCache.clear();
  predictorCache.clear();
  conservationCache.clear();
  stringCache.clear();
  gnomadFreqCache.clear();
  gnomadConstraintCache.clear();
  uniprotFeaturesCache.clear();
}

export interface ClinVarData {
  classification: string;
  lastEvaluated: string;
  reviewStatus: string;
  alleleFrequencies: { source: string; value: any }[];
  trait: string;
  uid: string | null;
}

const clinvarSearchResponseSchema = z.object({
  esearchresult: z.object({
    idlist: z.array(z.string()).default([])
  }).optional()
});

const clinvarSummaryResponseSchema = z.object({
  result: z.object({
    uids: z.array(z.string()).optional()
  }).catchall(
    z.object({
      title: z.string().optional(),
      germline_classification: z.object({
        description: z.string().optional(),
        last_evaluated: z.string().optional(),
        review_status: z.string().optional(),
        trait_set: z.array(z.object({
          trait_name: z.string().optional()
        })).optional()
      }).optional(),
      allele_freq_set: z.array(z.object({
        source: z.string().optional(),
        value: z.any().optional()
      })).optional()
    }).optional()
  ).optional()
});

const vepResponseSchema = z.array(z.object({
  seq_region_name: z.string().optional(),
  start: z.number().optional(),
  allele_string: z.string().optional(),
  transcript_consequences: z.array(z.object({
    alphamissense: z.object({
      am_pathogenicity: z.any().optional(),
      am_class: z.string().optional()
    }).optional(),
    cadd_phred: z.any().optional(),
    eve_score: z.any().optional(),
    eve_class: z.any().optional()
  })).optional()
})).min(1);

const myVariantResponseSchema = z.object({
  hits: z.array(z.object({
    dbnsfp: z.object({
      revel: z.any().optional(),
      gerp: z.any().optional(),
      "gerp++": z.any().optional(),
      phylop: z.any().optional()
    }).optional()
  })).optional()
});

export async function fetchClinVarData(gene: string, variant: string): Promise<ClinVarData> {
  const cacheKey = `${gene}_${variant}`;
  const cached = clinvarCache.get(cacheKey);
  if (cached) return cached;

  const defaultRes: ClinVarData = {
    classification: "Not found in ClinVar",
    lastEvaluated: "",
    reviewStatus: "",
    alleleFrequencies: [],
    trait: "",
    uid: null
  };
  
  const normGene = normalizeGeneSymbol(gene);
  const term = `${normGene} ${variant}`;
  
  const apiKey = process.env.NCBI_API_KEY;
  const apiKeyParam = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=${encodeURIComponent(term)}&retmode=json${apiKeyParam}`;
  
  const searchRes = await fetchWithRetry(searchUrl, {
    headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
    timeout: 15000
  });
  if (!searchRes.ok) {
    throw new Error(`ClinVar search failed (status: ${searchRes.status})`);
  }
  
  const searchJson = await searchRes.json();
  const searchData = clinvarSearchResponseSchema.parse(searchJson);
  const idList = searchData.esearchresult?.idlist || [];
  if (idList.length === 0) {
    clinvarCache.set(cacheKey, defaultRes);
    return defaultRes;
  }
  
  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${idList.join(",")}&retmode=json${apiKeyParam}`;
  const summaryRes = await fetchWithRetry(summaryUrl, {
    headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
    timeout: 15000
  });
  if (!summaryRes.ok) {
    throw new Error(`ClinVar summary failed (status: ${summaryRes.status})`);
  }
  
  const summaryJson = await summaryRes.json();
  const summaryData = clinvarSummaryResponseSchema.parse(summaryJson);
  const resultObj = summaryData.result || {};
  const queryNorm = (() => {
    const clean = variant.replace(/^p\./i, "").trim().toLowerCase();
    const match3 = clean.match(/^([a-z]{3})(\d+)([a-z]{3})$/);
    if (match3) {
      const wt1 = CLINVAR_AA_MAP[match3[1]];
      const pos = match3[2];
      const mut1 = CLINVAR_AA_MAP[match3[3]];
      if (wt1 && mut1) {
        return `${wt1.toUpperCase()}${pos}${mut1.toUpperCase()}`;
      }
    }
    const match1 = clean.match(/^([a-z])(\d+)([a-z])$/);
    if (match1) {
      return `${match1[1].toUpperCase()}${match1[2]}${match1[3].toUpperCase()}`;
    }
    return null;
  })();

  for (const id of idList) {
    const entry = resultObj[id];
    if (!entry) continue;
    
    const title = (entry.title || "").toLowerCase();
    
    let isMatch = false;
    if (queryNorm) {
      const pChangeMatches = title.match(/p\.[a-z]{1,3}\d+[a-z]{1,3}/g);
      if (pChangeMatches) {
        for (const pMatch of pChangeMatches) {
          const cleanMatch = pMatch.replace(/^p\./i, "").trim().toLowerCase();
          const m3 = cleanMatch.match(/^([a-z]{3})(\d+)([a-z]{3})$/);
          let matchNorm: string | null = null;
          if (m3) {
            const wt1 = CLINVAR_AA_MAP[m3[1]];
            const pos = m3[2];
            const mut1 = CLINVAR_AA_MAP[m3[3]];
            if (wt1 && mut1) {
              matchNorm = `${wt1.toUpperCase()}${pos}${mut1.toUpperCase()}`;
            }
          } else {
            const m1 = cleanMatch.match(/^([a-z])(\d+)([a-z])$/);
            if (m1) {
              matchNorm = `${m1[1].toUpperCase()}${m1[2]}${m1[3].toUpperCase()}`;
            }
          }
          if (matchNorm === queryNorm) {
            isMatch = true;
            break;
          }
        }
      }

      // Fallback: check exact word boundary substring match to handle titles without p. notation
      if (!isMatch) {
        const cleanVariant = variant.replace(/^p\./i, "").toLowerCase();
        const escaped = cleanVariant.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        if (regex.test(title)) {
          isMatch = true;
        }
      }
    }
    
    if (isMatch) {
      const classification = entry.germline_classification?.description || "Unknown";
      const lastEvaluated = entry.germline_classification?.last_evaluated || "";
      const reviewStatus = entry.germline_classification?.review_status || "";
      const traits = (entry.germline_classification?.trait_set || []).map((t: any) => t.trait_name || "").filter(Boolean).join(", ");
      
      const alleleFrequencies = (entry.allele_freq_set || []).map((freq: any) => ({
        source: freq.source || "Unknown",
        value: freq.value !== undefined ? freq.value : null
      }));
      
      const resVal = {
        classification,
        lastEvaluated,
        reviewStatus,
        alleleFrequencies,
        trait: traits,
        uid: id
      };
      clinvarCache.set(cacheKey, resVal);
      return resVal;
    }
  }
  clinvarCache.set(cacheKey, defaultRes);
  return defaultRes;
}

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

export async function fetchUniprotSequence(uniprotId: string): Promise<string> {
  const url = `https://rest.uniprot.org/uniprotkb/${uniprotId}.fasta`;
  const response = await fetchWithRetry(url, { timeout: 15000 });
  if (!response.ok) {
    throw new Error(`Failed to fetch UniProt sequence for ${uniprotId} (status ${response.status})`);
  }
  const text = await response.text();
  const lines = text.split("\n");
  const sequenceLines = lines.filter(line => !line.startsWith(">") && line.trim() !== "");
  return sequenceLines.join("").replace(/\s/g, "");
}

export async function fetchAlphafoldPdb(uniprotId: string): Promise<string | null> {
  const validatedUniprot = validateUniProt(uniprotId);
  
  // 1. Try querying EBI AlphaFold API first to find correct URL
  const afApiUrl = `https://alphafold.ebi.ac.uk/api/prediction/${validatedUniprot}`;
  let pdbUrlFromApi = "";
  try {
    const apiResponse = await fetchWithRetry(afApiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      },
      timeout: 15000
    });
    if (apiResponse.status === 404) {
      console.log(`[AlphaFold] UniProt ID ${validatedUniprot} returned 404 from EBI. Skipping candidate brute-force.`);
      return null;
    }
    if (apiResponse.ok) {
      const data = await apiResponse.json() as any;
      if (Array.isArray(data) && data.length > 0) {
        // Query the first entry that contains a valid pdbUrl
        const matched = data.find((item: any) => item.pdbUrl);
        if (matched) {
          pdbUrlFromApi = matched.pdbUrl;
          console.log(`Found official PDB URL from EBI API: ${pdbUrlFromApi}`);
        }
      }
    }
  } catch (apiErr) {
    console.warn("AlphaFold API prediction lookup failed:", apiErr);
  }
  
  // 2. Build candidate URLs to try in order (M-4)
  const candidates: string[] = [];
  if (pdbUrlFromApi) {
    candidates.push(pdbUrlFromApi);
  }
  // Try latest v6 first, then fall back to older versions sequentially
  for (const v of ["v6", "v4", "v3", "v2", "v1"]) {
    const candidateUrl = `https://alphafold.ebi.ac.uk/files/AF-${validatedUniprot}-F1-model_${v}.pdb`;
    if (!candidates.includes(candidateUrl)) {
      candidates.push(candidateUrl);
    }
  }

  // Try candidates until one succeeds
  let pdbData = "";
  let success = false;

  for (const url of candidates) {
    try {
      console.log(`Proxy attempting to fetch PDB from: ${url}`);
      const pRes = await fetchWithRetry(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "*/*"
        },
        timeout: 15000
      });
      if (pRes.ok) {
        pdbData = await pRes.text();
        if (pdbData && pdbData.indexOf("ATOM") !== -1) {
          success = true;
          console.log(`Successfully fetched PDB from ${url} (${pdbData.length} bytes)`);
          break;
        }
      }
    } catch (fetchErr) {
      console.warn(`Fetch error for url ${url}:`, fetchErr);
    }
  }

  return success ? pdbData : null;
}

export async function fetchBestPdbStructure(
  uniprotId: string,
  pos?: number
): Promise<{ pdbId: string; chainId: string } | null> {
  const validatedUniprot = validateUniProt(uniprotId);
  const url = `https://www.ebi.ac.uk/pdbe/graph-api/mappings/best_structures/${validatedUniprot}`;
  try {
    console.log(`[PDB Prioritizer] Querying best structures for UniProt accession ${validatedUniprot}...`);
    const response = await fetchWithRetry(url, {
      headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
      timeout: 15000
    });
    if (!response.ok) {
      console.warn(`[PDB Prioritizer] Failed to query PDBe best structures (status: ${response.status})`);
      return null;
    }
    const data = await response.json() as any;
    const structures = data[validatedUniprot] || data[uniprotId];
    if (!Array.isArray(structures)) {
      return null;
    }
    for (const item of structures) {
      if (!item.pdb_id || !item.chain_id) continue;
      
      // Verify 1-to-1 residue index mapping to prevent coordinate shift bugs
      const hasNoShift = item.unp_start === item.start && item.unp_end === item.end;
      if (!hasNoShift) continue;
      
      // If position is provided, verify it is covered by the resolved crystal coordinates
      if (pos !== undefined) {
        const isCovered = pos >= item.unp_start && pos <= item.unp_end;
        if (!isCovered) continue;
      }
      
      console.log(`[PDB Prioritizer] Found suitable experimental structure: ${item.pdb_id} chain ${item.chain_id} (Resolution: ${item.resolution}Å, Coverage: ${item.coverage})`);
      return { pdbId: item.pdb_id.toLowerCase(), chainId: item.chain_id };
    }
  } catch (err: any) {
    console.error("[PDB Prioritizer] Error finding best PDB structure:", err.message || err);
  }
  return null;
}

export function extractChainFromPdb(pdbText: string, chainId: string): string {
  const lines = pdbText.split("\n");
  const filteredLines: string[] = [];
  const targetChain = chainId.trim().toUpperCase();
  
  for (const line of lines) {
    const recordType = line.substring(0, 6).trim();
    
    if (recordType === "ATOM" || recordType === "HETATM") {
      // Chain identifier is at index 21 (0-indexed)
      const lineChain = line.length > 21 ? line.charAt(21).toUpperCase() : "";
      if (lineChain === targetChain) {
        filteredLines.push(line);
      }
    } else if (recordType === "TER") {
      const lineChain = line.length > 21 ? line.charAt(21).toUpperCase() : "";
      if (!lineChain || lineChain === targetChain) {
        filteredLines.push(line);
      }
    } else if (recordType === "CONECT") {
      // Skip connect records as they might refer to atoms in other chains we deleted
      continue;
    } else {
      // Keep metadata lines (HEADER, TITLE, REMARK, HELIX, SHEET, etc.)
      filteredLines.push(line);
    }
  }
  return filteredLines.join("\n");
}

export async function fetchPdbFromRcsb(pdbId: string, chainId?: string): Promise<string | null> {
  const chainUpper = (chainId || "A").toUpperCase();
  const cacheKey = `pdb_rcsb_${pdbId.toLowerCase()}_chain_${chainUpper}`;
  if (pdbCache.has(cacheKey)) {
    return pdbCache.get(cacheKey) || null;
  }

  const url = `https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb`;
  try {
    console.log(`[RCSB PDB] Fetching structure ${pdbId.toUpperCase()} from RCSB...`);
    const res = await fetchWithRetry(url, { timeout: 20000 });
    if (!res.ok) {
      console.warn(`[RCSB PDB] Failed to download PDB from RCSB (status: ${res.status})`);
      return null;
    }
    const fullText = await res.text();
    if (!fullText || !fullText.includes("ATOM")) {
      return null;
    }
    const chainPdb = extractChainFromPdb(fullText, chainUpper);
    pdbCache.set(cacheKey, chainPdb);
    return chainPdb;
  } catch (err: any) {
    console.error(`[RCSB PDB] Error downloading structure ${pdbId}:`, err.message || err);
  }
  return null;
}

export interface PredictorData {
  available: boolean;
  amPathogenicity: number | null;
  amClass: string | null;
  caddPhred: number | null;
  gnomadVariantId?: string | null;
  eveScore?: number | null;
  eveClass?: string | null;
}

export interface ConservationData {
  available: boolean;
  revel: number | null;
  gerp: number | null;
  phylop: number | null;
  consurf: number | null;
  consurfEstimated?: number | null;
  derived?: boolean;
}

export interface StringInteraction {
  partner: string;
  score: number;
}

export async function fetchPredictorData(gene: string, variant: string): Promise<PredictorData> {
  const cacheKey = `${gene}_${variant}`;
  const cached = predictorCache.get(cacheKey);
  if (cached) return cached;

  const cleanVar = normalizeVariantTo3Letter(variant);
  const normGene = normalizeGeneSymbol(gene);
  const url = `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(normGene)}:p.${encodeURIComponent(cleanVar)}?content-type=application/json&AlphaMissense=1&CADD=1&EVE=1`;
  
  try {
    const res = await fetchWithRetry(url, {
      headers: { "Accept": "application/json" },
      timeout: 15000
    });
    if (res.ok) {
      const data = await res.json() as any;
      const parsedData = vepResponseSchema.parse(data);
      if (parsedData.length > 0 && parsedData[0].transcript_consequences) {
        const consequences = parsedData[0].transcript_consequences;
        const tc = consequences.find((c: any) => c.alphamissense || c.cadd_phred !== undefined || c.eve_score !== undefined) || consequences[0];
        if (tc) {
          const amPathogenicity = (tc.alphamissense && tc.alphamissense.am_pathogenicity !== undefined) ? parseFloat(tc.alphamissense.am_pathogenicity) : null;
          const amClass = (tc.alphamissense && tc.alphamissense.am_class) ? String(tc.alphamissense.am_class) : null;
          const caddPhred = tc.cadd_phred !== undefined ? parseFloat(tc.cadd_phred) : null;
          
          const eveScore = tc.eve_score !== undefined ? parseFloat(tc.eve_score) : null;
          const eveClass = tc.eve_class !== undefined ? String(tc.eve_class) : null;

          // Parse genomic coordinates from root VEP object to construct GRCh38 gnomAD-compatible variant ID
          const chr = parsedData[0].seq_region_name;
          const startPos = parsedData[0].start;
          const alleleStr = parsedData[0].allele_string;
          let gnomadVariantId: string | null = null;
          if (chr && startPos && typeof alleleStr === "string") {
            const parts = alleleStr.split("/");
            if (parts.length >= 2) {
              gnomadVariantId = `${chr}-${startPos}-${parts[0]}-${parts[1]}`;
            }
          }

          const resVal = { available: true, amPathogenicity, amClass, caddPhred, gnomadVariantId, eveScore, eveClass };
          predictorCache.set(cacheKey, resVal);
          return resVal;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Predictors Fetch Error] Failed to fetch VEP predictors: ${err.message}`);
  }

  const defaultRes = {
    available: false,
    amPathogenicity: null,
    amClass: null,
    caddPhred: null,
    gnomadVariantId: null,
    eveScore: null,
    eveClass: null
  };
  predictorCache.set(cacheKey, defaultRes);
  return defaultRes;
}

export async function fetchConservationData(gene: string, variant: string): Promise<ConservationData> {
  const cacheKey = `${gene}_${variant}`;
  const cached = conservationCache.get(cacheKey);
  if (cached) return cached;

  const cleanVar = normalizeVariantTo3Letter(variant);
  const normGene = normalizeGeneSymbol(gene);
  // Correctly query dbnsfp by filtering genename and hgvsp separately to resolve MyVariant.info schema mismatch
  const queryStr = `dbnsfp.genename:${normGene} AND dbnsfp.hgvsp:"p.${cleanVar}"`;
  const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(queryStr)}&fields=dbnsfp`;
  
  try {
    const res = await fetchWithRetry(url, {
      headers: { "Accept": "application/json" },
      timeout: 15000
    });
    if (res.ok) {
      const data = await res.json() as any;
      const parsedData = myVariantResponseSchema.parse(data);
      if (parsedData.hits && parsedData.hits.length > 0) {
        const hit = parsedData.hits[0];
        const dbnsfp = hit.dbnsfp;
        if (dbnsfp) {
          // Parse REVEL score (handles both object formats with score arrays/values, and direct numeric values)
          let revel: any = null;
          if (dbnsfp.revel) {
            let rVal = dbnsfp.revel.score !== undefined ? dbnsfp.revel.score : dbnsfp.revel;
            if (Array.isArray(rVal)) rVal = rVal[0];
            revel = rVal !== undefined && rVal !== null ? parseFloat(rVal) : null;
          }

          // Parse GERP score (handles multiple schema keys: gerp++, gerp++_rs, gerp.elements)
          let gerp: any = null;
          const gerpObj = dbnsfp["gerp++"] || dbnsfp.gerp || {};
          let gerpVal = gerpObj.rs !== undefined ? gerpObj.rs : (gerpObj.elements || gerpObj["gerp++_rs"] || null);
          if (Array.isArray(gerpVal)) gerpVal = gerpVal[0];
          gerp = gerpVal !== undefined && gerpVal !== null ? parseFloat(gerpVal) : null;

          // Parse PhyloP score (handles multiple schema keys: 100way_vertebrate, phylop100way_vertebrate, vertebrate)
          let phylop: any = null;
          if (dbnsfp.phylop) {
            let phylopVal = dbnsfp.phylop["100way_vertebrate"]?.score !== undefined 
              ? dbnsfp.phylop["100way_vertebrate"].score 
              : (dbnsfp.phylop.vertebrate || dbnsfp.phylop["phylop100way_vertebrate"] || null);
            if (Array.isArray(phylopVal)) phylopVal = phylopVal[0];
            phylop = phylopVal !== undefined && phylopVal !== null ? parseFloat(phylopVal) : null;
          }

          let consurfEstimated: number | null = null;
          let derived = false;
          if (gerp !== null && phylop !== null) {
            const normalizedGerp = Math.min(1, Math.max(0, (gerp + 5) / 11)); 
            const normalizedPhyloP = Math.min(1, Math.max(0, (phylop + 1) / 5)); 
            consurfEstimated = (normalizedGerp + normalizedPhyloP) / 2;
            derived = true;
          }
          const resVal = { 
            available: true, 
            revel, 
            gerp, 
            phylop, 
            consurf: consurfEstimated !== null ? Math.round(consurfEstimated * 8) + 1 : null, 
            consurfEstimated, 
            derived 
          };
          conservationCache.set(cacheKey, resVal);
          return resVal;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Conservation Fetch Error] Failed to fetch MyVariant conservation: ${err.message}`);
  }

  const defaultRes = {
    available: false,
    revel: null,
    gerp: null,
    phylop: null,
    consurf: null,
    consurfEstimated: null,
    derived: false
  };
  conservationCache.set(cacheKey, defaultRes);
  return defaultRes;
}

export async function fetchStringInteractions(gene: string): Promise<StringInteraction[]> {
  const normGene = normalizeGeneSymbol(gene);
  const cacheKey = normGene;
  const cached = stringCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://version-12-0.string-db.org/api/json/network?identifiers=${encodeURIComponent(normGene)}&species=9606`;
  
  try {
    const res = await fetchWithRetry(url, { timeout: 15000 });
    if (res.ok) {
      const data = await res.json() as any;
      if (Array.isArray(data)) {
        const partnersMap = new Map<string, number>();
        const targetUpper = gene.toUpperCase();
        for (const item of data) {
          const nameA = (item.preferredName_A || "").toUpperCase();
          const nameB = (item.preferredName_B || "").toUpperCase();
          const score = item.score !== undefined ? parseFloat(item.score) : 0.4;
          
          if (nameA === targetUpper && nameB !== targetUpper) {
            partnersMap.set(nameB, Math.max(partnersMap.get(nameB) || 0, score));
          } else if (nameB === targetUpper && nameA !== targetUpper) {
            partnersMap.set(nameA, Math.max(partnersMap.get(nameA) || 0, score));
          }
        }
        const parsed = Array.from(partnersMap.entries()).map(([partner, score]) => ({ partner, score }));
        parsed.sort((a, b) => b.score - a.score);
        const sliced = parsed.slice(0, 5);
        stringCache.set(cacheKey, sliced);
        return sliced;
      }
    }
  } catch (err: any) {
    console.warn(`[STRING Network Fetch Error] Failed to fetch STRING network: ${err.message}`);
  }

  stringCache.set(cacheKey, []);
  return [];
}

export async function submitDynaMut2Job(
  pdbText: string,
  chain: string,
  pos: number,
  wtRes: string,
  mutRes: string
): Promise<string | null> {
  const url = "https://biosig.lab.uq.edu.au/dynamut2/api/prediction_single";
  const mutationCode = `${wtRes}${pos}${mutRes}`; // e.g. R408W
  console.log(`[DynaMut2 API] Preparing to submit single mutation job for ${mutationCode} on chain ${chain}...`);

  try {
    const formData = new FormData();
    formData.append("mutation", mutationCode);
    formData.append("chain", chain || "A");
    formData.append("pdb_file", new Blob([pdbText], { type: "text/plain" }), "wt.pdb");

    const response = await fetchWithRetry(url, {
      method: "POST",
      body: formData,
      timeout: 20000
    });

    if (!response.ok) {
      throw new Error(`Submit job failed (status: ${response.status})`);
    }

    const data = await response.json() as any;
    const jobId = data.job_id;
    if (!jobId) {
      throw new Error("API response did not contain a job_id.");
    }
    console.log(`[DynaMut2 API] Job submitted successfully. Job ID: ${jobId}`);
    return String(jobId);
  } catch (err: any) {
    console.error(`[DynaMut2 API] Error during submission:`, err.message);
    return null;
  }
}

export async function pollDynaMut2Job(
  jobId: string
): Promise<{ status: "RUNNING" | "DONE" | "ERROR"; prediction: number | null } | null> {
  const url = "https://biosig.lab.uq.edu.au/dynamut2/api/prediction_single";
  try {
    const pollUrl = `${url}?job_id=${jobId}`;
    const pollRes = await fetchWithRetry(pollUrl, {
      method: "GET",
      timeout: 10000
    });

    if (!pollRes.ok) {
      console.warn(`[DynaMut2 API] Polling request failed for job ${jobId} (status: ${pollRes.status})`);
      if (pollRes.status === 429) {
        const rateLimitErr = new Error("DynaMut2 upstream rate limit reached");
        (rateLimitErr as any).statusCode = 429;
        throw rateLimitErr;
      }
      return { status: "ERROR", prediction: null };
    }

    const pollJson = await pollRes.json() as any;
    if (pollJson.prediction !== undefined && pollJson.prediction !== null) {
      const ddG = parseFloat(pollJson.prediction);
      console.log(`[DynaMut2 API] Prediction completed for job ${jobId}: ${ddG} kcal/mol`);
      return { status: "DONE", prediction: isNaN(ddG) ? null : ddG };
    }

    // Check if explicitly running, queued, or missing prediction/error
    if (
      pollJson.status === "RUNNING" ||
      pollJson.message === "RUNNING" ||
      pollJson.status === "QUEUED" ||
      (pollJson.prediction === undefined && !pollJson.error)
    ) {
      return { status: "RUNNING", prediction: null };
    }

    console.warn(`[DynaMut2 API] Polling returned error or unexpected format:`, pollJson);
    return { status: "ERROR", prediction: null };
  } catch (err: any) {
    console.error(`[DynaMut2 API] Error polling job ${jobId}:`, err.message);
    if (err.statusCode === 429) {
      throw err;
    }
    return { status: "ERROR", prediction: null };
  }
}

// =============================================================================
// FREQ-1: gnomAD Variant Allele Frequency (GraphQL)
// =============================================================================

export interface GnomadVariantFrequency {
  /** Max allele frequency across gnomAD v4 sub-populations */
  maxAF: number | null;
  /** gnomAD v4 genome AF (global) */
  genomeAF: number | null;
  /** gnomAD v4 exome AF (global) */
  exomeAF: number | null;
  /** gnomAD v4 genome Allele Count (raw count) */
  genomeAC: number | null;
  /** gnomAD v4 exome Allele Count (raw count) */
  exomeAC: number | null;
  /** gnomAD v4 genome Allele Number (total alleles observed) */
  genomeAN: number | null;
  /** gnomAD v4 exome Allele Number (total alleles observed) */
  exomeAN: number | null;
  /** Number of homozygous individuals in gnomAD (relevant for recessive disorders) */
  nHomozygous: number | null;
  /** Dataset used */
  dataset: string;
}

const gnomadFreqCache = new LRUCache<string, GnomadVariantFrequency>({
  max: 500,
  ttl: 1000 * 60 * 60 * 24, // 24-hour TTL
});

/**
 * Query gnomAD GraphQL API for variant allele frequencies.
 *
 * @param variantId  gnomAD variant ID in the form "CHR-POS-REF-ALT" (GRCh38).
 *                   If not known, pass null and the function returns null.
 */
export async function fetchGnomadVariantFrequency(
  variantId: string | null
): Promise<GnomadVariantFrequency | null> {
  if (!variantId) return null;

  const cached = gnomadFreqCache.get(variantId);
  if (cached !== undefined) return cached;

  const query = `
    query VariantFrequency($variantId: String!) {
      variant(variantId: $variantId, dataset: gnomad_r4) {
        variant_id
        genome {
          ac
          an
          af
          homozygote_count
        }
        exome {
          ac
          an
          af
          homozygote_count
        }
      }
    }
  `;

  try {
    const resp = await fetchWithRetry(
      "https://gnomad.broadinstitute.org/api",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, variables: { variantId } }),
        timeout: 15000,
      },
      2,
      1500
    );

    if (!resp.ok) {
      console.warn(`[gnomAD Freq] API responded ${resp.status} for variant ${variantId}`);
      return null;
    }

    const json = await resp.json();
    const v = json?.data?.variant;
    if (!v) {
      console.warn(`[gnomAD Freq] No variant data returned for ${variantId}`);
      return null;
    }

    const genomeAF: number | null = v.genome?.af ?? null;
    const exomeAF:  number | null = v.exome?.af  ?? null;
    const genomeAC: number | null = v.genome?.ac ?? null;
    const exomeAC:  number | null = v.exome?.ac  ?? null;
    const genomeAN: number | null = v.genome?.an ?? null;
    const exomeAN:  number | null = v.exome?.an  ?? null;
    const nHomozygous: number | null =
      (v.genome?.homozygote_count ?? 0) + (v.exome?.homozygote_count ?? 0) || null;

    const maxAF =
      genomeAF !== null && exomeAF !== null ? Math.max(genomeAF, exomeAF) :
      genomeAF !== null ? genomeAF :
      exomeAF  !== null ? exomeAF  : null;

    const result: GnomadVariantFrequency = {
      maxAF,
      genomeAF,
      exomeAF,
      genomeAC,
      exomeAC,
      genomeAN,
      exomeAN,
      nHomozygous,
      dataset: "gnomad_r4",
    };

    gnomadFreqCache.set(variantId, result);
    return result;
  } catch (err: any) {
    console.error(`[gnomAD Freq] Error fetching ${variantId}:`, err.message);
    return null;
  }
}

// =============================================================================
// ACMG-6: gnomAD Gene Constraint Metrics (GraphQL) — for PP2 evidence
// =============================================================================

export interface GnomadGeneConstraint {
  /** Missense Z-score: ≥ 3.09 → constrained (PP2 evidence) */
  missense_z: number | null;
  /** Observed / Expected missense ratio: < 0.8 → constrained (PP2 evidence) */
  oe_mis: number | null;
  /** pLI score for LoF constraint */
  pli: number | null;
  /** Whether gene meets PP2 thresholds */
  isPP2Constrained: boolean;
}

const gnomadConstraintCache = new LRUCache<string, GnomadGeneConstraint>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 7, // 7-day TTL (gene constraint is stable)
});

export async function fetchGnomadGeneConstraint(
  geneSymbol: string
): Promise<GnomadGeneConstraint | null> {
  const key = geneSymbol.toUpperCase();
  const cached = gnomadConstraintCache.get(key);
  if (cached !== undefined) return cached;

  const query = `
    query GeneConstraint($gene: String!) {
      gene(gene_symbol: $gene, reference_genome: GRCh38) {
        gnomad_constraint {
          mis_z
          oe_mis
          pLI
        }
      }
    }
  `;

  try {
    const resp = await fetchWithRetry(
      "https://gnomad.broadinstitute.org/api",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, variables: { gene: key } }),
        timeout: 15000,
      },
      2,
      1500
    );

    if (!resp.ok) {
      console.warn(`[gnomAD Constraint] API ${resp.status} for gene ${key}`);
      return null;
    }

    const json = await resp.json();
    const constraint = json?.data?.gene?.gnomad_constraint;
    if (!constraint) {
      console.warn(`[gnomAD Constraint] No constraint data for ${key}`);
      return null;
    }

    const missense_z: number | null = constraint.mis_z   ?? null;
    const oe_mis:     number | null = constraint.oe_mis  ?? null;
    const pli:        number | null = constraint.pLI     ?? null;

    // PP2 thresholds per ACMG-6 plan:
    //   mis_z >= 3.09 OR oe_mis < 0.8 → constrained
    const isPP2Constrained =
      (missense_z !== null && missense_z >= 3.09) ||
      (oe_mis     !== null && oe_mis     <  0.8);

    const result: GnomadGeneConstraint = { missense_z, oe_mis, pli, isPP2Constrained };
    gnomadConstraintCache.set(key, result);
    return result;
  } catch (err: any) {
    console.error(`[gnomAD Constraint] Error fetching ${key}:`, err.message);
    return null;
  }
}

// =============================================================================
// UniProt: Curated functional feature annotations (active site, binding, etc.)
// =============================================================================

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
}

const uniprotFeaturesCache = new LRUCache<string, UniprotFeaturesResult>({
  max: 500,
  ttl: 1000 * 60 * 60 * 24 * 3, // 3-day TTL
});

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

    const result: UniprotFeaturesResult = { features, geneName };
    uniprotFeaturesCache.set(key, result);
    return result;
  } catch (err: any) {
    console.error(`[UniProt Features] Error fetching ${key}:`, err.message);
    return null;
  }
}

// =============================================================================
// Landscape Data: Batch query surrounding residues' constraint/conservation
// =============================================================================

export interface LandscapePositionData {
  residx: number;
  revelMax: number | null;
  amMax: number | null;
  gerp: number | null;
  phylop: number | null;
}

const landscapeCache = new LRUCache<string, LandscapePositionData[]>({
  max: 100,
  ttl: 1000 * 60 * 60 * 24, // 1-day TTL
});

export async function fetchLandscapeData(
  gene: string,
  startPos: number,
  endPos: number
): Promise<LandscapePositionData[]> {
  const normGene = normalizeGeneSymbol(gene);
  const cacheKey = `${normGene}_${startPos}_${endPos}`;
  const cached = landscapeCache.get(cacheKey);
  if (cached) return cached;

  const queryStr = `dbnsfp.genename:${normGene} AND dbnsfp.aa.pos:[${startPos} TO ${endPos}]`;
  const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(queryStr)}&fields=dbnsfp.revel,dbnsfp.alphamissense,dbnsfp.gerp%2B%2B,dbnsfp.gerp,dbnsfp.phylop,dbnsfp.aa.pos&size=1000`;

  const result: LandscapePositionData[] = [];
  const landscapeMap = new Map<number, {
    revelScores: number[];
    amScores: number[];
    gerpScores: number[];
    phylopScores: number[];
  }>();

  for (let pos = startPos; pos <= endPos; pos++) {
    landscapeMap.set(pos, {
      revelScores: [],
      amScores: [],
      gerpScores: [],
      phylopScores: []
    });
  }

  try {
    const res = await fetchWithRetry(url, {
      headers: { "Accept": "application/json" },
      timeout: 15000
    });
    if (res.ok) {
      const data = await res.json() as any;
      if (data.hits && Array.isArray(data.hits)) {
        data.hits.forEach((hit: any) => {
          const dbnsfp = hit.dbnsfp;
          if (!dbnsfp) return;

          const posList = Array.isArray(dbnsfp.aa?.pos)
            ? dbnsfp.aa.pos
            : (dbnsfp.aa?.pos ? [dbnsfp.aa.pos] : []);
          
          const targetPos = posList.find((p: any) => p >= startPos && p <= endPos);
          if (!targetPos) return;

          const posData = landscapeMap.get(targetPos);
          if (!posData) return;

          // Parse REVEL
          if (dbnsfp.revel) {
            let revVal = dbnsfp.revel.score !== undefined ? dbnsfp.revel.score : dbnsfp.revel;
            if (Array.isArray(revVal)) revVal = revVal[0];
            const val = parseFloat(revVal);
            if (!isNaN(val)) posData.revelScores.push(val);
          }

          // Parse AlphaMissense
          if (dbnsfp.alphamissense) {
            let amVal = dbnsfp.alphamissense.score !== undefined ? dbnsfp.alphamissense.score : dbnsfp.alphamissense;
            if (Array.isArray(amVal)) amVal = amVal[0];
            const val = parseFloat(amVal);
            if (!isNaN(val)) posData.amScores.push(val);
          }

          // Parse GERP++ / GERP
          const gerpObj = dbnsfp['gerp++'] || {};
          let gerpVal = gerpObj.rs !== undefined ? gerpObj.rs : null;
          if (gerpVal === null && dbnsfp.gerp?.['91_mammals']?.score !== undefined) {
            gerpVal = dbnsfp.gerp['91_mammals'].score;
          }
          if (gerpVal !== null) {
            const val = parseFloat(Array.isArray(gerpVal) ? gerpVal[0] : gerpVal);
            if (!isNaN(val)) posData.gerpScores.push(val);
          }

          // Parse PhyloP
          if (dbnsfp.phylop) {
            let phylopVal = dbnsfp.phylop['100way_vertebrate']?.score !== undefined
              ? dbnsfp.phylop['100way_vertebrate'].score
              : (dbnsfp.phylop.vertebrate || dbnsfp.phylop['phylop100way_vertebrate'] || null);
            if (phylopVal !== null) {
              const val = parseFloat(Array.isArray(phylopVal) ? phylopVal[0] : phylopVal);
              if (!isNaN(val)) posData.phylopScores.push(val);
            }
          }
        });
      }
    }
  } catch (err: any) {
    console.warn(`[Landscape Fetch Error] Failed to fetch dbNSFP landscape: ${err.message}`);
  }

  // Summarize into result array
  for (let pos = startPos; pos <= endPos; pos++) {
    const d = landscapeMap.get(pos)!;
    result.push({
      residx: pos,
      revelMax: d.revelScores.length > 0 ? Math.max(...d.revelScores) : null,
      amMax: d.amScores.length > 0 ? Math.max(...d.amScores) : null,
      gerp: d.gerpScores.length > 0 ? d.gerpScores.reduce((a, b) => a + b, 0) / d.gerpScores.length : null,
      phylop: d.phylopScores.length > 0 ? d.phylopScores.reduce((a, b) => a + b, 0) / d.phylopScores.length : null
    });
  }

  landscapeCache.set(cacheKey, result);
  return result;
}


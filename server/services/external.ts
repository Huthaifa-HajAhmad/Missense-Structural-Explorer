import { LRUCache } from "lru-cache";
import https from "https";
import crypto from "crypto";
import { CLINVAR_AA_MAP, CLINVAR_REV_AA_MAP, AMINO_ACID_1_TO_3_TITLE } from "../../src/aminoAcids.ts";
import { validateUniProt, CircuitBreaker } from "../utils.ts";
import { z } from "zod";
import { TabixIndexedFile } from "@gmod/tabix";
import path from "path";
import fs from "fs";
import { isLocalDbnsfpAvailable, queryLocalDbnsfpVariant, queryLocalDbnsfpLandscape } from "./dbnsfp_local.ts";
import { queryGenosWebservice } from "./genos_web.ts";

export function normalizeGeneSymbol(gene: string): string {
  const g = gene.trim().toUpperCase();
  if (g === "GBA1") return "GBA";
  return g;
}

const hostBreakers = new Map<string, CircuitBreaker>();

function getHostBreaker(hostname: string): CircuitBreaker {
  let breaker = hostBreakers.get(hostname);
  if (!breaker) {
    breaker = new CircuitBreaker(5, 60000); // 5 failures, 60s cooldown
    hostBreakers.set(hostname, breaker);
  }
  return breaker;
}

export async function fetchWithRetry(url: string, options: RequestInit & { timeout?: number } = {}, retries = 3, delay = 1000): Promise<Response> {
  let hostname = "unknown";
  try {
    hostname = new URL(url).hostname;
  } catch (_) {}

  const breaker = getHostBreaker(hostname);
  if (!breaker.canExecute()) {
    throw new Error(`Upstream service ${hostname} is temporarily unavailable (circuit breaker open).`);
  }

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
        breaker.recordFailure();
        lastStatus = res.status;
        let backoff = delay * (2 ** i);
        let hasRetryAfter = false;
        if (res.status === 429) {
          const retryAfterHeader = res.headers.get("Retry-After");
          if (retryAfterHeader) {
            const seconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(seconds)) {
              backoff = seconds * 1000;
              hasRetryAfter = true;
            } else {
              const date = Date.parse(retryAfterHeader);
              if (!isNaN(date)) {
                backoff = Math.max(0, date - Date.now());
                hasRetryAfter = true;
              }
            }
          }
        }
        if (!hasRetryAfter) {
          const jitter = 0.5 + Math.random() * 0.5;
          backoff = Math.round(backoff * jitter);
        }
        console.warn(`[Upstream Fetch ${res.status}] error/limit on ${url}. Retrying after ${backoff}ms (attempt ${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      
      breaker.recordSuccess();
      return res;
    } catch (err: any) {
      breaker.recordFailure();
      if (i === retries - 1) {
        err.statusCode = lastStatus;
        throw err;
      }
      const jitter = 0.5 + Math.random() * 0.5;
      const backoff = Math.round(delay * (2 ** i) * jitter);
      console.warn(`[Upstream Fetch Error] Failed to fetch ${url} (attempt ${i + 1}/${retries}): ${err.message}. Retrying in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  const errObj = new Error(`Failed to fetch ${url} after ${retries} attempts.`);
  (errObj as any).statusCode = lastStatus;
  throw errObj;
}

export function normalizeVariantTo3Letter(variant: string): string {
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

export const afUrlCache = new LRUCache<string, string>({
  max: 1000,
  ttl: 24 * 60 * 60 * 1000 // 24 hour TTL (M-3)
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
  landscapeCache.clear();
}

export interface ClinVarData {
  classification: string;
  lastEvaluated: string;
  reviewStatus: string;
  alleleFrequencies: { source: string; value: any }[];
  trait: string;
  uid: string | null;
  hasOtherPathogenicVariantSameAA?: boolean;
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
    canonical: z.union([z.number(), z.boolean()]).optional(),
    mane_select: z.string().optional(),
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
      phylop: z.any().optional(),
      bayesdel_noaf_score: z.any().optional(),
      bayesdel: z.any().optional(),
      hgvsp: z.any().optional(),
      metarnn: z.any().optional(),
      clinpred: z.any().optional(),
      eigen: z.any().optional(),
      dann: z.any().optional(),
      esm1b: z.any().optional(),
      eve: z.any().optional(),
      aou_ac: z.any().optional(),
      aou_an: z.any().optional(),
      aou_het: z.any().optional(),
      aou_hom: z.any().optional()
    }).optional()
  })).optional()
});

function getCodingNotation(title: string): string | null {
  const match = title.match(/(c\.[^\s(]+)/i);
  return match ? match[1].toLowerCase() : null;
}

export async function fetchClinVarData(gene: string, variant: string, originalNotation?: string): Promise<ClinVarData> {
  const cacheKey = `${gene}_${variant}_${originalNotation || ""}`;
  const cached = clinvarCache.get(cacheKey);
  if (cached) return cached;

  const defaultRes: ClinVarData = {
    classification: "Not found in ClinVar",
    lastEvaluated: "",
    reviewStatus: "",
    alleleFrequencies: [],
    trait: "",
    uid: null,
    hasOtherPathogenicVariantSameAA: false
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
    clinvarCache.set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
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

  // Match entries to queryNorm first
  const matchingEntries: { id: string; entry: any; cleanTitle: string }[] = [];
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
      matchingEntries.push({ id, entry, cleanTitle: title });
    }
  }

  if (matchingEntries.length === 0) {
    clinvarCache.set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
    return defaultRes;
  }

  // Find user's specific matched entry
  let matchedIdx = 0;
  if (originalNotation) {
    const cleanNotation = originalNotation.trim().toLowerCase();
    const idx = matchingEntries.findIndex(m => m.cleanTitle.includes(cleanNotation));
    if (idx !== -1) {
      matchedIdx = idx;
    }
  }

  const { id: matchedId, entry: matchedEntry } = matchingEntries[matchedIdx];
  const matchedTitle = matchingEntries[matchedIdx].cleanTitle;
  const matchedC = getCodingNotation(matchedTitle);

  // Check if there is another entry that is pathogenic/likely pathogenic
  let hasOtherPathogenicVariantSameAA = false;
  for (let i = 0; i < matchingEntries.length; i++) {
    if (i === matchedIdx) continue;
    const otherClass = (matchingEntries[i].entry.germline_classification?.description || "").toLowerCase();
    if (otherClass.includes("pathogenic") || otherClass.includes("likely pathogenic")) {
      const otherC = getCodingNotation(matchingEntries[i].cleanTitle);
      if (!matchedC || !otherC || matchedC !== otherC) {
        hasOtherPathogenicVariantSameAA = true;
        break;
      }
    }
  }

  const classification = matchedEntry.germline_classification?.description || "Unknown";
  const lastEvaluated = matchedEntry.germline_classification?.last_evaluated || "";
  const reviewStatus = matchedEntry.germline_classification?.review_status || "";
  const traits = (matchedEntry.germline_classification?.trait_set || []).map((t: any) => t.trait_name || "").filter(Boolean).join(", ");
  
  const alleleFrequencies = (matchedEntry.allele_freq_set || []).map((freq: any) => ({
    source: freq.source || "Unknown",
    value: freq.value !== undefined ? freq.value : null
  }));
  
  const resVal: ClinVarData = {
    classification,
    lastEvaluated,
    reviewStatus,
    alleleFrequencies,
    trait: traits,
    uid: matchedId,
    hasOtherPathogenicVariantSameAA
  };
  clinvarCache.set(cacheKey, resVal);
  return resVal;
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
  
  const cachedUrl = afUrlCache.get(validatedUniprot);
  if (cachedUrl) {
    try {
      const pRes = await fetchWithRetry(cachedUrl, {
        headers: { "User-Agent": "Missense-Structural-Explorer/1.0", "Accept": "*/*" },
        timeout: 15000
      });
      if (pRes.ok) {
        const pdbText = await pRes.text();
        if (pdbText && pdbText.includes("ATOM")) {
          return pdbText;
        }
      }
    } catch (_) {}
  }

  // 1. Try querying EBI AlphaFold API first to find correct URL
  const afApiUrl = `https://alphafold.ebi.ac.uk/api/prediction/${validatedUniprot}`;
  let pdbUrlFromApi = "";
  try {
    const apiResponse = await fetchWithRetry(afApiUrl, {
      headers: {
        "User-Agent": "Missense-Structural-Explorer/1.0 (bioinformatics-app)",
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
          afUrlCache.set(validatedUniprot, url);
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
): Promise<{ pdbId: string; chainId: string; shift: number; unpStart: number; structStart: number } | null> {
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
      
      // Allow shifts, but verify the position coverage
      const hasCoverage = pos !== undefined ? (pos >= item.unp_start && pos <= item.unp_end) : true;
      if (!hasCoverage) continue;
      
      const shift = item.unp_start - item.start;
      console.log(`[PDB Prioritizer] Found suitable experimental structure: ${item.pdb_id} chain ${item.chain_id} (Resolution: ${item.resolution}Å, Coverage: ${item.coverage}, Shift: ${shift})`);
      return { 
        pdbId: item.pdb_id.toLowerCase(), 
        chainId: item.chain_id, 
        shift,
        unpStart: item.unp_start,
        structStart: item.start
      };
    }
  } catch (err: any) {
    console.error("[PDB Prioritizer] Error finding best PDB structure:", err.message || err);
  }
  return null;
}

export function extractChainFromPdb(pdbText: string, chainId: string, shift = 0): string {
  const lines = pdbText.split("\n");
  const filteredLines: string[] = [];
  const targetChain = chainId.trim().toUpperCase();
  
  for (const line of lines) {
    const recordType = line.substring(0, 6).trim();
    
    if (recordType === "ATOM" || recordType === "HETATM") {
      // Chain identifier is at index 21 (0-indexed)
      const lineChain = line.length > 21 ? line.charAt(21).toUpperCase() : "";
      if (lineChain === targetChain) {
        if (shift !== 0 && line.length >= 26) {
          const resSeq = parseInt(line.substring(22, 26).trim(), 10);
          if (!isNaN(resSeq)) {
            const newResSeq = resSeq + shift;
            const newResSeqStr = String(newResSeq).padStart(4, " ");
            filteredLines.push(line.substring(0, 22) + newResSeqStr + line.substring(26));
            continue;
          }
        }
        filteredLines.push(line);
      }
    } else if (recordType === "TER") {
      const lineChain = line.length > 21 ? line.charAt(21).toUpperCase() : "";
      if (!lineChain || lineChain === targetChain) {
        if (shift !== 0 && line.length >= 26) {
          const resSeq = parseInt(line.substring(22, 26).trim(), 10);
          if (!isNaN(resSeq)) {
            const newResSeq = resSeq + shift;
            const newResSeqStr = String(newResSeq).padStart(4, " ");
            filteredLines.push(line.substring(0, 22) + newResSeqStr + line.substring(26));
            continue;
          }
        }
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

function parseFirstResidueSeq(pdbText: string, chainId: string): number | null {
  const lines = pdbText.split("\n");
  const targetChain = chainId.trim().toUpperCase();
  for (const line of lines) {
    if (line.startsWith("ATOM")) {
      const lineChain = line.length > 21 ? line.charAt(21).toUpperCase() : "";
      if (lineChain === targetChain) {
        const resSeq = parseInt(line.substring(22, 26).trim(), 10);
        if (!isNaN(resSeq)) {
          return resSeq;
        }
      }
    }
  }
  return null;
}

export async function fetchPdbFromRcsb(
  pdbId: string,
  chainId?: string,
  unpStart?: number,
  structStart?: number
): Promise<string | null> {
  const chainUpper = (chainId || "A").toUpperCase();
  const cacheKey = `pdb_rcsb_${pdbId.toLowerCase()}_chain_${chainUpper}_unp_${unpStart || 0}_struct_${structStart || 0}`;
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

    const firstResSeq = parseFirstResidueSeq(fullText, chainUpper);
    let finalShift = 0;
    if (unpStart !== undefined && structStart !== undefined && firstResSeq !== null) {
      if (Math.abs(firstResSeq - unpStart) < Math.abs(firstResSeq - structStart)) {
        finalShift = 0;
        console.log(`[RCSB PDB] PDB file ${pdbId} chain ${chainUpper} appears already aligned with UniProt (first residue in PDB: ${firstResSeq}, unpStart: ${unpStart}). Using shift: 0`);
      } else {
        finalShift = unpStart - structStart;
        console.log(`[RCSB PDB] PDB file ${pdbId} chain ${chainUpper} appears to use structural coordinates (first residue in PDB: ${firstResSeq}, structStart: ${structStart}, unpStart: ${unpStart}). Using shift: ${finalShift}`);
      }
    }

    const chainPdb = extractChainFromPdb(fullText, chainUpper, finalShift);
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
  bayesdel?: number | null;
  metarnn?: number | null;
  metarnnPred?: string | null;
  clinpred?: number | null;
  clinpredPred?: string | null;
  eigenPhred?: number | null;
  eigenRaw?: number | null;
  dann?: number | null;
  esm1b?: number | null;
  esm1bPred?: string | null;
  popeve?: number | null;
  aouFrequency?: {
    aouAC: number | null;
    aouAN: number | null;
    aouHet: number | null;
    aouHom: number | null;
  } | null;
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
  const url = `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(normGene)}:p.${encodeURIComponent(cleanVar)}?content-type=application/json&AlphaMissense=1&CADD=1&EVE=1&mane=1`;
  
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
        const hasPredictor = (c: any) => c.alphamissense || c.cadd_phred !== undefined || c.eve_score !== undefined;
        let tc = consequences.find((c: any) => c.mane_select && hasPredictor(c));
        if (!tc) {
          tc = consequences.find((c: any) => (c.canonical === 1 || c.canonical === true || c.canonical === "1") && hasPredictor(c));
        }
        if (!tc) {
          tc = consequences.find(hasPredictor);
        }
        if (!tc) {
          tc = consequences[0];
        }
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
  predictorCache.set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
  return defaultRes;
}

export async function fetchRealConsurfData(pdbId: string, chainId: string, pos: number): Promise<number | null> {
  const cleanPdb = pdbId.toUpperCase();
  const cleanChain = chainId.toUpperCase();
  
  const selUrl = `https://consurfdb.tau.ac.il/scripts/chain_selection.php?pdb_ID=${cleanPdb}`;
  try {
    const selRes = await fetchWithRetry(selUrl, { timeout: 10000 });
    if (!selRes.ok) return null;
    const html = await selRes.text();
    
    let hash: string | null = null;
    const matches = [...html.matchAll(/<option\s+value=["'](\S+)\s+(\S{5})["']/gi)];
    for (const match of matches) {
      if (match[1].toUpperCase() === cleanChain) {
        hash = match[2];
        break;
      }
    }
    
    if (!hash) return null;
    
    const sumUrl = `https://consurfdb.tau.ac.il/DB/${hash}/consurf_summary.txt`;
    const sumRes = await fetchWithRetry(sumUrl, { timeout: 10000 });
    if (!sumRes.ok) return null;
    const txt = await sumRes.text();
    
    let colorVal: number | null = null;
    const lines = txt.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("POS")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) continue;
      
      const colPos = parts[0];
      const colAtom = parts[2];
      const colColor = parts[4];
      
      const posNum = parseInt(colPos, 10);
      const atomMatch = colAtom.match(/^[A-Z]{3}(\d+):/i);
      const atomResNum = atomMatch ? parseInt(atomMatch[1], 10) : null;
      
      if (posNum === pos || atomResNum === pos) {
        const colorInt = parseInt(colColor, 10);
        if (!isNaN(colorInt) && colorInt >= 1 && colorInt <= 9) {
          colorVal = colorInt;
          break;
        }
      }
    }
    return colorVal;
  } catch (err: any) {
    console.warn(`[ConSurf Fetch Warning] Failed to fetch ConSurf data for ${cleanPdb}:${cleanChain}:${pos}: ${err.message}`);
    return null;
  }
}

const popEVECache = new LRUCache<string, any>({ max: 500, ttl: 60 * 60 * 1000 });
let popEVETabix: TabixIndexedFile | null = null;

function getPopEVETabix(): TabixIndexedFile | null {
  if (popEVETabix) return popEVETabix;
  const vcfPath = path.join(process.cwd(), "data", "popeve", "popeve_grch38.vcf.gz");
  if (!fs.existsSync(vcfPath)) return null;
  popEVETabix = new TabixIndexedFile({
    path: vcfPath
  });
  return popEVETabix;
}

export async function fetchPopEVEScore(
  chrom: string,
  pos: number,
  ref: string,
  alt: string
): Promise<number | null> {
  const cacheKey = `${chrom}:${pos}:${ref}:${alt}`;
  const cached = popEVECache.get(cacheKey);
  if (cached !== undefined) return cached;

  const tbi = getPopEVETabix();
  if (!tbi) {
    return null;
  }

  const chromNorm = chrom.startsWith("chr") ? chrom : `chr${chrom}`;
  const chromsToTry = chromNorm.startsWith("chr") 
    ? [chromNorm, chromNorm.slice(3)] 
    : [chromNorm, `chr${chromNorm}`];

  try {
    let score: number | null = null;
    for (const ch of chromsToTry) {
      try {
        await tbi.getLines(ch, pos - 1, pos, (line: string) => {
          const cols = line.split("\t");
          if (cols[1] !== String(pos)) return;
          if (cols[3] !== ref || cols[4] !== alt) return;
          const info = cols[7] ?? "";
          const match = info.match(/popEVE=([0-9.-]+)/);
          if (match) score = parseFloat(match[1]);
        });
        if (score !== null) break;
      } catch (innerErr) {
        // Try next chromosome format
      }
    }
    popEVECache.set(cacheKey, score);
    return score;
  } catch (err: any) {
    console.warn(`[popEVE] Tabix lookup failed for ${chromNorm}:${pos}:`, err.message);
    popEVECache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
    return null;
  }
}

const popEveOnlineCache = new LRUCache<string, any>({ max: 500, ttl: 1000 * 60 * 60 * 24 });
const refseqCache = new LRUCache<string, any>({ max: 1000, ttl: 1000 * 60 * 60 * 24 * 7 });

async function getRefSeqForProtein(proteinOrGene: string): Promise<string | null> {
  const cached = refseqCache.get(proteinOrGene);
  if (cached !== undefined) return cached;

  try {
    const isUniprot = /^[A-Z0-9]{6,10}$/i.test(proteinOrGene);
    const url = isUniprot 
      ? `https://rest.uniprot.org/uniprotkb/${proteinOrGene}.json`
      : `https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${proteinOrGene}+AND+organism_id:9606&fields=xref_refseq&format=json`;

    const res = await fetchWithRetry(url, { timeout: 10000 });
    if (!res.ok) {
      refseqCache.set(proteinOrGene, null);
      return null;
    }
    const data = await res.json() as any;
    let dbXrefs: any[] = [];
    if (isUniprot) {
      dbXrefs = data.uniProtKBCrossReferences || [];
    } else if (data.results && data.results.length > 0) {
      dbXrefs = data.results[0].uniProtKBCrossReferences || [];
    }

    const refseqXrefs = dbXrefs.filter((x: any) => x.database === "RefSeq");
    const refseqId = refseqXrefs.find((x: any) => typeof x.id === "string" && x.id.startsWith("NP_"))?.id || refseqXrefs[0]?.id || null;

    refseqCache.set(proteinOrGene, refseqId);
    return refseqId;
  } catch (err: any) {
    console.warn(`[popEVE Online] RefSeq lookup warning for ${proteinOrGene}: ${err.message}`);
    refseqCache.set(proteinOrGene, null);
    return null;
  }
}

export async function fetchPopEVEScoreOnline(proteinOrGene: string, variant: string): Promise<number | null> {
  const cacheKey = `${proteinOrGene}_${variant}`;
  const cached = popEveOnlineCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const refseqId = await getRefSeqForProtein(proteinOrGene);
    if (!refseqId) {
      popEveOnlineCache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
      return null;
    }

    const csvUrl = `https://data.evemodel.org/popeve/v1.1/mutations/${refseqId}.csv`;
    const res = await fetchWithRetry(csvUrl, { timeout: 15000 });
    if (!res.ok) {
      popEveOnlineCache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
      return null;
    }
    const csvText = await res.text();

    const match = variant.match(/([A-Z]{1,3})[=:/]?(\d+)[=:/]?([A-Z]{1,3})/i);
    if (!match) {
      popEveOnlineCache.set(cacheKey, null);
      return null;
    }

    const toSingle = (aa: string) => {
      if (aa.length === 1) return aa.toUpperCase();
      const map: Record<string, string> = { ALA:'A', ARG:'R', ASN:'N', ASP:'D', CYS:'C', GLU:'E', GLN:'Q', GLY:'G', HIS:'H', ILE:'I', LEU:'L', LYS:'K', MET:'M', PHE:'F', PRO:'P', SER:'S', THR:'T', TRP:'W', TYR:'Y', VAL:'V' };
      return map[aa.toUpperCase()] || aa.toUpperCase();
    };

    const targetMut = `${toSingle(match[1])}${match[2]}${toSingle(match[3])}`;
    const lines = csvText.split("\n");
    if (lines.length === 0) return null;

    const header = lines[0].split(",");
    const popEveIdx = header.indexOf("popEVE");
    if (popEveIdx === -1) return null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith(targetMut + ",")) {
        const parts = line.split(",");
        const scoreVal = parseFloat(parts[popEveIdx]);
        if (!isNaN(scoreVal)) {
          popEveOnlineCache.set(cacheKey, scoreVal);
          return scoreVal;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[popEVE Online Error] ${err.message}`);
  }

  popEveOnlineCache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
  return null;
}

export async function fetchConservationData(
  gene: string,
  variant: string,
  pdbId?: string | null,
  chainId?: string | null,
  pos?: number | null,
  gnomadVariantId?: string | null,
  genosRec?: any | null,
  uniprotId?: string | null
): Promise<ConservationData> {
  const cacheKey = `${gene}_${variant}_${pdbId || ""}_${chainId || ""}_${pos || ""}_${gnomadVariantId || ""}`;
  const cached = conservationCache.get(cacheKey);
  if (cached) {
    if (cached.popeve !== null) {
      return cached;
    }
    const onlineScore = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
    if (onlineScore !== null) {
      cached.popeve = onlineScore;
      conservationCache.set(cacheKey, cached);
    }
    return cached;
  }

  const resolvedPos = (pos !== undefined && pos !== null) 
    ? pos 
    : (() => {
        const match = variant.match(/\d+/);
        return match ? parseInt(match[0], 10) : null;
      })();

  const defaultRes: ConservationData = {
    available: false,
    revel: null,
    gerp: null,
    phylop: null,
    consurf: null,
    bayesdel: null,
    metarnn: null,
    metarnnPred: null,
    clinpred: null,
    clinpredPred: null,
    eigenPhred: null,
    eigenRaw: null,
    dann: null,
    esm1b: null,
    esm1bPred: null,
    popeve: null,
    aouFrequency: null
  };

  if (isLocalDbnsfpAvailable() && resolvedPos !== null) {
    try {
      const rec = await queryLocalDbnsfpVariant(gene, resolvedPos, null, null, variant);
      if (rec) {
        const popEVEPromise = gnomadVariantId
          ? (async () => {
              const parts = gnomadVariantId.split("-");
              if (parts.length >= 4) {
                const chrom = parts[0];
                const posVal = parseInt(parts[1], 10);
                const ref = parts[2];
                const alt = parts[3];
                if (!isNaN(posVal)) {
                  return fetchPopEVEScore(chrom, posVal, ref, alt);
                }
              }
              return null;
            })()
          : Promise.resolve(null);

        const consurfPromise = (pdbId && chainId)
          ? fetchRealConsurfData(pdbId, chainId, resolvedPos)
          : Promise.resolve(null);

        const [popEVEScore, consurfVal] = await Promise.all([popEVEPromise, consurfPromise]);

        let popEVEVal = rec.popeve ?? popEVEScore;
        if (popEVEVal === null) {
          popEVEVal = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
        }

        const resVal: ConservationData = {
          available: true,
          revel: rec.revel,
          gerp: rec.gerp,
          phylop: rec.phylop,
          consurf: consurfVal,
          bayesdel: rec.bayesdel,
          metarnn: rec.metarnn,
          metarnnPred: null,
          clinpred: rec.clinpred,
          clinpredPred: null,
          eigenPhred: rec.eigen,
          eigenRaw: null,
          dann: rec.dann,
          esm1b: rec.esm1b,
          esm1bPred: null,
          popeve: popEVEVal,
          aouFrequency: {
            aouAC: rec.aou_ac,
            aouAN: rec.aou_an,
            aouHet: rec.aou_het,
            aouHom: rec.aou_hom
          }
        };
        conservationCache.set(cacheKey, resVal);
        return resVal;
      }
    } catch (err: any) {
      console.warn(`[Local dbNSFP Query Error] Fallback to remote: ${err.message}`);
    }
  }

  // Try Genos Web Query service before falling back to MyVariant.info
  try {
    const activeGenosRec = genosRec !== undefined && genosRec !== null ? genosRec : await queryGenosWebservice(gene, variant, gnomadVariantId);
    if (activeGenosRec) {
      const consurfPromise = (pdbId && chainId && resolvedPos !== null)
        ? fetchRealConsurfData(pdbId, chainId, resolvedPos)
        : Promise.resolve(null);
      const consurfVal = await consurfPromise;

      let popEVEVal = activeGenosRec.popeve;
      if (popEVEVal === null) {
        popEVEVal = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
      }

      const resVal: ConservationData = {
        available: true,
        revel: activeGenosRec.revel,
        gerp: activeGenosRec.gerp,
        phylop: activeGenosRec.phylop,
        consurf: consurfVal,
        bayesdel: activeGenosRec.bayesdel,
        metarnn: activeGenosRec.metarnn,
        metarnnPred: null,
        clinpred: activeGenosRec.clinpred,
        clinpredPred: null,
        eigenPhred: activeGenosRec.eigenPhred,
        eigenRaw: null,
        dann: activeGenosRec.dann,
        esm1b: activeGenosRec.esm1b,
        esm1bPred: null,
        popeve: popEVEVal,
        aouFrequency: activeGenosRec.aou_ac !== null ? {
          aouAC: activeGenosRec.aou_ac,
          aouAN: activeGenosRec.aou_an,
          aouHet: activeGenosRec.aou_ac,
          aouHom: 0
        } : null
      };
      conservationCache.set(cacheKey, resVal);
      return resVal;
    }
  } catch (err: any) {
    console.warn(`[Genos Web Query Fallback Error] ${err.message}`);
  }

  const cleanVar = normalizeVariantTo3Letter(variant);
  const normGene = normalizeGeneSymbol(gene);
  const queryStr = (resolvedPos !== null)
    ? `dbnsfp.genename:${normGene} AND dbnsfp.aa.pos:${resolvedPos}`
    : `dbnsfp.genename:${normGene} AND dbnsfp.hgvsp:"p.${cleanVar}"`;
  const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(queryStr)}&fields=dbnsfp&limit=100`;
  
  try {
    const myVariantPromise = fetchWithRetry(url, {
      headers: { "Accept": "application/json" },
      timeout: 15000
    });

    const consurfPromise = (pdbId && chainId && pos)
      ? fetchRealConsurfData(pdbId, chainId, pos)
      : Promise.resolve(null);

    const popEVEPromise = gnomadVariantId
      ? (async () => {
          const parts = gnomadVariantId.split("-");
          if (parts.length >= 4) {
            const chrom = parts[0];
            const posVal = parseInt(parts[1], 10);
            const ref = parts[2];
            const alt = parts[3];
            if (!isNaN(posVal)) {
              return fetchPopEVEScore(chrom, posVal, ref, alt);
            }
          }
          return null;
        })()
      : Promise.resolve(null);

    const [res, consurfVal, popEVEScore] = await Promise.all([
      myVariantPromise,
      consurfPromise,
      popEVEPromise
    ]);

    if (res.ok) {
      const data = await res.json() as any;
      const parsedData = myVariantResponseSchema.parse(data);
      if (parsedData.hits && parsedData.hits.length > 0) {
        const matchTerm = `p.${cleanVar}`;
        let hit = parsedData.hits.find(h => {
          const hgvspField = h.dbnsfp?.hgvsp;
          if (!hgvspField) return false;
          const hgvspArray = Array.isArray(hgvspField) ? hgvspField : [hgvspField];
          return hgvspArray.some(hVal => 
            typeof hVal === "string" && hVal.toLowerCase().includes(matchTerm.toLowerCase())
          );
        }) || parsedData.hits[0];

        if (!hit) {
          conservationCache.set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
          return defaultRes;
        }

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

          // Parse BayesDel score (handles both dbnsfp.bayesdel.no_af.score and dbnsfp.bayesdel_noaf_score formats)
          let bayesdel: number | null = null;
          if (dbnsfp.bayesdel?.no_af?.score !== undefined && dbnsfp.bayesdel?.no_af?.score !== null) {
            let bVal = dbnsfp.bayesdel.no_af.score;
            if (Array.isArray(bVal)) bVal = bVal[0];
            bayesdel = bVal !== undefined && bVal !== null && bVal !== "" ? parseFloat(bVal) : null;
          } else if (dbnsfp.bayesdel_noaf_score !== undefined && dbnsfp.bayesdel_noaf_score !== null) {
            let bVal = dbnsfp.bayesdel_noaf_score;
            if (Array.isArray(bVal)) bVal = bVal[0];
            bayesdel = bVal !== undefined && bVal !== null && bVal !== "" ? parseFloat(bVal) : null;
          }

          // Parse MetaRNN
          let metarnn: number | null = null;
          let metarnnPred: string | null = null;
          if (dbnsfp.metarnn) {
            let v = dbnsfp.metarnn.score;
            if (Array.isArray(v)) v = v[0];
            metarnn = v != null ? parseFloat(v) : null;
            let p = dbnsfp.metarnn.pred;
            if (Array.isArray(p)) p = p[0];
            metarnnPred = typeof p === "string" ? p : null;
          }

          // Parse ClinPred
          let clinpred: number | null = null;
          let clinpredPred: string | null = null;
          if (dbnsfp.clinpred) {
            clinpred = dbnsfp.clinpred.score != null ? parseFloat(dbnsfp.clinpred.score) : null;
            clinpredPred = typeof dbnsfp.clinpred.pred === "string" ? dbnsfp.clinpred.pred : null;
          }

          // Parse Eigen
          let eigenPhred: number | null = null;
          let eigenRaw: number | null = null;
          if (dbnsfp.eigen) {
            eigenPhred = dbnsfp.eigen.phred_coding != null ? parseFloat(dbnsfp.eigen.phred_coding) : null;
            eigenRaw = dbnsfp.eigen.raw_coding != null ? parseFloat(dbnsfp.eigen.raw_coding) : null;
          }

          // Parse DANN
          let dann: number | null = null;
          if (dbnsfp.dann) {
            let d = dbnsfp.dann.score;
            if (Array.isArray(d)) d = d[0];
            dann = d != null ? parseFloat(d) : null;
          }

          // Parse ESM-1b
          let esm1b: number | null = null;
          let esm1bPred: string | null = null;
          if (dbnsfp.esm1b) {
            let s = dbnsfp.esm1b.score;
            if (Array.isArray(s)) s = s[0];
            esm1b = s != null ? parseFloat(s) : null;
            let ep = dbnsfp.esm1b.pred;
            if (Array.isArray(ep)) ep = ep[0];
            esm1bPred = typeof ep === "string" ? ep : null;
          }

          // Parse EVE / popEVE fallback
          let finalPopEVE = popEVEScore;
          if (finalPopEVE === null && dbnsfp.eve?.score !== undefined) {
            let eVal = dbnsfp.eve.score;
            if (Array.isArray(eVal)) eVal = eVal[0];
            const parsed = parseFloat(eVal);
            if (!isNaN(parsed)) finalPopEVE = parsed;
          }
          if (finalPopEVE === null) {
            finalPopEVE = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
          }

          // Parse All of Us counts
          let aouAC: number | null = null;
          let aouAN: number | null = null;
          let aouHet: number | null = null;
          let aouHom: number | null = null;

          if (dbnsfp.aou_ac !== undefined) {
            let val = Array.isArray(dbnsfp.aou_ac) ? dbnsfp.aou_ac[0] : dbnsfp.aou_ac;
            aouAC = val !== null && val !== "" ? parseInt(val, 10) : null;
          }
          if (dbnsfp.aou_an !== undefined) {
            let val = Array.isArray(dbnsfp.aou_an) ? dbnsfp.aou_an[0] : dbnsfp.aou_an;
            aouAN = val !== null && val !== "" ? parseInt(val, 10) : null;
          }
          if (dbnsfp.aou_het !== undefined) {
            let val = Array.isArray(dbnsfp.aou_het) ? dbnsfp.aou_het[0] : dbnsfp.aou_het;
            aouHet = val !== null && val !== "" ? parseInt(val, 10) : null;
          }
          if (dbnsfp.aou_hom !== undefined) {
            let val = Array.isArray(dbnsfp.aou_hom) ? dbnsfp.aou_hom[0] : dbnsfp.aou_hom;
            aouHom = val !== null && val !== "" ? parseInt(val, 10) : null;
          }

          const hasAou = aouAC !== null || aouAN !== null || aouHet !== null || aouHom !== null;

          const resVal: ConservationData = { 
            available: true, 
            revel, 
            gerp, 
            phylop, 
            consurf: consurfVal,
            bayesdel,
            metarnn,
            metarnnPred,
            clinpred,
            clinpredPred,
            eigenPhred,
            eigenRaw,
            dann,
            esm1b,
            esm1bPred,
            popeve: finalPopEVE,
            aouFrequency: hasAou ? {
              aouAC,
              aouAN,
              aouHet,
              aouHom
            } : null
          };
          conservationCache.set(cacheKey, resVal);
          return resVal;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Conservation Fetch Error] Failed to fetch MyVariant conservation: ${err.message}`);
  }

  conservationCache.set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
  return defaultRes;
}

export async function fetchStringInteractions(gene: string): Promise<StringInteraction[]> {
  const normGene = normalizeGeneSymbol(gene);
  const cacheKey = normGene;
  const cached = stringCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://string-db.org/api/json/network?identifiers=${encodeURIComponent(normGene)}&species=9606`;
  
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

  stringCache.set(cacheKey, [], { ttl: 5 * 60 * 1000 });
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

export async function submitDdmutJob(
  pdbText: string,
  chain: string,
  pos: number,
  wtRes: string,
  mutRes: string
): Promise<string | null> {
  const url = "https://biosig.lab.uq.edu.au/ddmut/api/prediction_single";
  const mutationCode = `${wtRes}${pos}${mutRes}`; // e.g. R408W
  console.log(`[DDMut API] Preparing to submit single mutation job for ${mutationCode} on chain ${chain}...`);

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
    console.log(`[DDMut API] Job submitted successfully. Job ID: ${jobId}`);
    return String(jobId);
  } catch (err: any) {
    console.error(`[DDMut API] Error during submission:`, err.message);
    return null;
  }
}

export async function pollDdmutJob(
  jobId: string
): Promise<{ status: "RUNNING" | "DONE" | "ERROR"; prediction: number | null } | null> {
  const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="job_id"\r\n\r\n${jobId}\r\n--${boundary}--\r\n`;

  console.log(`[DDMut API] Polling status for job ${jobId} using GET with multipart form-data...`);

  return new Promise((resolve) => {
    const options = {
      hostname: "biosig.lab.uq.edu.au",
      port: 443,
      path: "/ddmut/api/prediction_single",
      method: "GET",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": Buffer.byteLength(body)
      },
      rejectUnauthorized: false,
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            console.warn(`[DDMut API] Polling failed (status: ${res.statusCode})`);
            resolve({ status: "ERROR", prediction: null });
            return;
          }
          const pollJson = JSON.parse(data);
          if (pollJson.prediction !== undefined && pollJson.prediction !== null) {
            const ddG = parseFloat(pollJson.prediction);
            console.log(`[DDMut API] Prediction completed for job ${jobId}: ${ddG} kcal/mol`);
            resolve({ status: "DONE", prediction: isNaN(ddG) ? null : ddG });
            return;
          }
          if (
            pollJson.status === "RUNNING" ||
            pollJson.message === "RUNNING" ||
            pollJson.status === "QUEUED" ||
            pollJson.message === "QUEUED"
          ) {
            resolve({ status: "RUNNING", prediction: null });
            return;
          }
          console.warn(`[DDMut API] Polling returned error or unexpected format:`, pollJson);
          resolve({ status: "ERROR", prediction: null });
        } catch (e: any) {
          console.error(`[DDMut API] Parse error during polling:`, e.message);
          resolve({ status: "ERROR", prediction: null });
        }
      });
    });

    req.on("error", (err: any) => {
      console.error(`[DDMut API] Network error during polling:`, err.message);
      resolve({ status: "ERROR", prediction: null });
    });

    req.write(body);
    req.end();
  });
}


// =============================================================================
// FREQ-1: gnomAD Variant Allele Frequency (GraphQL)
// =============================================================================

export interface GnomadVariantFrequency {
  /** Max allele frequency across gnomAD v4 sub-populations */
  maxAF: number | null;
  /** Ancestry-specific max allele frequency for reliable groups (AN >= 2000) */
  groupMaxAF: number | null;
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
          populations {
            id
            ac
            an
          }
        }
        exome {
          ac
          an
          af
          homozygote_count
          populations {
            id
            ac
            an
          }
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
      (v.genome?.homozygote_count != null || v.exome?.homozygote_count != null)
        ? (v.genome?.homozygote_count ?? 0) + (v.exome?.homozygote_count ?? 0)
        : null;

    const maxAF =
      genomeAF !== null && exomeAF !== null ? Math.max(genomeAF, exomeAF) :
      genomeAF !== null ? genomeAF :
      exomeAF  !== null ? exomeAF  : null;

    // Compute ancestry-specific groupMaxAF (AN >= 2000)
    const populations: { id: string; ac: number; an: number; af: number }[] = [];
    if (v.genome?.populations) {
      for (const p of v.genome.populations) {
        populations.push({
          id: p.id,
          ac: p.ac,
          an: p.an,
          af: p.an > 0 ? p.ac / p.an : 0
        });
      }
    }
    if (v.exome?.populations) {
      for (const p of v.exome.populations) {
        populations.push({
          id: p.id,
          ac: p.ac,
          an: p.an,
          af: p.an > 0 ? p.ac / p.an : 0
        });
      }
    }

    const validPops = populations.filter(p => p.an >= 2000 && p.af !== null && p.af !== undefined);
    let groupMaxAF: number | null = null;
    if (validPops.length > 0) {
      let maxVal = 0;
      for (const p of validPops) {
        if (p.af > maxVal) {
          maxVal = p.af;
        }
      }
      groupMaxAF = maxVal;
    } else {
      // Fallback to global maxAF if no sub-population matches criteria
      groupMaxAF = maxAF;
    }

    const result: GnomadVariantFrequency = {
      maxAF,
      groupMaxAF,
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
  missense_z: number | null;
  oe_mis: number | null;
  pli: number | null;
  loeuf: number | null;
  isPP2Constrained: boolean;
  regions?: any[];
  regionalConstraint?: {
    isConstrained: boolean;
    oeRatio: number | null;
    pValue: number | null;
    regionText: string | null;
  } | null;
}

const gnomadConstraintCache = new LRUCache<string, GnomadGeneConstraint>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 7, // 7-day TTL (gene constraint is stable)
});

export async function fetchGnomadGeneConstraint(
  geneSymbol: string,
  aaPos?: number | null
): Promise<GnomadGeneConstraint | null> {
  const key = geneSymbol.toUpperCase();
  let cached = gnomadConstraintCache.get(key);

  if (cached === undefined) {
    const query = `
      query GeneConstraintAndRMC($gene: String!) {
        gene(gene_symbol: $gene, reference_genome: GRCh37) {
          gnomad_constraint {
            mis_z
            oe_mis
            pLI
            oe_lof_upper
          }
          gnomad_v2_regional_missense_constraint {
            passed_qc
            regions {
              chrom
              start
              stop
              aa_start
              aa_stop
              obs_mis
              exp_mis
              obs_exp
              p_value
            }
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

      if (resp.ok) {
        const json = await resp.json();
        const geneData = json?.data?.gene;
        const constraint = geneData?.gnomad_constraint;
        const rmc = geneData?.gnomad_v2_regional_missense_constraint;

        if (constraint) {
          const missense_z = constraint.mis_z != null ? parseFloat(constraint.mis_z.toFixed(2)) : null;
          const oe_mis = constraint.oe_mis != null ? parseFloat(constraint.oe_mis.toFixed(2)) : null;
          const pli = constraint.pLI != null ? parseFloat(constraint.pLI.toFixed(2)) : null;
          const loeuf = constraint.oe_lof_upper != null ? parseFloat(constraint.oe_lof_upper.toFixed(2)) : null;

          const isPP2Constrained =
            (missense_z !== null && missense_z >= 3.09) ||
            (oe_mis !== null && oe_mis < 0.8);

          cached = {
            missense_z,
            oe_mis,
            pli,
            loeuf,
            isPP2Constrained,
            regions: rmc?.regions || []
          };
          gnomadConstraintCache.set(key, cached);
        }
      }
    } catch (err: any) {
      console.error(`[gnomAD Constraint] Error fetching ${key}:`, err.message);
    }
  }

  if (!cached) return null;

  // Perform regional check for the specific aaPos on-the-fly from the cached object
  let regionalConstraint: GnomadGeneConstraint["regionalConstraint"] = null;
  if (aaPos && cached.regions && cached.regions.length > 0) {
    let matchedRegion = null;
    for (const r of cached.regions) {
      const startNum = parseInt(r.aa_start.replace(/\D/g, ""), 10);
      const stopNum = parseInt(r.aa_stop.replace(/\D/g, ""), 10);
      if (!isNaN(startNum) && !isNaN(stopNum)) {
        const minPos = Math.min(startNum, stopNum);
        const maxPos = Math.max(startNum, stopNum);
        if (aaPos >= minPos && aaPos <= maxPos) {
          matchedRegion = r;
          break;
        }
      }
    }
    if (matchedRegion) {
      regionalConstraint = {
        isConstrained: true,
        oeRatio: matchedRegion.obs_exp != null ? parseFloat(matchedRegion.obs_exp.toFixed(2)) : null,
        pValue: matchedRegion.p_value,
        regionText: `${matchedRegion.aa_start} to ${matchedRegion.aa_stop}`
      };
    } else {
      regionalConstraint = {
        isConstrained: false,
        oeRatio: null,
        pValue: null,
        regionText: null
      };
    }
  }

  return {
    ...cached,
    regionalConstraint
  };
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
  revelMean: number | null;
  revelMedian: number | null;
  revelMin: number | null;
  revelMax: number | null;
  revelCount: number;
  amMean: number | null;
  amMedian: number | null;
  amMin: number | null;
  amMax: number | null;
  amCount: number;
  gerp: number | null;
  phylop: number | null;
}

const landscapeCache = new LRUCache<string, LandscapePositionData[]>({
  max: 100,
  ttl: 1000 * 60 * 60 * 24, // 1-day TTL
});

function getMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[half];
  }
  return (sorted[half - 1] + sorted[half]) / 2.0;
}

export async function fetchLocalPopulationFrequencies(gene: string, pos: number, variant?: string | null): Promise<{
  gnomad: any | null;
  aou: any | null;
} | null> {
  if (!isLocalDbnsfpAvailable()) return null;
  const rec = await queryLocalDbnsfpVariant(gene, pos, null, null, variant);
  if (!rec) return null;

  return {
    gnomad: {
      maxAF: rec.gnomad_an ? (rec.gnomad_ac || 0) / rec.gnomad_an : null,
      groupMaxAF: rec.gnomad_an ? (rec.gnomad_ac || 0) / rec.gnomad_an : null,
      genomeAF: rec.gnomad_an ? (rec.gnomad_ac || 0) / rec.gnomad_an : null,
      exomeAF: rec.gnomad_an ? (rec.gnomad_ac || 0) / rec.gnomad_an : null,
      genomeAC: rec.gnomad_ac,
      exomeAC: 0,
      genomeAN: rec.gnomad_an,
      exomeAN: 0,
      nHomozygous: rec.gnomad_hom,
      dataset: "gnomad_r4_local"
    },
    aou: {
      aouAC: rec.aou_ac,
      aouAN: rec.aou_an,
      aouHet: rec.aou_het,
      aouHom: rec.aou_hom
    }
  };
}

export async function fetchLandscapeData(
  gene: string,
  startPos?: number,
  endPos?: number
): Promise<LandscapePositionData[]> {
  const normGene = normalizeGeneSymbol(gene);

  if (isLocalDbnsfpAvailable()) {
    const localLandscape = await queryLocalDbnsfpLandscape(normGene, startPos, endPos);
    if (localLandscape) {
      return localLandscape;
    }
  }
  
  // First, check if the full protein landscape is cached
  const fullCacheKey = `${normGene}_full`;
  const cachedFull = landscapeCache.get(fullCacheKey);
  if (cachedFull) {
    if (startPos !== undefined && endPos !== undefined) {
      return cachedFull.filter(item => item.residx >= startPos && item.residx <= endPos);
    }
    return cachedFull;
  }

  // If a specific window was requested and cached, return it
  if (startPos !== undefined && endPos !== undefined) {
    const windowCacheKey = `${normGene}_${startPos}_${endPos}`;
    const cachedWindow = landscapeCache.get(windowCacheKey);
    if (cachedWindow) return cachedWindow;
  }

  // Build the query: if startPos & endPos are passed, query that range. Otherwise query the entire gene.
  const queryStr = (startPos !== undefined && endPos !== undefined)
    ? `dbnsfp.genename:${normGene} AND dbnsfp.aa.pos:[${startPos} TO ${endPos}]`
    : `dbnsfp.genename:${normGene}`;

  // Increase the size to 5000 for full exonic query
  const sizeLimit = (startPos !== undefined && endPos !== undefined) ? 1000 : 5000;
  const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(queryStr)}&fields=dbnsfp.revel,dbnsfp.alphamissense,dbnsfp.gerp%2B%2B,dbnsfp.gerp,dbnsfp.phylop,dbnsfp.aa.pos&size=${sizeLimit}`;

  const result: LandscapePositionData[] = [];
  const landscapeMap = new Map<number, {
    revelScores: number[];
    amScores: number[];
    gerpScores: number[];
    phylopScores: number[];
  }>();

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
          
          posList.forEach((posVal: any) => {
            const pos = parseInt(posVal, 10);
            if (isNaN(pos)) return;

            // If we are filtering by start/end range, skip positions outside range
            if (startPos !== undefined && endPos !== undefined) {
              if (pos < startPos || pos > endPos) return;
            }

            if (!landscapeMap.has(pos)) {
              landscapeMap.set(pos, {
                revelScores: [],
                amScores: [],
                gerpScores: [],
                phylopScores: []
              });
            }

            const posData = landscapeMap.get(pos)!;

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
        });
      }
    }
  } catch (err: any) {
    console.warn(`[Landscape Fetch Error] Failed to fetch dbNSFP landscape: ${err.message}`);
  }

  /**
   * Aggregation Rationale (L-11 & N2-4):
   * For every residue position, up to 19 distinct amino acid substitutions exist across multiple canonical/non-canonical transcripts.
   * - REVEL & AlphaMissense: Use max (worst-case pathogenicity per position) for conservative clinical utility.
   * - GERP++ & PhyloP: Use mean (typical conservation level per position) to capture average local evolutionary selection pressure.
   * - Median: Represents robust central tendency less skewed by single extreme substitutions (e.g. Proline insertion).
   * - Min / Max: Establishes the exact score range bound for all possible variants at this position.
   * - Count: Tracks total transcript variants evaluated to signal data completeness.
   */
  for (const [pos, d] of landscapeMap.entries()) {
    const revelCount = d.revelScores.length;
    const amCount = d.amScores.length;

    const revelMean = revelCount > 0 ? d.revelScores.reduce((a, b) => a + b, 0) / revelCount : null;
    const revelMedian = getMedian(d.revelScores);
    const revelMin = revelCount > 0 ? Math.min(...d.revelScores) : null;
    const revelMax = revelCount > 0 ? Math.max(...d.revelScores) : null;

    const amMean = amCount > 0 ? d.amScores.reduce((a, b) => a + b, 0) / amCount : null;
    const amMedian = getMedian(d.amScores);
    const amMin = amCount > 0 ? Math.min(...d.amScores) : null;
    const amMax = amCount > 0 ? Math.max(...d.amScores) : null;

    const gerp = d.gerpScores.length > 0 ? d.gerpScores.reduce((a, b) => a + b, 0) / d.gerpScores.length : null;
    const phylop = d.phylopScores.length > 0 ? d.phylopScores.reduce((a, b) => a + b, 0) / d.phylopScores.length : null;

    result.push({
      residx: pos,
      revelMean,
      revelMedian,
      revelMin,
      revelMax,
      revelCount,
      amMean,
      amMedian,
      amMin,
      amMax,
      amCount,
      gerp,
      phylop
    });
  }

  // Sort by residue index position
  result.sort((a, b) => a.residx - b.residx);

  // If startPos & endPos were specified, fill in any missing positions in that range as empty entries
  if (startPos !== undefined && endPos !== undefined) {
    const resultMap = new Map(result.map(item => [item.residx, item]));
    const filledResult: LandscapePositionData[] = [];
    for (let pos = startPos; pos <= endPos; pos++) {
      const existing = resultMap.get(pos);
      if (existing) {
        filledResult.push(existing);
      } else {
        filledResult.push({
          residx: pos,
          revelMean: null,
          revelMedian: null,
          revelMin: null,
          revelMax: null,
          revelCount: 0,
          amMean: null,
          amMedian: null,
          amMin: null,
          amMax: null,
          amCount: 0,
          gerp: null,
          phylop: null
        });
      }
    }
    const windowCacheKey = `${normGene}_${startPos}_${endPos}`;
    landscapeCache.set(windowCacheKey, filledResult);
    return filledResult;
  }

  // Cache full protein
  landscapeCache.set(fullCacheKey, result);
  return result;
}


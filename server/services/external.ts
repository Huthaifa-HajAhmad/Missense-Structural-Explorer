import { LRUCache } from "lru-cache";
import { CLINVAR_AA_MAP, CLINVAR_REV_AA_MAP, AMINO_ACID_1_TO_3_TITLE } from "../../src/aminoAcids.ts";
import { validateUniProt } from "../utils.ts";
import { z } from "zod";

async function fetchWithRetry(url: string, options: RequestInit & { timeout?: number } = {}, retries = 3, delay = 1000): Promise<Response> {
  const timeoutMs = options.timeout ?? 15000;
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      
      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(id);
      
      if (res.status === 429) {
        console.warn(`[Upstream Fetch 429] Rate limited on ${url}. Retrying after ${delay * 2 ** i}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay * 2 ** i));
        continue;
      }
      return res;
    } catch (err: any) {
      if (i === retries - 1) throw err;
      console.warn(`[Upstream Fetch Error] Failed to fetch ${url} (attempt ${i + 1}/${retries}): ${err.message}. Retrying in ${delay * 2 ** i}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay * 2 ** i));
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} attempts.`);
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

export async function fetchClinVarData(gene: string, variant: string): Promise<ClinVarData> {
  const defaultRes: ClinVarData = {
    classification: "Not found in ClinVar",
    lastEvaluated: "",
    reviewStatus: "",
    alleleFrequencies: [],
    trait: "",
    uid: null
  };
  
  const term = `${gene} ${variant}`;
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=${encodeURIComponent(term)}&retmode=json`;
  
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
    return defaultRes;
  }
  
  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${idList.join(",")}&retmode=json`;
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
  const cleanVariant = variant.replace(/^p\./i, "").toLowerCase();
  
  for (const id of idList) {
    const entry = resultObj[id];
    if (!entry) continue;
    
    const title = (entry.title || "").toLowerCase();
    let isMatch = title.includes(cleanVariant);
    if (!isMatch) {
      const match3 = cleanVariant.match(/^([a-z]{3})(\d+)([a-z]{3})$/);
      const match1 = cleanVariant.match(/^([a-z])(\d+)([a-z])$/);
      
      if (match3) {
        const wt1 = CLINVAR_AA_MAP[match3[1]];
        const pos = match3[2];
        const mut1 = CLINVAR_AA_MAP[match3[3]];
        if (wt1 && mut1) {
          const shortVariant = `${wt1}${pos}${mut1}`;
          isMatch = title.includes(shortVariant);
        }
      } else if (match1) {
        const wt3 = CLINVAR_REV_AA_MAP[match1[1]];
        const pos = match1[2];
        const mut3 = CLINVAR_REV_AA_MAP[match1[3]];
        if (wt3 && mut3) {
          const longVariant = `${wt3}${pos}${mut3}`;
          isMatch = title.includes(longVariant);
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
      
      return {
        classification,
        lastEvaluated,
        reviewStatus,
        alleleFrequencies,
        trait: traits,
        uid: id
      };
    }
  }
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
  
  // 2. Build candidate URLs to try in order
  const candidates: string[] = [];
  if (pdbUrlFromApi) {
    candidates.push(pdbUrlFromApi);
  }
  
  // Generate combinations of common isoform suffixes and file versions
  const suffixes = ["-F1", "-4-F1", "-3-F1", "-2-F1", "-1-F1"];
  const versions = ["v6", "v4", "v3", "v2", "v1"];
  for (const suffix of suffixes) {
    for (const v of versions) {
      const candidateUrl = `https://alphafold.ebi.ac.uk/files/AF-${validatedUniprot}${suffix}-model_${v}.pdb`;
      if (!candidates.includes(candidateUrl)) {
        candidates.push(candidateUrl);
      }
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

export async function fetchPdbFromRcsb(pdbId: string, chainId: string): Promise<string | null> {
  const cacheKey = `pdb_rcsb_${pdbId.toLowerCase()}_chain_${chainId.toUpperCase()}`;
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
    const chainPdb = extractChainFromPdb(fullText, chainId);
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
  const cleanVar = normalizeVariantTo3Letter(variant);
  const url = `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(gene)}:p.${encodeURIComponent(cleanVar)}?content-type=application/json&AlphaMissense=1&CADD=1`;
  
  try {
    const res = await fetchWithRetry(url, {
      headers: { "Accept": "application/json" },
      timeout: 15000
    });
    if (res.ok) {
      const data = await res.json() as any;
      if (Array.isArray(data) && data.length > 0 && data[0].transcript_consequences) {
        const consequences = data[0].transcript_consequences;
        const tc = consequences.find((c: any) => c.alphamissense || c.cadd_phred !== undefined) || consequences[0];
        if (tc) {
          const amPathogenicity = tc.alphamissense ? parseFloat(tc.alphamissense.am_pathogenicity) : null;
          const amClass = tc.alphamissense ? tc.alphamissense.am_class : null;
          const caddPhred = tc.cadd_phred !== undefined ? parseFloat(tc.cadd_phred) : null;
          return { available: true, amPathogenicity, amClass, caddPhred };
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Predictors Fetch Error] Failed to fetch VEP predictors: ${err.message}`);
  }

  return {
    available: false,
    amPathogenicity: null,
    amClass: null,
    caddPhred: null
  };
}

export async function fetchConservationData(gene: string, variant: string): Promise<ConservationData> {
  const cleanVar = normalizeVariantTo3Letter(variant);
  const url = `https://myvariant.info/v1/query?q=dbnsfp.hgvsp:"${encodeURIComponent(gene)}:p.${encodeURIComponent(cleanVar)}"&fields=dbnsfp.revel,dbnsfp.gerp,dbnsfp.phylop`;
  
  try {
    const res = await fetchWithRetry(url, {
      headers: { "Accept": "application/json" },
      timeout: 15000
    });
    if (res.ok) {
      const data = await res.json() as any;
      if (data.hits && data.hits.length > 0) {
        const hit = data.hits[0];
        const dbnsfp = hit.dbnsfp;
        if (dbnsfp) {
          let revel = dbnsfp.revel;
          if (Array.isArray(revel)) revel = revel[0];
          revel = revel !== undefined ? parseFloat(revel) : null;

          let gerp = dbnsfp.gerp?.elements || dbnsfp.gerp?.["gerp++_rs"] || null;
          if (Array.isArray(gerp)) gerp = gerp[0];
          gerp = gerp !== undefined ? parseFloat(gerp) : null;

          let phylop = dbnsfp.phylop?.vertebrate || dbnsfp.phylop?.["phylop100way_vertebrate"] || null;
          if (Array.isArray(phylop)) phylop = phylop[0];
          phylop = phylop !== undefined ? parseFloat(phylop) : null;

          let consurfEstimated: number | null = null;
          let derived = false;
          if (gerp !== null && phylop !== null) {
            const normalizedGerp = Math.min(1, Math.max(0, (gerp + 5) / 11)); 
            const normalizedPhyloP = Math.min(1, Math.max(0, (phylop + 1) / 5)); 
            consurfEstimated = (normalizedGerp + normalizedPhyloP) / 2;
            derived = true;
          }
          return { 
            available: true, 
            revel, 
            gerp, 
            phylop, 
            consurf: null, 
            consurfEstimated, 
            derived 
          };
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Conservation Fetch Error] Failed to fetch MyVariant conservation: ${err.message}`);
  }

  return {
    available: false,
    revel: null,
    gerp: null,
    phylop: null,
    consurf: null,
    consurfEstimated: null,
    derived: false
  };
}

export async function fetchStringInteractions(gene: string): Promise<StringInteraction[]> {
  const url = `https://string-db.org/api/json/network?identifiers=${encodeURIComponent(gene)}&species=9606`;
  
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
        return parsed.slice(0, 5);
      }
    }
  } catch (err: any) {
    console.warn(`[STRING Network Fetch Error] Failed to fetch STRING network: ${err.message}`);
  }

  return [];
}

export async function fetchDynaMut2Prediction(
  pdbText: string,
  chain: string,
  pos: number,
  wtRes: string,
  mutRes: string
): Promise<number | null> {
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

    // Poll for results (max ~20 s: 8 attempts × 2 s interval)
    const maxAttempts = 8;
    const pollIntervalMs = 2000;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      console.log(`[DynaMut2 API] Polling status (attempt ${attempt}/${maxAttempts})...`);

      const pollUrl = `${url}?job_id=${jobId}`;
      const pollRes = await fetchWithRetry(pollUrl, {
        method: "GET",
        timeout: 10000
      });

      if (!pollRes.ok) {
        console.warn(`[DynaMut2 API] Polling request failed on attempt ${attempt}`);
        continue;
      }

      const pollJson = await pollRes.json() as any;
      // API returns { status: "RUNNING" } — also guard legacy { message: "RUNNING" } format
      if (pollJson.status === "RUNNING" || pollJson.message === "RUNNING") {
        continue;
      }

      if (pollJson.prediction !== undefined) {
        const ddG = parseFloat(pollJson.prediction);
        console.log(`[DynaMut2 API] Prediction completed: ${ddG} kcal/mol`);
        return isNaN(ddG) ? null : ddG;
      }

      console.warn(`[DynaMut2 API] Unexpected response format:`, pollJson);
      break;
    }
    console.warn(`[DynaMut2 API] Job ${jobId} timed out or failed to complete prediction.`);
  } catch (err: any) {
    console.error(`[DynaMut2 API] Error during prediction:`, err.message);
  }
  return null;
}

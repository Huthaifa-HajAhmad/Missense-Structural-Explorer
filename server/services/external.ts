import { LRUCache } from "lru-cache";
import { CLINVAR_AA_MAP, CLINVAR_REV_AA_MAP } from "../../src/aminoAcids.ts";
import { validateUniProt } from "../utils.ts";

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

export async function fetchClinVarData(gene: string, variant: string): Promise<ClinVarData> {
  const defaultRes: ClinVarData = {
    classification: "Not found in ClinVar",
    lastEvaluated: "",
    reviewStatus: "",
    alleleFrequencies: [],
    trait: "",
    uid: null
  };
  
  try {
    const term = `${gene} ${variant}`;
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=${encodeURIComponent(term)}&retmode=json`;
    
    const searchRes = await fetch(searchUrl, {
      headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
      signal: AbortSignal.timeout(15000)
    });
    if (!searchRes.ok) {
      return defaultRes;
    }
    
    const searchData = await searchRes.json() as any;
    const idList = searchData.esearchresult?.idlist || [];
    if (idList.length === 0) {
      return defaultRes;
    }
    
    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${idList.join(",")}&retmode=json`;
    const summaryRes = await fetch(summaryUrl, {
      headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
      signal: AbortSignal.timeout(15000)
    });
    if (!summaryRes.ok) {
      return defaultRes;
    }
    
    const summaryData = await summaryRes.json() as any;
    const cleanVariant = variant.replace(/^p\./i, "").toLowerCase();
    
    for (const id of idList) {
      const entry = summaryData.result[id];
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
        const traits = (entry.germline_classification?.trait_set || []).map((t: any) => t.trait_name).join(", ");
        
        const alleleFrequencies = (entry.allele_freq_set || []).map((freq: any) => ({
          source: freq.source,
          value: freq.value
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
  } catch (err) {
    console.error("[ClinVar] Error searching ClinVar:", err);
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
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
      signal: AbortSignal.timeout(15000)
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
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
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
    const apiResponse = await fetch(afApiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(15000)
    });
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
      const pRes = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "*/*"
        },
        signal: AbortSignal.timeout(15000)
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

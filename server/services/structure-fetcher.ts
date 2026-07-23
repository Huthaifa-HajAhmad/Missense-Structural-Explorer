import { validateUniProt } from "../utils.ts";
import { fetchWithRetry } from "./http-client.ts";
import { pdbCache, afUrlCache } from "./cache.ts";
import { fetchUniprotSequence } from "./uniprot.ts";
import type { PdbHomolog } from "../../src/types.ts";

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

export async function fetchPdbHomologs(uniprotId: string): Promise<PdbHomolog[]> {
  const validatedUniprot = validateUniProt(uniprotId);
  const cacheKey = `homologs_${validatedUniprot}`;
  if (pdbCache.has(cacheKey)) {
    const cachedData = pdbCache.get(cacheKey);
    if (cachedData) {
      try {
        return JSON.parse(cachedData);
      } catch (_) {}
    }
  }

  const sequence = await fetchUniprotSequence(validatedUniprot);
  if (!sequence || sequence.length < 25) {
    return [];
  }

  try {
    const searchRes = await fetchWithRetry("https://search.rcsb.org/rcsbsearch/v2/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: {
          type: "terminal",
          service: "sequence",
          parameters: {
            evalue_cutoff: 0.1,
            identity_cutoff: 0.3,
            sequence_type: "protein",
            value: sequence
          }

        },
        return_type: "entry"
      }),

      timeout: 15000
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text().catch(() => "");
      console.warn(`[RCSB Homolog Search] Query returned status ${searchRes.status}: ${errText}`);
      return [];
    }


    const searchData = await searchRes.json() as any;
    const hits = searchData.result_set?.slice(0, 10) || [];
    if (hits.length === 0) return [];

    const pdbIds = hits.map((hit: any) => hit.identifier);
    
    const graphqlQuery = `
      query getHomologMetadata($ids: [String!]!) {
        entries(entry_ids: $ids) {
          rcsb_id
          struct { title }
          rcsb_entry_info {
            experimental_method
            resolution_combined
            structure_determination_methodology
          }
          polymer_entities {
            rcsb_entity_source_organism {
              ncbi_scientific_name
            }
          }
        }
      }
    `;

    let metadataMap: Record<string, any> = {};
    try {
      const gqlRes = await fetchWithRetry("https://data.rcsb.org/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: { ids: pdbIds }
        }),
        timeout: 15000
      });
      if (gqlRes.ok) {
        const gqlData = await gqlRes.json() as any;
        const entries = gqlData.data?.entries || [];
        for (const entry of entries) {
          if (entry.rcsb_id) {
            metadataMap[entry.rcsb_id.toUpperCase()] = entry;
          }
        }
      }
    } catch (gqlErr: any) {
      console.warn("[RCSB GraphQL] Failed to fetch batched metadata:", gqlErr.message);
    }

    const seqLen = sequence.length;
    const homologs: PdbHomolog[] = hits
      .filter((hit: any) => {
        const pdbId = hit.identifier.toUpperCase();
        const entryMeta = metadataMap[pdbId] || {};
        const isComp = entryMeta.rcsb_entry_info?.structure_determination_methodology === "computational";
        if (isComp) return false;

        const organism = entryMeta.polymer_entities?.[0]?.rcsb_entity_source_organism?.[0]?.ncbi_scientific_name || "";
        const isHuman = organism.toLowerCase().includes("homo sapiens") || organism.toLowerCase().includes("human");
        return !isHuman;
      })
      .map((hit: any) => {
        const pdbId = hit.identifier.toUpperCase();
        const entryMeta = metadataMap[pdbId] || {};
        const title = entryMeta.struct?.title || "Experimental structure homolog";
        const method = entryMeta.rcsb_entry_info?.experimental_method || "Experimental";
        const resolution = entryMeta.rcsb_entry_info?.resolution_combined?.[0] || null;
        const organism = entryMeta.polymer_entities?.[0]?.rcsb_entity_source_organism?.[0]?.ncbi_scientific_name || "Unknown";

        let rawIdentity: number | null = null;
        let alignedLen = Math.round(seqLen * 0.8);
        if (hit.services?.[0]?.nodes?.[0]?.match_context?.[0]) {
          const mc = hit.services[0].nodes[0].match_context[0];
          if (typeof mc.sequence_identity === "number") rawIdentity = mc.sequence_identity;
          if (typeof mc.alignment_length === "number") alignedLen = mc.alignment_length;
        } else if (typeof hit.score === "number" && hit.score <= 1.0 && hit.score > 0) {
          rawIdentity = hit.score;
        }

        if (rawIdentity === null) {
          return null;
        }

        const identityPercent = Math.min(100, Math.round(rawIdentity > 1 ? rawIdentity : rawIdentity * 100));
        const coveragePercent = Math.min(100, Math.round((alignedLen / seqLen) * 100));

        return {
          pdbId,
          score: hit.score || 0,
          identity: identityPercent,
          coverage: coveragePercent,
          title,
          organism,
          method,
          resolution,
        };
      })
      .filter((h: PdbHomolog | null): h is PdbHomolog => h !== null)
      .slice(0, 5);

    homologs.sort((a, b) => b.identity - a.identity);

    pdbCache.set(cacheKey, JSON.stringify(homologs));
    return homologs;

  } catch (err: any) {
    console.error("[RCSB Homolog Search] Failed to fetch homologs:", err.message || err);
    return [];
  }
}


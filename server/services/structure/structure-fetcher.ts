import { validateUniProt } from "../../utils.ts";
import { fetchWithRetry } from "../infra/http-client.ts";
import { pdbCache, afUrlCache, bestPdbCache, singleFlight } from "../infra/cache.ts";
import { fetchUniprotSequence } from "../external-api/uniprot.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";
import type { PdbHomolog } from "../../../src/shared/contracts.ts";

export interface PdbBestStructureMapping {
  pdbId: string;
  chainId: string;
  shift: number;
  unpStart: number;
  structStart: number;
}

function singleFlightPdb(key: string, fetcher: () => Promise<string | null>): Promise<string | null> {
  const cached = pdbCache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  return singleFlight(key, async () => {
    const pdbText = await fetcher();
    if (pdbText && pdbText.includes("ATOM")) {
      pdbCache.set(key, pdbText);
    }
    return pdbText;
  });
}

export async function fetchAlphafoldPdb(uniprotId: string): Promise<string | null> {
  const validatedUniprot = validateUniProt(uniprotId);
  const cacheKey = `af_pdb_${validatedUniprot}`;

  return singleFlightPdb(cacheKey, async () => {
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
  });
}

export function extractAfdbVersion(urlOrId: string): string | undefined {
  if (!urlOrId || typeof urlOrId !== "string") return undefined;
  const match = urlOrId.match(/model_(v\d+)\./i);
  return match ? match[1].toLowerCase() : undefined;
}

export function getResolvedAlphafoldVersion(uniprotId: string): string | undefined {
  try {
    const validatedUniprot = validateUniProt(uniprotId);
    const cachedUrl = afUrlCache.get(validatedUniprot);
    if (cachedUrl) {
      return extractAfdbVersion(cachedUrl);
    }
  } catch (_) {}
  return undefined;
}

export async function fetchBestPdbStructure(
  uniprotId: string,
  pos?: number
): Promise<PdbBestStructureMapping | null> {
  const validatedUniprot = validateUniProt(uniprotId);
  const cacheKey = `${validatedUniprot}:${pos ?? "any"}`;
  const cached = bestPdbCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `https://www.ebi.ac.uk/pdbe/graph-api/mappings/best_structures/${validatedUniprot}`;
  try {
    console.log(`[PDB Prioritizer] Querying best structures for UniProt accession ${validatedUniprot}...`);
    const response = await fetchWithRetry(url, {
      headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
      timeout: 15000
    });
    if (!response.ok) {
      console.warn(`[PDB Prioritizer] Failed to query PDBe best structures (status: ${response.status})`);
      bestPdbCache.set(cacheKey, null, { ttl: 5 * 60 * 1000 });
      return null;
    }
    const data = await response.json() as any;
    const structures = data[validatedUniprot] || data[uniprotId];
    if (!Array.isArray(structures)) {
      bestPdbCache.set(cacheKey, null, { ttl: 60 * 60 * 1000 });
      return null;
    }
    for (const item of structures) {
      if (!item.pdb_id || !item.chain_id) continue;
      
      // Allow shifts, but verify the position coverage
      const hasCoverage = pos !== undefined ? (pos >= item.unp_start && pos <= item.unp_end) : true;
      if (!hasCoverage) continue;
      
      const shift = item.unp_start - item.start;
      console.log(`[PDB Prioritizer] Found suitable experimental structure: ${item.pdb_id} chain ${item.chain_id} (Resolution: ${item.resolution}Å, Coverage: ${item.coverage}, Shift: ${shift})`);
      const mapping: PdbBestStructureMapping = { 
        pdbId: item.pdb_id.toLowerCase(), 
        chainId: item.chain_id, 
        shift,
        unpStart: item.unp_start,
        structStart: item.start
      };
      bestPdbCache.set(cacheKey, mapping);
      return mapping;
    }
    bestPdbCache.set(cacheKey, null, { ttl: 60 * 60 * 1000 });
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

export async function fetchFullPdbEntry(pdbId: string): Promise<string | null> {
  const upper = pdbId.trim().toUpperCase();
  const cacheKey = `pdb_full_${upper.toLowerCase()}`;

  return singleFlightPdb(cacheKey, async () => {
    const url = `https://files.rcsb.org/download/${upper}.pdb`;
    try {
      console.log(`[RCSB PDB Full Entry] Fetching complete structure ${upper} from RCSB...`);
      const res = await fetchWithRetry(url, { timeout: 20000 });
      if (!res.ok) {
        console.warn(`[RCSB PDB Full Entry] Failed to download ${upper} from RCSB (status: ${res.status})`);
        return null;
      }
      const fullText = await res.text();
      if (!fullText || !fullText.includes("ATOM")) {
        return null;
      }
      return fullText;
    } catch (err: any) {
      console.warn(`[RCSB PDB Full Entry] Error fetching ${upper}:`, err.message);
      return null;
    }
  });
}

export async function fetchPdbFromRcsb(
  pdbId: string,
  chainId?: string,
  unpStart?: number,
  structStart?: number,
  validationContext?: {
    uniprotId?: string;
    sequence?: string;
    pos?: number;
    expectedWt1?: string;
  }
): Promise<string | null> {
  const chainUpper = (chainId || "A").toUpperCase();
  const cacheKey = `pdb_rcsb_${pdbId.toLowerCase()}_chain_${chainUpper}_unp_${unpStart || 0}_struct_${structStart || 0}_pos_${validationContext?.pos || 0}`;

  return singleFlightPdb(cacheKey, async () => {
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

      // 3-Tier Deterministic Alignment & Validation (No Heuristics)
      if (
        validationContext?.uniprotId &&
        validationContext?.sequence &&
        validationContext?.pos !== undefined &&
        validationContext?.expectedWt1
      ) {
        const { resolvePdbCoordinatesDeterministically } = await import("./sequence-aligner.ts");
        const resolution = await resolvePdbCoordinatesDeterministically({
          pdbId,
          chainId: chainUpper,
          rawPdbText: fullText,
          uniprotAccession: validationContext.uniprotId,
          uniprotSequence: validationContext.sequence,
          targetPos: validationContext.pos,
          expectedWt1: validationContext.expectedWt1
        });

        if (resolution.valid && resolution.pdbText) {
          console.log(`[RCSB PDB Alignment] Successfully verified deterministic alignment via ${resolution.source} for ${pdbId} chain ${chainUpper} at pos ${validationContext.pos}`);
          return resolution.pdbText;
        } else {
          console.warn(`[RCSB PDB Alignment Warning] Deterministic validation rejected PDB ${pdbId}: ${resolution.reason || 'Residue mismatch'}. Falling back to 1:1 AlphaFold canonical structure.`);
          return null;
        }
      }

      // Fallback if no sequence validation context provided
      const shift = (unpStart !== undefined && structStart !== undefined) ? (unpStart - structStart) : 0;
      const chainPdb = extractChainFromPdb(fullText, chainUpper, shift);
      return chainPdb;
    } catch (err: any) {
      console.error(`[RCSB PDB] Error downloading structure ${pdbId}:`, err.message || err);
      return null;
    }
  });
}

interface RawHomologCandidate {
  pdbId: string;
  score: number;
  identity: number;
  coverage: number;
  title: string;
  organism: string;
  isHuman: boolean;
  method: string;
  resolution: number | null;
  querySeqFrom?: number;
  querySeqTo?: number;
}

async function fetchRawHomologCandidates(validatedUniprot: string): Promise<RawHomologCandidate[]> {
  const cacheKey = `raw_homologs_${validatedUniprot}`;
  const cached = pdbCache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (_) {}
  }

  // Check persistent SQLite cache
  try {
    const db = AnalysisDatabase.getInstance();
    const sqliteEntry = await db.getExternalCacheAsync<RawHomologCandidate[]>(cacheKey);
    if (sqliteEntry && Array.isArray(sqliteEntry.data)) {
      pdbCache.set(cacheKey, JSON.stringify(sqliteEntry.data));
      return sqliteEntry.data;
    }
  } catch (_) {}

  return singleFlight(cacheKey, async () => {
    const cachedAgain = pdbCache.get(cacheKey);
    if (cachedAgain) {
      try {
        return JSON.parse(cachedAgain);
      } catch (_) {}
    }

    const sequence = await fetchUniprotSequence(validatedUniprot);
    if (!sequence || sequence.length < 25) {
      return [];
    }

    // Bound total RCSB candidate discovery to at most 18 seconds
    const timeoutSignal = AbortSignal.timeout(18000);

    try {
      const searchRes = await fetchWithRetry(
        "https://search.rcsb.org/rcsbsearch/v2/query",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: {
              type: "terminal",
              service: "sequence",
              parameters: {
                evalue_cutoff: 1.0,
                identity_cutoff: 0.22,
                sequence_type: "protein",
                value: sequence
              }
            },
            request_options: {
              results_content_type: ["experimental"],
              paginate: {
                start: 0,
                rows: 50
              }
            },
            return_type: "polymer_entity"
          }),
          timeout: 10000,
          signal: timeoutSignal
        },
        1 // 1 attempt total (0 retries) to strictly enforce the 18s timeout guard
      );

      if (!searchRes.ok) {
        const errText = await searchRes.text().catch(() => "");
        console.warn(`[RCSB Homolog Search] Query returned status ${searchRes.status}: ${errText}`);
        return [];
      }

      const searchData = await searchRes.json() as any;
      const hits = searchData?.result_set;
      if (!Array.isArray(hits) || hits.length === 0) {
        return [];
      }

      const topHits = hits.slice(0, 30);
      const hitInfoMap = new Map<string, { score: number; entityId: string; rawHit: any }>();
      const entryIdsToFetch = new Set<string>();

      for (const h of topHits) {
        const rawId = h.identifier as string;
        if (!rawId) continue;
        const [pdbId, entityId] = rawId.split("_");
        if (!pdbId) continue;
        const upperPdb = pdbId.toUpperCase();
        if (!hitInfoMap.has(upperPdb)) {
          hitInfoMap.set(upperPdb, { score: h.score ?? 0, entityId: entityId || "1", rawHit: h });
          entryIdsToFetch.add(upperPdb);
        }
      }

      const idsArray = Array.from(entryIdsToFetch);
      if (idsArray.length === 0) {
        return [];
      }

      const gqlQuery = `
        query getEntries($ids: [String!]!) {
          entries(entry_ids: $ids) {
            rcsb_id
            struct {
              title
            }
            rcsb_entry_info {
              experimental_method
              resolution_combined
            }
            polymer_entities {
              rcsb_entity_source_organism {
                ncbi_scientific_name
              }
            }
          }
        }
      `;

      const gqlRes = await fetchWithRetry(
        "https://data.rcsb.org/graphql",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: gqlQuery, variables: { ids: idsArray } }),
          timeout: 8000,
          signal: timeoutSignal
        },
        1 // 1 attempt total (0 retries) to strictly enforce the 18s timeout guard
      );

      if (!gqlRes.ok) {
        console.warn(`[RCSB Homolog Search] GraphQL metadata fetch failed: status ${gqlRes.status}`);
        return [];
      }

      const gqlData = await gqlRes.json() as any;
      const entries = gqlData?.data?.entries;
      if (!Array.isArray(entries)) {
        return [];
      }

      const entryMap = new Map<string, any>();
      for (const e of entries) {
        if (e && e.rcsb_id) {
          entryMap.set(e.rcsb_id.toUpperCase(), e);
        }
      }

      const seqLen = sequence.length;
      const candidates: RawHomologCandidate[] = [];

      for (const [pdbId, info] of hitInfoMap.entries()) {
        const entryMeta = entryMap.get(pdbId);
        if (!entryMeta) continue;

        const title = entryMeta.struct?.title || "Experimental structure homolog";
        const method = entryMeta.rcsb_entry_info?.experimental_method || "Experimental";
        const resolution = entryMeta.rcsb_entry_info?.resolution_combined?.[0] || null;
        const organism = entryMeta.polymer_entities?.[0]?.rcsb_entity_source_organism?.[0]?.ncbi_scientific_name || "Unknown";

        let rawIdentity: number = info.score;
        let alignedLen = Math.round(seqLen * 0.8);
        const mc = info.rawHit.services?.[0]?.nodes?.[0]?.match_context?.[0];
        if (mc) {
          if (typeof mc.sequence_identity === "number") rawIdentity = mc.sequence_identity;
          if (typeof mc.alignment_length === "number") alignedLen = mc.alignment_length;
        }

        const identityPercent = Math.min(100, Math.round(rawIdentity > 1 ? rawIdentity : rawIdentity * 100));
        const coveragePercent = Math.min(100, Math.round((alignedLen / seqLen) * 100));

        const qFrom = typeof mc?.query_sequence_from === "number" ? mc.query_sequence_from : undefined;
        const qTo = typeof mc?.query_sequence_to === "number" ? mc.query_sequence_to : undefined;

        candidates.push({
          pdbId,
          score: info.score,
          identity: identityPercent,
          coverage: coveragePercent,
          title,
          organism,
          isHuman: organism.toLowerCase().includes("homo sapiens") || organism.toLowerCase().includes("human"),
          method,
          resolution,
          querySeqFrom: qFrom,
          querySeqTo: qTo,
        });
      }

      pdbCache.set(cacheKey, JSON.stringify(candidates));
      try {
        const db = AnalysisDatabase.getInstance();
        await db.saveExternalCacheAsync(cacheKey, candidates, "RCSB Homologs", 7 * 24 * 60 * 60);
      } catch (_) {}
      return candidates;
    } catch (err: any) {
      console.warn("[RCSB Homolog Search] Notice: Failed or timed out fetching raw candidates:", err.message || err);
      return [];
    }
  });
}

export async function fetchPdbHomologs(uniprotId: string, pos?: number): Promise<PdbHomolog[]> {
  const validatedUniprot = validateUniProt(uniprotId);
  const posCacheKey = `homologs_${validatedUniprot}_pos_${pos ?? "none"}`;
  const cachedData = pdbCache.get(posCacheKey);
  if (cachedData) {
    try {
      return JSON.parse(cachedData);
    } catch (_) {}
  }

  // Check persistent SQLite cache
  try {
    const db = AnalysisDatabase.getInstance();
    const sqliteEntry = await db.getExternalCacheAsync<PdbHomolog[]>(posCacheKey);
    if (sqliteEntry && Array.isArray(sqliteEntry.data)) {
      pdbCache.set(posCacheKey, JSON.stringify(sqliteEntry.data));
      return sqliteEntry.data;
    }
  } catch (_) {}

  const rawCandidates = await fetchRawHomologCandidates(validatedUniprot);
  if (!rawCandidates || rawCandidates.length === 0) {
    return [];
  }

  try {
    const candidates = rawCandidates.map(c => {
      const coversPos = (pos !== undefined && c.querySeqFrom !== undefined && c.querySeqTo !== undefined)
        ? (pos >= c.querySeqFrom && pos <= c.querySeqTo)
        : true;
      return {
        ...c,
        coversPosition: coversPos
      };
    });

    // Sort priority: 1. Covers variant position, 2. Identity descending, 3. Better resolution
    candidates.sort((a, b) => {
      if (a.coversPosition && !b.coversPosition) return -1;
      if (!a.coversPosition && b.coversPosition) return 1;
      if (b.identity !== a.identity) return b.identity - a.identity;
      const resA = a.resolution ?? 999;
      const resB = b.resolution ?? 999;
      return resA - resB;
    });

    const getTitleRoot = (t: string) => {
      return t.toLowerCase()
        .replace(/crystal|structure|of|the|in|complex|with|refinement|at|resolution|domain|allele-[a-z0-9]+/g, "")
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 16);
    };

    const seenOrganisms = new Map<string, number[]>();
    const seenTitleRoots = new Set<string>();
    const seenSelfOrganisms = new Set<string>();
    const homologs: PdbHomolog[] = [];

    for (const h of candidates) {
      const orgNorm = h.organism.toLowerCase().trim();
      const titleRoot = getTitleRoot(h.title);

      if (h.identity >= 95) {
        if (seenSelfOrganisms.has(orgNorm)) {
          continue;
        }
        seenSelfOrganisms.add(orgNorm);
      }

      if (!seenOrganisms.has(orgNorm)) {
        seenOrganisms.set(orgNorm, []);
      }
      const existingIdentities = seenOrganisms.get(orgNorm)!;

      const isRedundantIdentity = existingIdentities.some(id => Math.abs(id - h.identity) < 5);
      if (isRedundantIdentity) {
        continue;
      }

      const titleClusterKey = `${titleRoot}_${orgNorm}`;
      if (seenTitleRoots.has(titleClusterKey) && existingIdentities.length >= 2) {
        continue;
      }

      existingIdentities.push(h.identity);
      seenTitleRoots.add(titleClusterKey);
      homologs.push(h);

      if (homologs.length >= 8) break;
    }

    pdbCache.set(posCacheKey, JSON.stringify(homologs));
    try {
      const db = AnalysisDatabase.getInstance();
      await db.saveExternalCacheAsync(posCacheKey, homologs, "RCSB Homologs Filtered", 7 * 24 * 60 * 60);
    } catch (_) {}
    return homologs;

  } catch (err: any) {
    console.warn("[RCSB Homolog Search] Notice: Failed to cluster homologs:", err.message || err);
    return [];
  }
}

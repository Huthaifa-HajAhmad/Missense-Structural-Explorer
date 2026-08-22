import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { normalizeGeneSymbol, fetchWithRetry } from "./http-client.ts";
import { isLocalDbnsfpAvailable, queryLocalDbnsfpVariant, queryLocalDbnsfpLandscape } from "./dbnsfp_local.ts";
import { landscapeCache } from "./cache.ts";
import { resolveGeneToUniprot, fetchUniprotSequence } from "./uniprot.ts";

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

let sqliteDb: DatabaseSync | null = null;
const sqliteDbPath = path.join(process.cwd(), "data", "landscape_cache.sqlite");

function getSqliteDb(): DatabaseSync | null {
  if (process.env.NODE_ENV === "test") return null;
  if (sqliteDb) return sqliteDb;
  try {
    const dir = path.dirname(sqliteDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    sqliteDb = new DatabaseSync(sqliteDbPath);
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS landscape_data (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    return sqliteDb;
  } catch (err: any) {
    console.error("[Landscape Cache] Failed to initialize SQLite database:", err.message);
    return null;
  }
}

function querySqliteCache(key: string): LandscapePositionData[] | null {
  const db = getSqliteDb();
  if (!db) return null;
  try {
    const now = Date.now();
    db.prepare("DELETE FROM landscape_data WHERE expires_at < ?").run(now);
    const row = db.prepare("SELECT data FROM landscape_data WHERE key = ? AND expires_at >= ?").get(key, now) as any;
    if (row && row.data) {
      const parsed = JSON.parse(row.data) as LandscapePositionData[];
      if (parsed.length > 0) {
        console.log(`[Landscape SQLite Cache Hit] Found cached data for key ${key}`);
        return parsed;
      }
    }
  } catch (err: any) {
    console.error("[Landscape Cache Error] Failed to read from SQLite cache:", err.message);
  }
  return null;
}

function writeSqliteCache(key: string, data: LandscapePositionData[]): void {
  const db = getSqliteDb();
  if (!db || data.length === 0) return;
  try {
    const ttl = 30 * 24 * 60 * 60 * 1000; // 30 days
    const expiresAt = Date.now() + ttl;
    db.prepare(`
      INSERT OR REPLACE INTO landscape_data (key, data, expires_at)
      VALUES (?, ?, ?)
    `).run(key, JSON.stringify(data), expiresAt);
    console.log(`[Landscape SQLite Cache Write] Cached results for key ${key} (expires in 30 days)`);
  } catch (err: any) {
    console.error("[Landscape Cache Error] Failed to write to SQLite cache:", err.message);
  }
}

function getMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[half];
  }
  return (sorted[half - 1] + sorted[half]) / 2.0;
}

function padMissingPositions(data: LandscapePositionData[], start: number, end: number): LandscapePositionData[] {
  const indexSet = new Set(data.map(d => d.residx));
  const padded = [...data];
  for (let i = start; i <= end; i++) {
    if (!indexSet.has(i)) {
      padded.push({
        residx: i,
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
  return padded.sort((a, b) => a.residx - b.residx);
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

  let seqLength = 0;
  try {
    const uniprotId = await resolveGeneToUniprot(normGene);
    if (uniprotId) {
      const seq = await fetchUniprotSequence(uniprotId);
      if (seq) seqLength = seq.length;
    }
  } catch {}
  
  // First, check if the full protein landscape is cached — never serve an empty cached
  // array as authoritative; empty results must be recomputed so transient upstream
  // outages cannot lock the landscape into the "0 residue positions mapped" state for
  // the full 24h cache TTL.
  const fullCacheKey = `${normGene}_full_schema:v3`;
  let cachedFull = landscapeCache.get(fullCacheKey);
  if (!cachedFull || cachedFull.length === 0) {
    const fromSqlite = querySqliteCache(fullCacheKey);
    if (fromSqlite && fromSqlite.length > 0) {
      cachedFull = fromSqlite;
      landscapeCache.set(fullCacheKey, fromSqlite);
    }
  }
  if (cachedFull && cachedFull.length > 0) {
    if (startPos !== undefined && endPos !== undefined) {
      const filtered = cachedFull.filter(item => item.residx >= startPos && item.residx <= endPos);
      return padMissingPositions(filtered, startPos, endPos);
    }
    return cachedFull;
  }

  // If a specific window was requested and cached, return it only if it carries data.
  if (startPos !== undefined && endPos !== undefined) {
    const windowCacheKey = `${normGene}_${startPos}_${endPos}_schema:v3`;
    let cachedWindow = landscapeCache.get(windowCacheKey);
    if (!cachedWindow || cachedWindow.length === 0) {
      const fromSqlite = querySqliteCache(windowCacheKey);
      if (fromSqlite && fromSqlite.length > 0) {
        cachedWindow = fromSqlite;
        landscapeCache.set(windowCacheKey, fromSqlite);
      }
    }
    if (cachedWindow && cachedWindow.length > 0) return cachedWindow;
  }

  // Query myvariant.info directly as the primary remote landscape provider for fast O(1) batch range retrieval.
  console.log(`[Landscape] Fetching landscape data for gene=${normGene} window=[${startPos ?? 'full'}, ${endPos ?? 'full'}] via MyVariant.info`);

  // Build the query: if startPos & endPos are passed, query that range. Otherwise query the entire gene.
  const queryStr = (startPos !== undefined && endPos !== undefined)
    ? `dbnsfp.genename:${normGene} AND dbnsfp.aa.pos:[${startPos} TO ${endPos}]`
    : `dbnsfp.genename:${normGene}`;

  const sizeLimit = (startPos !== undefined && endPos !== undefined) ? 2000 : 10000;
  
  async function fetchAllHits(q: string, limit: number): Promise<any[]> {
    const hits: any[] = [];
    const pageSize = 1000; // myvariant.info has a hard limit of 1000 per request
    let from = 0;
    while (hits.length < limit) {
      const targetFields = "dbnsfp.revel,dbnsfp.alphamissense,dbnsfp.gerp,dbnsfp.phylop,dbnsfp.aa.pos,dbnsfp.aapos,dbnsfp.pos,dbnsfp.hgvsp,dbnsfp.genename";
      const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(q)}&fields=${targetFields}&size=${pageSize}&from=${from}`;
      console.log(`[Landscape] Querying myvariant.info: ${url}`);
      const res = await fetchWithRetry(url, {
        headers: { "Accept": "application/json" },
        timeout: 15000
      });
      console.log(`[Landscape] myvariant.info response status: ${res.status}`);
      if (!res.ok) {
        throw new Error(`myvariant.info query failed with status ${res.status}`);
      }
      const data = await res.json() as any;
      if (!data.hits || !Array.isArray(data.hits) || data.hits.length === 0) {
        break;
      }
      hits.push(...data.hits);
      if (data.hits.length < pageSize) {
        break;
      }
      from += pageSize;
    }
    return hits;
  }

  const result: LandscapePositionData[] = [];
  const landscapeMap = new Map<number, {
    revelScores: number[];
    amScores: number[];
    gerpScores: number[];
    phylopScores: number[];
  }>();

  try {
    let hits: any[] = [];
    try {
      hits = await fetchAllHits(queryStr, sizeLimit);
    } catch (err: any) {
      console.warn(`[Landscape Fetch Warning] Range query fetchAllHits failed: ${err.message}`);
    }

    // Fallback: If range query returned no results, try position-targeted fallback query (Cause D)
    if (hits.length === 0 && startPos !== undefined && endPos !== undefined) {
      console.log(`[Landscape Fallback] Range query returned 0 hits. Trying position-targeted query fallback...`);
      const posQueries = [];
      for (let p = startPos; p <= endPos; p++) {
        posQueries.push(`dbnsfp.aa.pos:${p}`);
      }
      const fallbackQueryStr = `dbnsfp.genename:${normGene} AND (${posQueries.join(" OR ")})`;
      try {
        hits = await fetchAllHits(fallbackQueryStr, sizeLimit);
        console.log(`[Landscape Fallback] Position-targeted query returned ${hits.length} hits`);
      } catch (fallbackErr: any) {
        console.warn(`[Landscape Fallback Warning] Position-targeted query failed: ${fallbackErr.message}`);
      }
    }

    console.log(`[Landscape] myvariant.info returned ${hits.length} hits`);
    if (hits.length > 0) {
      hits.forEach((hit: any) => {
          const dbnsfp = hit.dbnsfp;
          console.log(`[Landscape] Hit has dbnsfp: ${!!dbnsfp}, aapos:`, dbnsfp?.aapos);
          if (!dbnsfp) {
            console.warn(`[Landscape] Hit has no dbnsfp field`);
            return;
          }

          const posList: any[] = [];
          const rawAapos = dbnsfp.aapos ?? dbnsfp.aa_pos ?? dbnsfp["aa.pos"];
          if (rawAapos !== undefined && rawAapos !== null) {
            const strVals = Array.isArray(rawAapos) 
              ? rawAapos.map(String) 
              : String(rawAapos).split(";");
            strVals.forEach((s: string) => {
              const parsed = parseInt(s.trim(), 10);
              if (!isNaN(parsed) && parsed !== -1) {
                posList.push(parsed);
              }
            });
          } else if (dbnsfp.aa?.pos !== undefined && dbnsfp.aa?.pos !== null) {
            const rawVal = dbnsfp.aa.pos;
            const strVals = Array.isArray(rawVal) ? rawVal : [rawVal];
            strVals.forEach((s: any) => {
              const parsed = parseInt(String(s).trim(), 10);
              if (!isNaN(parsed)) {
                posList.push(parsed);
              }
            });
          } else if (dbnsfp.pos !== undefined && dbnsfp.pos !== null) {
            const parsed = parseInt(String(dbnsfp.pos).trim(), 10);
            if (!isNaN(parsed)) posList.push(parsed);
          } else if (dbnsfp.hgvsp) {
            const hgvspArr = Array.isArray(dbnsfp.hgvsp) ? dbnsfp.hgvsp : [dbnsfp.hgvsp];
            for (const h of hgvspArr) {
              if (typeof h === "string") {
                const match = h.match(/p\.[A-Za-z]{1,3}(\d+)/);
                if (match) {
                  const parsed = parseInt(match[1], 10);
                  if (!isNaN(parsed)) {
                    posList.push(parsed);
                    break;
                  }
                }
              }
            }
          }
          
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
  console.log(`[Landscape] Aggregating scores for ${landscapeMap.size} positions`);
  for (const [pos, d] of landscapeMap.entries()) {
    const revelCount = d.revelScores.length;
    const amCount = d.amScores.length;
    console.log(`[Landscape] Pos ${pos}: ${revelCount} REVEL scores, ${amCount} AM scores`);

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

  const start = startPos !== undefined ? startPos : 1;
  const end = endPos !== undefined ? endPos : (seqLength > 0 ? seqLength : (result.length > 0 ? Math.max(...result.map(r => r.residx)) : 1));
  const paddedResult = padMissingPositions(result, start, end);

  if (startPos !== undefined && endPos !== undefined) {
    const windowCacheKey = `${normGene}_${startPos}_${endPos}_schema:v3`;
    landscapeCache.set(windowCacheKey, paddedResult);
    writeSqliteCache(windowCacheKey, paddedResult);
    return paddedResult;
  }

  // Cache full protein
  landscapeCache.set(fullCacheKey, paddedResult);
  writeSqliteCache(fullCacheKey, paddedResult);
  console.log(`[Landscape] Fetch complete: ${paddedResult.length} positions for gene=${normGene} window=[${startPos ?? 'full'}, ${endPos ?? 'full'}]`);
  return paddedResult;
}

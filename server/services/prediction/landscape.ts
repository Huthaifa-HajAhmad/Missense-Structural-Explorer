import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { normalizeGeneSymbol, fetchWithRetry } from "../infra/http-client.ts";
import { isLocalDbnsfpAvailable, queryLocalDbnsfpLandscapeRows, readLocalDbnsfpVersion } from "./dbnsfp_local.ts";
import { landscapeCache } from "../infra/cache.ts";
import { resolveGeneToUniprot, fetchUniprotSequence } from "../external-api/uniprot.ts";
import {
  aggregateLandscape,
  candidateFromMyVariantHit,
  selectReferenceTranscript,
  type LandscapeMeta,
  type LandscapeResult,
  type SnvCandidate
} from "./landscape-aggregate.ts";

export type { LandscapePositionData, LandscapeMeta, LandscapeResult } from "./landscape-aggregate.ts";
export { fetchLocalPopulationFrequencies } from "./local-population.ts";

/**
 * Bumped whenever the meaning of a cached row changes. v4: rows are read on one transcript and
 * count each SNV once (v3 rows pooled every isoform's residue numbers and must never be served).
 */
const CACHE_SCHEMA = "schema:v4";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Expired rows are swept at most this often, not on every read. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let sqliteDb: DatabaseSync | null = null;
let lastSweep = 0;
const sqliteDbPath = path.join(process.cwd(), "data", "landscape_cache.sqlite");

function getSqliteDb(): DatabaseSync | null {
  if (process.env.NODE_ENV === "test") return null;
  if (sqliteDb) return sqliteDb;
  try {
    const dir = path.dirname(sqliteDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

function readCache(key: string): LandscapeResult | null {
  const mem = landscapeCache.get(key) as LandscapeResult | undefined;
  if (mem && Array.isArray(mem.positions) && mem.positions.length > 0) return mem;
  const db = getSqliteDb();
  if (!db) return null;
  try {
    const now = Date.now();
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      db.prepare("DELETE FROM landscape_data WHERE expires_at < ?").run(now);
      lastSweep = now;
    }
    const row = db.prepare("SELECT data FROM landscape_data WHERE key = ? AND expires_at >= ?").get(key, now) as any;
    if (row?.data) {
      const parsed = JSON.parse(row.data) as LandscapeResult;
      if (Array.isArray(parsed?.positions) && parsed.positions.length > 0) {
        landscapeCache.set(key, parsed);
        return parsed;
      }
    }
  } catch (err: any) {
    console.error("[Landscape Cache] Read failed:", err.message);
  }
  return null;
}

function writeCache(key: string, value: LandscapeResult): void {
  // Never cache an answer with no scores: a transient upstream outage must not pin the empty
  // state for the TTL.
  const hasScores = value.positions.some((p) => p.revelCount > 0 || p.amCount > 0 || p.gerp !== null);
  if (!hasScores) return;
  landscapeCache.set(key, value);
  const db = getSqliteDb();
  if (!db) return;
  try {
    db.prepare("INSERT OR REPLACE INTO landscape_data (key, data, expires_at) VALUES (?, ?, ?)").run(
      key,
      JSON.stringify(value),
      Date.now() + CACHE_TTL_MS
    );
  } catch (err: any) {
    console.error("[Landscape Cache] Write failed:", err.message);
  }
}

let myVariantVersion: { value: string | null; at: number } | null = null;

/** dbNSFP version myvariant.info serves, from its metadata endpoint; null when not reported. */
async function fetchMyVariantDbnsfpVersion(): Promise<string | null> {
  if (myVariantVersion && Date.now() - myVariantVersion.at < 24 * 60 * 60 * 1000) return myVariantVersion.value;
  let value: string | null = null;
  try {
    const res = await fetchWithRetry("https://myvariant.info/v1/metadata", {
      headers: { Accept: "application/json" },
      timeout: 8000
    });
    if (res.ok) {
      const json = (await res.json()) as any;
      const v = json?.src?.dbnsfp?.version ?? json?.src?.dbnsfp?.release ?? null;
      value = v ? `dbNSFP ${String(v)}` : null;
    }
  } catch {
    value = null;
  }
  myVariantVersion = { value, at: Date.now() };
  return value;
}

async function fetchMyVariantHits(query: string, limit: number): Promise<any[]> {
  const hits: any[] = [];
  const pageSize = 1000; // myvariant.info's per-request cap
  const fields = [
    "dbnsfp.revel",
    "dbnsfp.alphamissense",
    "dbnsfp.gerp++",
    "dbnsfp.gerp",
    "dbnsfp.phylop",
    "dbnsfp.aa",
    "dbnsfp.aapos",
    "dbnsfp.ensembl",
    "dbnsfp.mane",
    "dbnsfp.vep_canonical",
    "dbnsfp.genename"
  ].join(",");
  let from = 0;
  while (hits.length < limit) {
    const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(query)}&fields=${fields}&size=${pageSize}&from=${from}`;
    const res = await fetchWithRetry(url, { headers: { Accept: "application/json" }, timeout: 15000 });
    if (!res.ok) throw new Error(`myvariant.info query failed with status ${res.status}`);
    const data = (await res.json()) as any;
    if (!Array.isArray(data?.hits) || data.hits.length === 0) break;
    hits.push(...data.hits);
    if (data.hits.length < pageSize) break;
    from += pageSize;
  }
  return hits;
}

async function loadReferenceSequence(gene: string): Promise<{ accession: string | null; sequence: string | null }> {
  try {
    const accession = await resolveGeneToUniprot(gene);
    if (!accession) return { accession: null, sequence: null };
    const sequence = await fetchUniprotSequence(accession);
    return { accession, sequence: sequence || null };
  } catch {
    return { accession: null, sequence: null };
  }
}

/**
 * Per-residue REVEL / AlphaMissense / conservation for a gene window, read on one transcript.
 * Local dbNSFP first (when built and covering the window), else myvariant.info.
 */
export async function fetchLandscape(gene: string, startPos?: number, endPos?: number): Promise<LandscapeResult> {
  const normGene = normalizeGeneSymbol(gene);
  const windowed = startPos !== undefined && endPos !== undefined;
  const cacheKey = `${normGene}_${windowed ? `${startPos}_${endPos}` : "full"}_${CACHE_SCHEMA}`;

  const cached = readCache(cacheKey);
  if (cached) return { ...cached, meta: { ...cached.meta, cached: true } };

  const { accession, sequence } = await loadReferenceSequence(normGene);
  const start = startPos ?? 1;
  const retrievedAt = new Date().toISOString();

  // Local dbNSFP: the ingest already stores one transcript's numbering per row.
  if (isLocalDbnsfpAvailable()) {
    const local = await queryLocalDbnsfpLandscapeRows(normGene, startPos, endPos);
    if (local) {
      const end = endPos ?? local.maxPos;
      const { positions, qualityFlags } = aggregateLandscape(local.candidates, {
        start,
        end,
        sequence,
        choice: { transcript: local.transcript, basis: local.transcriptBasis }
      });
      const covered = positions.filter((p) => p.revelCount > 0 || p.amCount > 0 || p.gerp !== null).length;
      // A sparse local window (a partial ingest) is not an answer; the remote source is asked instead.
      if (covered > 0 && covered >= positions.length * 0.2) {
        const result: LandscapeResult = {
          positions,
          meta: {
            source: "dbnsfp-local",
            sourceVersion: readLocalDbnsfpVersion(),
            transcript: local.transcript,
            transcriptBasis: local.transcriptBasis,
            window: { start, end },
            referenceSequence: sequence ? accession : null,
            qualityFlags,
            cached: false,
            retrievedAt
          }
        };
        writeCache(cacheKey, result);
        return result;
      }
    }
  }

  const query = windowed
    ? `dbnsfp.genename:${normGene} AND dbnsfp.aa.pos:[${startPos} TO ${endPos}]`
    : `dbnsfp.genename:${normGene}`;
  let hits: any[] = [];
  try {
    hits = await fetchMyVariantHits(query, windowed ? 2000 : 10000);
  } catch (err: any) {
    console.warn(`[Landscape] myvariant.info range query failed: ${err.message}`);
  }
  if (hits.length === 0 && windowed) {
    // Some deployments index aa.pos as a keyword, where range syntax returns nothing.
    const terms = [];
    for (let p = startPos!; p <= endPos!; p++) terms.push(`dbnsfp.aa.pos:${p}`);
    try {
      hits = await fetchMyVariantHits(`dbnsfp.genename:${normGene} AND (${terms.join(" OR ")})`, 2000);
    } catch (err: any) {
      console.warn(`[Landscape] myvariant.info per-position query failed: ${err.message}`);
    }
  }

  const candidates = hits.map(candidateFromMyVariantHit).filter((c): c is SnvCandidate => c !== null);
  const choice = selectReferenceTranscript(candidates, sequence);
  const end =
    endPos ?? (sequence ? sequence.length : Math.max(start, ...candidates.flatMap((c) => c.readings.map((r) => r.pos))));
  const { positions, qualityFlags } = aggregateLandscape(candidates, { start, end, sequence, choice });

  const meta: LandscapeMeta = {
    source: candidates.length > 0 ? "myvariant" : "none",
    sourceVersion: candidates.length > 0 ? await fetchMyVariantDbnsfpVersion() : null,
    transcript: choice.transcript,
    transcriptBasis: choice.basis,
    window: { start, end },
    referenceSequence: sequence ? accession : null,
    qualityFlags,
    cached: false,
    retrievedAt
  };
  console.log(
    `[Landscape] ${normGene} [${start}, ${end}]: ${candidates.length} SNVs on ${choice.transcript ?? "no transcript id"} (${choice.basis})` +
      (qualityFlags.length ? `; flags ${qualityFlags.join(", ")}` : "")
  );
  const result = { positions, meta };
  writeCache(cacheKey, result);
  return result;
}

/** Rows only, for callers that predate the provenance block. */
export async function fetchLandscapeData(gene: string, startPos?: number, endPos?: number) {
  return (await fetchLandscape(gene, startPos, endPos)).positions;
}

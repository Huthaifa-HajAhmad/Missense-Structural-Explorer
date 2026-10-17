import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { normalizeGeneSymbol, fetchWithRetry } from "../infra/http-client.ts";
import { isLocalDbnsfpAvailable, queryLocalDbnsfpLandscapeRows, readLocalDbnsfpVersion } from "./dbnsfp_local.ts";
import { landscapeCache } from "../infra/cache.ts";
import { resolveGeneToUniprot, fetchUniprotSequence } from "../external-api/uniprot.ts";
import { type CacheScope, currentCacheScope, newCacheScope, runInCacheScope } from "../infra/cache-scope.ts";
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
 * v5: window queries fetch each residue by exact term (v4 windows silently lacked residues whose number sorts after the window end as text).
 * v6: local dbNSFP windows read only the gene's MANE/canonical transcript (v5 local windows mixed in
 * alternative-isoform lines stored as `single` — BRAF: 567 extra rows from 4 other transcripts).
 */
const CACHE_SCHEMA = "schema:v6";
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
    // Encoded: an unencoded "gerp++" reaches the server as "gerp  " ('+' decodes to a space).
    const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&size=${pageSize}&from=${from}`;
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

/** Residues per request: one OR-term each keeps the query string well under URL limits. */
const WINDOW_TERMS_PER_REQUEST = 40;

/**
 * SNVs whose residue number on ANY transcript falls in [start, end], one explicit term per residue.
 * Never a range: myvariant.info indexes `dbnsfp.aa.pos` as text, so `[1 TO 31]` compares strings
 * and silently drops residues 4-9 (they sort after "31"), including the queried residue on SOD1
 * p.Ala5Val, while admitting 100-199. The aggregation then keeps the chosen transcript's numbering.
 */
export async function fetchMyVariantWindowHits(gene: string, start: number, end: number): Promise<any[]> {
  const byId = new Map<string, any>();
  for (let from = start; from <= end; from += WINDOW_TERMS_PER_REQUEST) {
    const to = Math.min(end, from + WINDOW_TERMS_PER_REQUEST - 1);
    const terms: string[] = [];
    for (let p = from; p <= to; p++) terms.push(`dbnsfp.aa.pos:${p}`);
    const chunk = await fetchMyVariantHits(`dbnsfp.genename:${gene} AND (${terms.join(" OR ")})`, 2000);
    for (const h of chunk) byId.set(typeof h?._id === "string" ? h._id : `#${byId.size}`, h);
  }
  return [...byId.values()];
}

/**
 * The UniProt sequence the landscape is checked against. `failed` is set when a lookup threw (a 429,
 * a timeout): the landscape is still answered, but not cached for 30 days without its reference.
 */
async function loadReferenceSequence(
  gene: string,
  requested?: string | null
): Promise<{ accession: string | null; sequence: string | null; failed: boolean }> {
  try {
    const accession = requested || (await resolveGeneToUniprot(gene));
    if (!accession) return { accession: null, sequence: null, failed: false };
    const sequence = await fetchUniprotSequence(accession);
    return { accession, sequence: sequence || null, failed: false };
  } catch {
    return { accession: null, sequence: null, failed: true };
  }
}

/**
 * Per-residue REVEL / AlphaMissense / conservation for a gene window, read on one transcript.
 * Local dbNSFP first (when built and covering the window), else myvariant.info.
 */
export async function fetchLandscape(
  gene: string,
  startPos?: number,
  endPos?: number,
  /**
   * The accession whose sequence the tab draws. The residue check and the sequence-agreement
   * transcript choice must use that sequence, not whichever accession the gene symbol resolves to.
   */
  uniprotId?: string | null
): Promise<LandscapeResult> {
  // Its own scope (under the caller's), so the cache write below can see whether anything this
  // landscape was built from was rate limited or served out of date (WP-I2).
  const scope = newCacheScope(currentCacheScope());
  return runInCacheScope(scope, () => computeLandscape(gene, startPos, endPos, uniprotId, scope));
}

async function computeLandscape(
  gene: string,
  startPos: number | undefined,
  endPos: number | undefined,
  uniprotId: string | null | undefined,
  scope: CacheScope
): Promise<LandscapeResult> {
  const normGene = normalizeGeneSymbol(gene);
  const windowed = startPos !== undefined && endPos !== undefined;
  const accessionKey = uniprotId ? uniprotId.trim().toUpperCase() : "auto";
  const cacheKey = `${normGene}_${accessionKey}_${windowed ? `${startPos}_${endPos}` : "full"}_${CACHE_SCHEMA}`;

  const cached = readCache(cacheKey);
  if (cached) return { ...cached, meta: { ...cached.meta, cached: true } };

  const { accession, sequence, failed: referenceFailed } = await loadReferenceSequence(normGene, uniprotId);
  /**
   * Cached for 30 days only when complete: the reference sequence arrived (an empty one, or a lookup
   * that threw, is not an answer), and nothing it was built from was refused, held back or served
   * stale. Otherwise it is answered now and asked for again next time.
   */
  const store = (result: LandscapeResult) => {
    const degraded =
      referenceFailed ||
      (accession !== null && sequence === null) ||
      scope.rateLimitedHosts.size > 0 ||
      scope.busyHosts.size > 0 ||
      scope.stale.length > 0;
    if (!degraded) writeCache(cacheKey, result);
  };
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
        store(result);
        return result;
      }
    }
  }

  let hits: any[] = [];
  try {
    hits = windowed
      ? await fetchMyVariantWindowHits(normGene, startPos!, endPos!)
      : await fetchMyVariantHits(`dbnsfp.genename:${normGene}`, 10000);
  } catch (err: any) {
    console.warn(`[Landscape] myvariant.info query failed: ${err.message}`);
  }

  const candidates = hits.map(candidateFromMyVariantHit).filter((c): c is SnvCandidate => c !== null);
  const choice = selectReferenceTranscript(candidates, sequence);
  const end =
    endPos ?? (sequence ? sequence.length : Math.max(start, ...candidates.flatMap((c) => c.readings.map((r) => r.pos))));
  const { positions, qualityFlags } = aggregateLandscape(candidates, { start, end, sequence, choice });
  const hitCap = windowed ? 2000 : 10000;
  // The source stops at the cap; residues past it read as unscored, which the flag makes visible.
  if (hits.length >= hitCap) qualityFlags.push(`truncated:${hitCap}`);

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
  store(result);
  return result;
}

/** Rows only, for callers that predate the provenance block. */
export async function fetchLandscapeData(gene: string, startPos?: number, endPos?: number, uniprotId?: string | null) {
  return (await fetchLandscape(gene, startPos, endPos, uniprotId)).positions;
}

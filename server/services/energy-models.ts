/**
 * energy-models.ts — Energy model integrations: DDGun (sequence-based) and RaSP (structural).
 *
 * Extracted from biophysics.ts. Contains:
 *   - ddgunCache + runDdgunSeq (DDGun online sequence-based ΔΔG)
 *   - raspCache + RaSP database helpers + runRaspLocal + initializeRaspDatabase + lookupPrecomputedRaspScore
 *
 * Depends on: os, path, fs, readline, stream, lru-cache, aminoAcids
 *
 * RaSP lookup hierarchy (Part4 #1 architectural fix):
 *   1. SQLite (data/df_rasp_gnomad_clinvar.sqlite) — O(log n) indexed lookup.
 *      Build once with: npx tsx scripts/build-rasp-sqlite.ts
 *   2. CSV + byte-offset sidecar (legacy) — used only until SQLite is built.
 */
import os from "os";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import readline from "readline";
import { LRUCache } from "lru-cache";
import { AMINO_ACID_3_TO_1 } from "../../src/aminoAcids.ts";
import { Readable } from "stream";
import { finished } from "stream/promises";
import crypto from "crypto";
import { anySignal } from "../utils.ts";
import { DatabaseSync } from "node:sqlite";
import { computeCalibratedConsensus } from "../../src/shared/thresholds.ts";

// ---------------------------------------------------------------------------
// RaSP (Rapid Stability Prediction — precomputed human proteome lookup)
// ---------------------------------------------------------------------------

const raspCache = new LRUCache<string, { score: number | null; reason?: string }>({ max: 200 });

const RASP_SQLITE_PATH = path.join(process.cwd(), "data", "df_rasp_gnomad_clinvar.sqlite");
const RASP_CSV_PATH = path.join(process.cwd(), "data", "df_rasp_gnomad_clinvar.csv");
let raspSqliteDb: DatabaseSync | null = null;
let raspSqliteChecked = false;

function getRaspSqliteDb(): DatabaseSync | null {
  if (raspSqliteChecked) return raspSqliteDb;
  raspSqliteChecked = true;
  try {
    const stat = fs.statSync(RASP_SQLITE_PATH);
    if (stat.size < 1024) return null; // placeholder / empty
    const db = new DatabaseSync(RASP_SQLITE_PATH, { open: true });
    // Quick sanity check
    const row = (db.prepare("SELECT count(*) as c FROM rasp_variants LIMIT 1").get as any)() as { c: number } | undefined;
    if (!row || row.c === 0) {
      db.close();
      console.warn("[RaSP SQLite] Database exists but is empty.");
      return null;
    }
    raspSqliteDb = db;
    console.log(`[RaSP SQLite] Indexed database active (${(stat.size / 1024 / 1024).toFixed(1)} MB).`);
    return raspSqliteDb;
  } catch {
    return null;
  }
}

function lookupRaspSqlite(
  db: DatabaseSync,
  uniprotId: string,
  pos: number,
  wt: string,
  mut: string
): { score: number | null; reason?: string } {
  try {
    const wt1 = wt.length === 3 ? AMINO_ACID_3_TO_1[wt.toUpperCase()] || wt : wt;
    const mut1 = mut.length === 3 ? AMINO_ACID_3_TO_1[mut.toUpperCase()] || mut : mut;
    const stmt = db.prepare(
      "SELECT rasp_score FROM rasp_variants WHERE uniprot_id = ? AND pos = ? AND wt = ? AND mut = ? LIMIT 1"
    );
    const row = (stmt.get as any)(uniprotId, pos, wt1.toUpperCase(), mut1.toUpperCase()) as { rasp_score: number | null } | undefined;
    if (row === undefined) return { score: null, reason: "Residue position is not present in the pre-computed database" };
    return { score: row.rasp_score };
  } catch (err: any) {
    console.warn("[RaSP SQLite] Lookup error:", err.message);
    return { score: null, reason: "Error querying pre-computed RaSP database" };
  }
}

function getFileMd5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);
    stream.on("data", data => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", err => reject(err));
  });
}

async function downloadRaspDatabase(csvPath: string): Promise<void> {
  const dataDir = path.dirname(csvPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  console.log("[RaSP] Querying Zenodo for human proteome database links...");
  const metadataRes = await fetch("https://zenodo.org/api/records/6835877");
  if (!metadataRes.ok) {
    throw new Error(`Failed to query Zenodo metadata: ${metadataRes.statusText}`);
  }
  const metadata = await metadataRes.json();
  const fileInfo = metadata.files.find((f: any) => (f.key || f.filename) === "df_rasp_gnomad_clinvar.csv");
  if (!fileInfo) {
    throw new Error("Could not find df_rasp_gnomad_clinvar.csv in Zenodo record.");
  }

  const downloadUrl = fileInfo.links.self || fileInfo.links.download;
  console.log(`[RaSP] Downloading human proteome database from Zenodo (size: ${(fileInfo.size / 1024 / 1024).toFixed(1)} MB)...`);
  
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download database: ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(csvPath);
  await finished(Readable.fromWeb(response.body as any).pipe(fileStream));
  console.log("[RaSP] Download complete. Verifying database checksum...");
  
  const actualHash = await getFileMd5(csvPath);
  const expectedHash = fileInfo.checksum.replace(/^md5:/, "");
  if (actualHash !== expectedHash) {
    try {
      fs.unlinkSync(csvPath);
    } catch (e) {}
    throw new Error(`Checksum mismatch for downloaded database: expected ${expectedHash}, got ${actualHash}`);
  }
}

export async function initializeRaspDatabase(): Promise<void> {
  if (getRaspSqliteDb()) return;

  const { buildRaspSqliteDatabase } = await import("../../scripts/build-rasp-sqlite.ts");

  if (fs.existsSync(RASP_CSV_PATH)) {
    console.log("[RaSP] CSV found without SQLite index. Triggering automatic SQLite build...");
    try {
      await buildRaspSqliteDatabase(RASP_CSV_PATH, RASP_SQLITE_PATH);
      raspSqliteChecked = false;
      getRaspSqliteDb();
      return;
    } catch (err: any) {
      console.error("[RaSP SQLite Migration Error]", err.message);
    }
  }

  if (!fs.existsSync(RASP_SQLITE_PATH)) {
    console.log("[RaSP] Human proteome database not found locally. Triggering background download...");
    downloadRaspDatabase(RASP_CSV_PATH)
      .then(async () => {
        console.log("[RaSP] Building SQLite index from downloaded database...");
        await buildRaspSqliteDatabase(RASP_CSV_PATH, RASP_SQLITE_PATH);
        raspSqliteChecked = false;
        getRaspSqliteDb();
      })
      .catch(err => {
        console.error("[RaSP Initialization Error] Failed to download precomputed RaSP database:", err.message);
      });
  }
}

export async function lookupPrecomputedRaspScore(
  uniprotId: string,
  pos: number,
  wt: string,
  mut: string
): Promise<{ score: number | null; reason?: string }> {
  const sqliteDb = getRaspSqliteDb();
  if (sqliteDb) {
    return lookupRaspSqlite(sqliteDb, uniprotId, pos, wt, mut);
  }

  return { score: null, reason: "Pre-computed RaSP database unavailable" };
}

/**
 * Release any open RaSP database file descriptors and reset in-memory caches.
 */
export function closeRaspResources(): void {
  if (raspSqliteDb) {
    try {
      raspSqliteDb.close();
    } catch {}
    raspSqliteDb = null;
  }
  raspSqliteChecked = false;
  raspCache.clear();
}

/**
 * Runs the local RaSP stability predictor via precomputed human proteome lookup.
 * Sign convention: negative = destabilizing (matching DynaMut2/DDMut).
 */
export async function runRaspLocal(
  wtPdbPath: string,
  mutPdbPath: string,
  chain: string,
  pos: number,
  wtAa: string,
  mutAa: string,
  uniprotId?: string | null
): Promise<{ score: number | null; reason?: string } | null> {
  // P1-1 Fix: Key cache on canonical protein/variant identifiers rather than temp file paths
  const cacheKey = `${uniprotId ?? ""}|${chain}|${pos}|${wtAa}|${mutAa}`;
  const cached = raspCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  if (uniprotId) {
    try {
      const resObj = await lookupPrecomputedRaspScore(uniprotId, pos, wtAa, mutAa);
      raspCache.set(cacheKey, resObj);
      return resObj;
    } catch (err: any) {
      console.warn(`[RaSP] Precomputed database lookup failed for ${uniprotId}:`, err.message);
    }
  }

  const defaultObj = { score: null, reason: "Residue position is not present in the pre-computed database" };
  raspCache.set(cacheKey, defaultObj);
  return defaultObj;
}

// ---------------------------------------------------------------------------
// ThermoMPNN (Tamarind Bio Remote Predictor)
// ---------------------------------------------------------------------------

export const thermompnnCache = new LRUCache<string, { prediction: number | null; jobId?: string; status: "pending" | "running" | "done" | "error" }>({ max: 200 });

export async function testTamarindConnection(apiKey?: string): Promise<{ valid: boolean; message: string }> {
  const keyToUse = apiKey || process.env.TAMARIND_API_KEY;
  if (!keyToUse) {
    return { valid: false, message: "No Tamarind Bio API Key provided." };
  }
  try {
    const res = await fetch("https://app.tamarind.bio/api/tools", {
      headers: {
        "x-api-key": keyToUse
      }
    });
    if (res.ok) {
      return { valid: true, message: "Connection to Tamarind Bio API verified successfully." };
    }
    if (res.status === 401 || res.status === 403) {
      return { valid: false, message: "Invalid Tamarind Bio API Key (Unauthorized)." };
    }
    const txt = await res.text();
    return { valid: false, message: `Tamarind API returned HTTP ${res.status}: ${txt.slice(0, 100)}` };
  } catch (err: any) {
    return { valid: false, message: `Network error connecting to Tamarind Bio API: ${err.message}` };
  }
}

export async function submitThermoMpnnJob(
  pdbContent: string,
  mutation: string,
  apiKey?: string,
  signal?: AbortSignal
): Promise<{ jobId: string | null; prediction: number | null; status: "pending" | "done" | "error"; error?: string }> {
  const keyToUse = apiKey || process.env.TAMARIND_API_KEY;
  if (!keyToUse) {
    return { jobId: null, prediction: null, status: "error", error: "Tamarind Bio API key not configured. Please enter your Tamarind API key in Settings." };
  }

  const generatedJobName = `thermompnn_${mutation.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
  const cacheKey = `${mutation}_${pdbContent.slice(0, 100)}`;
  const cached = thermompnnCache.get(cacheKey);
  if (cached && cached.prediction !== null) {
    return { jobId: cached.jobId || "cached", prediction: cached.prediction, status: "done" };
  }

  let chain = "A";
  if (mutation && mutation.length >= 4) {
    chain = mutation[1];
  }

  try {
    const fetchSignal = signal
      ? anySignal([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000);

    const response = await fetch("https://app.tamarind.bio/api/submit-job", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": keyToUse
      },
      body: JSON.stringify({
        type: "thermompnn",
        tool: "thermompnn",
        pdb: pdbContent,
        pdbFile: pdbContent,
        mutation,
        jobName: generatedJobName,
        chains: [chain],
        settings: {
          pdbFile: pdbContent,
          chains: [chain]
        }
      }),
      signal: fetchSignal
    });

    if (!response.ok) {
      const errText = typeof response.text === "function" ? await response.text() : "Unknown Error";
      return { jobId: null, prediction: null, status: "error", error: `Tamarind API HTTP ${response.status}: ${errText.slice(0, 100)}` };
    }

    let resText = "";
    if (typeof response.text === "function") {
      resText = await response.text();
    } else if (typeof response.json === "function") {
      resText = JSON.stringify(await response.json());
    }
    
    let data: any = null;
    if (resText && (resText.trim().startsWith("{") || resText.trim().startsWith("["))) {
      try {
        data = JSON.parse(resText);
      } catch (_) {}
    }

    if (data) {
      const jobId = data.jobId || data.id || data.job_id || generatedJobName;
      const rawDdg = data.Score ?? data.prediction ?? data.ddg ?? data.delta_delta_g ?? data.score ?? null;
      if (typeof rawDdg === "number") {
        thermompnnCache.set(cacheKey, { prediction: rawDdg, jobId, status: "done" });
        return { jobId, prediction: rawDdg, status: "done" };
      }
      if (jobId) {
        thermompnnCache.set(cacheKey, { prediction: null, jobId, status: "pending" });
        return { jobId, prediction: null, status: "pending" };
      }
    } else {
      // Plain text response "myJobName submitted to queue."
      const jobId = generatedJobName;
      thermompnnCache.set(cacheKey, { prediction: null, jobId, status: "pending" });
      return { jobId, prediction: null, status: "pending" };
    }

    return { jobId: null, prediction: null, status: "error", error: "No jobId or score returned by Tamarind API" };
  } catch (err: any) {
    console.warn("[ThermoMPNN] Failed to submit job to Tamarind Bio:", err.message);
    return { jobId: null, prediction: null, status: "error", error: err.message };
  }
}

export async function pollThermoMpnnJob(
  jobId: string,
  apiKey?: string
): Promise<{ status: "pending" | "running" | "done" | "error"; prediction: number | null; error?: string }> {
  const keyToUse = apiKey || process.env.TAMARIND_API_KEY;
  if (!keyToUse) {
    return { status: "error", prediction: null, error: "Tamarind Bio API key not configured" };
  }

  try {
    const response = await fetch(`https://app.tamarind.bio/api/jobs?jobName=${jobId}`, {
      headers: {
        "x-api-key": keyToUse
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return { status: "error", prediction: null, error: `HTTP ${response.status}` };
    }

    const data: any = await response.json();
    let jobData = data;
    if (data && Array.isArray(data.jobs)) {
      const found = data.jobs.find((j: any) => j.JobName === jobId || j.jobName === jobId);
      if (found) {
        jobData = found;
      } else {
        return { status: "pending", prediction: null };
      }
    }

    const rawStatus = jobData.JobStatus || jobData.status || "";
    const status = (rawStatus === "Complete" || rawStatus === "DONE" || rawStatus === "completed" || rawStatus === "success")
      ? "done"
      : (rawStatus === "ERROR" || rawStatus === "failed" || rawStatus === "Stopped" || rawStatus === "Deleted")
        ? "error"
        : (rawStatus === "Running")
          ? "running"
          : "pending";

    if (status === "done") {
      const rawDdg = jobData.Score ?? jobData.prediction ?? jobData.ddg ?? jobData.delta_delta_g ?? jobData.score ?? jobData.result?.ddg ?? null;
      const prediction = typeof rawDdg === "number" ? rawDdg : null;
      return { status: "done", prediction };
    }

    if (status === "error") {
      return { status: "error", prediction: null, error: jobData.error || "ThermoMPNN job execution failed" };
    }

    return { status: status === "running" ? "running" : "pending", prediction: null };
  } catch (err: any) {
    return { status: "error", prediction: null, error: err.message };
  }
}

/**
 * Enriches raw FoldX calculations with live remote job outputs, RaSP stability scores,
 * and calibrated consensus statistics.
 */
export function enrichBiophysicalResult(
  foldxRawResult: any,
  remoteJobs?: Partial<{
    dynamut2JobId: string | null;
    dynamut2Status: string | null;
    ddmutJobId: string | null;
    ddmutStatus: string | null;
    thermompnnJobId: string | null;
    thermompnnStatus: string | null;
    thermompnnError: string | null;
    thermompnnVal: number | null;
    stabilityoracleVal: number | null;
  }> | null,
  structureProvenance: any = null,
  posNum: number = 0
) {
  const jobs = remoteJobs || {};
  const finalPdb = foldxRawResult?.pdb ?? null;
  const finalDdG = foldxRawResult?.ddG ?? null;
  const finalStatus = foldxRawResult?.status ?? "unknown";

  const foldxMean = foldxRawResult?.energetics?.foldxMean ?? finalDdG;
  const foldxSd = foldxRawResult?.energetics?.foldxSd ?? null;
  const vdw = foldxRawResult?.energetics?.vdw ?? null;
  const electrostatics = foldxRawResult?.energetics?.electrostatics ?? null;
  const stericClashWarning = foldxRawResult?.energetics?.stericClashWarning ?? false;
  const localSidechainRmsd = foldxRawResult?.energetics?.localSidechainRmsd ?? null;
  const foldxRawDdGs = foldxRawResult?.energetics?.rawDdGs ?? null;
  const foldxSeed = foldxRawResult?.energetics?.seed ?? null;
  const rasp = foldxRawResult?.energetics?.rasp ?? null;
  const raspReason = foldxRawResult?.energetics?.raspReason ?? undefined;
  const stabilityoracleVal = jobs.stabilityoracleVal ?? foldxRawResult?.energetics?.stabilityoracle ?? null;

  const pendingTools: string[] = [];
  if (jobs.dynamut2Status === "pending") pendingTools.push("DynaMut2");
  if (jobs.ddmutStatus === "pending") pendingTools.push("DDMut");
  if (jobs.thermompnnStatus === "pending") pendingTools.push("ThermoMPNN");

  const evidenceComplete = pendingTools.length === 0;
  const foldxRepairFailed = foldxRawResult?.energetics?.foldxRepairFailed ?? false;
  const calResult = computeCalibratedConsensus({
    foldxMean,
    rasp,
    thermompnn: jobs.thermompnnVal ?? null,
    stabilityoracle: stabilityoracleVal,
    foldxRepairFailed
  });
  const rawConsensusVerdict = calResult.consensusVerdict;
  const consensusVerdict = (!evidenceComplete && rawConsensusVerdict)
    ? `${rawConsensusVerdict} (Preliminary - pending: ${pendingTools.join(", ")})`
    : rawConsensusVerdict;

  return {
    pdb: finalPdb,
    ddG: finalDdG,
    foldxDdG: foldxMean,
    thermompnnDdG: jobs.thermompnnVal ?? null,
    status: finalStatus,
    foldedResidueIndex: posNum,
    dynamut2JobId: jobs.dynamut2JobId ?? null,
    dynamut2Status: jobs.dynamut2Status ?? null,
    ddmutJobId: jobs.ddmutJobId ?? null,
    ddmutStatus: jobs.ddmutStatus ?? null,
    thermompnnJobId: jobs.thermompnnJobId ?? null,
    thermompnnStatus: jobs.thermompnnStatus ?? null,
    thermompnnError: jobs.thermompnnError ?? null,
    energetics: {
      foldx: foldxMean,
      vdw,
      electrostatics,
      stericClashWarning,
      localSidechainRmsd,
      rawDdGs: foldxRawDdGs,
      foldxRepairFailed,
      dynamut2: null,
      ddmut: null,
      rasp,
      raspReason,
      thermompnn: jobs.thermompnnVal ?? null,
      stabilityoracle: stabilityoracleVal,
      consensusProbability: calResult.consensusProbability,
      consensusConfMin: calResult.consensusConfMin,
      consensusConfMax: calResult.consensusConfMax,
      consensusVerdict,
      evidenceComplete,
      pendingTools
    },
    provenance: structureProvenance
  };
}

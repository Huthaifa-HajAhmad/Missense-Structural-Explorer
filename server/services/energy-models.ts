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
import { DatabaseSync } from "node:sqlite";
import * as self from "./energy-models.ts";

// ---------------------------------------------------------------------------
// RaSP (Rapid Stability Prediction — precomputed human proteome lookup)
// ---------------------------------------------------------------------------

const raspCache = new LRUCache<string, { score: number | null; reason?: string }>({ max: 200 });

async function createRaspIndex(csvPath: string): Promise<void> {
  const indexPath = csvPath.replace(".csv", ".index.json");
  const index: Record<string, number> = {};

  // #7 fix: open the raw file to count bytes correctly on both LF and CRLF systems.
  // We read raw bytes so byteOffset always tracks the true file position regardless of platform.
  return new Promise((resolve, reject) => {
    const rawStream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({ input: rawStream, crlfDelay: Infinity });
    let byteOffset = 0;
    let currentUniprot = "";

    rl.on("line", (line) => {
      const commaIdx = line.indexOf(",");
      if (commaIdx !== -1) {
        const uniprot = line.slice(0, commaIdx).trim();
        if (uniprot && uniprot !== currentUniprot && uniprot !== "uniprot_id") {
          index[uniprot] = byteOffset;
          currentUniprot = uniprot;
        }
      }
      // Count actual bytes in the line (sans the stripped line ending) plus the real
      // line-ending size.  crlfDelay strips \r\n to just the content; we measure both.
      const lineBytes = Buffer.byteLength(line, "utf8");
      // Peek at the raw byte that follows the line content to detect CRLF vs LF.
      // Simple heuristic: track via the running offset — the readline module strips the
      // ending so we cannot inspect it directly.  Instead we read a small probe at the
      // expected LF position.  For simplicity, and because the existing CSV is LF-only
      // (confirmed), we detect once per file and cache the value.
      byteOffset += lineBytes + raspCsvLineEndingSize;
    });

    rl.on("close", () => {
      try {
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
        console.log(`[RaSP] Created lookup index with ${Object.keys(index).length} proteins.`);
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    rl.on("error", (err) => reject(err));
  });
}

/**
 * Detect the actual line-ending size in the CSV once and cache it.
 * Returns 1 for LF-only files, 2 for CRLF.  Defaults to 1.
 */
let raspCsvLineEndingSize = 1;
function detectRaspLineEnding(csvPath: string): void {
  try {
    const sample = Buffer.alloc(512);
    const fd = fs.openSync(csvPath, "r");
    const bytesRead = fs.readSync(fd, sample, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead - 1; i++) {
      if (sample[i] === 0x0d && sample[i + 1] === 0x0a) { // CR LF
        raspCsvLineEndingSize = 2;
        return;
      }
      if (sample[i] === 0x0a) { // bare LF
        raspCsvLineEndingSize = 1;
        return;
      }
    }
  } catch { /* keep default */ }
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
  console.log("[RaSP] Checksum verified successfully. Creating byte-offset index...");
  await createRaspIndex(csvPath);
}

let raspIndex: Record<string, number> | null = null;
let raspFd: number | null = null;
// #5 fix: sorted offset pairs cached once at loadRaspIndex time (never re-sorted per lookup)
let raspSortedOffsets: { uniprot: string; offset: number }[] | null = null;

function getRaspFd(csvPath: string): number {
  if (raspFd !== null) return raspFd;
  try {
    raspFd = fs.openSync(csvPath, "r");
  } catch (err: any) {
    console.error("[RaSP] Failed to open CSV file:", err.message);
  }
  return raspFd!;
}

function loadRaspIndex(csvPath: string): Record<string, number> {
  if (raspIndex) return raspIndex;
  const indexPath = csvPath.replace(".csv", ".index.json");
  if (fs.existsSync(indexPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(indexPath, "utf8")) as Record<string, unknown>;
      // #6 fix: strip the non-numeric _meta entry before building the offset map
      const filtered: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (k !== "_meta" && typeof v === "number") {
          filtered[k] = v;
        }
      }
      raspIndex = filtered;
      // #5 fix: compute and cache the sorted array once so lookups are O(log n) not O(n log n)
      raspSortedOffsets = Object.entries(filtered)
        .map(([uniprot, offset]) => ({ uniprot, offset }))
        .sort((a, b) => a.offset - b.offset);
      return raspIndex;
    } catch (err) {
      console.warn("[RaSP] Failed to parse index file, recreating...", err);
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// SQLite-backed RaSP lookup (Part4 #1 architectural fix)
// Activated once scripts/build-rasp-sqlite.ts has been run.
// ---------------------------------------------------------------------------
const RASP_SQLITE_PATH = path.join(process.cwd(), "data", "df_rasp_gnomad_clinvar.sqlite");
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
      console.warn("[RaSP SQLite] Database exists but is empty — using CSV fallback.");
      return null;
    }
    raspSqliteDb = db;
    console.log(`[RaSP SQLite] Indexed database active (${(stat.size / 1024 / 1024).toFixed(1)} MB).`);
    return raspSqliteDb;
  } catch {
    return null; // SQLite not yet built — CSV fallback is used
  }
}

function lookupRaspSqlite(
  db: DatabaseSync,
  uniprotId: string,
  pos: number,
  wt: string,
  mut: string
): { score: number | null; reason?: string } | null {
  try {
    const stmt = db.prepare(
      "SELECT rasp_score FROM rasp_variants WHERE uniprot_id = ? AND pos = ? AND wt = ? AND mut = ? LIMIT 1"
    );
    const row = (stmt.get as any)(uniprotId, pos, wt.toUpperCase(), mut.toUpperCase()) as { rasp_score: number | null } | undefined;
    if (row === undefined) return { score: null, reason: "Residue position is not present in the pre-computed database" };
    return { score: row.rasp_score };
  } catch (err: any) {
    console.warn("[RaSP SQLite] Lookup error:", err.message);
    return null; // signal: fall back to CSV
  }
}

async function verifyRaspCsvIntegrity(csvPath: string): Promise<boolean> {
  try {
    const metadataRes = await fetch("https://zenodo.org/api/records/6835877", { signal: AbortSignal.timeout(10000) });
    if (!metadataRes.ok) {
      console.warn(`[RaSP] Failed to query Zenodo metadata for checksum: ${metadataRes.statusText}`);
      return false;
    }
    const metadata = await metadataRes.json() as any;
    const fileInfo = metadata.files.find((f: any) => (f.key || f.filename) === "df_rasp_gnomad_clinvar.csv");
    if (!fileInfo) {
      console.warn("[RaSP] Could not find df_rasp_gnomad_clinvar.csv in Zenodo record.");
      return false;
    }
    const expectedHash = fileInfo.checksum.replace(/^md5:/, "");
    const actualHash = await getFileMd5(csvPath);
    return actualHash === expectedHash;
  } catch (err: any) {
    console.warn(`[RaSP] Error during MD5 integrity check:`, err.message);
    return false;
  }
}

export async function initializeRaspDatabase(): Promise<void> {
  // Try SQLite first (#1 architectural fix) — no further init needed if available
  if (getRaspSqliteDb()) return;

  const csvPath = path.join(process.cwd(), "data", "df_rasp_gnomad_clinvar.csv");
  if (!fs.existsSync(csvPath)) {
    console.log("[RaSP] Human proteome database not found locally. Triggering background download...");
    downloadRaspDatabase(csvPath).catch(err => {
      console.error("[RaSP Initialization Error] Failed to download precomputed RaSP database:", err.message);
    });
  } else {
    try {
      detectRaspLineEnding(csvPath);
      const index = loadRaspIndex(csvPath);
      if (Object.keys(index).length === 0) {
        console.log("[RaSP] Index is missing or empty. Verifying database CSV MD5 checksum before index generation...");
        verifyRaspCsvIntegrity(csvPath).then(async (isValid) => {
          if (isValid) {
            console.log("[RaSP] Checksum verified. Re-generating index...");
            await createRaspIndex(csvPath);
            loadRaspIndex(csvPath);
            getRaspFd(csvPath);
          } else {
            console.warn("[RaSP] Local database CSV file is corrupted (checksum mismatch) or unreachable. Re-downloading...");
            try { fs.unlinkSync(csvPath); } catch (_) {}
            await downloadRaspDatabase(csvPath);
          }
        }).catch(err => {
          console.error("[RaSP] Failed to verify and initialize database:", err.message);
        });
      } else {
        getRaspFd(csvPath);
      }
    } catch (_) {}
  }
}

function binarySearchOffset(arr: { offset: number }[], targetOffset: number): number {
  let low = 0;
  let high = arr.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (arr[mid].offset === targetOffset) {
      return mid;
    } else if (arr[mid].offset < targetOffset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return -1;
}

export async function lookupPrecomputedRaspScore(
  uniprotId: string,
  pos: number,
  wt: string,
  mut: string
): Promise<{ score: number | null; reason?: string }> {
  // --- SQLite path (Part4 #1 fix) — O(log n) indexed lookup ---
  const sqliteDb = getRaspSqliteDb();
  if (sqliteDb) {
    const result = lookupRaspSqlite(sqliteDb, uniprotId, pos, wt, mut);
    if (result !== null) return result;
    // null means the SQLite lookup itself errored — fall through to CSV
  }
  // --- CSV fallback (legacy path — active until SQLite is built) ---
  const csvPath = path.join(process.cwd(), "data", "df_rasp_gnomad_clinvar.csv");
  if (!fs.existsSync(csvPath)) {
    console.warn("[RaSP] Human proteome database is not ready yet. Skipping lookup.");
    return { score: null, reason: "Pre-computed RaSP database unavailable" };
  }

  if (uniprotId.startsWith("_")) {
    return { score: null, reason: "Protein is not present in the pre-computed database" };
  }
  const index = loadRaspIndex(csvPath);
  const offset = index[uniprotId];
  if (offset === undefined) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[RaSP] Protein ${uniprotId} not found in human database.`);
    }
    return { score: null, reason: "Protein is not present in the pre-computed database" };
  }

  const wt1 = wt.length === 3 ? AMINO_ACID_3_TO_1[wt.toUpperCase()] || wt : wt;
  const mut1 = mut.length === 3 ? AMINO_ACID_3_TO_1[mut.toUpperCase()] || mut : mut;
  const targetVariant = `${wt1}${pos}${mut1}`;

  // Use the pre-sorted cached array (#5 fix — no per-lookup O(n log n) sort)
  const sortedOffsets = raspSortedOffsets ?? (
    Object.entries(index)
      .map(([uniprot, o]) => ({ uniprot, offset: o as number }))
      .sort((a, b) => a.offset - b.offset)
  );
  const currentIdx = binarySearchOffset(sortedOffsets, offset);
  const nextOffset = currentIdx !== -1 && currentIdx < sortedOffsets.length - 1
    ? sortedOffsets[currentIdx + 1].offset
    : null;

  let endOffset: number;
  if (nextOffset !== null) {
    endOffset = nextOffset;
  } else {
    try {
      const stat = fs.statSync(csvPath);
      endOffset = stat.size;
    } catch (_) {
      endOffset = offset + 1024 * 1024; // fallback 1MB
    }
  }
  const chunkSize = Math.max(0, endOffset - offset);
  if (chunkSize === 0) {
    return { score: null, reason: "Residue position is not present in the pre-computed database" };
  }

  return new Promise((resolve) => {
    const fd = getRaspFd(csvPath);
    if (fd === null || fd === undefined) {
      resolve({ score: null, reason: "Failed to open pre-computed database" });
      return;
    }

    const buffer = Buffer.alloc(chunkSize);
    fs.read(fd, buffer, 0, chunkSize, offset, (err, bytesRead) => {
      if (err) {
        console.error("[RaSP] Read error:", err);
        resolve({ score: null, reason: "Error reading database" });
        return;
      }

      const content = buffer.toString("utf8", 0, bytesRead);
      const lines = content.split(/\r?\n/);
      let foundScore: number | null = null;

      for (const line of lines) {
        const parts = line.split(",");
        if (parts[0] === uniprotId && parts[4] === targetVariant) {
          const score = parseFloat(parts[5]);
          if (!isNaN(score)) {
            foundScore = score;
            break;
          }
        }
      }

      if (foundScore !== null) {
        resolve({ score: foundScore });
      } else {
        resolve({ score: null, reason: "Residue position is not present in the pre-computed database" });
      }
    });
  });
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
  apiKey?: string
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
      signal: AbortSignal.timeout(15000)
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

/**
 * energy-models.ts — Energy model integrations: DDGun (sequence-based) and RaSP (structural).
 *
 * Extracted from biophysics.ts. Contains:
 *   - ddgunCache + runDdgunSeq (DDGun online sequence-based ΔΔG)
 *   - raspCache + RaSP database helpers + runRaspLocal + initializeRaspDatabase + lookupPrecomputedRaspScore
 *
 * Depends on: os, path, fs, readline, stream, lru-cache, aminoAcids
 */
import os from "os";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import readline from "readline";
import { LRUCache } from "lru-cache";
import { AMINO_ACID_3_TO_1 } from "../../src/aminoAcids.ts";
import * as self from "./energy-models.ts";

// ---------------------------------------------------------------------------
// RaSP (Rapid Stability Prediction — precomputed human proteome lookup)
// ---------------------------------------------------------------------------

const raspCache = new LRUCache<string, { score: number | null; reason?: string }>({ max: 200 });

async function createRaspIndex(csvPath: string): Promise<void> {
  const indexPath = csvPath.replace(".csv", ".index.json");
  const index: Record<string, number> = {};
  
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({ input: stream });
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
      byteOffset += Buffer.byteLength(line) + 1; // +1 for the newline character
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
  // @ts-ignore
  await finished(Readable.fromWeb(response.body).pipe(fileStream));
  console.log("[RaSP] Download complete. Creating byte-offset index...");
  await createRaspIndex(csvPath);
}

let raspIndex: Record<string, number> | null = null;

function loadRaspIndex(csvPath: string): Record<string, number> {
  if (raspIndex) return raspIndex;
  const indexPath = csvPath.replace(".csv", ".index.json");
  if (fs.existsSync(indexPath)) {
    try {
      raspIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      return raspIndex!;
    } catch (err) {
      console.warn("[RaSP] Failed to parse index file, recreating...", err);
    }
  }
  return {};
}

export async function initializeRaspDatabase(): Promise<void> {
  const csvPath = path.join(process.cwd(), "data", "df_rasp_gnomad_clinvar.csv");
  if (!fs.existsSync(csvPath)) {
    console.log("[RaSP] Human proteome database not found locally. Triggering background download...");
    downloadRaspDatabase(csvPath).catch(err => {
      console.error("[RaSP Initialization Error] Failed to download precomputed RaSP database:", err.message);
    });
  } else {
    try {
      loadRaspIndex(csvPath);
    } catch (_) {}
  }
}

export async function lookupPrecomputedRaspScore(
  uniprotId: string,
  pos: number,
  wt: string,
  mut: string
): Promise<{ score: number | null; reason?: string }> {
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

  return new Promise((resolve) => {
    const stream = fs.createReadStream(csvPath, { start: offset });
    const rl = readline.createInterface({ input: stream });
    let foundScore: number | null = null;

    rl.on("line", (line) => {
      const parts = line.split(",");
      const currentUniprot = parts[0];
      if (currentUniprot !== uniprotId) {
        rl.close();
        return;
      }
      if (parts[4] === targetVariant) {
        const score = parseFloat(parts[5]);
        if (!isNaN(score)) {
          foundScore = score;
        }
        rl.close();
      }
    });

    rl.on("close", () => {
      stream.destroy();
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
    return { jobId: null, prediction: null, status: "error", error: "Tamarind Bio API key not configured" };
  }

  const cacheKey = `${mutation}_${pdbContent.slice(0, 100)}`;
  const cached = thermompnnCache.get(cacheKey);
  if (cached && cached.prediction !== null) {
    return { jobId: cached.jobId || "cached", prediction: cached.prediction, status: "done" };
  }

  try {
    const response = await fetch("https://app.tamarind.bio/api/submit-job", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": keyToUse
      },
      body: JSON.stringify({
        tool: "thermompnn",
        pdb: pdbContent,
        mutation
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return { jobId: null, prediction: null, status: "error", error: `Tamarind API HTTP ${response.status}: ${errText.slice(0, 100)}` };
    }

    const data: any = await response.json();
    const jobId = data.jobId || data.id || data.job_id || null;
    
    // Check if result returned synchronously
    const rawDdg = data.prediction ?? data.ddg ?? data.delta_delta_g ?? data.score ?? null;
    if (typeof rawDdg === "number") {
      // ThermoMPNN convention: negative = destabilizing (matching DynaMut2/DDMut/RaSP)
      thermompnnCache.set(cacheKey, { prediction: rawDdg, jobId, status: "done" });
      return { jobId, prediction: rawDdg, status: "done" };
    }

    if (jobId) {
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
    const response = await fetch(`https://app.tamarind.bio/api/job-status/${jobId}`, {
      headers: {
        "x-api-key": keyToUse
      }
    });

    if (!response.ok) {
      return { status: "error", prediction: null, error: `HTTP ${response.status}` };
    }

    const data: any = await response.json();
    const status = data.status === "DONE" || data.status === "completed" || data.status === "success" 
      ? "done" 
      : data.status === "ERROR" || data.status === "failed" 
        ? "error" 
        : "running";

    if (status === "done") {
      const rawDdg = data.prediction ?? data.ddg ?? data.delta_delta_g ?? data.score ?? data.result?.ddg ?? null;
      const prediction = typeof rawDdg === "number" ? rawDdg : null;
      return { status: "done", prediction };
    }

    if (status === "error") {
      return { status: "error", prediction: null, error: data.error || "ThermoMPNN job execution failed" };
    }

    return { status: "running", prediction: null };
  } catch (err: any) {
    return { status: "error", prediction: null, error: err.message };
  }
}

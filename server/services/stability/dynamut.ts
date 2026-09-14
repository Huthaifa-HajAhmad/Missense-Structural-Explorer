import https from "node:https";
import { fetchWithRetry, withHostLock } from "../infra/http-client.ts";

export type BioSigTool = "dynamut2" | "ddmut";

const BIOSIG_HEADERS: Record<string, string> = {
  "User-Agent": "MissenseStructuralExplorer/1.0 (Bioinformatics Research; +https://github.com)",
  "Accept": "application/json"
};

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB max response size

/**
 * Executes an HTTP GET request with a form body using native node:https.
 * Required because BioSig DDMut Flask route reads request.form['job_id'] on GET,
 * whereas standard WHATWG fetch forbids bodies on GET requests.
 */
export function httpGetWithBody(
  urlStr: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = 15000
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    let isSettled = false;
    const url = new URL(urlStr);
    const postData = body;

    const safeReject = (err: Error) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(deadlineTimer);
      reject(err);
    };

    const safeResolve = (val: { status: number; text: string }) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(deadlineTimer);
      resolve(val);
    };

    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData)
        },
        timeout: timeoutMs
      },
      (res) => {
        res.setEncoding("utf8");
        let data = "";
        let byteCount = 0;

        res.on("data", (chunk: string) => {
          byteCount += Buffer.byteLength(chunk);
          if (byteCount > MAX_PAYLOAD_BYTES) {
            req.destroy();
            safeReject(new Error("BioSig response exceeded maximum allowed payload size (5MB)"));
            return;
          }
          data += chunk;
        });

        res.on("error", (err) => {
          req.destroy();
          safeReject(err);
        });

        res.on("end", () => {
          safeResolve({ status: res.statusCode || 200, text: data });
        });
      }
    );

    // Hard overall deadline timer
    const deadlineTimer = setTimeout(() => {
      req.destroy();
      safeReject(new Error(`BioSig request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    req.on("timeout", () => {
      req.destroy();
      safeReject(new Error(`BioSig socket timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => {
      safeReject(err);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Crops a PDB coordinate stream to a localized contiguous window of residues
 * centered around targetPos on the specified chain, preserving original residue numbering.
 * Used for BioSig API (DynaMut2/DDMut) when whole protein exceeds 1500 residues.
 */
export function cropPdbWindowAroundMutation(
  pdbText: string,
  chain: string,
  targetPos: number,
  windowSize = 750
): string {
  const lines = pdbText.split(/\r?\n/);
  const targetChainUpper = (chain?.trim() || "A").toUpperCase();
  const halfWindow = Math.floor(windowSize / 2);
  const minRes = targetPos - halfWindow;
  const maxRes = targetPos + halfWindow;

  const croppedLines: string[] = [];
  let foundTarget = false;

  for (const line of lines) {
    if (line.startsWith("ATOM  ") || line.startsWith("HETATM")) {
      const lineChain = (line[21]?.trim() || "A").toUpperCase();
      const resSeqStr = line.slice(22, 26).trim();
      const resSeq = parseInt(resSeqStr, 10);

      if (!isNaN(resSeq)) {
        if (lineChain === targetChainUpper && resSeq === targetPos) {
          foundTarget = true;
        }
        if (lineChain === targetChainUpper && resSeq >= minRes && resSeq <= maxRes) {
          croppedLines.push(line);
        }
      }
    } else if (line.startsWith("CRYST1") || line.startsWith("HEADER") || line.startsWith("TITLE") || line.startsWith("SCALE")) {
      croppedLines.push(line);
    }
  }

  if (!foundTarget || croppedLines.length === 0) {
    return pdbText; // Return original if target residue not found in window
  }

  croppedLines.push("TER");
  croppedLines.push("END");
  return croppedLines.join("\n");
}

/**
 * Generic submission handler for BioSig single point mutation prediction jobs (DynaMut2 / DDMut).
 */
export async function submitBioSigJob(
  tool: BioSigTool,
  pdbText: string,
  chain: string,
  pos: number,
  wtRes: string,
  mutRes: string,
  signal?: AbortSignal
): Promise<string | null> {
  const toolName = tool === "dynamut2" ? "DynaMut2" : "DDMut";
  const url = `https://biosig.lab.uq.edu.au/${tool}/api/prediction_single`;
  const mutationCode = `${wtRes}${pos}${mutRes}`; // e.g. R408W

  // Pre-flight check: Safeguard against extreme unphysical structures (>1500 residues)
  let effectivePdb = pdbText;
  let residueCount = (pdbText.match(/^ATOM\s+.*?CA\s+/gm) || []).length;

  if (residueCount > 1500) {
    console.log(`[${toolName} API] Structure contains ${residueCount} residues (>1500 limit). Windowing contiguous 750-residue region around pos ${pos}...`);
    effectivePdb = cropPdbWindowAroundMutation(pdbText, chain, pos, 750);
    residueCount = (effectivePdb.match(/^ATOM\s+.*?CA\s+/gm) || []).length;
    console.log(`[${toolName} API] Cropped structure prepared: ${residueCount} residues for remote submission.`);
    if (residueCount > 1500) {
      console.warn(`[${toolName} API] Cropped structure still exceeds 1500 residues (${residueCount}). Skipping remote BioSig submission.`);
      return null;
    }
  }

  console.log(`[${toolName} API] Preparing to submit single mutation job for ${mutationCode} on chain ${chain}...`);

  try {
    const formData = new FormData();
    formData.append("mutation", mutationCode);
    formData.append("chain", chain || "A");
    formData.append("pdb_file", new Blob([effectivePdb], { type: "text/plain" }), "wt.pdb");

    const response = await fetchWithRetry(url, {
      method: "POST",
      body: formData,
      headers: BIOSIG_HEADERS,
      timeout: 30000,
      signal
    });

    if (!response.ok) {
      const bodyText = typeof response.text === "function" ? await response.text().catch(() => "") : "";
      console.warn(`[${toolName} API] Submission rejected (HTTP ${response.status}):`, String(bodyText).slice(0, 150));
      return null;
    }

    let data: any = null;
    if (typeof response.text === "function") {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        console.warn(`[${toolName} API] Upstream returned non-JSON body:`, text.slice(0, 150));
        return null;
      }
    } else if (typeof (response as any).json === "function") {
      data = await (response as any).json();
    }

    const jobId = data?.job_id;
    if (!jobId) {
      console.warn(`[${toolName} API] Response missing job_id:`, data);
      return null;
    }
    console.log(`[${toolName} API] Job submitted successfully. Job ID: ${jobId}`);
    return String(jobId);
  } catch (err: any) {
    console.warn(`[${toolName} API] Error during submission (service unavailable):`, err.message);
    return null;
  }
}

/**
 * Generic polling handler for BioSig single point mutation prediction jobs (DynaMut2 / DDMut).
 */
export async function pollBioSigJob(
  tool: BioSigTool,
  jobId: string
): Promise<{ status: "RUNNING" | "DONE" | "ERROR"; prediction: number | null } | null> {
  const toolName = tool === "dynamut2" ? "DynaMut2" : "DDMut";
  const url = `https://biosig.lab.uq.edu.au/${tool}/api/prediction_single`;
  try {
    let statusCode = 200;
    let rawText = "";

    if (tool === "ddmut") {
      // BioSig DDMut Flask route strictly inspects request.form['job_id'].
      // Passing ?job_id=... as query param triggers an unhandled KeyError / 500 error in BioSig.
      // Since WHATWG fetch forbids bodies on GET requests, we use native https.request via httpGetWithBody,
      // wrapped in withHostLock to enforce per-host semaphore (concurrency) and circuit breaker protection.
      const urlObj = new URL(url);
      const res = await withHostLock(urlObj.hostname, () =>
        httpGetWithBody(
          url,
          `job_id=${encodeURIComponent(jobId)}`,
          BIOSIG_HEADERS,
          15000
        )
      );
      statusCode = res.status;
      rawText = res.text;
    } else {
      const pollUrl = `${url}?job_id=${encodeURIComponent(jobId)}`;
      const pollRes = await fetchWithRetry(pollUrl, {
        method: "GET",
        headers: BIOSIG_HEADERS,
        timeout: 10000
      });
      statusCode = pollRes.status;
      rawText = typeof pollRes.text === "function" ? await pollRes.text() : JSON.stringify(await (pollRes as any).json());
    }

    if (statusCode < 200 || statusCode >= 300) {
      console.warn(`[${toolName} API] Polling request failed for job ${jobId} (status: ${statusCode})`);
      if (statusCode === 429) {
        const rateLimitErr = new Error(`${toolName} upstream rate limit reached`);
        (rateLimitErr as any).statusCode = 429;
        throw rateLimitErr;
      }
      return { status: "ERROR", prediction: null };
    }

    let pollJson: any = null;
    try {
      pollJson = JSON.parse(rawText);
    } catch {
      console.warn(`[${toolName} API] Polling returned non-JSON payload:`, rawText.slice(0, 150));
      return { status: "ERROR", prediction: null };
    }

    if (pollJson.prediction !== undefined && pollJson.prediction !== null) {
      const ddG = parseFloat(pollJson.prediction);
      console.log(`[${toolName} API] Prediction completed for job ${jobId}: ${ddG} kcal/mol`);
      return { status: "DONE", prediction: isNaN(ddG) ? null : ddG };
    }

    // Check if explicitly running, queued, or missing prediction/error
    if (
      pollJson.status === "RUNNING" ||
      pollJson.message === "RUNNING" ||
      pollJson.status === "QUEUED" ||
      pollJson.message === "QUEUED" ||
      pollJson.status === "PENDING" ||
      (pollJson.prediction === undefined && !pollJson.error)
    ) {
      return { status: "RUNNING", prediction: null };
    }

    console.warn(`[${toolName} API] Polling returned error or unexpected format:`, pollJson);
    return { status: "ERROR", prediction: null };
  } catch (err: any) {
    console.warn(`[${toolName} API] Warning polling job ${jobId}:`, err.message);
    if (err.statusCode === 429) {
      throw err;
    }
    return { status: "ERROR", prediction: null };
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible named exports
// ---------------------------------------------------------------------------

export async function submitDynaMut2Job(
  pdbText: string,
  chain: string,
  pos: number,
  wtRes: string,
  mutRes: string,
  signal?: AbortSignal
): Promise<string | null> {
  return submitBioSigJob("dynamut2", pdbText, chain, pos, wtRes, mutRes, signal);
}

export async function pollDynaMut2Job(
  jobId: string
): Promise<{ status: "RUNNING" | "DONE" | "ERROR"; prediction: number | null } | null> {
  return pollBioSigJob("dynamut2", jobId);
}

export async function submitDdmutJob(
  pdbText: string,
  chain: string,
  pos: number,
  wtRes: string,
  mutRes: string,
  signal?: AbortSignal
): Promise<string | null> {
  return submitBioSigJob("ddmut", pdbText, chain, pos, wtRes, mutRes, signal);
}

export async function pollDdmutJob(
  jobId: string
): Promise<{ status: "RUNNING" | "DONE" | "ERROR"; prediction: number | null } | null> {
  return pollBioSigJob("ddmut", jobId);
}



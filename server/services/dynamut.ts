import { fetchWithRetry } from "./http-client.ts";

export type BioSigTool = "dynamut2" | "ddmut";

const BIOSIG_HEADERS: Record<string, string> = {
  "User-Agent": "MissenseStructuralExplorer/1.0 (Bioinformatics Research; +https://github.com)",
  "Accept": "application/json"
};

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
  const residueCount = (pdbText.match(/^ATOM\s+.*?CA\s+/gm) || []).length;
  if (residueCount > 1500) {
    console.log(`[${toolName} API] Structure contains ${residueCount} residues (>1500 safeguard limit). Skipping remote BioSig submission.`);
    return null;
  }

  console.log(`[${toolName} API] Preparing to submit single mutation job for ${mutationCode} on chain ${chain}...`);

  try {
    const formData = new FormData();
    formData.append("mutation", mutationCode);
    formData.append("chain", chain || "A");
    formData.append("pdb_file", new Blob([pdbText], { type: "text/plain" }), "wt.pdb");

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
    const pollUrl = `${url}?job_id=${jobId}`;
    const pollRes = await fetchWithRetry(pollUrl, {
      method: "GET",
      headers: BIOSIG_HEADERS,
      timeout: 10000
    });

    if (!pollRes.ok) {
      console.warn(`[${toolName} API] Polling request failed for job ${jobId} (status: ${pollRes.status})`);
      if (pollRes.status === 429) {
        const rateLimitErr = new Error(`${toolName} upstream rate limit reached`);
        (rateLimitErr as any).statusCode = 429;
        throw rateLimitErr;
      }
      return { status: "ERROR", prediction: null };
    }

    let pollJson: any = null;
    if (typeof pollRes.text === "function") {
      const text = await pollRes.text();
      try {
        pollJson = JSON.parse(text);
      } catch {
        console.warn(`[${toolName} API] Polling returned non-JSON payload:`, text.slice(0, 150));
        return { status: "ERROR", prediction: null };
      }
    } else if (typeof (pollRes as any).json === "function") {
      pollJson = await (pollRes as any).json();
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



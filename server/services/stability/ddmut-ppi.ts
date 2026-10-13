/**
 * server/services/stability/ddmut-ppi.ts — BioSig DDMut-PPI Interface Binding Affinity Service.
 *
 * Dedicated to computing Protein-Protein Interaction binding affinity shifts (ΔΔG_bind)
 * and residue-to-interface physical distances upon missense mutations in multimeric complexes.
 *
 * Adheres strictly to the Strict No-Heuristics Policy:
 * - Requires a genuine multimer structure (N >= 2 chains).
 * - Never fabricates synthetic binding scores if upstream is unreachable or warming up.
 */

import crypto from "node:crypto";
import { LRUCache } from "lru-cache";
import { fetchWithRetry, reportEgressAnswer, withHostLock } from "../infra/http-client.ts";
import { httpGetWithBody } from "./dynamut.ts";

/**
 * One DDMut-PPI prediction. `ddgBind` is in DDMut-PPI's own sign convention: ΔΔG ≤ 0 is REDUCED
 * binding affinity (Zhou et al., Nucleic Acids Res 2024;52:W207, doi:10.1093/nar/gkae412). No class is
 * attached: the authors publish no cut-points, and the 1.0 / 0.5 classes this module used to assign
 * were read with the opposite sign.
 */
export interface DdmutPpiResult {
  ddgBind: number;
  distanceToInterface: number | null;
  provenance: string;
  resultsPage?: string;
}

/** How one evaluation ended: a value, a job still running upstream (kept for the next call), or a failure. */
export type DdmutPpiOutcome =
  | { status: "done"; result: DdmutPpiResult }
  | { status: "running" }
  | { status: "failed"; reason: string };

const BIOSIG_PPI_HEADERS: Record<string, string> = {
  "User-Agent": "MissenseStructuralExplorer/1.0 (Bioinformatics Research; +https://github.com)",
  "Accept": "application/json"
};

// In-memory LRU cache: 200 entries, 24-hour TTL
const ppiResultCache = new LRUCache<string, DdmutPpiResult>({
  max: 200,
  ttl: 24 * 60 * 60 * 1000
});

// Pending jobs LRU cache to resume polling across budget timeouts: 200 entries, 15-minute TTL
const pendingPpiJobs = new LRUCache<string, { jobId: string; submittedAt: number }>({
  max: 200,
  ttl: 15 * 60 * 1000
});

// In-flight deduplication to avoid double-submitting the same complex mutation
const inFlightPpiRequests = new Map<string, Promise<DdmutPpiOutcome>>();

/**
 * Resets all in-memory caches and in-flight tracking (useful for test isolation).
 */
export function clearDdmutPpiCache(): void {
  ppiResultCache.clear();
  pendingPpiJobs.clear();
  inFlightPpiRequests.clear();
}

/**
 * Extracts distinct chain identifiers from ATOM/HETATM records in a PDB file.
 */
export function getUniqueChainsFromPdb(pdbText: string): string[] {
  const chains = new Set<string>();
  const lines = pdbText.split("\n");
  for (const line of lines) {
    if (line.startsWith("ATOM  ") || line.startsWith("HETATM")) {
      if (line.length >= 22) {
        const c = line[21].trim();
        if (c) chains.add(c);
      }
    }
  }
  return Array.from(chains);
}

/**
 * Submits a multi-chain complex to DDMut-PPI.
 */
export async function submitDdmutPpiJob(
  pdbText: string,
  chain: string,
  mutationCode: string,
  signal?: AbortSignal
): Promise<string | null> {
  const chains = getUniqueChainsFromPdb(pdbText);
  if (chains.length < 2) {
    console.warn(`[DDMut-PPI API] Structure contains only ${chains.length} chain(s). DDMut-PPI strictly requires >= 2 chains.`);
    return null;
  }

  const url = "https://biosig.lab.uq.edu.au/ddmut_ppi/api/single";
  try {
    const formData = new FormData();
    formData.append("pdb_file", new Blob([pdbText], { type: "text/plain" }), "wt_complex.pdb");
    formData.append("chain", chain || (chains[0] ?? "A"));
    formData.append("mutation", mutationCode);

    const response = await fetchWithRetry(url, {
      method: "POST",
      body: formData,
      headers: BIOSIG_PPI_HEADERS,
      timeout: 30000,
      signal
    });

    if (!response.ok) {
      const errText = typeof response.text === "function" ? await response.text().catch(() => "") : "";
      console.warn(`[DDMut-PPI API] Submission rejected (HTTP ${response.status}):`, String(errText).slice(0, 150));
      return null;
    }

    let data: any = null;
    if (typeof response.text === "function") {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        console.warn(`[DDMut-PPI API] Upstream returned non-JSON body:`, text.slice(0, 150));
        return null;
      }
    } else if (typeof (response as any).json === "function") {
      data = await (response as any).json();
    }

    if (data?.error) {
      console.warn(`[DDMut-PPI API] Upstream rejected submission:`, data.error);
      return null;
    }

    const jobId = data?.job_id;
    if (!jobId) {
      console.warn(`[DDMut-PPI API] Response missing job_id:`, data);
      return null;
    }

    console.log(`[DDMut-PPI API] Job submitted successfully. Job ID: ${jobId}`);
    return String(jobId);
  } catch (err: any) {
    console.warn(`[DDMut-PPI API] Error during submission:`, err.message);
    return null;
  }
}

/**
 * Polls DDMut-PPI for completion.
 */
export async function pollDdmutPpiJob(
  jobId: string,
  timeoutMs = 15000
): Promise<{ status: "RUNNING" | "DONE" | "ERROR"; ddgBind: number | null; distanceToInterface: number | null; resultsPage?: string } | null> {
  const url = "https://biosig.lab.uq.edu.au/ddmut_ppi/api/single";
  try {
    const urlObj = new URL(url);
    const res = await withHostLock(urlObj.hostname, () =>
      httpGetWithBody(
        url,
        `job_id=${encodeURIComponent(jobId)}`,
        BIOSIG_PPI_HEADERS,
        timeoutMs
      )
    );

    reportEgressAnswer(urlObj.hostname, res.status, res.retryAfter ?? null);

    if (res.status < 200 || res.status >= 300) {
      console.warn(`[DDMut-PPI API] Polling failed for job ${jobId} (status: ${res.status})`);
      return { status: "ERROR", ddgBind: null, distanceToInterface: null };
    }

    let pollJson: any = null;
    try {
      pollJson = JSON.parse(res.text);
    } catch {
      console.warn(`[DDMut-PPI API] Non-JSON polling response for job ${jobId}`);
      return { status: "ERROR", ddgBind: null, distanceToInterface: null };
    }

    // Check for explicit upstream failure status
    if (
      pollJson.status === "ERROR" ||
      pollJson.status === "FAILED" ||
      pollJson.status === "FAILURE" ||
      pollJson.message === "ERROR" ||
      pollJson.error
    ) {
      console.warn(`[DDMut-PPI API] Polling returned error for job ${jobId}:`, pollJson);
      return { status: "ERROR", ddgBind: null, distanceToInterface: null };
    }

    if (pollJson.status === "DONE" || (pollJson.prediction !== undefined && pollJson.prediction !== null)) {
      const ddg = typeof pollJson.prediction === "number" ? pollJson.prediction : parseFloat(pollJson.prediction);
      const rawDist = pollJson.distance_to_interface !== undefined ? parseFloat(pollJson.distance_to_interface) : null;
      const dist = rawDist !== null && Number.isFinite(rawDist) ? rawDist : null;
      console.log(`[DDMut-PPI API] Calculation complete for job ${jobId}: ΔΔG_bind = ${ddg} kcal/mol, dist = ${dist} Å`);
      return {
        status: "DONE",
        ddgBind: Number.isFinite(ddg) ? ddg : null,
        distanceToInterface: dist,
        resultsPage: pollJson.results_page
      };
    }

    if (pollJson.status === "RUNNING" || pollJson.message === "RUNNING") {
      return { status: "RUNNING", ddgBind: null, distanceToInterface: null };
    }

    return { status: "ERROR", ddgBind: null, distanceToInterface: null };
  } catch (err: any) {
    console.warn(`[DDMut-PPI API] Polling threw error for job ${jobId}:`, err.message);
    return { status: "ERROR", ddgBind: null, distanceToInterface: null };
  }
}

/**
 * Full end-to-end evaluation with caching and polling loop.
 *
 * `pdbText` must be the WILD-TYPE complex: DDMut-PPI applies `mutationCode` to it.
 */
export async function evaluateDdmutPpi(
  pdbText: string,
  chain: string,
  mutationCode: string,
  maxWaitMs = 25000,
  signal?: AbortSignal,
  pollIntervalMs = 4000
): Promise<DdmutPpiOutcome> {
  const hash = crypto.createHash("sha256").update(pdbText).digest("hex").slice(0, 16);
  const cacheKey = `ddmut_ppi:${hash}:${chain}:${mutationCode}`;

  const cached = ppiResultCache.get(cacheKey);
  if (cached) return { status: "done", result: cached };

  // Deduplicate in-flight requests
  const existingPromise = inFlightPpiRequests.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const evalPromise = (async (): Promise<DdmutPpiOutcome> => {
    try {
      let jobId = pendingPpiJobs.get(cacheKey)?.jobId;
      if (!jobId) {
        const submittedJobId = await submitDdmutPpiJob(pdbText, chain, mutationCode, signal);
        if (!submittedJobId) return { status: "failed", reason: "DDMut-PPI did not accept the job." };
        jobId = submittedJobId;
        pendingPpiJobs.set(cacheKey, { jobId, submittedAt: Date.now() });
      }

      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitMs) {
        if (signal?.aborted) return { status: "running" };

        await new Promise((r) => setTimeout(r, pollIntervalMs));
        if (signal?.aborted) return { status: "running" };

        const pollResult = await pollDdmutPpiJob(jobId);
        if (!pollResult) return { status: "failed", reason: "DDMut-PPI did not answer." };

        if (pollResult.status === "DONE") {
          pendingPpiJobs.delete(cacheKey);
          if (pollResult.ddgBind !== null) {
            const result: DdmutPpiResult = {
              ddgBind: pollResult.ddgBind,
              distanceToInterface: pollResult.distanceToInterface,
              provenance: "DDMut-PPI",
              resultsPage: pollResult.resultsPage
            };
            ppiResultCache.set(cacheKey, result);
            return { status: "done", result };
          }
          return { status: "failed", reason: "DDMut-PPI finished without a prediction." };
        }

        if (pollResult.status === "ERROR") {
          pendingPpiJobs.delete(cacheKey);
          return { status: "failed", reason: "DDMut-PPI reported an error for this job." };
        }
      }

      console.log(`[DDMut-PPI API] Job ${jobId} still running after ${maxWaitMs}ms budget. Retaining job ID to resume on subsequent call.`);
      return { status: "running" };
    } catch (err: any) {
      console.warn(`[DDMut-PPI API] Evaluation failed for ${mutationCode}:`, err.message);
      return { status: "failed", reason: "DDMut-PPI could not be reached." };
    } finally {
      inFlightPpiRequests.delete(cacheKey);
    }
  })();

  inFlightPpiRequests.set(cacheKey, evalPromise);
  return evalPromise;
}

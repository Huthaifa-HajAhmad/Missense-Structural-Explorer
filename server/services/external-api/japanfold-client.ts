/**
 * server/services/japanfold-client.ts — Unified API client for JapanFold sovereign drug discovery platform.
 *
 * Provides:
 * - ESMC: Zero-shot variant fitness, positional entropy, embedding shifts
 * - ESMFold-2: De novo 3D coordinate generation (up to 1,024 residues)
 * - SaProt: Structure-aware language modeling with 3Di token conditioning
 * - Boltz-2: quaternary complex modelling (submitted, then followed as a job)
 */

import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { CONFIG } from "../../config.ts";
import { anySignal } from "../../utils/signals.ts";
import { governedFetch } from "../infra/http-client.ts";
import { sharedFlight, type SharedFlights } from "../infra/shared-flight.ts";

export interface JapanFoldZeroShotResult {
  status: "success" | "failed";
  llr: number;
  wtProbability: number;
  mutProbability: number;
  mutRank?: number;
  positionalEntropy: number;
  embeddingShift: number;
  preferences?: Array<{ aa: string; prob: number }>;
  localShiftMap?: Array<{ position: number; residue: string; shift: number }>;
  conformationState?: string;
  klDivergence?: number;
  provenance: string;
}

export interface JapanFoldMultimerResult {
  status: "success" | "failed";
  complexPdb: string;
  ipTm: number | null;
  pTm: number | null;
  interfaceContacts: Array<{ resA: number; resB: number; distance: number }>;
  provenance: string;
}

const japanFoldCache = new LRUCache<string, any>({
  max: 500,
  maxSize: 50 * 1024 * 1024, // 50MB memory ceiling
  sizeCalculation: (val) => {
    if (typeof val === "string") return val.length;
    if (val && typeof val.complexPdb === "string") return val.complexPdb.length + 512;
    if (val && typeof val.pdbText === "string") return val.pdbText.length + 512;
    return 1024;
  },
  ttl: 1000 * 60 * 60 * 24 * 14 // 14 days
});

const PERMANENT_AUTH_STATUSES = new Set([401, 402, 403, 451]);
const AUTH_REFUSAL_TTL_MS = 10 * 60 * 1000;
const japanFoldAuthRefusedUntil = new Map<string, number>();

function authCircuitKey(): string {
  return `${CONFIG.services.japanfoldBaseUrl || ""}|${CONFIG.services.japanfoldApiKey || ""}`;
}

function isJapanFoldAuthBlocked(): boolean {
  const key = authCircuitKey();
  const until = japanFoldAuthRefusedUntil.get(key);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    japanFoldAuthRefusedUntil.delete(key);
    return false;
  }
  return true;
}

function recordJapanFoldStatus(status: number): void {
  if (PERMANENT_AUTH_STATUSES.has(status)) {
    japanFoldAuthRefusedUntil.set(authCircuitKey(), Date.now() + AUTH_REFUSAL_TTL_MS);
  }
}

export function clearJapanFoldCache(): void {
  japanFoldCache.clear();
  japanFoldFlights.clear();
  japanFoldAuthRefusedUntil.clear();
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (CONFIG.services.japanfoldApiKey) {
    headers["Authorization"] = `Bearer ${CONFIG.services.japanfoldApiKey}`;
    headers["X-API-Key"] = CONFIG.services.japanfoldApiKey;
  }
  return headers;
}

/** ESMC, ESMFold-2 and SaProt calls in flight, by cache key (what they compute, never who asked). */
const japanFoldFlights: SharedFlights<any> = new Map();

/**
 * One JapanFold call per cache key for every concurrent caller (WP-I2). A caller whose signal aborts
 * gets null, like any other failed call, while the shared call carries on and fills the cache.
 */
async function joinJapanFold<T>(key: string, run: () => Promise<T | null>, signal?: AbortSignal): Promise<T | null> {
  try {
    return await sharedFlight(japanFoldFlights, key, run, { signal });
  } catch {
    return null;
  }
}

/**
 * Tier-1: Query JapanFold ESMC for zero-shot variant fitness and latent embedding shifts.
 */
export async function queryEsmc(
  sequence: string,
  pos: number,
  wt: string,
  mut: string,
  signal?: AbortSignal
): Promise<JapanFoldZeroShotResult | null> {
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex").slice(0, 16);
  const cacheKey = `japanfold:esmc:${seqHash}:${pos}:${wt}:${mut}`;
  const cached = japanFoldCache.get(cacheKey);
  if (cached) return cached;
  if (isJapanFoldAuthBlocked()) return null;

  return joinJapanFold(cacheKey, async () => {
    if (isJapanFoldAuthBlocked()) return null;
    const timeoutMs = CONFIG.timeouts.japanfoldZeroShotMs || 3500;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    // Bounded by its own timeout, not by the caller's signal: the call is shared (see joinJapanFold).
    const effectiveSignal = timeoutSignal;

    try {
      const url = `${CONFIG.services.japanfoldBaseUrl}/v1/predictions`;
      const response = await governedFetch(url, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: "esmc",
          sequence,
          position: pos,
          wt: wt.toUpperCase(),
          mut: mut.toUpperCase()
        }),
        signal: effectiveSignal
      });

      if (!response.ok) {
        recordJapanFoldStatus(response.status);
        console.warn(`[JapanFold Client] ESMC query failed with HTTP ${response.status}`);
        return null;
      }

      const data = (await response.json()) as any;
      if (data && (Number.isFinite(data.llr) || Number.isFinite(data.score))) {
        const rawLlr = Number.isFinite(data.llr) ? data.llr : data.score;
        const result: JapanFoldZeroShotResult = {
          status: "success",
          llr: rawLlr,
          wtProbability: Number.isFinite(data.wtProbability) ? data.wtProbability : 0,
          mutProbability: Number.isFinite(data.mutProbability) ? data.mutProbability : 0,
          mutRank: Number.isFinite(data.mutRank) ? data.mutRank : undefined,
          positionalEntropy: Number.isFinite(data.positionalEntropy) ? data.positionalEntropy : 0,
          embeddingShift: Number.isFinite(data.embeddingShift) ? data.embeddingShift : 0,
          preferences: Array.isArray(data.preferences) ? data.preferences : [],
          localShiftMap: Array.isArray(data.localShiftMap) ? data.localShiftMap : [],
          provenance: "JapanFold ESMC (Tier 1)"
        };
        japanFoldCache.set(cacheKey, result);
        return result;
      }
    } catch (err: any) {
      console.warn(`[JapanFold Client] ESMC invocation error: ${err.message}`);
    }

    return null;
  }, signal);
}

/**
 * Tier-1: Query JapanFold ESMFold-2 for de novo 3D structure generation.
 */
export async function queryEsmfold2(
  sequence: string,
  signal?: AbortSignal
): Promise<string | null> {
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex").slice(0, 16);
  const cacheKey = `japanfold:esmfold2:${seqHash}`;
  const cached = japanFoldCache.get(cacheKey);
  if (cached) return cached;

  return joinJapanFold(cacheKey, async () => {
    const timeoutMs = CONFIG.timeouts.japanfoldFoldingMs || 60000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    // Bounded by its own timeout, not by the caller's signal: the call is shared (see joinJapanFold).
    const effectiveSignal = timeoutSignal;

    try {
      const url = `${CONFIG.services.japanfoldBaseUrl}/v1/predictions`;
      const response = await governedFetch(url, {
        // A fold holds its request open until the model answers; its own lane keeps short calls moving.
        lane: "compute",
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: "esmfold2-fast",
          sequence,
          params: {
            output_format: "pdb"
          }
        }),
        signal: effectiveSignal
      });

      if (response.status === 200) {
        const data = (await response.json()) as any;
        const pdb = data?.pdb || data?.structure || (typeof data === "string" && data.includes("ATOM") ? data : null);
        if (pdb) {
          japanFoldCache.set(cacheKey, pdb);
          return pdb;
        }
      } else if (response.status === 202) {
        const jobData = (await response.json()) as any;
        const jobId = jobData?.id;
        const resultsPath = jobData?.links?.results || (jobId ? `/v1/jobs/${jobId}/results` : null);
      
        if (resultsPath) {
          const resultsUrl = `${CONFIG.services.japanfoldBaseUrl}${resultsPath}`;
          const startTime = Date.now();
        
          while (Date.now() - startTime < timeoutMs && !effectiveSignal?.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 2500));
            if (effectiveSignal?.aborted) break;

            try {
              const pollRes = await governedFetch(resultsUrl, {
                headers: getAuthHeaders(),
                signal: effectiveSignal
              });
              if (!pollRes.ok) {
                if ([400, 401, 403, 404].includes(pollRes.status)) {
                  console.warn(`[JapanFold Client] Polling failed with non-transient HTTP ${pollRes.status}. Aborting.`);
                  break;
                }
              } else {
                const pollData = (await pollRes.json()) as any;
                if (pollData.ready || pollData.status === "completed" || pollData.status === "succeeded") {
                  const pdb = pollData?.pdb || pollData?.structure || (typeof pollData === "string" && pollData.includes("ATOM") ? pollData : null);
                  if (pdb) {
                    japanFoldCache.set(cacheKey, pdb);
                    return pdb;
                  }
                  break;
                } else if (pollData.status === "failed" || pollData.status === "error") {
                  console.warn(`[JapanFold Client] ESMFold-2 job failed: ${pollData.error || "Unknown error"}`);
                  break;
                }
              }
            } catch (pollErr: any) {
              console.warn(`[JapanFold Client] Polling error: ${pollErr.message}`);
            }
          }
        }
      } else {
        console.warn(`[JapanFold Client] ESMFold-2 query failed with HTTP ${response.status}`);
        return null;
      }
    } catch (err: any) {
      console.warn(`[JapanFold Client] ESMFold-2 invocation error: ${err.message}`);
    }

    return null;
  }, signal);
}

/**
 * Tier-1: Query JapanFold SaProt for structure-conditioned fitness and 3Di conformations.
 */
export async function querySaProt(
  sequence: string,
  pos: number,
  wt: string,
  mut: string,
  wtPdb?: string | null,
  signal?: AbortSignal
): Promise<JapanFoldZeroShotResult | null> {
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex").slice(0, 16);
  // The structure is part of the request, so it is part of the answer's identity (and of the shared call's).
  const pdbHash = wtPdb ? crypto.createHash("sha256").update(wtPdb).digest("hex").slice(0, 16) : "none";
  const cacheKey = `japanfold:saprot:${seqHash}:${pdbHash}:${pos}:${wt}:${mut}`;
  const cached = japanFoldCache.get(cacheKey);
  if (cached) return cached;
  if (isJapanFoldAuthBlocked()) return null;

  return joinJapanFold(cacheKey, async () => {
    if (isJapanFoldAuthBlocked()) return null;
    const timeoutMs = CONFIG.timeouts.japanfoldZeroShotMs || 3500;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    // Bounded by its own timeout, not by the caller's signal: the call is shared (see joinJapanFold).
    const effectiveSignal = timeoutSignal;

    try {
      const url = `${CONFIG.services.japanfoldBaseUrl}/v1/predictions`;
      const response = await governedFetch(url, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          model: "saprot",
          sequence,
          position: pos,
          wt: wt.toUpperCase(),
          mut: mut.toUpperCase(),
          wtPdb: wtPdb || null
        }),
        signal: effectiveSignal
      });

      if (!response.ok) {
        recordJapanFoldStatus(response.status);
        console.warn(`[JapanFold Client] SaProt query failed with HTTP ${response.status}`);
        return null;
      }

      const data = (await response.json()) as any;
      if (data && (Number.isFinite(data.llr) || Number.isFinite(data.score))) {
        const rawLlr = Number.isFinite(data.llr) ? data.llr : data.score;
        const result: JapanFoldZeroShotResult = {
          status: "success",
          llr: rawLlr,
          wtProbability: Number.isFinite(data.wtProbability) ? data.wtProbability : 0,
          mutProbability: Number.isFinite(data.mutProbability) ? data.mutProbability : 0,
          mutRank: Number.isFinite(data.mutRank) ? data.mutRank : undefined,
          positionalEntropy: Number.isFinite(data.positionalEntropy) ? data.positionalEntropy : 0,
          embeddingShift: Number.isFinite(data.embeddingShift) ? data.embeddingShift : 0,
          preferences: Array.isArray(data.preferences) ? data.preferences : [],
          localShiftMap: Array.isArray(data.localShiftMap) ? data.localShiftMap : [],
          conformationState: data.conformationState,
          klDivergence: Number.isFinite(data.klDivergence) ? data.klDivergence : undefined,
          provenance: "JapanFold SaProt (Tier 1)"
        };
        japanFoldCache.set(cacheKey, result);
        return result;
      }
    } catch (err: any) {
      console.warn(`[JapanFold Client] SaProt invocation error: ${err.message}`);
    }

    return null;
  }, signal);
}

/**
 * Boltz-2 complex prediction on JapanFold, submitted and then followed until it finishes.
 *
 * The earlier client made ONE blocking request and gave up after `japanfoldFoldingMs` (60 s, with a
 * 15 s fallback). A complex of two 1085-residue chains does not fold in a minute, so every large
 * assembly came back "Provider error", and a 202 job id was read as "no model". That is a false
 * negative made by the client, not by the model. Now:
 *   • a 202 (or a 200 carrying a job id) is followed by polling, the way ESMFold-2 is;
 *   • when this call's wait runs out the job is KEPT (`pendingBoltzJobs`) and reported "running":
 *     the next call resumes it instead of submitting again;
 *   • each failure keeps its kind (timeout, HTTP status, rejected input, network, job failed), so the
 *     screen can say "try again" for a transient fault and "why" for a rejection;
 *   • only a model is cached. A failure is never cached: caching a transient fault would turn it into
 *     a lasting false negative.
 * No size limit is imposed here: the service decides what it can fold, and says so (a 4xx is kept
 * as `rejected` with its status and message).
 */
export type Boltz2Outcome =
  | { status: "done"; result: JapanFoldMultimerResult }
  | { status: "running"; jobId: string }
  | { status: "failed"; failure: { kind: "timeout" | "http" | "rejected" | "network" | "no-model" | "job-failed"; httpStatus?: number | null; detail?: string | null } };

const BOLTZ_PROVENANCE = "Boltz-2 via JapanFold";

/** Jobs submitted and not yet finished, by chain hash: resumed by the next call. */
const pendingBoltzJobs = new LRUCache<string, { resultsUrl: string; jobId: string; submittedAt: number }>({
  max: 200,
  ttl: 6 * 60 * 60 * 1000,
});

export function clearBoltzJobs(): void {
  pendingBoltzJobs.clear();
  inflightBoltzSubmits.clear();
}

function readModel(data: any): JapanFoldMultimerResult | null {
  const pdb = typeof data?.complexPdb === "string" ? data.complexPdb : typeof data?.pdb === "string" ? data.pdb : typeof data?.structure === "string" ? data.structure : null;
  if (!pdb) return null;
  return {
    status: "success",
    complexPdb: pdb,
    ipTm: Number.isFinite(data.ipTm) ? data.ipTm : Number.isFinite(data.iptm) ? data.iptm : null,
    pTm: Number.isFinite(data.pTm) ? data.pTm : Number.isFinite(data.ptm) ? data.ptm : null,
    interfaceContacts: Array.isArray(data.interfaceContacts)
      ? data.interfaceContacts.filter((c: any) => c && Number.isFinite(c.resA) && Number.isFinite(c.resB) && Number.isFinite(c.distance))
      : [],
    provenance: BOLTZ_PROVENANCE,
  };
}

async function detailOf(res: Response): Promise<string | null> {
  try {
    const text = (await res.text()).trim();
    if (!text) return null;
    try {
      const j = JSON.parse(text);
      const msg = j?.detail ?? j?.error ?? j?.message;
      if (typeof msg === "string") return msg.slice(0, 240) || null;
      // A body with no message of its own ({}) says nothing; never print it as one.
      return msg ? JSON.stringify(msg).slice(0, 240) : null;
    } catch {
      return text.slice(0, 240);
    }
  } catch {
    return null;
  }
}

type BoltzSubmit = { kind: "outcome"; outcome: Boltz2Outcome } | { kind: "job"; job: { resultsUrl: string; jobId: string; submittedAt: number } };

/** Submissions in flight, by chain hash: see `runBoltz2Multimer`. */
const inflightBoltzSubmits = new Map<string, Promise<BoltzSubmit>>();

/**
 * Where a job's results may be fetched from. `links.results` comes from the service's own response and
 * is fetched with our auth headers, so only the configured JapanFold host is followed: a path, or an
 * absolute URL on that origin. Anything else is refused rather than sent our credentials.
 */
export function resolveResultsUrl(resultsPath: string, base = CONFIG.services.japanfoldBaseUrl): string | null {
  try {
    const baseUrl = new URL(base);
    const url = new URL(resultsPath, `${baseUrl.origin}/`);
    return url.origin === baseUrl.origin ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The submit step on its own. It does not take a caller's abort signal: it may be shared by several
 * callers, and one caller leaving must not cancel the others' submission. Its own timeout bounds it.
 */
async function submitBoltz2(
  chains: Array<{ chainId: string; sequence: string }>,
  chainHash: string,
  cacheKey: string,
  timeoutMs: number
): Promise<BoltzSubmit> {
  let response: Response;
  try {
    response = await governedFetch(`${CONFIG.services.japanfoldBaseUrl}/v1/predictions`, {
      lane: "compute", // the submit can hold its request open until the model answers
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ model: "boltz-2", chains }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    const failure = err?.name === "TimeoutError" || err?.name === "AbortError"
      ? { kind: "timeout" as const, detail: `No answer within ${Math.round(timeoutMs / 1000)} s of submitting.` }
      : { kind: "network" as const, detail: err?.message ?? null };
    return { kind: "outcome", outcome: { status: "failed", failure } };
  }
  if (!response.ok) {
    const detail = await detailOf(response);
    const rejected = response.status === 400 || response.status === 413 || response.status === 422;
    return { kind: "outcome", outcome: { status: "failed", failure: { kind: rejected ? "rejected" : "http", httpStatus: response.status, detail } } };
  }
  const data = (await response.json().catch(() => null)) as any;
  // A finished model is read whatever the 2xx code; a 202 carries a job, not coordinates.
  const model = readModel(data);
  if (model) {
    japanFoldCache.set(cacheKey, model);
    return { kind: "outcome", outcome: { status: "done", result: model } };
  }
  const jobId = data?.id ?? data?.jobId ?? data?.job_id;
  const resultsPath = data?.links?.results || (jobId ? `/v1/jobs/${jobId}/results` : null);
  if (!jobId || !resultsPath) {
    return { kind: "outcome", outcome: { status: "failed", failure: { kind: "no-model", httpStatus: response.status, detail: "The service answered without a model or a job to follow." } } };
  }
  const resultsUrl = resolveResultsUrl(String(resultsPath));
  if (!resultsUrl) {
    return { kind: "outcome", outcome: { status: "failed", failure: { kind: "no-model", httpStatus: response.status, detail: "The service named a results URL on another host; it was not followed." } } };
  }
  const job = { jobId: String(jobId), resultsUrl, submittedAt: Date.now() };
  pendingBoltzJobs.set(chainHash, job);
  return { kind: "job", job };
}

/**
 * Submit (or resume) a Boltz-2 complex prediction and wait up to `waitMs` for it.
 *
 * @param waitMs how long THIS call waits; the job itself is not cancelled when it runs out.
 */
export async function runBoltz2Multimer(
  chains: Array<{ chainId: string; sequence: string }>,
  signal?: AbortSignal,
  { waitMs = CONFIG.timeouts.japanfoldFoldingMs || 60000, pollMs = 5000 }: { waitMs?: number; pollMs?: number } = {}
): Promise<Boltz2Outcome> {
  const chainHash = crypto.createHash("sha256").update(JSON.stringify(chains)).digest("hex").slice(0, 16);
  const cacheKey = `japanfold:boltz2:${chainHash}`;
  const cached = japanFoldCache.get(cacheKey);
  if (cached) return { status: "done", result: cached };

  const started = Date.now();
  const outOfTime = () => Date.now() - started >= waitMs;
  let job = pendingBoltzJobs.get(chainHash) ?? null;

  if (!job) {
    // One submission per complex at a time: a second request for the same chains arriving while the
    // first is still being accepted joins it instead of submitting again (the job is only recorded
    // once the service answers, so without this both would submit).
    let submitting = inflightBoltzSubmits.get(chainHash);
    if (!submitting) {
      submitting = submitBoltz2(chains, chainHash, cacheKey, waitMs).finally(() => inflightBoltzSubmits.delete(chainHash));
      inflightBoltzSubmits.set(chainHash, submitting);
    }
    const submitted = await submitting;
    if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (submitted.kind === "outcome") return submitted.outcome;
    job = submitted.job;
  }

  // Follow the job until it finishes or this call's wait runs out.
  while (!outOfTime()) {
    if (signal?.aborted) return { status: "running", jobId: job.jobId };
    try {
      const res = await governedFetch(job.resultsUrl, { headers: getAuthHeaders(), signal: anySignal([signal, AbortSignal.timeout(15000)]) });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        const finished = data?.ready || data?.status === "completed" || data?.status === "succeeded" || data?.status === "success";
        if (finished) {
          pendingBoltzJobs.delete(chainHash);
          const model = readModel(data);
          if (model) {
            japanFoldCache.set(cacheKey, model);
            return { status: "done", result: model };
          }
          return { status: "failed", failure: { kind: "no-model", detail: "The job finished without a model." } };
        }
        if (data?.status === "failed" || data?.status === "error") {
          pendingBoltzJobs.delete(chainHash);
          const msg = data?.error ?? data?.detail ?? null;
          return { status: "failed", failure: { kind: "job-failed", detail: typeof msg === "string" ? msg.slice(0, 240) : null } };
        }
      } else if ([400, 401, 403, 404, 410].includes(res.status)) {
        pendingBoltzJobs.delete(chainHash);
        return { status: "failed", failure: { kind: "http", httpStatus: res.status, detail: await detailOf(res) } };
      }
      // Any other answer (5xx, a dropped poll) is transient: keep following the job.
    } catch (err: any) {
      if (signal?.aborted) return { status: "running", jobId: job.jobId };
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(0, waitMs - (Date.now() - started)))));
  }
  return { status: "running", jobId: job.jobId };
}

/** Rows-only accessor kept for callers that can act on a model or nothing. */
export async function queryBoltz2Multimer(
  chains: Array<{ chainId: string; sequence: string }>,
  signal?: AbortSignal
): Promise<JapanFoldMultimerResult | null> {
  const outcome = await runBoltz2Multimer(chains, signal);
  return outcome.status === "done" ? outcome.result : null;
}

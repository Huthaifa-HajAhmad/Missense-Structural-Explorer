import { CONFIG } from "../../config.ts";
/**
 * foldx-queue-job.ts — what a queued FoldX job does, around the FoldX run itself.
 *
 * A "FoldX job" in the queue is more than FoldX. Beside the FoldX core call (`generateMutantPdb`) the
 * worker runs two cheap local engines (RaSP, a table lookup; StabilityOracle, the sidecar) and then
 * enriches the result with every engine's value. Only the FoldX core is portable to a person's own
 * computer (plan section 3, fact 6), so this module splits the job at that seam:
 *
 *   startFoldxCompanions  RaSP + StabilityOracle, publishing into the job record as they land. Single-
 *                         flight per job, and each skips itself once `done`, so starting them again (a
 *                         job handed back from a computer to the server) costs nothing.
 *   finishFoldxQueueJob   publish the FoldX value early, wait for the companions, enrich.
 *   runFoldxQueueJobOnServer  the server worker: companions + FoldX here + finish. Behaviour is exactly
 *                         what `server.ts` did inline before the agent protocol (WP-F) needed the seam.
 *
 * When a paired computer runs the FoldX core, the server starts the companions at claim time and
 * finishes the job when the computer's validated result arrives (`services/infra/agent-jobs.ts`).
 */
import { BiophysicalJobQueue } from "../infra/biophysical-queue.ts";
import {
  enrichBiophysicalResult,
  generateMutantPdb,
  getRaspCoverage,
  RASP_STORE_UNAVAILABLE_REASON,
  runRaspLocal,
  runStabilityOracleAnalysisDetailed,
} from "../biophysics.ts";
import { STABILITY_ORACLE_BACKGROUND_BUDGET_MS } from "./stabilityoracle.ts";
import { requestBackgroundRepair } from "./foldx/background-repair.ts";
import { backfillMutantCacheCompanions } from "./foldx/cache.ts";
import { buildFoldxCacheKey } from "../infra/foldx-job-registry.ts";
import { fetchProtVarFoldx, protvarErrorFields, protvarJobFields } from "../external-api/protvar.ts";

export interface QueueMutation {
  wtAa: string;
  chain: string;
  position: number;
  mutAa: string;
}

/** `VA600E` / `V600E` as the worker reads it; empty fields when the code does not parse. */
export function parseQueueMutation(mutation: unknown): QueueMutation {
  const m = typeof mutation === "string" ? mutation.trim().match(/^([a-zA-Z])([a-zA-Z])?(\d+)([a-zA-Z])$/) : null;
  return {
    wtAa: m ? m[1].toUpperCase() : "",
    chain: m?.[2] ? m[2].toUpperCase() : "A",
    position: m ? parseInt(m[3], 10) : 0,
    mutAa: m ? m[4].toUpperCase() : "",
  };
}

async function publishRemoteJobs(jobId: string | undefined, updates: Record<string, unknown>): Promise<void> {
  if (!jobId) return;
  try {
    await BiophysicalJobQueue.getInstance().mutateJobData(jobId, (current) =>
      current ? { ...current, remoteJobs: { ...(current.remoteJobs || {}), ...updates } } : current,
    );
  } catch (err: any) {
    console.warn("[Queue Worker] Could not publish an engine update:", err?.message ?? err);
  }
}

const companionsInFlight = new Map<string, Promise<void>>();

/**
 * RaSP and StabilityOracle for one job, started once per job in this process. Both run beside FoldX so
 * neither inherits its multi-minute wait, and each publishes its value into the job record as it lands.
 */
export function startFoldxCompanions(jobId: string | undefined, data: any): Promise<void> {
  if (jobId) {
    const running = companionsInFlight.get(jobId);
    if (running) return running;
  }
  const run = runCompanions(jobId, data);
  if (jobId) {
    companionsInFlight.set(jobId, run);
    // `then` with both handlers, not `finally`: a `finally` promise fails again with `run`'s error, and
    // nothing would be listening to it.
    const forget = () => {
      if (companionsInFlight.get(jobId) === run) companionsInFlight.delete(jobId);
    };
    void run.then(forget, forget);
  }
  return run;
}

async function runCompanions(jobId: string | undefined, data: any): Promise<void> {
  const queue = BiophysicalJobQueue.getInstance();
  const { wtAa, chain, position, mutAa } = parseQueueMutation(data?.mutation);
  const previousRemoteJobs = (jobId ? (await queue.getJobData(jobId))?.remoteJobs : null) ?? data?.remoteJobs ?? {};

  /** RaSP is a bundled-table lookup. Run it beside RepairPDB so it can never inherit FoldX's multi-minute wait. */
  const rasp = (async () => {
    if (previousRemoteJobs.raspStatus === "done" || previousRemoteJobs.raspStatus === "unavailable") return;
    if (!data.uniprotId || !position || !wtAa || !mutAa) {
      // The lookup was never given what it needs. `done` asserted that the index had been
      // consulted and let the client call it "not covered" against an engine that never ran;
      // anything this deployment cannot execute here is `unavailable`, like the engines below.
      await publishRemoteJobs(jobId, { raspStatus: "unavailable", raspError: "No UniProt accession or variant fields for the RaSP lookup" });
      return;
    }
    await publishRemoteJobs(jobId, { raspStatus: "pending", raspError: null });
    try {
      const result = await runRaspLocal("", "", chain, position, wtAa, mutAa, data.uniprotId);
      const hasScore = typeof result?.score === "number";
      if (!hasScore && result?.reason === RASP_STORE_UNAVAILABLE_REASON) {
        /**
         * The index is unusable — a property of this deployment, not of the variant. A `done`
         * with no value left the classification to the reason text alone; `unavailable` plus
         * that reason renders as "not configured / operator can fix" instead of asserting a
         * fact about the protein.
         */
        await publishRemoteJobs(jobId, {
          raspVal: null,
          // The reason stays: the client sorts a store-fault sentence under "not configured"
          // (`classifyRaspMissReason`) and relies on it to distinguish that from a coverage miss.
          raspReason: RASP_STORE_UNAVAILABLE_REASON,
          raspSource: undefined,
          raspCoverage: getRaspCoverage() ?? undefined,
          raspError: RASP_STORE_UNAVAILABLE_REASON,
          raspStatus: "unavailable",
        });
        return;
      }
      await publishRemoteJobs(jobId, {
        raspVal: hasScore ? result!.score : null,
        raspReason: hasScore ? undefined : (result?.reason ?? undefined),
        raspSource: result?.source,
        raspCoverage: getRaspCoverage() ?? undefined,
        raspError: null,
        raspStatus: "done",
      });
    } catch (err: any) {
      console.warn("[Queue Worker] Independent RaSP lookup failed:", err?.message ?? err);
      await publishRemoteJobs(jobId, { raspStatus: "error", raspError: err?.message ?? "RaSP lookup failed" });
    }
  })();

  /**
   * ProtVar's precomputed FoldX (EBI, on the AlphaFold model): a reference value, looked up beside
   * RaSP for the same reason — a remote table read must never wait behind the local FoldX run.
   */
  const protvar = (async () => {
    if (previousRemoteJobs.protvarStatus === "done" || previousRemoteJobs.protvarStatus === "unavailable") return;
    if (!data.uniprotId || !position || !wtAa || !mutAa) {
      // Same honesty rule as RaSP above: nothing was looked up, so this is not done.
      await publishRemoteJobs(jobId, { protvarStatus: "unavailable", protvarError: "No UniProt accession or variant fields for the ProtVar lookup" });
      return;
    }
    await publishRemoteJobs(jobId, { protvarStatus: "pending" });
    try {
      await publishRemoteJobs(jobId, protvarJobFields(await fetchProtVarFoldx(data.uniprotId, position, wtAa, mutAa)));
    } catch (err: any) {
      console.warn("[Queue Worker] ProtVar FoldX lookup failed:", err?.message ?? err);
      await publishRemoteJobs(jobId, protvarErrorFields(err));
    }
  })();

  /** StabilityOracle uses the input template, so it can run while FoldX repairs that template. */
  const stabilityOracle = (async () => {
    if (previousRemoteJobs.stabilityoracleStatus === "done") return;
    if (!data.wtPdb) {
      // The sidecar scores the wild-type structure itself; without a template every request is a
      // guaranteed rejection. Short-circuit so the sidecar log stays free of self-inflicted 400s.
      await publishRemoteJobs(jobId, { stabilityoracleStatus: "unavailable", stabilityoracleError: null });
      return;
    }
    await publishRemoteJobs(jobId, { stabilityoracleStatus: "pending", stabilityoracleError: null });
    try {
      // Sidecar unreachable and sidecar rejection are different outcomes (no sidecar here vs. a
      // live sidecar refusing this query), and the job record now keeps them apart.
      const outcome = await runStabilityOracleAnalysisDetailed(
        data.uniprotId || "UNKNOWN",
        `${wtAa}${position}${mutAa}`,
        data.uniprotId || "",
        "",
        data.wtPdb,
        chain,
        STABILITY_ORACLE_BACKGROUND_BUDGET_MS,
      );
      const hasScore = outcome.kind === "value" && Number.isFinite(outcome.result.ddG);
      await publishRemoteJobs(jobId, {
        stabilityoracleVal: hasScore ? outcome.result!.ddG : null,
        stabilityoracleStatus: hasScore ? "done" : outcome.kind === "error" ? "error" : "unavailable",
        stabilityoracleError: hasScore
          ? null
          : outcome.kind === "error"
            ? outcome.message
            : outcome.kind === "unavailable"
              ? null
              : "StabilityOracle did not return a score",
      });
    } catch (err: any) {
      console.warn("[Queue Worker] Independent StabilityOracle evaluation failed:", err?.message ?? err);
      await publishRemoteJobs(jobId, { stabilityoracleStatus: "error", stabilityoracleError: err?.message ?? "StabilityOracle failed" });
    }
  })();

  await Promise.all([rasp, protvar, stabilityOracle]);
}

/** The result a FoldX failure becomes, so the other engines' values still reach the reader. */
export function foldxFailureResult(err: { message?: string; foldxRepair?: { failed: boolean; skipped: boolean; skippedReason?: string } }): any {
  const message = err?.message ?? "FoldX failed";
  // The runner states what RepairPDB did. Only an error from elsewhere falls back to its wording, and
  // only the one phrase that says the repair failed (the runner's own messages mention RepairPDB always).
  const repair = err?.foldxRepair;
  const isPdbResidueMissing = /not found in the PDB structure|Mutation mismatch|Invalid mutation code/i.test(message);
  const isBinaryMissing = !isPdbResidueMissing && /FoldX binary not found|parameter files missing|cannot be executed|ENOENT/i.test(message);
  console.warn(`[Queue Worker] FoldX execution failed (${message}). Binary missing: ${isBinaryMissing}. PDB coordinate mismatch: ${isPdbResidueMissing}. Proceeding with independent biophysical predictors.`);
  return {
    pdb: null,
    ddG: null,
    status: isBinaryMissing ? "unavailable" : "failed",
    error: message,
    energetics: {
      foldxMean: null,
      foldxRepairFailed: !isBinaryMissing && !isPdbResidueMissing && (repair ? repair.failed : /RepairPDB previously failed/i.test(message)),
      ...(repair?.skipped ? { foldxRepairSkipped: true } : {}),
      ...(repair?.skippedReason ? { foldxRepairSkippedReason: repair.skippedReason } : {}),
      foldxBinaryMissing: isBinaryMissing,
      foldxError: message,
    },
  };
}

/**
 * Everything after the FoldX core: publish its value the moment it exists (the poll route shows it while
 * a companion is still finishing), wait for the companions, and return the enriched, immutable result.
 */
export async function finishFoldxQueueJob(
  jobId: string | undefined,
  data: any,
  foldxResult: any,
  companions: Promise<void>,
  /** The cache entry FoldX's value was stored under, when it was stored: the companions' values are kept with it. */
  cacheKey?: string
): Promise<any> {
  const queue = BiophysicalJobQueue.getInstance();
  const hasFoldxScore = typeof foldxResult?.energetics?.foldxMean === "number" || typeof foldxResult?.ddG === "number";
  const foldxStatus = hasFoldxScore ? "success" : foldxResult?.status === "unavailable" ? "unavailable" : "failed";
  const foldxUpdates = {
    ...(foldxResult?.energetics ?? {}),
    foldx: foldxResult?.energetics?.foldxMean ?? foldxResult?.ddG ?? null,
    foldxStatus,
  };
  if (jobId) {
    try {
      await queue.mutateJobData(jobId, (current) => (current ? { ...current, foldxUpdate: foldxUpdates } : current));
    } catch (err: any) {
      console.warn("[Queue Worker] Could not publish the FoldX result early:", err?.message ?? err);
    }
  }

  // The two local engines have already run alongside FoldX. Await their terminal states so the final
  // immutable result is complete, while the poll route exposes each value as soon as it lands.
  await companions;

  const latestJob = jobId ? await queue.getJobData(jobId) : null;
  const remoteJobs = latestJob?.remoteJobs || data.remoteJobs || {};
  const structureProvenance = latestJob?.structureProvenance || data.structureProvenance || {};
  const enriched = enrichBiophysicalResult(foldxResult, remoteJobs, structureProvenance, parseQueueMutation(data.mutation).position);
  if (cacheKey) {
    // A cache that cannot be written must not fail a finished job: the reader already has the result.
    await backfillMutantCacheCompanions(cacheKey, enriched).catch((err: any) => {
      console.warn("[Queue Worker] Could not keep the companion engines' values with the FoldX entry:", err?.message ?? err);
    });
  }
  return enriched;
}

/** The server's own FoldX queue job: companions and FoldX side by side, then the finish. */
export async function runFoldxQueueJobOnServer(data: any, signal: AbortSignal | undefined, jobId: string | undefined): Promise<any> {
  const companions = startFoldxCompanions(jobId, data);
  let foldxResult: any = null;
  try {
    /**
     * Phase reporting is what replaced the client's fabricated progress stepper.
     *
     * FoldX is the one engine measured in minutes (a 489-residue template: 205 s of repair,
     * 2 s of modelling), and the UI had no way to learn which half it was in — so it invented
     * a stage from elapsed time and claimed "Finalizing" for most of the wait. The worker
     * knows the truth; it writes it to the job record the client is already polling.
     */
    foldxResult = await generateMutantPdb(
      data.wtPdb,
      data.mutation,
      data.uniprotId,
      data.jobDir,
      signal,
      data.options,
      (phase) => BiophysicalJobQueue.getInstance().updateJobPhase(jobId!, phase),
    );
  } catch (err: any) {
    if (signal?.aborted) {
      companions.catch(() => {});
      throw err;
    }
    foldxResult = foldxFailureResult(err);
  }
  /**
   * This job went without a repaired template because RepairPDB cannot finish inside its cap on this
   * host. Repair it in idle time so the next variant on this structure does not pay for that again
   * (`foldx/background-repair.ts`: idle-only, yields to any job). Only admission is awaited; the repair itself never holds up this job.
   */
  if (foldxResult?.energetics?.foldxRepairSkipped && foldxResult.energetics.foldxRepairSkippedReason !== "cached-repair-rejected") {
    const request = await requestBackgroundRepair({
      wtPdb: data.wtPdb,
      options: data.options,
      label: `${data.uniprotId ?? "structure"} ${data.mutation ?? ""}`.trim()
    }).catch(() => null);
    // Unknown, disabled, ineligible and recently abandoned repairs must not cause client reruns.
    const active = request?.status === "scheduled" || request?.status === "cached" ||
      (request?.status === "already-known" && ["waiting", "running"].includes(request.reason));
    if (active) {
      const now = Date.now();
      foldxResult.energetics.foldxRepairRefresh = { after: now + 60_000, until: now + 6 * 60 * 60 * 1000 + CONFIG.timeouts.foldxBackgroundRepairMaxMs };
    } else {
      delete foldxResult.energetics.foldxRepairRefresh;
    }
  }
  // A job without a template or a mutation has no cache entry to keep the companions' values with.
  const cacheKey = data.wtPdb && data.mutation ? buildFoldxCacheKey(data.wtPdb, data.mutation, data.options) : undefined;
  return finishFoldxQueueJob(jobId, data, foldxResult, companions, cacheKey);
}

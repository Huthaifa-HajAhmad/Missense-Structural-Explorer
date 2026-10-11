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
import { enrichBiophysicalResult, generateMutantPdb, getRaspCoverage, runRaspLocal, runStabilityOracleAnalysis } from "../biophysics.ts";
import { fetchUniprotSequence } from "../uniprot.ts";

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
    void run.finally(() => {
      if (companionsInFlight.get(jobId) === run) companionsInFlight.delete(jobId);
    });
  }
  return run;
}

async function runCompanions(jobId: string | undefined, data: any): Promise<void> {
  const queue = BiophysicalJobQueue.getInstance();
  const { wtAa, chain, position, mutAa } = parseQueueMutation(data?.mutation);
  const previousRemoteJobs = (jobId ? (await queue.getJobData(jobId))?.remoteJobs : null) ?? data?.remoteJobs ?? {};

  /** RaSP is a bundled-table lookup. Run it beside RepairPDB so it can never inherit FoldX's multi-minute wait. */
  const rasp = (async () => {
    if (previousRemoteJobs.raspStatus === "done") return;
    if (!data.uniprotId || !position || !wtAa || !mutAa) {
      await publishRemoteJobs(jobId, { raspStatus: "done" });
      return;
    }
    await publishRemoteJobs(jobId, { raspStatus: "pending" });
    try {
      const result = await runRaspLocal("", "", chain, position, wtAa, mutAa, data.uniprotId);
      await publishRemoteJobs(jobId, {
        raspVal: result?.score ?? null,
        raspReason: result?.reason,
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

  /** StabilityOracle uses the input template, so it can run while FoldX repairs that template. */
  const stabilityOracle = (async () => {
    if (previousRemoteJobs.stabilityoracleStatus === "done") return;
    if (!data.wtPdb && !data.uniprotId) {
      await publishRemoteJobs(jobId, { stabilityoracleStatus: "done" });
      return;
    }
    await publishRemoteJobs(jobId, { stabilityoracleStatus: "pending", stabilityoracleError: null });
    try {
      const sequence = data.uniprotId ? await fetchUniprotSequence(data.uniprotId).catch(() => "") : "";
      const result = await runStabilityOracleAnalysis(
        data.uniprotId || "UNKNOWN",
        `${wtAa}${position}${mutAa}`,
        data.uniprotId || "",
        sequence,
        data.wtPdb,
      );
      await publishRemoteJobs(jobId, {
        stabilityoracleVal: result?.ddG ?? null,
        stabilityoracleStatus: "done",
        stabilityoracleError: null,
      });
    } catch (err: any) {
      console.warn("[Queue Worker] Independent StabilityOracle evaluation failed:", err?.message ?? err);
      await publishRemoteJobs(jobId, { stabilityoracleStatus: "error", stabilityoracleError: err?.message ?? "StabilityOracle failed" });
    }
  })();

  await Promise.all([rasp, stabilityOracle]);
}

/** The result a FoldX failure becomes, so the other engines' values still reach the reader. */
export function foldxFailureResult(err: { message?: string }): any {
  const message = err?.message ?? "FoldX failed";
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
      foldxRepairFailed: !isBinaryMissing && !isPdbResidueMissing && /repair/i.test(message),
      foldxBinaryMissing: isBinaryMissing,
      foldxError: message,
    },
  };
}

/**
 * Everything after the FoldX core: publish its value the moment it exists (the poll route shows it while
 * a companion is still finishing), wait for the companions, and return the enriched, immutable result.
 */
export async function finishFoldxQueueJob(jobId: string | undefined, data: any, foldxResult: any, companions: Promise<void>): Promise<any> {
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
  return enrichBiophysicalResult(foldxResult, remoteJobs, structureProvenance, parseQueueMutation(data.mutation).position);
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
    foldxResult = foldxFailureResult(err);
  }
  return finishFoldxQueueJob(jobId, data, foldxResult, companions);
}

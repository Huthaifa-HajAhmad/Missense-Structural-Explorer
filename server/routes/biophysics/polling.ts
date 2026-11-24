import { type Router } from "express";
import crypto from "crypto";
import fs from "fs";
import { z } from "zod";

import {
  sendError,
  formatZodError,
  onClientDisconnect,
} from "../../utils.ts";
import {
  parseResiduesFromPdbMaybeAsync,
  cleanPdbForFoldX,
  submitThermoMpnnJob,
  enrichBiophysicalResult,
} from "../../services/biophysics.ts";
import { BiophysicalJobQueue } from "../../services/biophysical-queue.ts";
// NOTE: the consensus is deliberately NOT computed in this file. Its one authoritative computation
// is `enrichBiophysicalResult`, which sees all counted engines.
import { requireUser, noStore } from "../../auth/middleware.ts";
import { submitterId } from "../../auth/principal.ts";
import { withProvenanceFor } from "../../../src/shared/computeProvenance.ts";
import { LEGACY_OWNER } from "../../services/infra/queue-owners.ts";
import { AMINO_ACID_1_TO_3, AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";

/** FoldX and independent engine values that are safe to publish before the overall job settles. */
function engineUpdatesFromJob(jobData: any, remoteJobs: any): Record<string, unknown> | undefined {
  const updates: Record<string, unknown> = {
    ...(jobData?.structureProvenance ? { structureProvenance: jobData.structureProvenance } : {}),
    ...(jobData?.foldxUpdate ?? {}),
  };

  if (remoteJobs?.raspStatus != null || remoteJobs?.raspVal !== undefined) {
    updates.rasp = typeof remoteJobs.raspVal === "number" ? remoteJobs.raspVal : null;
    if (remoteJobs.raspStatus != null) updates.raspStatus = remoteJobs.raspStatus;
    if (typeof remoteJobs.raspReason === "string") updates.raspReason = remoteJobs.raspReason;
    if (remoteJobs.raspSource === "experimental" || remoteJobs.raspSource === "alphafold") updates.raspSource = remoteJobs.raspSource;
    if (remoteJobs.raspCoverage) updates.raspCoverage = remoteJobs.raspCoverage;
    if (remoteJobs.raspError !== undefined) updates.raspError = remoteJobs.raspError;
  }

  if (remoteJobs?.protvarStatus != null || remoteJobs?.protvarVal !== undefined) {
    updates.protvar = typeof remoteJobs.protvarVal === "number" ? remoteJobs.protvarVal : null;
    if (remoteJobs.protvarStatus != null) updates.protvarStatus = remoteJobs.protvarStatus;
    for (const field of ["protvarPlddt", "protvarModel", "protvarReason", "protvarError"] as const) {
      if (remoteJobs[field] !== undefined) updates[field] = remoteJobs[field];
    }
  }

  if (remoteJobs?.stabilityoracleStatus != null || remoteJobs?.stabilityoracleVal !== undefined) {
    updates.stabilityoracle = typeof remoteJobs.stabilityoracleVal === "number" ? remoteJobs.stabilityoracleVal : null;
    if (remoteJobs.stabilityoracleStatus != null) updates.stabilityoracleStatus = remoteJobs.stabilityoracleStatus;
    if (remoteJobs.stabilityoracleError !== undefined) updates.stabilityoracleError = remoteJobs.stabilityoracleError;
  }

  if (remoteJobs?.thermompnnStatus != null || remoteJobs?.thermompnnVal !== undefined) {
    updates.thermompnn = typeof remoteJobs.thermompnnVal === "number" ? remoteJobs.thermompnnVal : null;
  }

  return Object.keys(updates).length ? updates : undefined;
}

function parseMutationParam(mutation: string): { wtLetter: string; mutLetter: string; posNum: number; chainParam: string } | null {
  if (!mutation || typeof mutation !== "string" || mutation.length > 50) return null;
  const clean = mutation.replace(/^p\./i, "").trim();

  // 1. FoldX 4-part format: e.g. RA408W (WT=R, Chain=A, Pos=408, Mut=W)
  const foldxMatch = clean.match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$/);
  if (foldxMatch) {
    return {
      wtLetter: foldxMatch[1].toUpperCase(),
      chainParam: foldxMatch[2].toUpperCase(),
      posNum: parseInt(foldxMatch[3], 10),
      mutLetter: foldxMatch[4].toUpperCase()
    };
  }

  // 2. Standard 1-letter missense: e.g. R408W (WT=R, Pos=408, Mut=W)
  const standard1Match = clean.match(/^([a-zA-Z])(\d+)([a-zA-Z])$/);
  if (standard1Match) {
    return {
      wtLetter: standard1Match[1].toUpperCase(),
      chainParam: "",
      posNum: parseInt(standard1Match[2], 10),
      mutLetter: standard1Match[3].toUpperCase()
    };
  }

  // 3. 3-letter HGVS format: e.g. Arg408Trp
  const standard3Match = clean.match(/^([a-zA-Z]{3})(\d+)([a-zA-Z]{3})$/);
  if (standard3Match) {
    const wtUpper = standard3Match[1].toUpperCase();
    const mutUpper = standard3Match[3].toUpperCase();
    const wt1 = AMINO_ACID_3_TO_1[wtUpper];
    const mut1 = AMINO_ACID_3_TO_1[mutUpper];
    if (wt1 && mut1) {
      return {
        wtLetter: wt1,
        chainParam: "",
        posNum: parseInt(standard3Match[2], 10),
        mutLetter: mut1
      };
    }
  }

  return null;
}

const biophysicsSubmitSchema = z.object({
  wtPdb: z.string().optional(),
  pdbRef: z.string().optional(),
  uniprotId: z.string().max(50).optional(),
  mutation: z.string().min(1).max(50)
}).refine(data => !!(data.wtPdb || data.pdbRef || data.uniprotId), {
  message: "Either wtPdb, pdbRef, or uniprotId must be provided."
});

const thermompnnSubmitSchema = biophysicsSubmitSchema;

async function resolvePdbTextFromParam(body: { wtPdb?: string; pdbRef?: string; uniprotId?: string }): Promise<string | null> {
  if (body.wtPdb && body.wtPdb.trim().length > 0) {
    return body.wtPdb;
  }
  const ref = (body.pdbRef || body.uniprotId || "").trim();
  if (!ref) return null;

  const { pdbCache } = await import("../../services/cache.ts");
  if (pdbCache.has(ref)) {
    return pdbCache.get(ref) || null;
  }
  const { fetchAlphafoldPdb } = await import("../../services/external.ts");
  const fetched = await fetchAlphafoldPdb(ref);
  if (fetched) {
    pdbCache.set(ref, fetched);
    return fetched;
  }
  return null;
}

import { EventEmitter } from "events";

export const jobEventEmitter = new EventEmitter();
jobEventEmitter.setMaxListeners(250);

/** A subscription names the jobs it is waiting for; more than this is not a progress bar. */
const MAX_SSE_JOB_IDS = 50;
/** Open streams one address may hold, so idle sockets cannot exhaust file descriptors. */
const MAX_SSE_PER_CLIENT = 20;
const sseConnectionsByClient = new Map<string, number>();

export function broadcastJobUpdate(update: {
  jobId: string;
  tool: "foldx" | "p2rank";
  status: string;
  prediction?: number | null;
  result?: any;
  error?: string;
}) {
  jobEventEmitter.emit("job_update", update);
}

export function registerPollingRoutes(apiRouter: Router, jsonParserPdb: any): void {

  // Server-Sent Events (SSE) stream for biophysics job progress/completion (A1)
  apiRouter.get("/jobs/events", (req, res) => {
    // Validate before the stream starts: once headers are flushed, sendError drops its body and the
    // client is left holding an open 200 event-stream.
    const jobsParam = typeof req.query.jobs === "string" ? req.query.jobs : "";
    const requestedIds = jobsParam.split(",").map(s => s.trim()).filter(Boolean);
    if (requestedIds.length === 0) {
      return sendError(res, 400, "BAD_REQUEST", "Query parameter 'jobs' specifying one or more job IDs is required for SSE subscription.");
    }
    if (requestedIds.length > MAX_SSE_JOB_IDS || requestedIds.some(id => !/^[a-zA-Z0-9_\-]{1,100}$/.test(id))) {
      return sendError(res, 400, "BAD_REQUEST", `'jobs' takes at most ${MAX_SSE_JOB_IDS} job IDs, each made of letters, digits, '_' or '-'.`);
    }
    const subscribedJobIds = new Set(requestedIds);

    const clientKey = req.ip ?? "unknown";
    if ((sseConnectionsByClient.get(clientKey) ?? 0) >= MAX_SSE_PER_CLIENT) {
      return sendError(res, 429, "TOO_MANY_STREAMS", "Too many open job streams from this address.");
    }
    sseConnectionsByClient.set(clientKey, (sseConnectionsByClient.get(clientKey) ?? 0) + 1);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // Send initial connected handshake
    res.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);

    const listener = (update: any) => {
      if (subscribedJobIds.has(update.jobId) && !res.writableEnded && !res.destroyed) {
        res.write(`data: ${JSON.stringify({ type: "job_update", ...update })}\n\n`);
      }
    };

    jobEventEmitter.on("job_update", listener);

    const pingInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
      }
    }, 15000);

    // Clean up on client disconnect.
    // `req.on("close")` is wrong here: for a bodyless GET the request completes immediately, so
    // the listener and ping interval were torn down right after the handshake and the subscriber
    // never received a single job update. `res` 'close' fires when the stream actually goes away.
    onClientDisconnect(res, () => {
      clearInterval(pingInterval);
      jobEventEmitter.off("job_update", listener);
      const left = (sseConnectionsByClient.get(clientKey) ?? 1) - 1;
      if (left <= 0) sseConnectionsByClient.delete(clientKey);
      else sseConnectionsByClient.set(clientKey, left);
    });
  });

  /**
   * The signed-in person's own jobs: what they submitted or joined, with a queue place for the
   * waiting ones. Needs an account, because without one there is no "mine".
   */
  apiRouter.get("/my-jobs", requireUser, noStore, async (req, res) => {
    try {
      const userId = (req.principal as Extract<NonNullable<typeof req.principal>, { kind: "user" }>).userId;
      res.json({ jobs: await BiophysicalJobQueue.getInstance().listFor(userId) });
    } catch (err: any) {
      // The reader gets a fixed sentence: a SQLite failure's message can name a filesystem path on the
      // server, which is not the reader's business and is not actionable for them.
      console.error("[my-jobs] failed to list jobs:", err?.message ?? err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", "Could not list your jobs. Please try again.");
    }
  });

  /**
   * Cancel a job. The owner (or anyone who joined it) withdraws their own interest, and the job is
   * stopped only when nobody else is still waiting for it; an admin stops any job outright. Without
   * accounts (legacy mode) the shared-token caller may cancel jobs that have no owner.
   */
  apiRouter.post("/jobs/:jobId/cancel", noStore, async (req, res) => {
    const { jobId } = req.params;
    if (!jobId || !/^[a-zA-Z0-9_\-]{1,100}$/.test(jobId)) {
      return sendError(res, 400, "BAD_REQUEST", "Invalid job ID format.");
    }
    try {
      const queue = BiophysicalJobQueue.getInstance();
      const p = req.principal;
      let outcome;
      if (p?.kind === "user") {
        outcome = await queue.cancelFor(jobId, p.userId, p.user.role === "admin");
      } else {
        // Not an admin: the shared-token caller acts as LEGACY_OWNER, so it can withdraw from
        // legacy jobs but not stop SYSTEM_OWNER pre-warm jobs (only a signed-in admin can).
        const owner = await queue.getJobOwner(jobId);
        outcome = owner && owner !== LEGACY_OWNER
          ? ({ ok: false, reason: "forbidden" } as const)
          : await queue.cancelFor(jobId, LEGACY_OWNER, false);
      }
      if (!outcome.ok) {
        if (outcome.reason === "not_found") return sendError(res, 404, "NOT_FOUND", `Job ${jobId} not found.`);
        if (outcome.reason === "forbidden") return sendError(res, 403, "FORBIDDEN", "This job belongs to someone else.");
        return sendError(res, 409, "JOB_FINISHED", "This job has already finished.");
      }
      res.json({
        cancelled: outcome.aborted,
        stillRunningForOthers: !outcome.aborted,
        remainingWatchers: outcome.remainingWatchers,
      });
    } catch (err: any) {
      sendError(res, 500, "INTERNAL_SERVER_ERROR", `Could not cancel job: ${err.message}`);
    }
  });

  apiRouter.get("/foldx-job/:jobId", async (req, res) => {
    const { jobId } = req.params;
    if (!jobId || !/^[a-zA-Z0-9_\-]{1,100}$/.test(jobId)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid FoldX Job ID format.");
      return;
    }

    try {
      const queue = BiophysicalJobQueue.getInstance();
      const jobInfo = await queue.getJobStatus(jobId);

      if (!jobInfo) {
        sendError(res, 404, "NOT_FOUND", `FoldX job ${jobId} not found.`);
        return;
      }

      const jobData = await queue.getJobData(jobId);
      const remoteJobs = jobData?.remoteJobs || {
        thermompnnStatus: "pending",
        thermompnnError: null,
        thermompnnVal: null,
        stabilityoracleVal: null
      };

      if (jobInfo.status === "completed") {
        const mutation = jobInfo.result?.mutation || jobData?.mutation || "";
        const numMatch = mutation.match(/\d+/);
        const posNum = numMatch ? parseInt(numMatch[0], 10) : 0;
        const structureProvenance = jobInfo.result?.provenance || jobData?.structureProvenance || {};

        const enriched = enrichBiophysicalResult(jobInfo.result, remoteJobs, structureProvenance, posNum);

        // Anyone holding the job id can poll it: an owner's account id is shown only to that owner,
        // and never on the broadcast stream.
        broadcastJobUpdate({ jobId, tool: "foldx", status: "completed", result: withProvenanceFor(enriched, null) });

        return res.json({
          jobId,
          status: "completed",
          result: withProvenanceFor(enriched, submitterId(req)),
          runsOn: queue.runsOn(jobId, submitterId(req) ?? null),
          thermompnnStatus: remoteJobs.thermompnnStatus,
          thermompnnError: remoteJobs.thermompnnError
        });
      }

      if (jobInfo.status === "failed") {
        const mutation = jobInfo.result?.mutation || jobData?.mutation || "";
        const numMatch = mutation.match(/\d+/);
        const posNum = numMatch ? parseInt(numMatch[0], 10) : 0;
        const structureProvenance = jobInfo.result?.provenance || jobData?.structureProvenance || {};

        const enriched = jobInfo.result
          ? enrichBiophysicalResult(jobInfo.result, remoteJobs, structureProvenance, posNum)
          : enrichBiophysicalResult({ pdb: null, ddG: null, status: "failed", error: jobInfo.error }, remoteJobs, structureProvenance, posNum);

        broadcastJobUpdate({ jobId, tool: "foldx", status: "failed", error: jobInfo.error || "FoldX job failed during execution", result: withProvenanceFor(enriched, null) });
        return res.json({
          jobId,
          status: "failed",
          error: jobInfo.error || "FoldX job failed during execution",
          result: withProvenanceFor(enriched, submitterId(req)),
          runsOn: queue.runsOn(jobId, submitterId(req) ?? null),
          thermompnnStatus: remoteJobs.thermompnnStatus,
          thermompnnError: remoteJobs.thermompnnError
        });
      }

      return res.json({
        jobId,
        status: jobInfo.status,
        phase: jobInfo.status === "queued" ? "queued" : (jobData?.phase ?? null),
        startedAt: jobInfo.startedAt ?? null,
        elapsedMs: jobInfo.status === "running" && jobInfo.startedAt ? Math.max(0, Date.now() - jobInfo.startedAt) : null,
        createdAt: jobInfo.createdAt ?? null,
        queuedAhead: jobInfo.status === "queued" ? await queue.getQueuePosition(jobId) : 0,
        queuedEtaMs: jobInfo.status === "queued" ? ((await queue.getEta(jobId))?.waitMs ?? null) : null,
        // While the scheduler is held (too little memory), no start time is honest: say why instead.
        queueHold: jobInfo.status === "queued" ? queue.getHoldFor(jobId) : null,
        // Where it runs and why (live routing, WP-G2); null when it is simply the server's, as always.
        runsOn: queue.runsOn(jobId, submitterId(req) ?? null),
        thermompnnStatus: remoteJobs.thermompnnStatus,
        thermompnnError: remoteJobs.thermompnnError,
        engineUpdates: engineUpdatesFromJob(jobData, remoteJobs)
      });
    } catch (err: any) {
      console.error(`[Route Error] FoldX job polling failed for ${jobId}:`, err.message);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", `FoldX job polling failed: ${err.message}`);
    }
  });

  apiRouter.post("/thermompnn-submit", jsonParserPdb, async (req, res) => {
    const parseResult = thermompnnSubmitSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { mutation } = req.body;
      const wtPdb = await resolvePdbTextFromParam(req.body);
      if (!wtPdb) {
        sendError(res, 404, "NOT_FOUND", "PDB structure could not be resolved from provided reference or payload.");
        return;
      }

      const parsed = parseMutationParam(mutation);
      if (!parsed) {
        sendError(res, 400, "BAD_REQUEST", "Invalid mutation code format.");
        return;
      }
      const { wtLetter, mutLetter, posNum, chainParam } = parsed;

      const cleanedPdb = cleanPdbForFoldX(wtPdb);
      const pdbResidues = await parseResiduesFromPdbMaybeAsync(cleanedPdb);
      const targetRes = pdbResidues.find(r => r.resSeq === posNum && (chainParam === "" || r.chain.toUpperCase() === chainParam.toUpperCase()));
      if (!targetRes) {
        sendError(res, 422, "UNPROCESSABLE_ENTITY", `Target residue position ${posNum}${chainParam ? ` on chain ${chainParam.toUpperCase()}` : ""} is not found in the PDB structure.`);
        return;
      }
      const expectedWt3 = AMINO_ACID_1_TO_3[wtLetter.toUpperCase()];
      if (expectedWt3 && targetRes.resName3.toUpperCase() !== expectedWt3.toUpperCase()) {
        sendError(
          res,
          422,
          "UNPROCESSABLE_ENTITY",
          `Wild-type residue mismatch: the mutation expects ${wtLetter} (${expectedWt3}) at position ${posNum}, but the structure has ${targetRes.resName3} on chain ${targetRes.chain}. The structure may use its own numbering.`
        );
        return;
      }
      const resolvedChainUpper = targetRes.chain.toUpperCase() || "A";
      const canonicalMutation = `${wtLetter}${resolvedChainUpper}${posNum}${mutLetter}`;

      const thermoRes = await submitThermoMpnnJob(cleanedPdb, canonicalMutation);

      res.json({
        thermompnnStatus: thermoRes.status,
        prediction: thermoRes.prediction ?? null,
        error: thermoRes.error || null
      });
    } catch (err: any) {
      console.error("ThermoMPNN submit endpoint failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to run ThermoMPNN.");
    }
  });
}

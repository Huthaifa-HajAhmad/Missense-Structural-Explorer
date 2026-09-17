import { type Router } from "express";
import crypto from "crypto";
import fs from "fs";
import { z } from "zod";

import {
  sendError,
  AuditLogger,
  formatZodError,
  onClientDisconnect,
} from "../../utils.ts";
import {
  pollDynaMut2Job,
  submitDynaMut2Job,
  pollDdmutJob,
  submitDdmutJob,
} from "../../services/external.ts";
import {
  parseResiduesFromPdbMaybeAsync,
  submitThermoMpnnJob,
  pollThermoMpnnJob,
  enrichBiophysicalResult,
} from "../../services/biophysics.ts";
import { BiophysicalJobQueue } from "../../services/biophysical-queue.ts";
import { computeConsensusVerdict, computeCalibratedConsensus } from "../../../src/shared/thresholds.ts";
import { recordJobInRegistry, getRegistryPath, type RegistryJob } from "../shared.ts";
import { AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";

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

const dynamut2SubmitSchema = biophysicsSubmitSchema;
const ddmutSubmitSchema = biophysicsSubmitSchema;
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

export function broadcastJobUpdate(update: {
  jobId: string;
  tool: "foldx" | "dynamut2" | "ddmut" | "thermompnn" | "p2rank";
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
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const jobsParam = (req.query.jobs as string) || "";
    const subscribedJobIds = new Set(jobsParam.split(",").map(s => s.trim()).filter(Boolean));

    if (subscribedJobIds.size === 0) {
      sendError(res, 400, "BAD_REQUEST", "Query parameter 'jobs' specifying one or more job IDs is required for SSE subscription.");
      return;
    }

    // Send initial connected handshake
    res.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);

    const listener = (update: any) => {
      if (subscribedJobIds.has(update.jobId)) {
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
    });
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
        dynamut2JobId: null,
        dynamut2Status: "pending",
        ddmutJobId: null,
        ddmutStatus: "pending",
        thermompnnJobId: null,
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

        broadcastJobUpdate({ jobId, tool: "foldx", status: "completed", result: enriched });

        return res.json({
          jobId,
          status: "completed",
          result: enriched,
          dynamut2JobId: remoteJobs.dynamut2JobId,
          dynamut2Status: remoteJobs.dynamut2Status,
          ddmutJobId: remoteJobs.ddmutJobId,
          ddmutStatus: remoteJobs.ddmutStatus,
          thermompnnJobId: remoteJobs.thermompnnJobId,
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

        broadcastJobUpdate({ jobId, tool: "foldx", status: "failed", error: jobInfo.error || "FoldX job failed during execution", result: enriched });
        return res.json({
          jobId,
          status: "failed",
          error: jobInfo.error || "FoldX job failed during execution",
          result: enriched,
          dynamut2JobId: remoteJobs.dynamut2JobId,
          dynamut2Status: remoteJobs.dynamut2Status,
          ddmutJobId: remoteJobs.ddmutJobId,
          ddmutStatus: remoteJobs.ddmutStatus,
          thermompnnJobId: remoteJobs.thermompnnJobId,
          thermompnnStatus: remoteJobs.thermompnnStatus,
          thermompnnError: remoteJobs.thermompnnError
        });
      }

      return res.json({
        jobId,
        status: jobInfo.status,
        dynamut2JobId: remoteJobs.dynamut2JobId,
        dynamut2Status: remoteJobs.dynamut2Status,
        ddmutJobId: remoteJobs.ddmutJobId,
        ddmutStatus: remoteJobs.ddmutStatus,
        thermompnnJobId: remoteJobs.thermompnnJobId,
        thermompnnStatus: remoteJobs.thermompnnStatus,
        thermompnnError: remoteJobs.thermompnnError
      });
    } catch (err: any) {
      console.error(`[Route Error] FoldX job polling failed for ${jobId}:`, err.message);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", `FoldX job polling failed: ${err.message}`);
    }
  });

  apiRouter.get("/thermompnn-job/:jobId", async (req, res) => {
    const jobId = req.params.jobId;
    if (!jobId || !/^[a-zA-Z0-9_\-]{1,100}$/.test(jobId)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid ThermoMPNN Job ID format.");
      return;
    }
    try {
      const apiKey = (req.headers["x-tamarind-api-key"] as string) || (req.query?.tamarindApiKey as string) || (req.query?.apiKey as string) || process.env.TAMARIND_API_KEY;
      const result = await pollThermoMpnnJob(jobId, apiKey);
      if (result.status === "done" || result.status === "error") {
        broadcastJobUpdate({ jobId, tool: "thermompnn", status: result.status, prediction: result.prediction });
      }
      // Always return 200 so the client can deterministically terminate polling on
      // terminal statuses (error/done) instead of rescheduling on 502/504. (P0-3)
      return res.json({
        jobId,
        status: result.status,
        prediction: result.prediction,
        error: result.status === "error" ? (result.error || "ThermoMPNN job execution failed on upstream server.") : undefined
      });
    } catch (err: any) {
      console.error(`[Route Error] ThermoMPNN job polling failed for ${jobId}:`, err.message);
      return res.json({ jobId, status: "error", prediction: null, error: `ThermoMPNN job polling failed: ${err.message}` });
    }
  });

  const BIOSIG_MAX_AGE_MS = 300 * 1000; // 300s (5 min) max wait for remote academic server queue
 
  async function checkBioSigJobStaleness(jobId: string, tool: "dynamut2" | "ddmut"): Promise<boolean> {
    try {
      if (fs.existsSync(getRegistryPath())) {
        const content = await fs.promises.readFile(getRegistryPath(), "utf-8");
        const registry: RegistryJob[] = JSON.parse(content);
        const entry = registry.find(j => j.jobId === jobId && j.type === tool);
        if (entry) {
          const ageMs = Date.now() - new Date(entry.timestamp).getTime();
          if (ageMs > BIOSIG_MAX_AGE_MS) {
            console.warn(`[BioSig Staleness] ${tool} job ${jobId} is ${Math.round(ageMs / 1000)}s old (>300s timeout).`);
            return true;
          }
        }
      }
    } catch (err: any) {
      console.warn(`[BioSig Staleness] Failed to read registry for ${tool}:`, err.message);
    }
    return false;
  }

  async function backfillRemotePredictionToCache(jobId: string, tool: "dynamut2" | "ddmut", prediction: number): Promise<void> {
    try {
      if (fs.existsSync(getRegistryPath())) {
        const registryContent = await fs.promises.readFile(getRegistryPath(), "utf-8");
        const registry: RegistryJob[] = JSON.parse(registryContent);
        const entry = registry.find(j => j.jobId === jobId && j.type === tool);
        if (entry && entry.foldxCacheKey) {
          const { getMutantFromCache, writeMutantToCache } = await import("../../services/biophysics.ts");
          const cached = await getMutantFromCache(entry.foldxCacheKey);
          if (cached && cached.energetics) {
            let updated = false;
            if (tool === "dynamut2" && cached.energetics.dynamut2 !== prediction) {
              cached.energetics.dynamut2 = prediction;
              updated = true;
            } else if (tool === "ddmut" && cached.energetics.ddmut !== prediction) {
              cached.energetics.ddmut = prediction;
              updated = true;
            }
            if (updated) {
              writeMutantToCache(entry.foldxCacheKey, cached);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[BioSig Cache Backfill Warning] Failed to backfill ${tool} for ${jobId}:`, err.message);
    }
  }

  apiRouter.get("/dynamut2-job/:jobId", async (req, res) => {
    const { jobId } = req.params;
    const reqId = (req.headers["x-request-id"] || crypto.randomUUID()) as string;

    if (!jobId || !/^\d{1,20}$/.test(jobId)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid DynaMut2 Job ID format: must be numeric digits.");
      return;
    }

    const isStale = await checkBioSigJobStaleness(jobId, "dynamut2");
    if (isStale) {
      await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: "UNAVAILABLE", reason: "TIMEOUT" });
      broadcastJobUpdate({ jobId, tool: "dynamut2", status: "UNAVAILABLE" });
      return res.json({ jobId, status: "UNAVAILABLE", prediction: null, error: "BioSig server queue congested (>5m wait)." });
    }

    const foldx = req.query?.foldx ? parseFloat(req.query.foldx as string) : null;
    const rasp = req.query?.rasp ? parseFloat(req.query.rasp as string) : null;
    const ddmut = req.query?.ddmut ? parseFloat(req.query.ddmut as string) : null;
    const stabilityoracle = req.query?.stabilityoracle ? parseFloat(req.query.stabilityoracle as string) : null;
    const foldxRepairFailed = req.query?.foldxRepairFailed === "true";

    try {
      const result = await pollDynaMut2Job(jobId);
      if (!result || result.status === "ERROR") {
        await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: "UNAVAILABLE" });
        broadcastJobUpdate({ jobId, tool: "dynamut2", status: "UNAVAILABLE" });
        return res.json({ jobId, status: "UNAVAILABLE", prediction: null, error: "DynaMut2 upstream server currently unavailable." });
      }

      await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: result.status });

      if (result.status === "DONE") {
        broadcastJobUpdate({ jobId, tool: "dynamut2", status: "DONE", prediction: result.prediction });
        if (result.prediction !== null) {
          await backfillRemotePredictionToCache(jobId, "dynamut2", result.prediction);
        }
      }

      const calResult = result.status === "DONE" && result.prediction !== null
        ? computeCalibratedConsensus({ foldxMean: foldx, dynamut2: result.prediction, ddmut, rasp, stabilityoracle, foldxRepairFailed })
        : null;

      res.json({
        jobId,
        status: result.status,
        prediction: result.prediction,
        consensusVerdict: calResult ? calResult.consensusVerdict : null,
        consensusProbability: calResult ? calResult.consensusProbability : null,
        consensusConfMin: calResult ? calResult.consensusConfMin : null,
        consensusConfMax: calResult ? calResult.consensusConfMax : null
      });
    } catch (err: any) {
      console.warn(`[Route Warning] DynaMut2 job polling failed for ${jobId}:`, err.message);
      await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: "UNAVAILABLE" });
      return res.json({ jobId, status: "UNAVAILABLE", prediction: null, error: `DynaMut2 upstream unavailable: ${err.message}` });
    }
  });

  apiRouter.get("/ddmut-job/:jobId", async (req, res) => {
    const { jobId } = req.params;
    const reqId = (req.headers["x-request-id"] || crypto.randomUUID()) as string;

    if (!jobId || !/^\d{1,20}$/.test(jobId)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid DDMut Job ID format: must be numeric digits.");
      return;
    }

    const isStale = await checkBioSigJobStaleness(jobId, "ddmut");
    if (isStale) {
      await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: "UNAVAILABLE", reason: "TIMEOUT" });
      broadcastJobUpdate({ jobId, tool: "ddmut", status: "UNAVAILABLE" });
      return res.json({ jobId, status: "UNAVAILABLE", prediction: null, error: "BioSig server queue congested (>5m wait)." });
    }

    const foldx = req.query?.foldx ? parseFloat(req.query.foldx as string) : null;
    const rasp = req.query?.rasp ? parseFloat(req.query.rasp as string) : null;
    const dynamut2 = req.query?.dynamut2 ? parseFloat(req.query.dynamut2 as string) : null;
    const stabilityoracle = req.query?.stabilityoracle ? parseFloat(req.query.stabilityoracle as string) : null;
    const foldxRepairFailed = req.query?.foldxRepairFailed === "true";

    try {
      const result = await pollDdmutJob(jobId);
      if (!result || result.status === "ERROR") {
        await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: "UNAVAILABLE" });
        broadcastJobUpdate({ jobId, tool: "ddmut", status: "UNAVAILABLE" });
        return res.json({ jobId, status: "UNAVAILABLE", prediction: null, error: "DDMut upstream server currently unavailable." });
      }

      await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: result.status });

      if (result.status === "DONE") {
        broadcastJobUpdate({ jobId, tool: "ddmut", status: "DONE", prediction: result.prediction });
        if (result.prediction !== null) {
          await backfillRemotePredictionToCache(jobId, "ddmut", result.prediction);
        }
      }

      const calResult = result.status === "DONE" && result.prediction !== null
        ? computeCalibratedConsensus({ foldxMean: foldx, dynamut2, ddmut: result.prediction, rasp, stabilityoracle, foldxRepairFailed })
        : null;

      res.json({
        jobId,
        status: result.status,
        prediction: result.prediction,
        consensusVerdict: calResult ? calResult.consensusVerdict : null,
        consensusProbability: calResult ? calResult.consensusProbability : null,
        consensusConfMin: calResult ? calResult.consensusConfMin : null,
        consensusConfMax: calResult ? calResult.consensusConfMax : null
      });
    } catch (err: any) {
      console.warn(`[Route Warning] DDMut job polling failed for ${jobId}:`, err.message);
      await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: "UNAVAILABLE" });
      return res.json({ jobId, status: "UNAVAILABLE", prediction: null, error: `DDMut upstream unavailable: ${err.message}` });
    }
  });

  apiRouter.post("/dynamut2-submit", jsonParserPdb, async (req, res) => {
    const parseResult = dynamut2SubmitSchema.safeParse(req.body);
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

      let resolvedChain = chainParam;
      try {
        const pdbResidues = await parseResiduesFromPdbMaybeAsync(wtPdb);
        const targetRes = pdbResidues.find(r => r.resSeq === posNum && (chainParam === "" || r.chain === chainParam));
        if (targetRes) {
          resolvedChain = targetRes.chain;
        } else {
          const fallbackRes = pdbResidues.find(r => r.resSeq === posNum);
          if (fallbackRes) {
            resolvedChain = fallbackRes.chain;
          }
        }
      } catch (pdbErr) {
        console.warn("[PDB Parse Warning] Failed to parse residues for chain resolution:", pdbErr);
      }
      const resolvedChainUpper = resolvedChain.toUpperCase() || "A";

      const dynamut2JobId = await submitDynaMut2Job(wtPdb, resolvedChainUpper, posNum, wtLetter, mutLetter);
      if (dynamut2JobId) {
        await recordJobInRegistry(dynamut2JobId, "dynamut2", mutation.trim());
      }
      res.json({
        dynamut2JobId,
        dynamut2Status: dynamut2JobId ? "pending" : "unavailable"
      });
    } catch (err: any) {
      console.error("DynaMut2 submit endpoint failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to submit DynaMut2 job.");
    }
  });

  apiRouter.post("/ddmut-submit", jsonParserPdb, async (req, res) => {
    const parseResult = ddmutSubmitSchema.safeParse(req.body);
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

      let resolvedChain = chainParam;
      try {
        const pdbResidues = await parseResiduesFromPdbMaybeAsync(wtPdb);
        const targetRes = pdbResidues.find(r => r.resSeq === posNum && (chainParam === "" || r.chain === chainParam));
        if (targetRes) {
          resolvedChain = targetRes.chain;
        } else {
          const fallbackRes = pdbResidues.find(r => r.resSeq === posNum);
          if (fallbackRes) {
            resolvedChain = fallbackRes.chain;
          }
        }
      } catch (pdbErr) {
        console.warn("[PDB Parse Warning] Failed to parse residues for chain resolution:", pdbErr);
      }
      const resolvedChainUpper = resolvedChain.toUpperCase() || "A";

      const ddmutJobId = await submitDdmutJob(wtPdb, resolvedChainUpper, posNum, wtLetter, mutLetter);
      if (ddmutJobId) {
        await recordJobInRegistry(ddmutJobId, "ddmut", mutation.trim());
      }
      res.json({
        ddmutJobId,
        ddmutStatus: ddmutJobId ? "pending" : "unavailable"
      });
    } catch (err: any) {
      console.error("DDMut submit endpoint failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to submit DDMut job.");
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

      const apiKey = (req.headers["x-tamarind-api-key"] as string) || process.env.TAMARIND_API_KEY;
      const thermoRes = await submitThermoMpnnJob(wtPdb, mutation, apiKey);

      if (thermoRes.jobId) {
        await recordJobInRegistry(thermoRes.jobId, "thermompnn", mutation);
      }

      res.json({
        thermompnnJobId: thermoRes.jobId || null,
        thermompnnStatus: thermoRes.status || "pending",
        prediction: thermoRes.prediction || null,
        error: thermoRes.error || null,
        thermoJobId: thermoRes.jobId || null,
        thermoStatus: thermoRes.status || "pending"
      });
    } catch (err: any) {
      console.error("ThermoMPNN submit endpoint failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to submit ThermoMPNN job.");
    }
  });
}

import { type Router } from "express";
import crypto from "crypto";
import fs from "fs";
import { z } from "zod";

import {
  sendError,
  AuditLogger,
  formatZodError,
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
} from "../../services/biophysics.ts";
import { computeConsensusVerdict } from "../../../src/shared/thresholds.ts";
import { recordJobInRegistry, REGISTRY_PATH, type RegistryJob } from "../shared.ts";

const dynamut2SubmitSchema = z.object({
  wtPdb: z.string(),
  mutation: z.string()
});

const ddmutSubmitSchema = z.object({
  wtPdb: z.string(),
  mutation: z.string()
});

const thermompnnSubmitSchema = z.object({
  wtPdb: z.string(),
  mutation: z.string()
});

export function registerPollingRoutes(apiRouter: Router, jsonParserPdb: any): void {

  apiRouter.get("/thermompnn-job/:jobId", async (req, res) => {
    const jobId = req.params.jobId;
    if (!jobId || !/^[a-zA-Z0-9_\-]{1,100}$/.test(jobId)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid ThermoMPNN Job ID format.");
      return;
    }
    try {
      const apiKey = (req.headers["x-tamarind-api-key"] as string) || (req.query?.tamarindApiKey as string) || (req.query?.apiKey as string) || process.env.TAMARIND_API_KEY;
      const result = await pollThermoMpnnJob(jobId, apiKey);
      if (result.status === "error") {
        sendError(res, 502, "BAD_GATEWAY", result.error || "ThermoMPNN job execution failed on upstream server.");
        return;
      }
      return res.json({
        jobId,
        status: result.status,
        prediction: result.prediction
      });
    } catch (err: any) {
      console.error(`[Route Error] ThermoMPNN job polling failed for ${jobId}:`, err.message);
      sendError(res, 502, "BAD_GATEWAY", `ThermoMPNN job polling failed: ${err.message}`);
    }
  });

  apiRouter.get("/dynamut2-job/:jobId", async (req, res) => {
    const { jobId } = req.params;
    const reqId = (req.headers["x-request-id"] || crypto.randomUUID()) as string;

    if (!jobId || !/^\d{1,20}$/.test(jobId)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid DynaMut2 Job ID format: must be numeric digits.");
      return;
    }

    const foldx = req.query?.foldx ? parseFloat(req.query.foldx as string) : null;
    const rasp = req.query?.rasp ? parseFloat(req.query.rasp as string) : null;
    const ddmut = req.query?.ddmut ? parseFloat(req.query.ddmut as string) : null;
    const foldxRepairFailed = req.query?.foldxRepairFailed === "true";

    try {
      const result = await pollDynaMut2Job(jobId);
      if (!result || result.status === "ERROR") {
        await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: "ERROR" });
        sendError(res, 502, "BAD_GATEWAY", "DynaMut2 job polling failed: upstream server returned an error.");
        return;
      }

      await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: result.status });

      const consensusVerdict = result.status === "DONE" && result.prediction !== null
        ? computeConsensusVerdict({ foldxMean: foldx, dynamut2: result.prediction, ddmut, rasp, foldxRepairFailed })
        : null;

      res.json({
        jobId,
        status: result.status,
        prediction: result.prediction,
        consensusVerdict
      });
    } catch (err: any) {
      console.error(`[Route Error] DynaMut2 job polling failed for ${jobId}:`, err.message);
      await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: "ERROR" });
      if (err.statusCode === 429) {
        sendError(res, 429, "RATE_LIMIT_ERROR", "Upstream DynaMut2 API rate limit reached.");
        return;
      }
      sendError(res, 502, "BAD_GATEWAY", `DynaMut2 job polling failed: ${err.message}`);
    }
  });

  apiRouter.get("/ddmut-job/:jobId", async (req, res) => {
    const { jobId } = req.params;
    const reqId = (req.headers["x-request-id"] || crypto.randomUUID()) as string;

    if (!jobId || !/^\d{1,20}$/.test(jobId)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid DDMut Job ID format: must be numeric digits.");
      return;
    }

    const DDM_MAX_AGE_MS = 8 * 60 * 1000;
    try {
      if (fs.existsSync(REGISTRY_PATH)) {
        const content = await fs.promises.readFile(REGISTRY_PATH, "utf-8");
        const registry: RegistryJob[] = JSON.parse(content);
        const entry = registry.find(j => j.jobId === jobId && j.type === "ddmut");
        if (entry) {
          const ageMs = Date.now() - new Date(entry.timestamp).getTime();
          if (ageMs > DDM_MAX_AGE_MS) {
            console.warn(`[DDMut Staleness] Job ${jobId} is ${Math.round(ageMs / 60000)}m old and still RUNNING — treating as ERROR (zombie job).`);
            await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: "STALE_ERROR", ageMs });
            sendError(res, 504, "GATEWAY_TIMEOUT", "Job execution timed out or hung on the upstream server.");
            return;
          }
        }
      }
    } catch (registryErr: any) {
      console.warn("[DDMut Staleness] Could not read job registry:", registryErr.message);
    }

    const foldx = req.query?.foldx ? parseFloat(req.query.foldx as string) : null;
    const rasp = req.query?.rasp ? parseFloat(req.query.rasp as string) : null;
    const dynamut2 = req.query?.dynamut2 ? parseFloat(req.query.dynamut2 as string) : null;
    const foldxRepairFailed = req.query?.foldxRepairFailed === "true";

    try {
      const result = await pollDdmutJob(jobId);
      if (!result || result.status === "ERROR") {
        await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: "ERROR" });
        sendError(res, 502, "BAD_GATEWAY", "DDMut job polling failed: upstream server returned an error.");
        return;
      }

      await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: result.status });

      const consensusVerdict = result.status === "DONE" && result.prediction !== null
        ? computeConsensusVerdict({ foldxMean: foldx, dynamut2, ddmut: result.prediction, rasp, foldxRepairFailed })
        : null;

      res.json({
        jobId,
        status: result.status,
        prediction: result.prediction,
        consensusVerdict
      });
    } catch (err: any) {
      console.error(`[Route Error] DDMut job polling failed for ${jobId}:`, err.message);
      await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: "ERROR" });
      if (err.statusCode === 429) {
        sendError(res, 429, "RATE_LIMIT_ERROR", "Upstream DDMut API rate limit reached.");
        return;
      }
      sendError(res, 502, "BAD_GATEWAY", `DDMut job polling failed: ${err.message}`);
    }
  });

  apiRouter.post("/dynamut2-submit", jsonParserPdb, async (req, res) => {
    const parseResult = dynamut2SubmitSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { wtPdb, mutation } = req.body;
      const mutTrimmed = mutation.trim();
      const wtLetter = mutTrimmed[0].toUpperCase();
      const mutLetter = mutTrimmed[mutTrimmed.length - 1].toUpperCase();

      const mutMatch = mutTrimmed.match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$/);
      if (!mutMatch) {
        sendError(res, 400, "BAD_REQUEST", "Invalid mutation code format.");
        return;
      }
      const chainParam = mutMatch[2].toUpperCase();
      const posNum = parseInt(mutMatch[3], 10);

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
        await recordJobInRegistry(dynamut2JobId, "dynamut2", mutTrimmed);
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
      const { wtPdb, mutation } = req.body;
      const mutTrimmed = mutation.trim();
      const wtLetter = mutTrimmed[0].toUpperCase();
      const mutLetter = mutTrimmed[mutTrimmed.length - 1].toUpperCase();

      const mutMatch = mutTrimmed.match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$/);
      if (!mutMatch) {
        sendError(res, 400, "BAD_REQUEST", "Invalid mutation code format.");
        return;
      }
      const chainParam = mutMatch[2].toUpperCase();
      const posNum = parseInt(mutMatch[3], 10);

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
        await recordJobInRegistry(ddmutJobId, "ddmut", mutTrimmed);
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
      const { wtPdb, mutation } = req.body;

      const apiKey = (req.headers["x-tamarind-api-key"] as string) || process.env.TAMARIND_API_KEY;
      const thermoRes = await submitThermoMpnnJob(wtPdb, mutation, apiKey);

      if (thermoRes.jobId) {
        await recordJobInRegistry(thermoRes.jobId, "thermompnn", mutation);
      }

      res.json({
        thermompnnJobId: thermoRes.jobId,
        thermompnnStatus: thermoRes.status,
        prediction: thermoRes.prediction,
        error: thermoRes.error
      });
    } catch (err: any) {
      console.error("ThermoMPNN submit endpoint failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to submit ThermoMPNN job.");
    }
  });
}

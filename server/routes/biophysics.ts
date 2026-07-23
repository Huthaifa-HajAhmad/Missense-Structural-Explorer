/**
 * biophysics.ts — Biophysics-related routes:
 *   POST /analyze-variant-biophysical
 *   GET  /dynamut2-job/:jobId
 *   POST /dynamut2-submit
 *   GET  /ddmut-job/:jobId
 *   POST /ddmut-submit
 *   POST /generate-mutant
 *   POST /pocket-finder
 *   POST /nearest-residues
 */
import { type Router } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import {
  sendError,
  validateGene,
  validateVariant,
  validateUniProt,
  AuditLogger,
  MUTATION_FOLDX_PATTERN,
  getApiKeyFromSession,
} from "../utils.ts";
import { analyzeVariantLimiter } from "../middleware.ts";
import { fetchAlphafoldPdb } from "../services/structure-fetcher.ts";
import {
  FoldingEngine,
  FoldingContext,
  ESMFoldEngine,
  AlphaFoldEngine
} from "../services/folding-engines.ts";
import { verifyStability } from "../services/biophysics-bridge.ts";
import {
  performGeminiBiophysicalAnalysis,
} from "../services/gemini.ts";
import {
  fetchUniprotSequence,
  submitDynaMut2Job,
  pollDynaMut2Job,
  submitDdmutJob,
  pollDdmutJob,
} from "../services/external.ts";
import {
  biophysicalSemaphore,
  generateMutantPdb,
  findBindingPocket,
  parseResiduesFromPdbMaybeAsync,
  getResidueDetails,
  runRaspLocal,
  testTamarindConnection,
  submitThermoMpnnJob,
  pollThermoMpnnJob,
} from "../services/biophysics.ts";
import { THRESHOLDS, computeConsensusVerdict } from "../../src/shared/thresholds.ts";
import { type FoldXResult, activeBackgroundTasks, inFlightPrewarms } from "./state.ts";
import { getFromCache, writeToCache, recordJobInRegistry } from "./shared.ts";

export function registerBiophysicsRoutes(apiRouter: Router, jsonParserRegular: any, jsonParserPdb: any): void {

  apiRouter.post("/test-tamarind-connection", jsonParserRegular, async (req, res) => {
    try {
      const apiKey = (req.headers["x-tamarind-api-key"] as string) || req.body?.tamarindApiKey || process.env.TAMARIND_API_KEY;
      const result = await testTamarindConnection(apiKey);
      return res.json(result);
    } catch (err: any) {
      return sendError(res, 500, "INTERNAL_ERROR", `Failed to test Tamarind connection: ${err.message}`);
    }
  });

  apiRouter.get("/thermompnn-job/:jobId", async (req, res) => {
    const reqId = (req.headers["x-request-id"] || crypto.randomUUID()) as string;
    const jobId = req.params.jobId;
    try {
      const apiKey = (req.headers["x-tamarind-api-key"] as string) || (req.query?.tamarindApiKey as string) || process.env.TAMARIND_API_KEY;
      const result = await pollThermoMpnnJob(jobId, apiKey);
      return res.json({
        jobId,
        status: result.status,
        prediction: result.prediction,
        error: result.error
      });
    } catch (err: any) {
      console.error(`[Route Error] ThermoMPNN job polling failed for ${jobId}:`, err.message);
      res.json({ jobId, status: "ERROR", prediction: null });
    }
  });

  apiRouter.post("/biophysics/verify-stability", jsonParserRegular, async (req, res) => {
    try {
      const { uniprotId, mutation, engine, wtPdb } = req.body;

      if (!uniprotId || !mutation || !engine) {
        sendError(res, 400, "BAD_REQUEST", "Missing required parameters: uniprotId, mutation, or engine.");
        return;
      }

      const { chain, position, wt, mt } = mutation;
      if (!chain || position === undefined || !wt || !mt) {
        sendError(res, 400, "BAD_REQUEST", "Invalid mutation object format. Must contain chain, position, wt, and mt.");
        return;
      }

      // 1. Resolve WT Sequence
      let wtSeq = req.body.wtSeq;
      if (!wtSeq) {
        try {
          const seqObj = await fetchUniprotSequence(uniprotId);
          wtSeq = seqObj;
        } catch (seqErr: any) {
          sendError(res, 500, "INTERNAL_ERROR", `Failed to resolve sequence for UniProt ID ${uniprotId}: ${seqErr.message}`);
          return;
        }
      }

      if (!wtSeq) {
        sendError(res, 500, "INTERNAL_ERROR", `Could not resolve sequence for UniProt ID ${uniprotId}.`);
        return;
      }

      // 2. Instantiate selected folding engine
      let foldingEngine: FoldingEngine;
      if (engine === "esmfold") {
        foldingEngine = new ESMFoldEngine();
      } else if (engine === "alphafold") {
        foldingEngine = new AlphaFoldEngine();
      } else {
        sendError(res, 400, "BAD_REQUEST", `Unsupported engine type: ${engine}`);
        return;
      }

      // 3. Resolve template WT PDB
      let resolvedWtPdb = wtPdb;
      if (!resolvedWtPdb) {
        try {
          resolvedWtPdb = await fetchAlphafoldPdb(uniprotId);
        } catch (pdbErr: any) {
          sendError(res, 500, "INTERNAL_ERROR", `Failed to retrieve template PDB: ${pdbErr.message}`);
          return;
        }
      }

      if (!resolvedWtPdb) {
        sendError(res, 500, "INTERNAL_ERROR", "No template wildtype PDB structure available.");
        return;
      }

      // 4. Construct FoldX/Job context details
      const jobId = crypto.randomUUID();
      const jobDir = path.join(process.cwd(), "temp_jobs", jobId);
      const mutationCode = `${wt}${chain}${position}${mt}`; // e.g. RA408H -> WT chain pos MT
      const tamarindApiKey = (req.headers["x-tamarind-api-key"] as string) || req.body?.tamarindApiKey || process.env.TAMARIND_API_KEY;
      const biohubToken = (req.headers["x-biohub-token"] as string) || req.body?.biohubToken || process.env.BIOHUB_API_KEY;

      const context: FoldingContext = {
        wtPdb: resolvedWtPdb,
        uniprotId,
        jobDir,
        mutationCode,
        biohubToken
      };

      // 5. Run verifyStability orchestrator
      try {
        const verifyResult = await verifyStability(
          wtSeq,
          mutation,
          foldingEngine,
          context,
          tamarindApiKey
        );

        // Cleanup temporary FoldX job directories if any
        try {
          if (fs.existsSync(jobDir)) {
            await fs.promises.rm(jobDir, { recursive: true, force: true });
          }
        } catch (cleanupErr) {}

        res.json({
          ddG: verifyResult.ddG,
          thermompnnJobId: verifyResult.thermompnnJobId,
          thermompnnStatus: verifyResult.thermompnnStatus,
          structure: verifyResult.structure,
          mutationCode
        });
      } catch (runErr: any) {
        // Clean up job directory on error
        try {
          if (fs.existsSync(jobDir)) {
            await fs.promises.rm(jobDir, { recursive: true, force: true });
          }
        } catch (cleanupErr) {}

        console.error("[Biophysics Route verify-stability Error]:", runErr);
        sendError(res, 500, "INTERNAL_ERROR", runErr.message || "Stability verification failed.");
      }
    } catch (routeErr: any) {
      console.error("[Route verify-stability Crash]:", routeErr);
      sendError(res, 500, "INTERNAL_ERROR", routeErr.message || "An unexpected route crash occurred.");
    }
  });

  apiRouter.post("/analyze-variant-biophysical", jsonParserRegular, async (req, res) => {
    try {
      let gene: string, variant: string, uniprotId: string;
      try {
        gene = validateGene(req.body.gene);
        variant = validateVariant(req.body.variant);
        uniprotId = validateUniProt(req.body.uniprotId);
      } catch (err: any) {
        sendError(res, 400, "BAD_REQUEST", err.message);
        return;
      }

      const cacheKey = `biophysical_${uniprotId}_${variant}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        console.log(`[Cache Hit] Serving cached biophysical Gemini insights for ${cacheKey}`);
        res.json(cached);
        return;
      }

      // Cache miss: invoke rate limiter programmatically (bypass during tests)
      const runHandler = async () => {
        try {
          const mutMatch = variant.match(/([a-zA-Z]{3}|\w)\s*(\d+)\s*([a-zA-Z]{3}|\w)/);
          if (!mutMatch) {
            sendError(res, 400, "BAD_REQUEST", `Invalid protein variant format: ${variant}`);
            return;
          }
          const wildType = mutMatch[1];
          const residueIndex = mutMatch[2];
          const mutant = mutMatch[3];

          const customSessionId = req.headers["x-gemini-session-id"] as string | undefined;
          let customApiKey: string | undefined;
          if (customSessionId) {
            customApiKey = getApiKeyFromSession(customSessionId);
            if (!customApiKey) {
              sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate in Settings.");
              return;
            }
          }

          const timeoutSignal = AbortSignal.timeout(60000);
          let result;
          try {
            result = await performGeminiBiophysicalAnalysis(
              gene,
              variant,
              uniprotId,
              residueIndex,
              wildType,
              mutant,
              customApiKey,
              timeoutSignal
            );
            writeToCache(cacheKey, result);
          } catch (err: any) {
            console.warn("[Graceful Fallback] Biophysical Gemini narrative execution failed:", err.message);
            result = {
              biochemicalShift: "Biochemical shift details unavailable (Gemini service limit or timeout).",
              structuralImpact: `structural impact details unavailable. (${err.message || "Failed to connect to Gemini API"}).`
            };
          }
          res.json(result);
        } catch (innerError: any) {
          console.error("Biophysical inner execution failure:", innerError);
          sendError(res, 500, "INTERNAL_ERROR", innerError.message || "Failed to process biophysical request.");
        }
      };

      if (process.env.NODE_ENV === "test") {
        await runHandler();
      } else {
        analyzeVariantLimiter(req, res, runHandler);
      }
    } catch (error: any) {
      console.error("Biophysical endpoint failure:", error);
      sendError(res, 500, "INTERNAL_ERROR", error.message || "Failed to process biophysical request.");
    }
  });

  apiRouter.get("/dynamut2-job/:jobId", async (req, res) => {
    const { jobId } = req.params;
    const reqId = (req.headers["x-request-id"] || crypto.randomUUID()) as string;

    if (!jobId || !/^\d{1,20}$/.test(jobId)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid DynaMut2 Job ID format: must be numeric digits.");
      return;
    }

    // Parse other scores from query parameters to dynamically compute consensusVerdict
    const foldx = req.query?.foldx ? parseFloat(req.query.foldx as string) : null;
    const rasp = req.query?.rasp ? parseFloat(req.query.rasp as string) : null;
    const ddmut = req.query?.ddmut ? parseFloat(req.query.ddmut as string) : null;

    try {
      const result = await pollDynaMut2Job(jobId);
      if (!result) {
        await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: "ERROR" });
        res.json({ jobId, status: "ERROR", prediction: null, consensusVerdict: null });
        return;
      }

      await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: result.status });

      const consensusVerdict = result.status === "DONE" && result.prediction !== null
        ? computeConsensusVerdict({ foldxMean: foldx, dynamut2: result.prediction, ddmut, rasp })
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
      res.json({ jobId, status: "ERROR", prediction: null, consensusVerdict: null });
    }
  });

  apiRouter.get("/ddmut-job/:jobId", async (req, res) => {
    const { jobId } = req.params;
    const reqId = (req.headers["x-request-id"] || crypto.randomUUID()) as string;

    if (!jobId || !/^\d{1,20}$/.test(jobId)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid DDMut Job ID format: must be numeric digits.");
      return;
    }

    // Parse other scores from query parameters to dynamically compute consensusVerdict
    const foldx = req.query?.foldx ? parseFloat(req.query.foldx as string) : null;
    const rasp = req.query?.rasp ? parseFloat(req.query.rasp as string) : null;
    const dynamut2 = req.query?.dynamut2 ? parseFloat(req.query.dynamut2 as string) : null;

    try {
      const result = await pollDdmutJob(jobId);
      if (!result) {
        await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: "ERROR" });
        res.json({ jobId, status: "ERROR", prediction: null, consensusVerdict: null });
        return;
      }

      await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: result.status });

      const consensusVerdict = result.status === "DONE" && result.prediction !== null
        ? computeConsensusVerdict({ foldxMean: foldx, dynamut2, ddmut: result.prediction, rasp })
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
      res.json({ jobId, status: "ERROR", prediction: null, consensusVerdict: null });
    }
  });

  apiRouter.post("/dynamut2-submit", jsonParserPdb, async (req, res) => {
    try {
      const { wtPdb, mutation } = req.body;
      if (!wtPdb || !mutation) {
        sendError(res, 400, "BAD_REQUEST", "Missing wtPdb or mutation.");
        return;
      }

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
      sendError(res, 500, "INTERNAL_ERROR", err.message || "Failed to submit DynaMut2 job.");
    }
  });

  apiRouter.post("/ddmut-submit", jsonParserPdb, async (req, res) => {
    try {
      const { wtPdb, mutation } = req.body;
      if (!wtPdb || !mutation) {
        sendError(res, 400, "BAD_REQUEST", "Missing wtPdb or mutation.");
        return;
      }

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
      sendError(res, 500, "INTERNAL_ERROR", err.message || "Failed to submit DDMut job.");
    }
  });

  apiRouter.post("/generate-mutant", jsonParserPdb, async (req, res) => {
    try {
      const { wtPdb, mutation, uniprotId } = req.body;

      if (!wtPdb || typeof wtPdb !== "string" || (!wtPdb.includes("ATOM") && !wtPdb.includes("HETATM"))) {
        sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records.");
        return;
      }
      if (wtPdb.length > 5 * 1024 * 1024) {
        sendError(res, 400, "BAD_REQUEST", "PDB file exceeds maximum size of 5MB.");
        return;
      }
      if (!mutation || typeof mutation !== "string" || !MUTATION_FOLDX_PATTERN.test(mutation.trim())) {
        sendError(res, 400, "BAD_REQUEST", "Invalid mutation code: must match FoldX format (e.g., RA215W).");
        return;
      }

      const mutTrimmed = mutation.trim();
      const wtLetter = mutTrimmed[0].toUpperCase();
      const mutLetter = mutTrimmed[mutTrimmed.length - 1].toUpperCase();
      if (wtLetter === mutLetter) {
        sendError(res, 400, "BAD_REQUEST", "Synonymous mutation detected: WT and mutant residues are identical.");
        return;
      }

      // Resolve chain and residue index from the WT PDB structure first
      const mutMatch = mutTrimmed.match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$/);
      if (!mutMatch) {
        sendError(res, 400, "BAD_REQUEST", "Invalid mutation code format.");
        return;
      }
      const chainParam = mutMatch[2].toUpperCase();
      const posNum = parseInt(mutMatch[3], 10);

      let resolvedChain = chainParam;
      let pdbResidues: any[] | null = null;
      try {
        pdbResidues = await parseResiduesFromPdbMaybeAsync(wtPdb);
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

      const jobId = crypto.randomUUID();
      const jobDir = path.join(process.cwd(), "temp_jobs", jobId);

      async function cleanupFiles() {
        try {
          if (fs.existsSync(jobDir)) {
            await fs.promises.rm(jobDir, { recursive: true, force: true });
            console.log(`[Cleanup] Deleted temporary job directory: ${jobDir}`);
          }
        } catch (cleanupErr: any) {
          console.error(`[Cleanup Error] Job directory cleanup failed:`, cleanupErr.message);
        }
      }

      try {
        let foldxResult: FoldXResult | null = null;
        let foldxError: any = null;

        let dynamut2JobId: string | null = null;
        let dynamut2Status: "pending" | "unavailable" | null = null;

        let ddmutJobId: string | null = null;
        let ddmutStatus: "pending" | "unavailable" | null = null;
        let thermompnnJobId: string | null = null;
        let thermompnnStatus: "pending" | "done" | "unavailable" | null = null;
        let thermompnnVal: number | null = null;
        let rasp: number | null = null;
        let raspReason: string | undefined = undefined;

        const tamarindApiKey = (req.headers["x-tamarind-api-key"] as string) || req.body?.tamarindApiKey || process.env.TAMARIND_API_KEY;

        const runFoldX = async (): Promise<FoldXResult | null> => {
          let acquired = false;
          try {
            await biophysicalSemaphore.acquire();
            acquired = true;

            await AuditLogger.log("GENERATE_MUTANT", {
              mutation: mutTrimmed
            });

            // Create job directory
            await fs.promises.mkdir(jobDir, { recursive: true });
            return await generateMutantPdb(wtPdb, mutTrimmed, uniprotId, jobDir);
          } catch (err: any) {
            foldxError = err;
            return null;
          } finally {
            if (acquired) {
              biophysicalSemaphore.release();
            }
          }
        };

        const d2Promise = submitDynaMut2Job(wtPdb, resolvedChainUpper, posNum, wtLetter, mutLetter)
          .then(async (id) => {
            if (id) {
              dynamut2JobId = id;
              dynamut2Status = "pending";
              await recordJobInRegistry(id, "dynamut2", mutTrimmed);
            } else {
              dynamut2Status = "unavailable";
            }
          })
          .catch(err => {
            console.warn("[DynaMut2 Background Submission Error] Failed to submit:", err.message);
            dynamut2Status = "unavailable";
          });

        const ddmutPromise = submitDdmutJob(wtPdb, resolvedChainUpper, posNum, wtLetter, mutLetter)
          .then(async (id) => {
            if (id) {
              ddmutJobId = id;
              ddmutStatus = "pending";
              await recordJobInRegistry(id, "ddmut", mutTrimmed);
            } else {
              ddmutStatus = "unavailable";
            }
          })
          .catch(err => {
            console.warn("[DDMut Background Submission Error] Failed to submit:", err.message);
            ddmutStatus = "unavailable";
          });

        const tmPromise = submitThermoMpnnJob(wtPdb, mutTrimmed, tamarindApiKey)
          .then(async (resObj) => {
            if (resObj.status === "done" && resObj.prediction !== null) {
              thermompnnVal = resObj.prediction;
              thermompnnStatus = "done";
            } else if (resObj.jobId && resObj.status === "pending") {
              thermompnnJobId = resObj.jobId;
              thermompnnStatus = "pending";
              await recordJobInRegistry(resObj.jobId, "thermompnn", mutTrimmed);
            } else {
              thermompnnStatus = "unavailable";
            }
          })
          .catch(err => {
            console.warn("[ThermoMPNN Background Submission Error] Failed to submit:", err.message);
            thermompnnStatus = "unavailable";
          });

        // Run FoldX, DynaMut2 job submission, DDMut job submission, and ThermoMPNN job submission in parallel
        const [foldxRes] = await Promise.all([
          runFoldX(),
          d2Promise,
          ddmutPromise,
          tmPromise
        ]);
        foldxResult = foldxRes;

        // Handle FoldX-phase errors that should abort the request (input errors / residue mismatch / engine unavailable)
        if (foldxError) {
          console.warn(`[Biophysical Server Route] FoldX execution error:`, foldxError.message);
          const reqId = req.headers["x-request-id"] as string;
          await AuditLogger.log("GENERATE_MUTANT_FAILED", {
            reqId,
            message: foldxError.message
          });

          if (foldxError.message.includes("not found in PDB") || foldxError.message.includes("mismatch")) {
            sendError(res, 422, "UNPROCESSABLE_ENTITY", foldxError.message);
            return;
          }

          // P0-2 Fix: Restore HTTP 503 MODELING_UNAVAILABLE fail-loud contract
          sendError(res, 503, "MODELING_UNAVAILABLE", `Biophysical modeling engine unavailable (FoldX execution failed: ${foldxError.message})`);
          return;
        }

        const reqId = (req.headers["x-request-id"] || crypto.randomUUID()) as string;
        await AuditLogger.log("DYNAMUT2_SUBMIT", {
          reqId,
          dynamut2JobId,
          status: dynamut2Status
        });

        await AuditLogger.log("DDMUT_SUBMIT", {
          reqId,
          ddmutJobId,
          status: ddmutStatus
        });

        await AuditLogger.log("THERMOMPNN_SUBMIT", {
          reqId,
          thermompnnJobId,
          status: thermompnnStatus
        });

        // Run RaSP sequentially after FoldX (requires mutant PDB text from foldxResult)
        if (foldxResult?.pdb) {
          try {
            const wtPdbPath = path.join(jobDir, "wt_for_rasp.pdb");
            const mutPdbPath = path.join(jobDir, "mut_for_rasp.pdb");
            await fs.promises.mkdir(jobDir, { recursive: true });
            await fs.promises.writeFile(wtPdbPath, wtPdb, "utf8");
            await fs.promises.writeFile(mutPdbPath, foldxResult.pdb, "utf8");
            const raspRes = await runRaspLocal(wtPdbPath, mutPdbPath, resolvedChainUpper, posNum, wtLetter, mutLetter, uniprotId);
            if (raspRes !== null) {
              rasp = raspRes.score;
              raspReason = raspRes.reason;
              console.log(`[RaSP] ΔΔG prediction: ${rasp} kcal/mol (reason: ${raspReason || 'none'})`);
            }
            // Clean up temp files
            await Promise.allSettled([
              fs.promises.unlink(wtPdbPath),
              fs.promises.unlink(mutPdbPath)
            ]);
          } catch (raspErr: any) {
            console.warn(`[RaSP] Failed to compute prediction:`, raspErr.message);
          }
        }

        // If FoldX succeeded, use its outputs
        const finalPdb = foldxResult ? foldxResult.pdb : wtPdb;
        const finalDdG = foldxResult ? foldxResult.ddG : null;
        const finalStatus = foldxResult ? foldxResult.status : "failed";

        const foldxMean = foldxResult?.energetics?.foldxMean ?? finalDdG;
        const foldxSd = foldxResult?.energetics?.foldxSd ?? null;
        const vdw = foldxResult?.energetics?.vdw ?? null;
        const electrostatics = foldxResult?.energetics?.electrostatics ?? null;
        const stericClashWarning = foldxResult?.energetics?.stericClashWarning ?? false;
        const localSidechainRmsd = foldxResult?.energetics?.localSidechainRmsd ?? null;

        // P0-4 Fix: Track evidence completeness and pending tools
        const pendingTools: string[] = [];
        if (dynamut2Status === "pending") pendingTools.push("DynaMut2");
        if (ddmutStatus === "pending") pendingTools.push("DDMut");
        if (thermompnnStatus === "pending") pendingTools.push("ThermoMPNN");

        const evidenceComplete = pendingTools.length === 0;
        const rawConsensusVerdict = computeConsensusVerdict({ foldxMean, rasp, thermompnn: thermompnnVal });
        const consensusVerdict = (!evidenceComplete && rawConsensusVerdict)
          ? `${rawConsensusVerdict} (Preliminary - pending: ${pendingTools.join(", ")})`
          : rawConsensusVerdict;

        res.json({
          pdb: finalPdb,
          ddG: finalDdG,
          status: finalStatus,
          foldedResidueIndex: posNum,
          resolvedChain: resolvedChainUpper,
          dynamut2JobId,
          dynamut2Status,
          ddmutJobId,
          ddmutStatus,
          thermompnnJobId,
          thermompnnStatus,
          energetics: {
            foldx: finalDdG,
            foldxMean,
            foldxSd,
            vdw,
            electrostatics,
            stericClashWarning,
            localSidechainRmsd,
            dynamut2: null,
            ddmut: null,
            rasp,
            raspReason,
            thermompnn: thermompnnVal,
            consensusVerdict,
            evidenceComplete,
            pendingTools
          },
          provenance: {
            foldxVersion: "5.0",
            foldxRuns: 5,
            raspDatasetSnapshot: "2023-Zenodo-6835877",
            vesmModel: "VESM_150M_v1",
            timestamp: new Date().toISOString()
          }
        });
      } finally {
        await cleanupFiles();
      }
    } catch (outerErr: any) {
      sendError(res, 500, "INTERNAL_ERROR", outerErr.message || "An unexpected error occurred.");
    }
  });

  apiRouter.post("/pocket-finder", jsonParserPdb, async (req, res) => {
    try {
      const { pdbText, targetIndex } = req.body;

      if (!pdbText || typeof pdbText !== "string" || (!pdbText.includes("ATOM") && !pdbText.includes("HETATM"))) {
        sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records.");
        return;
      }
      if (pdbText.length > 5 * 1024 * 1024) {
        sendError(res, 400, "BAD_REQUEST", "PDB file exceeds maximum size of 5MB.");
        return;
      }

      const mutIndex = targetIndex !== undefined && targetIndex !== null ? Number(targetIndex) : null;
      if (mutIndex === null || isNaN(mutIndex) || mutIndex <= 0 || mutIndex > 99999) {
        sendError(res, 400, "BAD_REQUEST", "Invalid targetIndex: must be a positive integer.");
        return;
      }

      try {
        const parsedResidues = await parseResiduesFromPdbMaybeAsync(pdbText);
        if (!parsedResidues || parsedResidues.length === 0) {
          throw new Error("PDB structure contains no parseable residues.");
        }
        const targetRes = parsedResidues.find(r => r.resSeq === mutIndex);
        if (!targetRes) {
          sendError(res, 400, "BAD_REQUEST", `Target residue index #${mutIndex} was not found in the PDB structure.`);
          return;
        }
      } catch (parseErr: any) {
        sendError(res, 400, "BAD_REQUEST", `Malformed PDB structure: ${parseErr.message}`);
        return;
      }

      let acquired = false;
      try {
        await biophysicalSemaphore.acquire();
        acquired = true;
      } catch (semErr: any) {
        sendError(res, 503, "CONCURRENCY_LIMIT", "Biophysical server is busy. Please try again later.");
        return;
      }

      const jobId = crypto.randomUUID();
      const jobDir = path.join(process.cwd(), "temp_jobs", jobId);

      async function cleanupPocketFiles() {
        try {
          if (fs.existsSync(jobDir)) {
            await fs.promises.rm(jobDir, { recursive: true, force: true });
            console.log(`[Cleanup] Deleted temporary pocket job directory: ${jobDir}`);
          }
        } catch (cleanupErr: any) {
          console.error("[Pocket Cleanup Error] Cleanup failed:", cleanupErr.message);
        }
      }

      try {
        const result = await findBindingPocket(pdbText, mutIndex, jobDir);
        res.json(result);

      } catch (err: any) {
        console.error("Pocket finder route failure:", err);
        const reqId = req.headers["x-request-id"] as string;
        await AuditLogger.log("POCKET_FINDER_FAILED", {
          reqId,
          message: err.message
        });
        if (err.message.includes("out of range") || err.message.includes("not found")) {
          sendError(res, 422, "UNPROCESSABLE_ENTITY", err.message);
        } else {
          sendError(res, 500, "INTERNAL_ERROR", err.message || "An error occurred during pocket finding.");
        }
      } finally {
        await cleanupPocketFiles();
        if (acquired) {
          biophysicalSemaphore.release();
        }
      }
    } catch (outerErr: any) {
      sendError(res, 500, "INTERNAL_ERROR", outerErr.message || "An unexpected error occurred.");
    }
  });

  apiRouter.post("/nearest-residues", jsonParserPdb, async (req, res) => {
    try {
      const { pdbText, targetIndex } = req.body;
      let n = req.body.n !== undefined ? Number(req.body.n) : 5;

      if (!pdbText || typeof pdbText !== "string" || (!pdbText.includes("ATOM") && !pdbText.includes("HETATM"))) {
        sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records.");
        return;
      }
      if (pdbText.length > 5 * 1024 * 1024) {
        sendError(res, 400, "BAD_REQUEST", "PDB file exceeds maximum size of 5MB.");
        return;
      }
      if (targetIndex === undefined || targetIndex === null || isNaN(Number(targetIndex))) {
        sendError(res, 400, "BAD_REQUEST", "Invalid targetIndex: must be a number.");
        return;
      }
      const targetIndexNum = Number(targetIndex);

      if (isNaN(n) || n <= 0) {
        n = 5;
      }
      if (n > 20) {
        n = 20;
      }

      const residues = await parseResiduesFromPdbMaybeAsync(pdbText);
        const targetRes = residues.find(r => r.resSeq === targetIndexNum);
        if (!targetRes) {
          sendError(res, 422, "UNPROCESSABLE_ENTITY", `Target residue position ${targetIndexNum} is not found in the PDB structure.`);
          return;
        }

        if (targetRes.x === undefined || targetRes.y === undefined || targetRes.z === undefined) {
          sendError(res, 422, "UNPROCESSABLE_ENTITY", `Coordinates for target residue position ${targetIndexNum} could not be extracted.`);
          return;
        }

        const computedNeighbors: any[] = [];
        for (const r of residues) {
          if (r.resSeq === targetIndexNum) continue;
          if (r.x === undefined || r.y === undefined || r.z === undefined) continue;

          const dx = r.x - targetRes.x;
          const dy = r.y - targetRes.y;
          const dz = r.z - targetRes.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          const details = getResidueDetails(r.resName3);
          computedNeighbors.push({
            index: r.resSeq,
            name: r.resName3,
            distance: parseFloat(dist.toFixed(2)),
            properties: details.properties,
            role: details.role,
            classBadge: details.classBadge
          });
        }

        computedNeighbors.sort((a, b) => a.distance - b.distance);
        const sliced = computedNeighbors.slice(0, n);

        res.json({
          residues: sliced,
          source: "computed"
        });
      } catch (err: any) {
      console.error("Nearest residues calculation failure:", err);
      sendError(res, 500, "INTERNAL_ERROR", err.message || "An error occurred while computing nearest residues.");
    }
  });
}

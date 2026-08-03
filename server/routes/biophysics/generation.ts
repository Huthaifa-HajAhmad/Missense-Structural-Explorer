import { type Router } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { z } from "zod";

import {
  sendError,
  validateGene,
  validateVariant,
  validateUniProt,
  AuditLogger,
  MUTATION_FOLDX_PATTERN,
  getApiKeyFromSession,
  formatZodError,
} from "../../utils.ts";
import { analyzeVariantLimiter } from "../../middleware.ts";
import {
  biophysicalSemaphore,
  generateMutantPdb,
  parseResiduesFromPdbMaybeAsync,
  runRaspLocal,
  submitThermoMpnnJob,
} from "../../services/biophysics.ts";
import {
  performGeminiBiophysicalAnalysis,
} from "../../services/gemini.ts";
import {
  submitDynaMut2Job,
  submitDdmutJob,
} from "../../services/external.ts";
import { type FoldXResult } from "../state.ts";
import { computeConsensusVerdict } from "../../../src/shared/thresholds.ts";
import { getFromCache, writeToCache, recordJobInRegistry } from "../shared.ts";

const generateMutantSchema = z.object({
  wtPdb: z.string(),
  mutation: z.string(),
  uniprotId: z.string().optional(),
  pH: z.union([z.number(), z.string()]).optional(),
  temperature: z.union([z.number(), z.string()]).optional(),
  ionicStrength: z.union([z.number(), z.string()]).optional()
});

export function registerGenerationRoutes(apiRouter: Router, jsonParserPdb: any): void {

  apiRouter.post("/analyze-variant-biophysical", jsonParserPdb, async (req, res) => {
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
          sendError(res, 500, "INTERNAL_SERVER_ERROR", innerError.message || "Failed to process biophysical request.");
        }
      };

      if (process.env.NODE_ENV === "test") {
        await runHandler();
      } else {
        analyzeVariantLimiter(req, res, runHandler);
      }
    } catch (error: any) {
      console.error("Biophysical endpoint failure:", error);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "Failed to process biophysical request.");
    }
  });

  apiRouter.post("/generate-mutant", jsonParserPdb, async (req, res) => {
    const parseResult = generateMutantSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
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
        const targetRes = pdbResidues.find(r => r.resSeq === posNum && r.chain === chainParam);
        if (targetRes) {
          resolvedChain = targetRes.chain;
        } else {
          sendError(res, 422, "UNPROCESSABLE_ENTITY", `Target residue position ${posNum} on chain ${chainParam} is not found in the PDB structure.`);
          return;
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
        let thermompnnStatus: "pending" | "done" | "unavailable" | "error" | null = null;
        let thermompnnError: string | null = null;
        let thermompnnVal: number | null = null;
        let rasp: number | null = null;
        let raspReason: string | undefined = undefined;

        const tamarindApiKey = (req.headers["x-tamarind-api-key"] as string) || req.body?.tamarindApiKey || process.env.TAMARIND_API_KEY;

        const pHVal = req.body.pH !== undefined ? parseFloat(String(req.body.pH)) : undefined;
        const tempVal = req.body.temperature !== undefined ? parseFloat(String(req.body.temperature)) : undefined;
        const ionVal = req.body.ionicStrength !== undefined ? parseFloat(String(req.body.ionicStrength)) : undefined;

        const foldxOptions = {
          pH: isNaN(pHVal as number) ? undefined : pHVal,
          temperature: isNaN(tempVal as number) ? undefined : tempVal,
          ionicStrength: isNaN(ionVal as number) ? undefined : ionVal
        };

        const runFoldX = async (): Promise<FoldXResult | null> => {
          let acquired = false;
          try {
            await biophysicalSemaphore.acquire();
            acquired = true;

            await AuditLogger.log("GENERATE_MUTANT", {
              mutation: mutTrimmed
            });

            await fs.promises.mkdir(jobDir, { recursive: true });
            return await generateMutantPdb(wtPdb, mutTrimmed, uniprotId, jobDir, undefined, foldxOptions);
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
            } else if (resObj.status === "error") {
              thermompnnStatus = "error";
              thermompnnError = resObj.error || "ThermoMPNN API submission error";
            } else {
              thermompnnStatus = "unavailable";
            }
          })
          .catch(err => {
            console.warn("[ThermoMPNN Background Submission Error] Failed to submit:", err.message);
            thermompnnStatus = "error";
            thermompnnError = err.message;
          });

        foldxResult = await runFoldX();

        const remoteSubmissions = Promise.all([d2Promise, ddmutPromise, tmPromise]);
        const fastTimeout = new Promise(resolve => setTimeout(resolve, 300));
        await Promise.race([remoteSubmissions, fastTimeout]);

        if (foldxError) {
          console.warn(`[Biophysical Server Route] FoldX execution error:`, foldxError.message);
          const reqId = req.headers["x-request-id"] as string;
          await AuditLogger.log("GENERATE_MUTANT_FAILED", {
            reqId,
            message: foldxError.message
          });

          if (foldxError.message.includes("semaphore") || foldxError.message.includes("Concurrency limit") || foldxError.message.includes("queue is full")) {
            sendError(res, 503, "CONCURRENCY_LIMIT", "Biophysical server is busy. Please try again later.");
            return;
          }

          if (foldxError.message.includes("not found in PDB") || foldxError.message.includes("mismatch")) {
            sendError(res, 422, "UNPROCESSABLE_ENTITY", foldxError.message);
            return;
          }

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
            await Promise.allSettled([
              fs.promises.unlink(wtPdbPath),
              fs.promises.unlink(mutPdbPath)
            ]);
          } catch (raspErr: any) {
            console.warn(`[RaSP] Failed to compute prediction:`, raspErr.message);
          }
        }

        const finalPdb = foldxResult ? foldxResult.pdb : wtPdb;
        const finalDdG = foldxResult ? foldxResult.ddG : null;
        const finalStatus = foldxResult ? foldxResult.status : "failed";

        const foldxMean = foldxResult?.energetics?.foldxMean ?? finalDdG;
        const foldxSd = foldxResult?.energetics?.foldxSd ?? null;
        const vdw = foldxResult?.energetics?.vdw ?? null;
        const electrostatics = foldxResult?.energetics?.electrostatics ?? null;
        const stericClashWarning = foldxResult?.energetics?.stericClashWarning ?? false;
        const localSidechainRmsd = foldxResult?.energetics?.localSidechainRmsd ?? null;

        const pendingTools: string[] = [];
        if (dynamut2Status === "pending") pendingTools.push("DynaMut2");
        if (ddmutStatus === "pending") pendingTools.push("DDMut");
        if (thermompnnStatus === "pending") pendingTools.push("ThermoMPNN");

        const evidenceComplete = pendingTools.length === 0;
        const foldxRepairFailed = foldxResult?.energetics?.foldxRepairFailed ?? false;
        const rawConsensusVerdict = computeConsensusVerdict({ foldxMean, rasp, thermompnn: thermompnnVal, foldxRepairFailed });
        const consensusVerdict = (!evidenceComplete && rawConsensusVerdict)
          ? `${rawConsensusVerdict} (Preliminary - pending: ${pendingTools.join(", ")})`
          : rawConsensusVerdict;

        res.json({
          pdb: finalPdb,
          ddG: finalDdG,
          foldxDdG: foldxMean,
          thermompnnDdG: thermompnnVal,
          status: finalStatus,
          foldedResidueIndex: posNum,
          resolvedChain: resolvedChainUpper,
          dynamut2JobId,
          dynamut2Status,
          ddmutJobId,
          ddmutStatus,
          thermompnnJobId,
          thermompnnStatus,
          thermompnnError,
          energetics: {
            foldx: finalDdG,
            foldxMean,
            foldxSd,
            vdw,
            electrostatics,
            stericClashWarning,
            localSidechainRmsd,
            foldxRepairFailed,
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
      sendError(res, 500, "INTERNAL_SERVER_ERROR", outerErr.message || "An unexpected error occurred.");
    }
  });
}

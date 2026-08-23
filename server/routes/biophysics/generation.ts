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
  anySignal,
} from "../../utils.ts";
import { analyzeVariantLimiter } from "../../middleware.ts";
import {
  generateMutantPdb,
  getMutantFromCache,
  writeMutantToCache,
  parseResiduesFromPdbMaybeAsync,
  runRaspLocal,
  submitThermoMpnnJob,
  getFoldxCacheKey,
  cleanPdbForFoldX,
} from "../../services/biophysics.ts";
import { runStabilityOracleAnalysis } from "../../services/stabilityoracle.ts";
import { fetchUniprotSequence } from "../../services/uniprot.ts";
import { BiophysicalJobQueue } from "../../services/biophysical-queue.ts";
import {
  performGeminiBiophysicalAnalysis,
  getConfiguredGeminiModels,
} from "../../services/gemini.ts";
import {
  submitDynaMut2Job,
  submitDdmutJob,
  fetchAlphafoldPdb,
} from "../../services/external.ts";
import { resolveStructure, type ResolvedStructure } from "../../services/structure-resolver.ts";
import { type FoldXResult } from "../state.ts";
import { computeConsensusVerdict, computeCalibratedConsensus } from "../../../src/shared/thresholds.ts";
import { getFromCache, writeToCache, recordJobInRegistry, enrichBiophysicalResult } from "../shared.ts";
import { AMINO_ACID_1_TO_3 } from "../../../src/aminoAcids.ts";

const generateMutantSchema = z.object({
  wtPdb: z.string().optional(),
  mutation: z.string().min(1).max(50),
  uniprotId: z.string().max(50).optional(),
  pH: z.union([z.number(), z.string()]).optional(),
  temperature: z.union([z.number(), z.string()]).optional(),
  ionicStrength: z.union([z.number(), z.string()]).optional()
});

const activeFoldxJobs = new Map<string, string>();

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

      const customSessionId = req.headers["x-gemini-session-id"] as string | undefined;
      let customApiKey: string | undefined;
      if (customSessionId) {
        customApiKey = getApiKeyFromSession(customSessionId);
        if (!customApiKey) {
          sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate in Settings.");
          return;
        }
      }

      const activeApiKey = customApiKey || process.env.GEMINI_API_KEY || "no_key";
      const keyHash = crypto.createHash("sha256").update(activeApiKey).digest("hex");
      const model = getConfiguredGeminiModels()[0];
      const cacheKey = `biophysical_${uniprotId}_${variant}_key:${keyHash}_model:${model}_schema:v2`;
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

          const clientAbortController = new AbortController();
          if (req && typeof req.on === "function") {
            req.on("close", () => {
              if (!res.headersSent) clientAbortController.abort();
            });
          }

          const timeoutSignal = AbortSignal.timeout(60000);
          const combinedSignal = anySignal([clientAbortController.signal, timeoutSignal]);
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
              combinedSignal as AbortSignal
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
      if (wtPdb) {
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
      }
      let resolvedChainUpper = resolvedChain.toUpperCase() || "A";

      const jobId = crypto.randomUUID();
      const jobDir = path.join(process.cwd(), "temp_jobs", jobId);

      let isCacheHit = false;
      let isExistingActiveJob = false;

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
        let stabilityoracleVal: number | null = null;

        const tamarindApiKey = (req.headers["x-tamarind-api-key"] as string) || req.body?.tamarindApiKey || process.env.TAMARIND_API_KEY;

      const pHVal = req.body.pH !== undefined ? parseFloat(String(req.body.pH)) : undefined;
      const tempVal = req.body.temperature !== undefined ? parseFloat(String(req.body.temperature)) : undefined;
      const ionVal = req.body.ionicStrength !== undefined ? parseFloat(String(req.body.ionicStrength)) : undefined;
      const seedVal = req.body.seed !== undefined ? parseInt(String(req.body.seed), 10) : undefined;

      // ── Authoritative server-side structure resolution ────────────────────────
      // resolveStructure() uses the same LRU-cached fetchers as the /pdb/ route, so
      // this is typically a cache hit (no extra network round-trip).
      let resolvedStructure: ResolvedStructure | null = null;
      try {
        resolvedStructure = await resolveStructure(uniprotId, posNum);
        if (resolvedStructure && resolvedStructure.provenance.source !== "alphafold") {
          try {
            const residues = await parseResiduesFromPdbMaybeAsync(resolvedStructure.pdbText);
            const targetChain = resolvedStructure.provenance.chainId || chainParam;
            const hasResidue = residues.some(r => r.resSeq === posNum && r.chain.toUpperCase() === targetChain.toUpperCase());
            if (!hasResidue) {
              console.warn(`[generate-mutant] Resolved structure ${resolvedStructure.provenance.pdbId} is missing coordinates for residue ${posNum} on chain ${targetChain}. Falling back to AlphaFold.`);
              const afData = await fetchAlphafoldPdb(uniprotId);
              if (afData) {
                resolvedStructure = {
                  pdbText: afData,
                  provenance: { source: "alphafold" }
                };
              }
            }
          } catch (checkErr: any) {
            console.warn("[generate-mutant] Failed to verify residue coverage in resolved structure:", checkErr.message);
          }
        }
      } catch (resolveErr: any) {
        console.warn("[generate-mutant] resolveStructure failed, falling back to client-provided PDB:", resolveErr.message);
      }
      // Use server-resolved PDB if available; otherwise trust the client-provided wtPdb
      const effectiveWtPdb = resolvedStructure?.pdbText ?? wtPdb;

      if (resolvedStructure && resolvedStructure.provenance.chainId) {
        resolvedChain = resolvedStructure.provenance.chainId;
        resolvedChainUpper = resolvedChain.toUpperCase() || "A";
      }
      const wt1 = mutTrimmed[0].toUpperCase();
      const mut1 = mutTrimmed[mutTrimmed.length - 1].toUpperCase();
      const actualMutation = `${wt1}${resolvedChain}${posNum}${mut1}`;

      if (!effectiveWtPdb || typeof effectiveWtPdb !== "string" || (!effectiveWtPdb.includes("ATOM") && !effectiveWtPdb.includes("HETATM"))) {
        sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records, and structure could not be resolved from UniProt.");
        return;
      }
      if (effectiveWtPdb.length > 5 * 1024 * 1024) {
        sendError(res, 400, "BAD_REQUEST", "Resolved or provided PDB file exceeds maximum size of 5MB.");
        return;
      }

      // 3-Way Fail-Fast Invariant Check (Finding 3.3)
      const expectedWt3 = AMINO_ACID_1_TO_3[wt1];
      try {
        const parsedResidues = await parseResiduesFromPdbMaybeAsync(effectiveWtPdb);
        const targetPdbRes = parsedResidues.find(r => r.resSeq === posNum && r.chain.toUpperCase() === resolvedChainUpper);
        if (!targetPdbRes) {
          sendError(res, 422, "UNPROCESSABLE_ENTITY", `Target residue position ${posNum} on chain ${resolvedChainUpper} is not found in the PDB structure.`);
          return;
        }
        if (expectedWt3 && targetPdbRes.resName3.toUpperCase() !== expectedWt3.toUpperCase()) {
          sendError(
            res,
            422,
            "UNPROCESSABLE_ENTITY",
            `Wild-type residue mismatch: mutation expects wild-type ${wt1} (${expectedWt3}) at position ${posNum}, but PDB structure contains ${targetPdbRes.resName3} on chain ${resolvedChainUpper}.`
          );
          return;
        }
      } catch (checkErr: any) {
        console.warn("[generate-mutant] Invariant check warning:", checkErr.message);
      }

        const foldxOptions = {
          pH: isNaN(pHVal as number) ? undefined : pHVal,
          temperature: isNaN(tempVal as number) ? undefined : tempVal,
          ionicStrength: isNaN(ionVal as number) ? undefined : ionVal,
          seed: isNaN(seedVal as number) ? undefined : seedVal
        };

        const clientAbortController = new AbortController();
        if (req && typeof req.on === "function") {
          req.on("close", () => {
            if (!res.headersSent) clientAbortController.abort();
          });
        }
        const combinedSignal = anySignal([clientAbortController.signal, AbortSignal.timeout(240000)]);

        // 1. Calculate cache key for FoldX mutant (consistent with foldx.ts)
        const normalizedPdb = cleanPdbForFoldX(effectiveWtPdb);
        const pdbHash = crypto.createHash("sha256").update(normalizedPdb).digest("hex");
        const foldxCacheKey = getFoldxCacheKey(pdbHash, actualMutation, foldxOptions);

        const cachedFoldx = getMutantFromCache(foldxCacheKey);

        let queueJobId: string | null = null;
        isExistingActiveJob = false;

        if (!cachedFoldx) {
          const queue = BiophysicalJobQueue.getInstance();
          const existingJobId = activeFoldxJobs.get(foldxCacheKey);
          if (existingJobId) {
            const statusInfo = await queue.getJobStatus(existingJobId);
            if (statusInfo && (statusInfo.status === "queued" || statusInfo.status === "running")) {
              queueJobId = existingJobId;
              isExistingActiveJob = true;
              const existingJobData = await queue.getJobData(existingJobId);
              if (existingJobData && existingJobData.remoteJobs) {
                dynamut2JobId = existingJobData.remoteJobs.dynamut2JobId;
                dynamut2Status = existingJobData.remoteJobs.dynamut2Status;
                ddmutJobId = existingJobData.remoteJobs.ddmutJobId;
                ddmutStatus = existingJobData.remoteJobs.ddmutStatus;
                thermompnnJobId = existingJobData.remoteJobs.thermompnnJobId;
                thermompnnStatus = existingJobData.remoteJobs.thermompnnStatus;
                thermompnnError = existingJobData.remoteJobs.thermompnnError;
              }
              console.log(`[Biophysical Deduplication] Joined existing active queued/running FoldX job: ${queueJobId}`);
            } else {
              activeFoldxJobs.delete(foldxCacheKey);
            }
          }

          if (!isExistingActiveJob) {
            await AuditLogger.log("GENERATE_MUTANT", {
              mutation: actualMutation
            });
            try {
              queueJobId = await queue.pushJob("foldx", {
                wtPdb: effectiveWtPdb,
                mutation: actualMutation,
                uniprotId,
                jobDir,
                options: foldxOptions,
                structureProvenance: {
                  source: resolvedStructure?.provenance.source ?? "client-provided",
                  pdbId: resolvedStructure?.provenance.pdbId ?? null,
                  chainId: resolvedStructure?.provenance.chainId ?? null,
                  resolution: resolvedStructure?.provenance.resolution ?? null,
                  method: resolvedStructure?.provenance.method ?? null,
                  identity: resolvedStructure?.provenance.identity ?? null,
                  raspDatasetSnapshot: "2023-Zenodo-6835877",
                  vesmModel: "VESM_150M_v1",
                  timestamp: new Date().toISOString()
                },
                remoteJobs: {
                  dynamut2JobId: null,
                  dynamut2Status: "pending",
                  ddmutJobId: null,
                  ddmutStatus: "pending",
                  thermompnnJobId: null,
                  thermompnnStatus: "pending",
                  thermompnnError: null,
                  thermompnnVal: null,
                  stabilityoracleVal: null
                }
              });
              activeFoldxJobs.set(foldxCacheKey, queueJobId);
            } catch (queueErr: any) {
              if (queueErr.message.includes("BUSY")) {
                throw queueErr;
              }
              throw queueErr;
            }
          }
        }

        async function updateQueueJobRemoteData(updates: any) {
          if (!queueJobId || isExistingActiveJob) return;
          try {
            const queue = BiophysicalJobQueue.getInstance();
            const jobData = await queue.getJobData(queueJobId);
            if (jobData && jobData.remoteJobs) {
              jobData.remoteJobs = {
                ...jobData.remoteJobs,
                ...updates
              };
              await queue.updateJobData(queueJobId, jobData);
            }
          } catch (err: any) {
            console.warn("[updateQueueJobRemoteData Warning] Failed to update queue job:", err.message);
          }
        }

        let d2Promise = Promise.resolve();
        let ddmutPromise = Promise.resolve();
        let tmPromise = Promise.resolve();
        let stabilityOraclePromise = Promise.resolve();

        if (!cachedFoldx && !isExistingActiveJob) {
          const backgroundRemoteSignal = AbortSignal.timeout(180000);
          const cleanedRemotePdb = cleanPdbForFoldX(effectiveWtPdb);

          d2Promise = submitDynaMut2Job(cleanedRemotePdb, resolvedChainUpper, posNum, wtLetter, mutLetter, backgroundRemoteSignal)
            .then(async (id) => {
              if (id) {
                dynamut2JobId = id;
                dynamut2Status = "pending";
                await recordJobInRegistry(id, "dynamut2", actualMutation);
              } else {
                dynamut2Status = "unavailable";
              }
              await updateQueueJobRemoteData({ dynamut2JobId, dynamut2Status });
            })
            .catch(async (err) => {
              console.warn("[DynaMut2 Background Submission Error] Failed to submit:", err.message);
              dynamut2Status = "unavailable";
              await updateQueueJobRemoteData({ dynamut2Status });
            });

          // Stagger DDMut submission slightly (350ms) to avoid instantaneous host lock / rate limit collision on biosig.lab.uq.edu.au
          ddmutPromise = (async () => {
            await new Promise(r => setTimeout(r, 350));
            return submitDdmutJob(cleanedRemotePdb, resolvedChainUpper, posNum, wtLetter, mutLetter, backgroundRemoteSignal);
          })()
            .then(async (id) => {
              if (id) {
                ddmutJobId = id;
                ddmutStatus = "pending";
                await recordJobInRegistry(id, "ddmut", actualMutation);
              } else {
                ddmutStatus = "unavailable";
              }
              await updateQueueJobRemoteData({ ddmutJobId, ddmutStatus });
            })
            .catch(async (err) => {
              console.warn("[DDMut Background Submission Error] Failed to submit:", err.message);
              ddmutStatus = "unavailable";
              await updateQueueJobRemoteData({ ddmutStatus });
            });

          tmPromise = submitThermoMpnnJob(cleanedRemotePdb, actualMutation, tamarindApiKey, backgroundRemoteSignal)
            .then(async (resObj) => {
              if (resObj.status === "done" && resObj.prediction !== null) {
                thermompnnVal = resObj.prediction;
                thermompnnStatus = "done";
              } else if (resObj.jobId && resObj.status === "pending") {
                thermompnnJobId = resObj.jobId;
                thermompnnStatus = "pending";
                await recordJobInRegistry(resObj.jobId, "thermompnn", actualMutation);
              } else if (resObj.status === "error") {
                thermompnnStatus = "error";
                thermompnnError = resObj.error || "ThermoMPNN API submission error";
              } else {
                thermompnnStatus = "unavailable";
              }
              await updateQueueJobRemoteData({
                thermompnnJobId,
                thermompnnStatus,
                thermompnnError,
                thermompnnVal
              });
            })
            .catch(async (err) => {
              console.warn("[ThermoMPNN Background Submission Error] Failed to submit:", err.message);
              thermompnnStatus = "error";
              thermompnnError = err.message;
              await updateQueueJobRemoteData({
                thermompnnStatus,
                thermompnnError
              });
            });

          const sequence = await fetchUniprotSequence(uniprotId).catch(() => "");
          stabilityOraclePromise = runStabilityOracleAnalysis(
            "UNKNOWN",
            `${wtLetter}${posNum}${mutLetter}`,
            uniprotId,
            sequence,
            effectiveWtPdb
          )
            .then(async (resObj) => {
              if (resObj) {
                stabilityoracleVal = resObj.ddG;
              }
              await updateQueueJobRemoteData({ stabilityoracleVal });
            })
            .catch(err => {
              console.warn("[StabilityOracle Background Error] Failed:", err.message);
            });
        }

        // Detach: keep a settled handler so Node does not surface unhandled rejection warnings.
        Promise.allSettled([d2Promise, ddmutPromise, tmPromise, stabilityOraclePromise]);

        // P0-1.2: Fire remote submissions asynchronously in the background.
        // The queue worker already records remote-job state via `updateQueueJobRemoteData`,
        // so the client can poll `/foldx-job/:jobId` to see DynaMut2/DDMut/ThermoMPNN progress.
        // Do not block the response on those submissions — they are optional enrichment and
        // must never stall the FoldX enqueue when their upstream is degraded.
        if (cachedFoldx) {
          // Cache hit: return full result synchronously
          console.log(`[Cache Hit] Serving cached mutant simulation for ${foldxCacheKey}`);
          isCacheHit = true;

          let finalStabilityoracleVal = stabilityoracleVal ?? cachedFoldx?.energetics?.stabilityoracle ?? null;
          if (finalStabilityoracleVal === null && effectiveWtPdb) {
            try {
              const soRes = await runStabilityOracleAnalysis(
                uniprotId || "UNKNOWN",
                `${wtLetter}${posNum}${mutLetter}`,
                uniprotId || "",
                "",
                effectiveWtPdb
              );
              if (soRes) {
                finalStabilityoracleVal = soRes.ddG;
                if (cachedFoldx.energetics) {
                  cachedFoldx.energetics.stabilityoracle = finalStabilityoracleVal;
                }
                writeMutantToCache(foldxCacheKey, cachedFoldx);
              }
            } catch (soErr: any) {
              console.warn("[StabilityOracle Cache Backfill Warning]:", soErr.message);
            }
          }

          const enriched = enrichBiophysicalResult(cachedFoldx, {
            dynamut2JobId,
            dynamut2Status,
            ddmutJobId,
            ddmutStatus,
            thermompnnJobId,
            thermompnnStatus,
            thermompnnError,
            thermompnnVal,
            stabilityoracleVal: finalStabilityoracleVal
          }, {
            source: resolvedStructure?.provenance.source ?? "client-provided",
            pdbId: resolvedStructure?.provenance.pdbId ?? null,
            chainId: resolvedStructure?.provenance.chainId ?? null,
            resolution: resolvedStructure?.provenance.resolution ?? null,
            method: resolvedStructure?.provenance.method ?? null,
            identity: resolvedStructure?.provenance.identity ?? null,
            raspDatasetSnapshot: "2023-Zenodo-6835877",
            vesmModel: "VESM_150M_v1",
            timestamp: new Date().toISOString()
          }, posNum);

          res.json(enriched);
          return;
        }

        res.json({
          status: "queued",
          foldxJobId: queueJobId,
          dynamut2JobId,
          dynamut2Status,
          ddmutJobId,
          ddmutStatus,
          thermompnnJobId,
          thermompnnStatus,
          thermompnnError
        });
      } catch (err: any) {
        if (err.message.includes("BUSY")) {
          sendError(res, 503, "SERVICE_UNAVAILABLE", "Biophysical queue is busy. Please try again later.");
        } else {
          throw err;
        }
      } finally {
        if (isCacheHit || isExistingActiveJob) {
          try {
            await cleanupFiles();
          } catch (cleanupErr: any) {
            console.warn(`[Cleanup Warning] Failed to cleanup temp files: ${cleanupErr.message}`);
          }
        }
      }
    } catch (outerErr: any) {
      if (!res.headersSent) {
        sendError(res, 500, "INTERNAL_SERVER_ERROR", outerErr.message || "An unexpected error occurred.");
      } else {
        console.error(`[Generation Error after headers sent]`, outerErr);
      }
    }
  });
}

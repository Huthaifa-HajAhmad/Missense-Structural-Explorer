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
  onClientDisconnect,
} from "../../utils.ts";
import { analyzeVariantLimiter } from "../../middleware.ts";
import { geminiCredentialSegment } from "../../services/infra/cache-keys.ts";
import {
  generateMutantPdb,
  getMutantFromCache,
  writeMutantToCache,
  parseResiduesFromPdbMaybeAsync,
  runRaspLocal,
  getRaspCoverage,
  RASP_STORE_UNAVAILABLE_REASON,
  submitThermoMpnnJob,
  cleanPdbForFoldX,
} from "../../services/biophysics.ts";
import {
  activeFoldxJobs,
  buildFoldxCacheKey,
  submitOrJoinFoldxJob,
} from "../../services/infra/foldx-job-registry.ts";
import { runStabilityOracleAnalysisDetailed } from "../../services/stabilityoracle.ts";
import { BiophysicalJobQueue } from "../../services/biophysical-queue.ts";
import {
  performGeminiBiophysicalAnalysis,
  getConfiguredGeminiModels,
  isGeminiApiKeyPlaceholder,
} from "../../services/gemini.ts";
import {
  fetchAlphafoldPdb,
} from "../../services/external.ts";
import { resolveStructure, type ResolvedStructure } from "../../services/structure-resolver.ts";
import { type FoldXResult } from "../state.ts";
// (the consensus is computed once, in `enrichBiophysicalResult`, and is no longer recomputed here)
import { getFromCache, writeToCache, enrichBiophysicalResult } from "../shared.ts";
import { AMINO_ACID_1_TO_3 } from "../../../src/shared/aminoAcids.ts";
import { submitterId, submitterLimits, submitterPlacementPref } from "../../auth/principal.ts";
import { QueueLimitError } from "../../services/infra/queue-owners.ts";
import { AdmissionError } from "../../services/infra/admission.ts";
import { countResidues, foldxQueueCostEstimateMs } from "../../services/stability/foldx/estimate.ts";
import { agentJoinGuard } from "../../services/infra/agent-jobs.ts";
import { fetchProtVarFoldx, protvarErrorFields, protvarJobFields } from "../../services/external-api/protvar.ts";
import { residueOfRequest } from "../variant/residue-of-request.ts";
import { CALLER_NUMBERING_REASON } from "../../services/stability/foldx-queue-job.ts";

const generateMutantSchema = z.object({
  wtPdb: z.string().optional(),
  mutation: z.string().min(1).max(50),
  uniprotId: z.string().max(50).optional(),
  pH: z.union([z.number(), z.string()]).optional(),
  temperature: z.union([z.number(), z.string()]).optional(),
  ionicStrength: z.union([z.number(), z.string()]).optional(),
  seed: z.union([z.number(), z.string()]).optional(),
  /** The run's signed numbering proof (`numbering-proof.ts`), sent back unchanged. */
  numberingProof: z.string().max(1024).optional()
});

/**
 * In-flight FoldX jobs, keyed by the FoldX cache key.
 *
 * Re-exported from the shared registry so every submitter — this route and the speculative pre-warm
 * — deduplicates through ONE map. Two maps meant a pre-warm job was invisible here and one variant
 * could run two concurrent FoldX jobs (audit R2-F4).
 */
export { activeFoldxJobs };

export interface InFlightSubmissions {
  /**
   * ThermoMPNN's submission answers with a prediction (local sidecar, synchronous)
   * or a refusal with its reason. Two callers for one variant therefore share ONE call; joining a
   * second submission would queue it behind the very CPU pass the first is waiting on.
   */
  thermompnnPromise?: ReturnType<typeof submitThermoMpnnJob>;
}
export const inFlightRemoteSubmissions = new Map<string, InFlightSubmissions>();

/**
 * Release a settled ThermoMPNN call immediately: this promise carries a value OR a refusal, so
 * keeping it would make the next analysis join an old busy/error answer instead of submitting
 * again. A newer promise for the same cache key is kept.
 */
export function releaseThermoSubmission(cacheKey: string, promise: Promise<unknown>): void {
  const current = inFlightRemoteSubmissions.get(cacheKey);
  if (!current) return;
  if (current.thermompnnPromise === promise) delete current.thermompnnPromise;
  if (!current.thermompnnPromise) {
    inFlightRemoteSubmissions.delete(cacheKey);
  }
}

export function clearInFlightRemoteSubmissions(): void {
  inFlightRemoteSubmissions.clear();
  activeFoldxJobs.clear();
  pendingRemoteSubmissions.clear();
}

/**
 * Companion ThermoMPNN submission still resolving when a CACHE-HIT response was sent, keyed by an opaque token.
 */
export interface RemoteSubmissionOutcome {
  thermompnnStatus: string | null;
  thermompnnError: string | null;
  thermompnnVal: number | null;
}
export const pendingRemoteSubmissions = new Map<string, { promise: Promise<RemoteSubmissionOutcome>; expiresAt: number }>();
/** Longest the long-poll holds a request open: past the 30 s submission timeout plus one retry. */
export const REMOTE_SUBMISSION_WAIT_MS = 75_000;
const REMOTE_SUBMISSION_TTL_MS = 10 * 60_000;
/**
 * The one signal every background remote submission of an analysis shares. It must stay longer than
 * each engine's own budget + wait, or the caller aborts before the engine can explain itself; the
 * nesting is asserted in `server/tests/sidecar-budget.test.ts`.
 */
export const BACKGROUND_REMOTE_TIMEOUT_MS = 180_000;

function pruneRemoteSubmissions(now = Date.now()): void {
  for (const [token, entry] of pendingRemoteSubmissions) {
    if (entry.expiresAt <= now) pendingRemoteSubmissions.delete(token);
  }
}

export function registerGenerationRoutes(apiRouter: Router, jsonParserPdb: any): void {

  /**
   * The job ids of remote engines submitted during a FoldX cache hit (see `pendingRemoteSubmissions`).
   * Holds the request open until every submission has settled or REMOTE_SUBMISSION_WAIT_MS passes;
   * `settled: false` means the wait ran out, which the client reports as no result.
   */
  apiRouter.get("/remote-submissions/:token", async (req, res) => {
    const token = req.params.token;
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid remote submission token.");
      return;
    }
    pruneRemoteSubmissions();
    const entry = pendingRemoteSubmissions.get(token);
    if (!entry) {
      sendError(res, 404, "NOT_FOUND", "Unknown or expired remote submission token.");
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeDisconnect = () => {};
    const timedOut = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), REMOTE_SUBMISSION_WAIT_MS);
      removeDisconnect = onClientDisconnect(res, () => {
        if (timer) clearTimeout(timer);
        resolve(null);
      });
    });
    const outcome = await Promise.race([entry.promise, timedOut]);
    if (timer) clearTimeout(timer);
    removeDisconnect();
    if ((res as any).writableEnded || (res as any).destroyed) {
      return;
    }
    if (!outcome) {
      res.json({ settled: false });
      return;
    }
    res.json({ settled: true, ...outcome });
  });

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

      const model = getConfiguredGeminiModels()[0];
      // Same effective key as the narrative route: a placeholder env value is no key.
      const envKey = process.env.GEMINI_API_KEY && !isGeminiApiKeyPlaceholder(process.env.GEMINI_API_KEY)
        ? process.env.GEMINI_API_KEY
        : undefined;
      const credential = geminiCredentialSegment(customApiKey || envKey);
      const cacheKey = `biophysical_${uniprotId}_${variant}_${credential}_model:${model}_schema:v3`;
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
          // Detect disconnects on `res`: `req` 'close' fires as soon as the body is read.
          onClientDisconnect(res, () => clientAbortController.abort());

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
            // A placeholder ("details unavailable …", returned when no model produced anything) is
            // answered but not cached: the key is shared by every keyed user for 24 h (WP-I2).
            if (!/details unavailable/i.test(String(result?.biochemicalShift ?? ""))) writeToCache(cacheKey, result);
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
      const {
        wtPdb,
        mutation,
        uniprotId,
        pH,
        temperature,
        ionicStrength,
        seed,
        numberingProof
      } = parseResult.data;

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

        let thermompnnStatus: "pending" | "done" | "unavailable" | "error" | "busy" | null = null;
        let thermompnnError: string | null = null;
        let thermompnnVal: number | null = null;
        let rasp: number | null = null;
        let raspReason: string | undefined = undefined;
        let stabilityoracleVal: number | null = null;

      const pHVal = pH !== undefined ? parseFloat(String(pH)) : undefined;
      const tempVal = temperature !== undefined ? parseFloat(String(temperature)) : undefined;
      const ionVal = ionicStrength !== undefined ? parseFloat(String(ionicStrength)) : undefined;
      const seedVal = seed !== undefined ? parseInt(String(seed), 10) : undefined;

      const wt1 = mutTrimmed[0].toUpperCase();
      const mut1 = mutTrimmed[mutTrimmed.length - 1].toUpperCase();
      const expectedWt3 = AMINO_ACID_1_TO_3[wt1];

      // ── Structure resolution & validation ────────────────────────
      let effectiveWtPdb = wtPdb;
      let resolvedStructure: ResolvedStructure | null = null;

      // Check if client-provided PDB contains the matching wild-type residue
      let clientPdbValid = false;
      if (wtPdb && typeof wtPdb === "string" && (wtPdb.includes("ATOM") || wtPdb.includes("HETATM"))) {
        try {
          const residues = await parseResiduesFromPdbMaybeAsync(wtPdb);
          const targetRes = residues.find(r => r.resSeq === posNum && r.chain.toUpperCase() === chainParam);
          if (targetRes && (!expectedWt3 || targetRes.resName3.toUpperCase() === expectedWt3.toUpperCase())) {
            clientPdbValid = true;
            resolvedChain = targetRes.chain;
            resolvedChainUpper = resolvedChain.toUpperCase() || "A";
          }
        } catch (_) {}
      }

      if (!clientPdbValid && uniprotId?.trim()) {
        // Resolve structure from PDBe / AlphaFold
        try {
          /**
           * FoldX and the remote ΔΔG engines MUTATE this template. An experimental chain that
           * already carries a substitution (UROD 1R3S is the D86G mutant) would be mutated a second
           * time, so the resolver is asked for a wild-type chain and falls to the AlphaFold model
           * when the crystal is not one. The provenance carries which entry was refused and why.
           */
          resolvedStructure = await resolveStructure(uniprotId, posNum, { requireWildType: true });
          if (resolvedStructure) {
            const residues = await parseResiduesFromPdbMaybeAsync(resolvedStructure.pdbText);
            const targetChain = resolvedStructure.provenance.chainId || chainParam;
            const targetRes = residues.find(r => r.resSeq === posNum && r.chain.toUpperCase() === targetChain.toUpperCase());
            const matchesExpected = targetRes && (!expectedWt3 || targetRes.resName3.toUpperCase() === expectedWt3.toUpperCase());

            if (!matchesExpected && resolvedStructure.provenance.source !== "alphafold") {
              console.warn(`[generate-mutant] Resolved structure ${resolvedStructure.provenance.pdbId} lacks matching wild-type ${wt1} at position ${posNum} on chain ${targetChain}. Falling back to AlphaFold.`);
              const afData = await fetchAlphafoldPdb(uniprotId);
              if (afData) {
                resolvedStructure = {
                  pdbText: afData,
                  // Keep the resolution's own disclosures (the wild-type refusal, the version): the
                  // screen must still be able to say why the experimental entry is not the template.
                  provenance: {
                    source: "alphafold",
                    ...(resolvedStructure.provenance.afdbVersion ? { afdbVersion: resolvedStructure.provenance.afdbVersion } : {}),
                    ...(resolvedStructure.provenance.excludedExperimental ? { excludedExperimental: resolvedStructure.provenance.excludedExperimental } : {})
                  }
                };
              }
            }
          }
        } catch (resolveErr: any) {
          console.warn("[generate-mutant] resolveStructure failed, falling back to client-provided PDB:", resolveErr.message);
        }

        effectiveWtPdb = resolvedStructure?.pdbText ?? wtPdb;
        if (resolvedStructure && resolvedStructure.provenance.chainId) {
          resolvedChain = resolvedStructure.provenance.chainId;
          resolvedChainUpper = resolvedChain.toUpperCase() || "A";
        }
      }

      const actualMutation = `${wt1}${resolvedChain}${posNum}${mut1}`;
      /**
       * How the position's numbering was proven, for the audit entry. A structure the caller sent is read
       * in its own numbering, which is not UniProt numbering, so no proof applies to it. Nothing is
       * refused on it yet (doc/VERIFIED_RESIDUE_DESIGN.md §4, step A).
       */
      const numberingFields = (() => {
        if (clientPdbValid || !uniprotId?.trim()) return { numberingProofCheck: "caller-structure" };
        const { residue, rejectedProof } = residueOfRequest({
          token: numberingProof,
          identity: { accession: uniprotId.trim(), position: posNum, wildType: wt1, mutant: mut1 },
        });
        return { numberingProof: residue.proof, ...(rejectedProof ? { numberingProofCheck: rejectedProof } : {}) };
      })();
      const logGenerateMutant = (served: "queued" | "joined" | "cache-hit") =>
        AuditLogger.log("GENERATE_MUTANT", { mutation: actualMutation, served, ...numberingFields });

      if (!effectiveWtPdb || typeof effectiveWtPdb !== "string" || (!effectiveWtPdb.includes("ATOM") && !effectiveWtPdb.includes("HETATM"))) {
        if (!wtPdb && uniprotId?.trim()) {
          // Nothing was sent, so nothing sent was invalid. The resolver answers null both when no model
          // covers the residue and when a provider failed, so the message claims neither.
          sendError(res, 422, "NO_STRUCTURE", `We could not obtain a usable structure for residue ${posNum} of ${uniprotId.trim()}: no experimental chain or AlphaFold model could be used, or a structure provider did not answer. The structure-based engines did not run; trying again later may help.`);
          return;
        }
        sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records, and structure could not be resolved from UniProt.");
        return;
      }
      if (effectiveWtPdb.length > 5 * 1024 * 1024) {
        sendError(res, 400, "BAD_REQUEST", "Resolved or provided PDB file exceeds maximum size of 5MB.");
        return;
      }

      // 3-Way Fail-Fast Invariant Check (Finding 3.3)
      try {
        const parsedResidues = await parseResiduesFromPdbMaybeAsync(effectiveWtPdb);
        const targetPdbRes = parsedResidues.find(r => r.resSeq === posNum && r.chain.toUpperCase() === resolvedChainUpper);
        if (!targetPdbRes) {
          sendError(res, 422, "UNPROCESSABLE_ENTITY", `Target residue position ${posNum} on chain ${resolvedChainUpper} is not found in the PDB structure.`);
          return;
        }
        if (expectedWt3 && targetPdbRes.resName3.toUpperCase() !== expectedWt3.toUpperCase()) {
          // The numbering note must match where the structure actually came from: asserting
          // "canonical numbering" for a client-supplied or experimental PDB sends the user
          // looking for an isoform problem when the real cause may be the structure's own
          // construct numbering.
          const structureSource = resolvedStructure?.provenance.source ?? "client-provided";
          const numberingNote =
            structureSource === "alphafold"
              ? "The AlphaFold model follows this protein's canonical sequence numbering — if the" +
                " notation came from a different isoform (e.g. MANE Select), re-enter it in" +
                " canonical numbering, and check the wild-type residue."
              : `The ${structureSource === "client-provided" ? "supplied" : structureSource} structure may use its own construct numbering — verify the structure's residue numbering against the notation, and re-enter the substitution in canonical numbering.`;
          sendError(
            res,
            422,
            "UNPROCESSABLE_ENTITY",
            `Wild-type residue mismatch: mutation expects wild-type ${wt1} (${expectedWt3}) at position ${posNum}, but PDB structure contains ${targetPdbRes.resName3} on chain ${resolvedChainUpper}. ` +
              numberingNote
          );
          return;
        }
      } catch (checkErr: any) {
        console.warn("[generate-mutant] Invariant check warning:", checkErr.message);
      }

        /**
         * The FoldX environment, in FOLDX'S OWN UNITS — temperature in KELVIN, ionic strength in
         * MOLAR (pH is unit-free). They are forwarded verbatim to `--temperature` /
         * `--ionStrength`, and they are part of the mutant cache key, so this route must NOT convert
         * them: the client's Settings panel collects °C and mM and converts at its own boundary
         * (`src/shared/biophysicsConditions.ts`). Converting here as well would double-convert, and
         * converting here *instead* would silently reinterpret every caller that already sends
         * native units.
         */
        const foldxOptions = {
          pH: isNaN(pHVal as number) ? undefined : pHVal,
          temperature: isNaN(tempVal as number) ? undefined : tempVal,
          ionicStrength: isNaN(ionVal as number) ? undefined : ionVal,
          seed: isNaN(seedVal as number) ? undefined : seedVal
        };

        // 1. Calculate cache key for FoldX mutant (one derivation, shared with the pre-warm registry)
        const foldxCacheKey = buildFoldxCacheKey(effectiveWtPdb, actualMutation, foldxOptions);

        // Served only if this person may have it (a result from someone's own computer may be private).
        const cachedFoldx = await getMutantFromCache(foldxCacheKey, submitterId(req) ?? null);

        let queueJobId: string | null = null;
        isExistingActiveJob = false;
        /**
         * The joined job's real state, when this request joined one instead of creating it.
         *
         * Without this the response described a RUNNING job as "queued" with a queue position
         * computed from other waiting jobs — a constant presented as an observation, corrected only
         * by the first poll. `existingJobData` is read below, inside the join branch.
         */
        let joinedJobStatus: "queued" | "running" | null = null;
        let joinedJobPhase: string | null = null;
        let joinedJobStartedAt: number | null = null;
        /**
         * True when the job joined here was submitted by the PRE-WARM, not by a reader's request.
         *
         * The two are not interchangeable. A joined reader request relies on the original submitter
         * having already dispatched ThermoMPNN / StabilityOracle and writing the job's companion
         * fields — the pre-warm does neither (it has no reader tokens and its results are only a
         * cache warm). Treating a joined pre-warm job as a joined request would answer the reader
         * with those engines missing and nothing on the way to fill them in, which is the
         * "pending with no route to a result" defect this file has already been fixed for once. So
         * a pre-warm join takes over BOTH jobs: the companion submissions and the writes.
         */
        let joinedJobIsPrewarm = false;

        /**
         * Where this request's structure came from. Built once, because a joined PRE-WARM job has no
         * provenance of its own (it was submitted with no reader context) and this request must
         * supply it — the keys matched, so this IS the run's structure.
         */
        const structureProvenance = {
          source: resolvedStructure?.provenance.source ?? "client-provided",
          pdbId: resolvedStructure?.provenance.pdbId ?? null,
          chainId: resolvedStructure?.provenance.chainId ?? null,
          resolution: resolvedStructure?.provenance.resolution ?? null,
          method: resolvedStructure?.provenance.method ?? null,
          identity: resolvedStructure?.provenance.identity ?? null,
          ...(resolvedStructure?.provenance.afdbVersion
            ? { afdbVersion: resolvedStructure.provenance.afdbVersion }
            : {}),
          /**
           * Why the screen does not show the experimental entry beside this AlphaFold template:
           * the chain is not the wild type. `sequenceDifferences` is the other side of the same
           * fact — an experimental template that WAS kept (a view) and the residues it departs by.
           */
          ...(resolvedStructure?.provenance.sequenceDifferences
            ? { sequenceDifferences: resolvedStructure.provenance.sequenceDifferences }
            : {}),
          ...(resolvedStructure?.provenance.excludedExperimental
            ? { excludedExperimental: resolvedStructure.provenance.excludedExperimental }
            : {}),
          timestamp: new Date().toISOString()
        };

        if (!cachedFoldx) {
          const queue = BiophysicalJobQueue.getInstance();
          const submission = await submitOrJoinFoldxJob({
            cacheKey: foldxCacheKey,
            queue,
            // A job running on someone's own computer is joined only if its result may be given to this caller.
            mayJoin: agentJoinGuard(queue, submitterId(req) ?? null),
            enqueue: async () => {
              // Logged once the job is in the queue: a refused submission (429, 503) queued nothing.
              const queuedJobId = await queue.pushJob("foldx", {
                wtPdb: effectiveWtPdb,
                mutation: actualMutation,
                uniprotId,
                // The caller's own file: its positions are not UniProt positions (CALLER_NUMBERING_REASON).
                ...(clientPdbValid ? { structureNumbering: "caller" } : {}),
                jobDir,
                options: foldxOptions,
                structureProvenance,
                remoteJobs: {
                  thermompnnStatus: "pending",
                  thermompnnError: null,
                  thermompnnVal: null,
                  stabilityoracleVal: null,
                  stabilityoracleStatus: "pending",
                  stabilityoracleError: null,
                  raspVal: null,
                  raspStatus: "pending",
                  raspReason: null,
                  raspSource: null,
                  raspError: null,
                  protvarStatus: "pending",
                  protvarVal: null
                }
              }, {
                ownerId: submitterId(req),
                limits: submitterLimits(req),
                costEstimateMs: foldxQueueCostEstimateMs(effectiveWtPdb),
                residues: countResidues(effectiveWtPdb),
                placementPref: submitterPlacementPref(req),
              });
              await logGenerateMutant("queued");
              return queuedJobId;
            }
          });

          queueJobId = submission.queueJobId;
          isExistingActiveJob = submission.joined;
          joinedJobStatus = submission.status;
          joinedJobStartedAt = submission.startedAt;
          joinedJobPhase = submission.phase;

          const watcherId = submitterId(req);
          if (watcherId) queue.addWatcher(queueJobId, watcherId);

          if (submission.joined) {
            void logGenerateMutant("joined");
            const existingJobData = submission.jobData;
            joinedJobIsPrewarm = existingJobData?.prewarm === true;
            if (existingJobData && existingJobData.remoteJobs) {
              thermompnnStatus = existingJobData.remoteJobs.thermompnnStatus;
              thermompnnError = existingJobData.remoteJobs.thermompnnError;
            }
            console.log(
              `[Biophysical Deduplication] Joined existing active queued/running FoldX job: ${queueJobId}` +
                (joinedJobIsPrewarm ? " (speculative pre-warm; this request owns the companion engines)" : "")
            );

            let claimedPrewarm = false;
            if (joinedJobIsPrewarm) {
              /**
               * The pre-warm was submitted with no reader context, so its record carries no
               * structure provenance. Atomically flip `prewarm: false` inside `mutateJobData` so at
               * most one concurrent reader claims ownership of companion-engine submissions and writes
               * provenance/remoteJobs; any competing reader picks up recorded remoteJobs instead.
               */
              await queue.mutateJobData(submission.queueJobId, (data: any) => {
                if (!data) return data;
                if (data.prewarm === true) {
                  claimedPrewarm = true;
                  return { ...data, prewarm: false, structureProvenance };
                }
                if (data.remoteJobs) {
                  thermompnnStatus = data.remoteJobs.thermompnnStatus ?? thermompnnStatus;
                  thermompnnError = data.remoteJobs.thermompnnError ?? thermompnnError;
                }
                return data;
              });
              joinedJobIsPrewarm = claimedPrewarm;
            }
          }
        }

        /**
         * A pre-warm job carries no remote-engine submissions, so the single reader that claims it
         * makes them itself — and is allowed to write them to the job record, which the
         * `isExistingActiveJob` guard otherwise forbids for competing readers.
         */
        const ownsRemoteSubmissions = !isExistingActiveJob || joinedJobIsPrewarm;

        async function updateQueueJobRemoteData(updates: any) {
          if (!queueJobId || !ownsRemoteSubmissions) return;
          try {
            const queue = BiophysicalJobQueue.getInstance();
            /**
             * Through `mutateJobData`, not get-then-update.
             *
             * The previous read-modify-write straddled awaits, so a phase written by the FoldX
             * worker inside that window was overwritten by this writer's stale copy of the blob.
             * Both writers now share one serialised chain per job.
             */
            await queue.mutateJobData(queueJobId, jobData => {
              if (!jobData) return jobData;
              return {
                ...jobData,
                remoteJobs: {
                  ...(jobData.remoteJobs || {}),
                  ...updates
                }
              };
            });
          } catch (err: any) {
            console.warn("[updateQueueJobRemoteData Warning] Failed to update queue job:", err.message);
          }
        }

        let tmPromise = Promise.resolve();

        const existingThermompnn = cachedFoldx?.energetics?.thermompnn;
        const needThermompnn = ownsRemoteSubmissions && (typeof existingThermompnn !== "number");

        const existingStabilityoracle = cachedFoldx?.energetics?.stabilityoracle;

        if (typeof existingThermompnn === "number") {
          thermompnnVal = existingThermompnn;
          thermompnnStatus = "done";
        }
        if (typeof existingStabilityoracle === "number") {
          stabilityoracleVal = existingStabilityoracle;
        }

        const backgroundRemoteSignal = AbortSignal.timeout(BACKGROUND_REMOTE_TIMEOUT_MS);
        const cleanedRemotePdb = cleanPdbForFoldX(effectiveWtPdb);

        if (needThermompnn) {
          thermompnnStatus = "pending";
          let inFlight = inFlightRemoteSubmissions.get(foldxCacheKey);
          if (!inFlight) {
            inFlight = {};
            inFlightRemoteSubmissions.set(foldxCacheKey, inFlight);
          }
          if (!inFlight.thermompnnPromise) {
            const createdThermoPromise = submitThermoMpnnJob(cleanedRemotePdb, actualMutation, backgroundRemoteSignal)
              .finally(() => releaseThermoSubmission(foldxCacheKey, createdThermoPromise));
            inFlight.thermompnnPromise = createdThermoPromise;
          }

          tmPromise = inFlight.thermompnnPromise
            .then(async (resObj) => {
              if (resObj.status === "done" && resObj.prediction !== null) {
                thermompnnVal = resObj.prediction;
                thermompnnStatus = "done";
                // Clone latest cached record instead of mutating live LRU `cachedFoldx` in place.
                const latestCached = (await getMutantFromCache(foldxCacheKey, submitterId(req) ?? null)) ?? cachedFoldx;
                if (latestCached?.energetics) {
                  writeMutantToCache(foldxCacheKey, {
                    ...latestCached,
                    energetics: {
                      ...latestCached.energetics,
                      thermompnn: resObj.prediction
                    }
                  });
                }
              } else if (resObj.status === "error" || resObj.status === "busy") {
                thermompnnStatus = resObj.status;
                thermompnnError = resObj.error || "ThermoMPNN submission error";
              } else {
                thermompnnStatus = "unavailable";
                if (resObj.error) thermompnnError = resObj.error;
              }
              await updateQueueJobRemoteData({
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
        }

        // Give local ThermoMPNN up to 1.5s to answer on cache hits before returning immediately,
        // while allowing a queued CPU pass to settle in the background and report via `/remote-submissions/:token`.
        await Promise.race([
          Promise.allSettled([tmPromise]),
          new Promise(r => setTimeout(r, 1500))
        ]);

        if (cachedFoldx) {
          // Cache hit: return full result synchronously.
          // Clone before attaching transient response-only statuses/errors so we never mutate the
          // live LRU `mutantCache` entry in place across requests, and persist successful backfills
          // strictly against the non-transient `persistedRecord`.
          console.log(`[Cache Hit] Serving cached mutant simulation for ${foldxCacheKey}`);
          isCacheHit = true;
          void logGenerateMutant("cache-hit");

          const cloneCachedRecord = (rec: typeof cachedFoldx): typeof cachedFoldx => ({
            ...rec,
            energetics: rec.energetics ? { ...rec.energetics } : rec.energetics
          });
          const persistedRecord = cloneCachedRecord(cachedFoldx);
          const responseRecord = cloneCachedRecord(cachedFoldx);

          let finalStabilityoracleVal = stabilityoracleVal ?? responseRecord?.energetics?.stabilityoracle ?? null;
          let finalStabilityoracleStatus: string | null =
            typeof finalStabilityoracleVal === "number" ? "done" : null;
          let finalStabilityoracleError: string | null = null;

          if (finalStabilityoracleVal === null && effectiveWtPdb) {
            try {
              const soOutcome = await runStabilityOracleAnalysisDetailed(
                uniprotId || "UNKNOWN",
                `${wtLetter}${posNum}${mutLetter}`,
                uniprotId || "",
                "",
                effectiveWtPdb,
                resolvedChainUpper
              );
              if (soOutcome.kind === "value" && typeof soOutcome.result.ddG === "number" && Number.isFinite(soOutcome.result.ddG)) {
                finalStabilityoracleVal = soOutcome.result.ddG;
                finalStabilityoracleStatus = "done";
                if (responseRecord.energetics && persistedRecord.energetics) {
                  // Only a value goes to the long-lived cache. A transient outage's status,
                  // persisted here, fossilised for a day: later readers inherited "unavailable"
                  // or "error" for an engine the next lookup would happily answer.
                  const patch = {
                    stabilityoracle: finalStabilityoracleVal,
                    stabilityoracleStatus: "done",
                    stabilityoracleError: null
                  };
                  Object.assign(persistedRecord.energetics, patch);
                  Object.assign(responseRecord.energetics, patch);
                  writeMutantToCache(foldxCacheKey, cloneCachedRecord(persistedRecord));
                }
              } else if (soOutcome.kind === "error") {
                // A live sidecar REJECTING this query is not "not installed": say the rejection.
                finalStabilityoracleStatus = "error";
                finalStabilityoracleError = soOutcome.message;
              } else {
                finalStabilityoracleStatus = "unavailable";
                finalStabilityoracleError = soOutcome.kind === "unavailable" ? soOutcome.reason : "StabilityOracle did not return a score";
              }
            } catch (soErr: any) {
              console.warn("[StabilityOracle Cache Backfill Warning]:", soErr.message);
              finalStabilityoracleStatus = "error";
              finalStabilityoracleError = soErr.message;
            }
          } else if (typeof finalStabilityoracleVal === "number") {
            finalStabilityoracleStatus = "done";
            if (responseRecord.energetics) {
              responseRecord.energetics.stabilityoracleStatus = "done";
            }
          } else {
            finalStabilityoracleStatus = "unavailable";
            if (responseRecord.energetics) {
              responseRecord.energetics.stabilityoracleStatus = "unavailable";
            }
          }

          let finalThermompnnVal = thermompnnVal ?? responseRecord?.energetics?.thermompnn ?? null;
          if (typeof finalThermompnnVal === "number") {
            thermompnnStatus = "done";
            if (responseRecord.energetics && persistedRecord.energetics && persistedRecord.energetics.thermompnn !== finalThermompnnVal) {
              persistedRecord.energetics.thermompnn = finalThermompnnVal;
              responseRecord.energetics.thermompnn = finalThermompnnVal;
              writeMutantToCache(foldxCacheKey, cloneCachedRecord(persistedRecord));
            }
          }

          /**
           * RaSP on a cache hit.
           *
           * RaSP is looked up by the queue worker AFTER FoldX has written its cache entry, so the cached
           * record always carries `rasp: null` and no `raspReason`. This path used to serve that record
           * as-is: RaSP was never consulted on any revisit, and the client — seeing no value and no
           * reason — reported "Not covered", a statement about the protein that nothing had checked.
           * It is one indexed SQLite read, so it is done here on every hit that lacks a score.
           */
          if (responseRecord.energetics && clientPdbValid) {
            // Only in this response: the same lookups run normally for a UniProt-numbered structure.
            if (typeof responseRecord.energetics.rasp !== "number") {
              Object.assign(responseRecord.energetics, { raspStatus: "unavailable", raspError: CALLER_NUMBERING_REASON });
            }
            if (responseRecord.energetics.protvarStatus !== "done") {
              Object.assign(responseRecord.energetics, { protvarStatus: "unavailable", protvarError: CALLER_NUMBERING_REASON });
            }
          }
          if (responseRecord.energetics && typeof responseRecord.energetics.rasp !== "number" && uniprotId && !clientPdbValid) {
            try {
              const raspRes = await runRaspLocal("", "", resolvedChainUpper, posNum, wtLetter, mutLetter, uniprotId);
              if (raspRes && typeof raspRes.score === "number") {
                const patch = {
                  rasp: raspRes.score,
                  raspReason: raspRes.reason,
                  raspSource: raspRes.source,
                  raspCoverage: getRaspCoverage() ?? undefined,
                  raspStatus: "done",
                  raspError: null
                };
                if (persistedRecord.energetics) {
                  Object.assign(persistedRecord.energetics, patch);
                  writeMutantToCache(foldxCacheKey, cloneCachedRecord(persistedRecord));
                }
                Object.assign(responseRecord.energetics, patch);
              } else if (raspRes && raspRes.reason === RASP_STORE_UNAVAILABLE_REASON) {
                // A store the deployment cannot read is not a coverage fact and not a completed
                // lookup; and persisting either would freeze the state until the next value
                // arrives. Keep the answer in this response only — reason included, so the
                // client classifies it as an operator-fixable fault, not about the protein.
                responseRecord.energetics.raspStatus = "unavailable";
                responseRecord.energetics.raspError = RASP_STORE_UNAVAILABLE_REASON;
                responseRecord.energetics.raspReason = RASP_STORE_UNAVAILABLE_REASON;
              } else if (raspRes) {
                // A genuine coverage miss: keep the lookup's own sentence as the reason (only in
                // this response), so the client renders "Not covered" rather than a failure.
                responseRecord.energetics.raspStatus = "unavailable";
                responseRecord.energetics.raspError = null;
                responseRecord.energetics.raspReason = raspRes.reason;
              }
            } catch (raspErr: any) {
              console.warn("[RaSP Cache-Hit Lookup Warning]:", raspErr.message);
            }
          }

          /**
           * ProtVar on a cache hit, for the same reason as RaSP above: the companion lookup lands after
           * FoldX wrote its cache entry, so a revisit would otherwise never show it. One cached read.
           */
          if (responseRecord.energetics && responseRecord.energetics.protvarStatus !== "done" && uniprotId && !clientPdbValid) {
            try {
              // `protvarVal` is the job-record name; on the energetics payload the value is `protvar`.
              const { protvarVal, ...protvarRest } = protvarJobFields(
                await fetchProtVarFoldx(uniprotId, posNum, wtLetter, mutLetter)
              );
              const patch = { ...protvarRest, protvar: protvarVal };
              if (persistedRecord.energetics) {
                Object.assign(persistedRecord.energetics, patch);
                writeMutantToCache(foldxCacheKey, cloneCachedRecord(persistedRecord));
              }
              Object.assign(responseRecord.energetics, patch);
            } catch (protvarErr: any) {
              console.warn("[ProtVar Cache-Hit Lookup Warning]:", protvarErr.message);
              // Said, not silent — and not persisted, so the next visit retries an outage.
              const { protvarVal, ...protvarRest } = protvarErrorFields(protvarErr);
              Object.assign(responseRecord.energetics, protvarRest, { protvar: protvarVal });
            }
          }

          const enriched = enrichBiophysicalResult(responseRecord, {
            thermompnnStatus,
            thermompnnError,
            thermompnnVal: finalThermompnnVal,
            stabilityoracleVal: finalStabilityoracleVal,
            stabilityoracleStatus: finalStabilityoracleStatus,
            stabilityoracleError: finalStabilityoracleError,
            // Passed explicitly like every other engine, rather than relying on the in-place update above.
            protvarStatus: responseRecord.energetics?.protvarStatus ?? null,
            protvarVal: responseRecord.energetics?.protvar ?? null,
            protvarPlddt: responseRecord.energetics?.protvarPlddt ?? null,
            protvarModel: responseRecord.energetics?.protvarModel ?? null,
            protvarReason: responseRecord.energetics?.protvarReason ?? null,
            protvarError: responseRecord.energetics?.protvarError ?? null
          }, structureProvenance, posNum);

          /**
           * ThermoMPNN still running behind another CPU task: hand the client a token to collect
           * its synchronous result once the sidecar pass finishes.
           */
          const unresolved = thermompnnStatus === "pending" && finalThermompnnVal === null;
          let remoteSubmissionToken: string | null = null;
          if (unresolved) {
            remoteSubmissionToken = crypto.randomUUID();
            pruneRemoteSubmissions();
            pendingRemoteSubmissions.set(remoteSubmissionToken, {
              promise: Promise.allSettled([tmPromise]).then(() => ({
                thermompnnStatus,
                thermompnnError,
                thermompnnVal,
              })),
              expiresAt: Date.now() + REMOTE_SUBMISSION_TTL_MS,
            });
          }

          res.json(remoteSubmissionToken ? { ...enriched, remoteSubmissionToken } : enriched);
          return;
        }

        res.json({
          status: "queued",
          foldxJobId: queueJobId,
          phase: joinedJobStatus === "running" ? joinedJobPhase : "queued",
          startedAt: joinedJobStartedAt,
          // Measured here, in this host's clock, for the same reason the poll route does it.
          elapsedMs: joinedJobStatus === "running" && joinedJobStartedAt
            ? Math.max(0, Date.now() - joinedJobStartedAt)
            : null,
          queuedAhead: joinedJobStatus === "running"
            ? 0
            : (queueJobId ? await BiophysicalJobQueue.getInstance().getQueuePosition(queueJobId) : null),
          queuedEtaMs: joinedJobStatus === "running" || !queueJobId
            ? null
            : ((await BiophysicalJobQueue.getInstance().getEta(queueJobId))?.waitMs ?? null),
          // Where it runs and why (live routing, WP-G2); null when it is simply the server's, as always.
          runsOn: queueJobId ? BiophysicalJobQueue.getInstance().runsOn(queueJobId, submitterId(req) ?? null) : null,
          thermompnnStatus,
          thermompnnError
        });
      } catch (err: any) {
        if (err instanceof QueueLimitError) {
          sendError(res, err.status, err.code, err.message);
        } else if (err instanceof AdmissionError) {
          sendError(res, err.status, err.code, err.message);
        } else if (err.message.includes("BUSY")) {
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

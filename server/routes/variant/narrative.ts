import path from "path";
import dotenv from "dotenv";
import { type Router } from "express";
import crypto from "crypto";
import { z } from "zod";

import {
  validateGene,
  validateVariant,
  validateUniProt,
  sendError,
  AuditLogger,
  filterPII,
  getApiKeyFromSession,
  formatZodError,
  onClientDisconnect,
} from "../../utils.ts";
import { analyzeVariantLimiter } from "../../middleware.ts";
import { resolveGeneToUniprot } from "../../services/external.ts";
// Shared with the Population Frequencies screen, so the report and the UI cannot state different
// frequencies or different absence causes for one variant.
import {
  buildFrequencyEvidence,
  formatAlleleFrequency,
} from "../../../src/shared/frequencyEvidence.ts";
import {
  performGeminiAnalysis,
  GeminiError,
  getConfiguredGeminiModels,
  isGeminiApiKeyPlaceholder,
  classifyGeminiFailure,
  failureKindToFallbackReason,
  sanitizeProviderError,
  type GeminiFailureKind,
} from "../../services/gemini.ts";
import { computeRuleBasedACMG } from "../../services/acmg.ts";
import { type AnalysisResult, aouLookupSchema } from "../../../src/shared/contracts.ts";
import {
  type NarrativeFallbackReason,
  describeFallbackReason,
} from "../../../src/shared/narrativeFallback.ts";
import { NARRATIVE_PROMPT_SCHEMA_VERSION } from "../../../src/shared/narrativeSynthesis.ts";
import {
  buildNarrativeEvidenceContract,
  canonicalNarrativeEvidence,
} from "../../../src/shared/narrativeEvidence.ts";
import { deepModelEvidenceSchema } from "../../../src/shared/contracts.ts";
import { CLINVAR_ABSENCE_SENTENCE, clinvarPresence } from "../../../src/shared/clinvarPresence.ts";
import {
  getFromCache,
  writeToCache,
  handleNarrativeResponse,
} from "../shared.ts";

/**
 * Outer request deadline, sat between the synthesis budget and the client timeout:
 *
 *   synthesis budget (105s)  <  request deadline (130s)  <  client timeout (140s)
 *
 * The budget must expire first so the route can classify the failure and return a rule-based
 * report; this deadline is a backstop for work outside the model loop (gene resolution, RAG).
 */
const NARRATIVE_REQUEST_DEADLINE_MS = 130_000;

const analyzeVariantNarrativeSchema = z.object({
  gene: z.string(),
  variant: z.string(),
  uniprotId: z.string().optional().default(""),
  userDirections: z.string().optional(),
  acmgWeighting: z.enum(["standard", "conservative", "strict-structural"]).optional(),
  clinvar: z.any().optional(),
  predictorData: z.any().optional(),
  conservationData: z.any().optional(),
  stringInteractions: z.any().optional(),
  gnomadConstraint: z.any().optional(),
  gnomadFrequency: z.any().optional(),
  uniprotFeatures: z.any().optional(),
  sequence: z.any().optional(),
  aouFrequency: z.any().optional(),
  aouLookup: aouLookupSchema.nullable().optional(),
  /**
   * Per-source fetch outcomes. Validated here rather than read ad hoc off `req.body`, because the
   * frequency sentence below turns on it: without it a gnomAD timeout is indistinguishable from a
   * confirmed absence, and the report asserted absence.
   */
  serviceStatus: z.record(z.string(), z.string()).optional(),
  /**
   * The deep-model observations the synthesis is to be given.
   *
   * Validated by the SHARED schema (`src/shared/contracts.ts`) rather than by a shape written here: it
   * is interpolated into a clinical prompt, so its model ids, state vocabulary, numeric bounds and text
   * lengths are the app's own contract, and a payload describing a model this app does not have is
   * refused instead of paraphrased. Absent from a client that predates the deep-evidence integration,
   * which then simply gets the fast evidence set.
   */
  deepEvidence: deepModelEvidenceSchema.nullable().optional(),
});

export function registerNarrativeRoutes(apiRouter: Router, jsonParserRegular: any): void {

  apiRouter.post("/analyze-variant-narrative", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    const parseResult = analyzeVariantNarrativeSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      let gene: string, variant: string, uniprotId: string;
      let userDirections: string | undefined;
      let acmgWeighting: "standard" | "conservative" | "strict-structural" = "standard";

      try {
        gene = validateGene(req.body.gene);
        variant = validateVariant(req.body.variant);
        const requestedUniprotId = typeof req.body.uniprotId === "string" ? req.body.uniprotId.trim() : "";
        if (requestedUniprotId) {
          uniprotId = validateUniProt(requestedUniprotId);
        } else {
          const resolvedUniprotId = await resolveGeneToUniprot(gene);
          if (!resolvedUniprotId) {
            throw new Error(`Could not resolve gene '${gene}' to a UniProt accession. Please provide the UniProt ID manually.`);
          }
          uniprotId = validateUniProt(resolvedUniprotId);
        }
        if (req.body.userDirections !== undefined) {
          if (typeof req.body.userDirections !== "string") {
            throw new Error("userDirections must be a string");
          }
          userDirections = filterPII(req.body.userDirections.slice(0, 1000));
        }

        if (req.body.acmgWeighting !== undefined) {
          if (req.body.acmgWeighting === "standard" || req.body.acmgWeighting === "conservative" || req.body.acmgWeighting === "strict-structural") {
            acmgWeighting = req.body.acmgWeighting;
          } else {
            throw new Error("acmgWeighting must be one of: standard, conservative, strict-structural");
          }
        }
      } catch (err: any) {
        sendError(res, 400, "BAD_REQUEST", err.message);
        return;
      }

      const { clinvar, predictorData, conservationData, stringInteractions, gnomadConstraint, gnomadFrequency, uniprotFeatures, sequence, aouFrequency, serviceStatus } = req.body;
      // Read from the VALIDATED body, not `req.body`: the schema is what bounds and normalizes it.
      const deepEvidence = parseResult.data.deepEvidence ?? null;
      const aouLookup = parseResult.data.aouLookup ?? null;

      const mutMatch = variant.match(/([a-zA-Z]{3}|\w)\s*(\d+)\s*([a-zA-Z]{3}|\w)/);
      if (!mutMatch) {
        sendError(res, 400, "BAD_REQUEST", `Invalid protein variant format: ${variant}`);
        return;
      }
      const wildType = mutMatch[1];
      const residueIndex = mutMatch[2];
      const mutant = mutMatch[3];

      /**
       * The evidence contract, from the SHARED declaration.
       *
       * Both client paths (`narrativeService`, `useNarrativeResynthesis`) build their request through
       * `planNarrativeSynthesis`, so this is the same object they canonicalize — which is what makes
       * one run hash to one key whichever control the reader pressed.
       *
       * `serviceStatus` travels INSIDE the hash, not only into the prompt, and that is the fix this
       * contract exists for: a ClinVar TIMEOUT and a ClinVar query that was never made both arrive as
       * `clinvar: null`, so they hashed identically while producing different prompt text
       * (`clinvarPresence` reads the status and says `unread` for one, `unqueried` for the other). A
       * narrative written for the failed query was servable to the run that never asked — the cache
       * asserting the model was told something it was not. `aouFrequency` is in the contract for the
       * same class of reason: the fallback frequency sentence reads it, so a run that has none must
       * not be served a narrative written when it was present.
       */
      const evidenceContract = buildNarrativeEvidenceContract({
        clinvar,
        predictorData,
        conservationData,
        stringInteractions,
        gnomadConstraint,
        gnomadFrequency,
        aouFrequency,
        uniprotFeatures,
        sequence,
        serviceStatus,
        /*
         * The validated deep-model block is part of the evidence the key describes.
         *
         * Without it the key would be blind to the one thing the prompt gained: a run whose FoldX ΔΔG
         * arrived after the first synthesis hashed the same as the run that never had one, so the
         * earlier narrative — written while the engine was still pending — would be served for the
         * later, complete evidence set.
         */
        deepEvidence,
      });
      const customSessionId = req.headers["x-gemini-session-id"] as string | undefined;
      let customApiKey: string | undefined;
      if (customSessionId) {
        customApiKey = getApiKeyFromSession(customSessionId);
        if (!customApiKey) {
          sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate in Settings.");
          return;
        }
      }

      if (!process.env.GEMINI_API_KEY || isGeminiApiKeyPlaceholder(process.env.GEMINI_API_KEY)) {
        dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });
      }

      const envKey = process.env.GEMINI_API_KEY && !isGeminiApiKeyPlaceholder(process.env.GEMINI_API_KEY)
        ? process.env.GEMINI_API_KEY
        : undefined;

      const effectiveKey = customApiKey || envKey;
      const activeApiKey = effectiveKey || "no_key";
      const keyHash = crypto.createHash("sha256").update(activeApiKey).digest("hex");
      const model = getConfiguredGeminiModels()[0];
      /*
       * SHA-256 over the CONTRACT's canonical string — one string, produced by the shared helper, so
       * the key and the revision the client records are two views of the same evidence. The contract
       * version is inside that string, so a change to what a narrative is given invalidates every
       * cached narrative by construction rather than by someone remembering to bump a segment here.
       */
      const evidenceHash = crypto
        .createHash("sha256")
        .update(canonicalNarrativeEvidence(evidenceContract))
        .digest("hex");
      /*
       * The `_schema:` segment is the prompt version, read from the shared constant rather than
       * written here. It is the ONLY part of this key that changes when the prompt changes; every
       * other segment is a pure function of the request, so without a version bump a re-run of the
       * same variant with the same evidence hits the same key and is served a narrative the previous
       * prompt wrote — for the cache's full 24h TTL. See `NARRATIVE_PROMPT_SCHEMA_VERSION` for why
       * that mattered here specifically.
       */
      const cacheKey = `clinical_${uniprotId}_${variant}_${acmgWeighting}_${userDirections || ""}_${evidenceHash}_key:${keyHash}_model:${model}_schema:v${NARRATIVE_PROMPT_SCHEMA_VERSION}`;
      const cached = getFromCache(cacheKey);

      if (cached) {
        console.log(`[Cache Hit] Serving cached clinical Gemini narrative for ${cacheKey}`);
        return handleNarrativeResponse(
          res,
          cached,
          gene,
          variant,
          clinvar,
          predictorData,
          conservationData,
          gnomadConstraint,
          gnomadFrequency,
          acmgWeighting,
          null,
          uniprotFeatures,
          sequence
        );
      }

      const clientAbortController = new AbortController();
      // `req.on("close")` fires as soon as the body has been read, which express.json() has
      // already done — that aborted every synthesis before it started. Use the response.
      onClientDisconnect(res, () => clientAbortController.abort());
      const timeoutSignal = AbortSignal.timeout(NARRATIVE_REQUEST_DEADLINE_MS);
      const combinedSignal = AbortSignal.any([clientAbortController.signal, timeoutSignal]);
      const reqId = req.headers["x-request-id"] as string;

      let analysisResult;
      try {
        analysisResult = await performGeminiAnalysis(
          gene,
          variant,
          uniprotId,
          residueIndex,
          wildType,
          mutant,
          userDirections,
          clinvar,
          acmgWeighting,
          customApiKey,
          combinedSignal,
          predictorData,
          conservationData,
          stringInteractions,
          /*
           * The run's per-source outcomes, so the prompt can tell "ClinVar holds nothing" from "ClinVar
           * could not be read". Both arrive as a null record; only this distinguishes them. Without it
           * a timed-out query was described to the model as "ClinVar was not queried for this run" —
           * a false statement about the run, contradicted by the Population rail on the same screen.
           */
          serviceStatus ?? null,
          /*
           * The validated deep-model observations, so the synthesis can consider the stability and
           * language-model results the report displays beside it — under the prompt block's own rules
           * that they are correlated predictions rather than assays, and that no ACMG criterion may be
           * created from them.
           */
          deepEvidence
        );
        writeToCache(cacheKey, analysisResult);
      } catch (err: any) {
        console.warn("[Graceful Fallback] Gemini narrative execution failed:", err.stack || err.message);

        const isGeminiErr = err instanceof GeminiError;
        const isKeyMissing = isGeminiErr
          ? err.code === "API_KEY_MISSING"
          : Boolean(err.message && (err.message.includes("placeholder") || err.message.includes("required")));

        /*
         * The verdict comes from the engine when the engine produced the error: the attempt
         * loop already classified this failure to decide pool membership and cooldowns, and
         * the code it threw was chosen from that verdict. Classifying the raw error a second
         * time here is what let a 503-coded unclassified failure be re-read as "overload" from
         * its status and presented to the user as "AI service busy". A foreign error — one
         * that never passed through the loop — still has to be classified.
         */
        const failureKind: GeminiFailureKind =
          isGeminiErr && err.failureKind ? err.failureKind : classifyGeminiFailure(err);
        // Hand the client a stable reason code. The client must never have to guess
        // degradation state from prose.
        const fallbackReason: NarrativeFallbackReason = isKeyMissing
          ? "API_KEY_MISSING"
          : failureKindToFallbackReason(failureKind);
        const providerDetail = isGeminiErr && err.providerDetail
          ? err.providerDetail
          : sanitizeProviderError(err);
        const attemptedModels = isGeminiErr ? err.attemptedModels : undefined;

        await AuditLogger.log("ANALYZE_VARIANT_FAILED", {
          reqId,
          code: isGeminiErr ? err.code : "INTERNAL_SERVER_ERROR",
          reason: fallbackReason,
          providerDetail,
          attemptedModels,
        });

        const ruleInsights = computeRuleBasedACMG({
          gene,
          variant,
          clinvar,
          predictorData,
          conservationData,
          gnomadConstraint,
          gnomadFrequency,
          acmgWeighting,
          esm2: null,
          uniprotFeatures,
          sequence
        });

        /**
         * The ClinVar sentence, from the shared presence predicate.
         *
         * This was two branches over a three-state input: `clinvar ? "Listed as …" : "Not listed in
         * ClinVar (rare or novel variant)."`. `clinvar` is null both when ClinVar was never queried and
         * when the query timed out, so an OUTAGE printed "Not listed in ClinVar (rare or novel
         * variant)" — a negative clinical finding and a novelty claim, manufactured from a failed
         * request — while the frequency sentence three lines below was carefully refusing to do exactly
         * that (see its comment). The sentinel branch had its own version: a record whose
         * `classification` is `"Not found in ClinVar"` printed "Listed as **Not found in ClinVar**",
         * which reads as a classification.
         *
         * `serviceStatus` is in scope here; `clinvarPresence` reads it and the record together, so this
         * is now the same state the prompt, the Population rail and report inventory are given.
         */
        const clinvarState = clinvarPresence(clinvar, serviceStatus ?? null);
        const clinvarText = clinvarState === "held"
          ? `Listed as **${clinvar?.classification || "Unclassified"}** (Review status: *${clinvar?.reviewStatus || "unknown"}*).`
          : CLINVAR_ABSENCE_SENTENCE[clinvarState];

        /**
         * The frequency sentence, from the same module the Population Frequencies screen renders.
         *
         * It used to read `gnomadFrequency.exomeAF` and, whenever that was falsy, write "Absent from
         * the gnomAD population database (extremely rare or novel variant)." Three defects in one
         * line: a gnomAD **timeout** produced the absence claim, a genomes-only variant was called
         * absent, and the value the ACMG classifier actually used (`groupMaxAF`) was ignored in
         * favour of one dataset's global AF. The report is the most consequential surface this text
         * appears on, so it now states what the pipeline established and nothing more.
         */
        const frequency = buildFrequencyEvidence({
          gnomadFrequency,
          aouFrequency: aouFrequency ?? null,
          aouLookup: aouLookup ?? null,
          serviceStatus: serviceStatus ?? null,
          clinvar,
          assembly: predictorData?.gnomadVariantAssembly ?? null,
          pli: gnomadConstraint?.pli ?? null,
          engineCriteria: ruleInsights.acmgCriteria,
          acmgWeighting,
          // The report must say "lookup failed, re-run", not "this coordinate is GRCh37", on a fallback run.
          locus: { predictorData: predictorData ?? null },
        });
        const freqText = (() => {
          const criterion = frequency.criterion;
          if (criterion.af === null) return criterion.statement;
          const where =
            criterion.sourceId === "clinvar-submissions"
              ? "ClinVar-submitted data"
              : criterion.usedGroupMax
                ? "gnomAD (ancestry-grouped maximum)"
                : "gnomAD (global maximum)";
          const observed =
            criterion.af === 0
              ? `Not present in ${where.replace(" (ancestry-grouped maximum)", "").replace(" (global maximum)", "")} in the reference cohorts sampled (allele frequency 0).`
              : `Observed in ${where} with an allele frequency of **${formatAlleleFrequency(criterion.af)}**.`;
          return `${observed} ${criterion.statement}${criterion.fallback ? " The grouped frequency fell back to the global maximum because no population was large enough to report." : ""}`;
        })();

        const cadd = predictorData?.caddPhred;
        const am = predictorData?.amClass;
        const revel = conservationData?.revel;

        const predictorSummary = [
          cadd ? `CADD PHRED **${cadd}**` : null,
          revel ? `REVEL **${revel}**` : null,
          am ? `AlphaMissense **${am}**` : null
        ].filter(Boolean).join(" · ");

        /**
         * The rule-based report is a real, self-contained clinical document.
         *
         * It deliberately contains no system-status heading and no provider error text:
         * degradation state travels in the structured fields below and is rendered by the
         * UI, so the report body never mixes infrastructure telemetry into clinical prose.
         */
        const sections: string[] = [];

        sections.push(
          `### Rule-Based Clinical Summary\n\n` +
          `This report was assembled from curated database evidence and deterministic ACMG/AMP ` +
          `decision rules. Live AI synthesis was not applied, so every statement below traces ` +
          `directly to a retrieved data source and remains independently auditable.`
        );

        sections.push(
          `### Classification\n\n` +
          `Rule-based ACMG/AMP consensus: **${ruleInsights.acmgVerdict || "Variant of Uncertain Significance (VUS)"}**.`
        );

        const evidenceLines = [
          `- **ClinVar** — ${clinvarText}`,
          `- **Population frequency** — ${freqText}`,
        ];
        if (predictorSummary) {
          evidenceLines.push(`- **In-silico predictors** — ${predictorSummary}.`);
        }
        sections.push(`### Evidence Considered\n\n${evidenceLines.join("\n")}`);

        sections.push(
          `### Recommended Next Steps\n\n` +
          `- Add biophysical evidence: run **FoldX** and **DynaMut2** from the 3D Structure tab to ` +
          `quantify the folding free-energy change (ΔΔG).\n` +
          `- Re-run **AI synthesis** once the language model service is reachable to obtain an ` +
          `integrated narrative that reconciles clinical, evolutionary and structural signals.\n` +
          `- Treat the classification above as provisional: it reflects database evidence only and ` +
          `is not a substitute for expert variant curation.`
        );

        analysisResult = {
          analysis: sections.join("\n\n"),
          isFallback: true,
          fallbackReason,
          fallbackMessage: describeFallbackReason(fallbackReason).detail,
          /*
           * Retryability is the shared vocabulary's answer, not a second classification of the
           * error. `narrativeFallback.ts` already carries a `retryable` verdict per reason, and
           * re-deciding it here from `isTransientFailure` disagreed with it for the unclassified
           * case: the report's own prose offered "Re-synthesize" while the server withheld the
           * button, so the affordance vanished for exactly the provider-storm failure this
           * surface was hardened for. API_KEY_INVALID is the documented exception — the
           * vocabulary calls it non-retryable because re-running with the same credential
           * cannot help, but replacing the credential and re-running is what it asks for.
           */
          fallbackRetryable: describeFallbackReason(fallbackReason).retryable || fallbackReason === "API_KEY_INVALID",
          providerDetail,
          attemptedModels,
          insights: {
            biochemicalShift: "Not synthesized",
            structuralImpact: "Not synthesized",
            acmgCriteria: []
          }
        } as AnalysisResult;
      }

      handleNarrativeResponse(
        res,
        analysisResult,
        gene,
        variant,
        clinvar,
        predictorData,
        conservationData,
        gnomadConstraint,
        gnomadFrequency,
        acmgWeighting,
        null,
        uniprotFeatures,
        sequence
      );
    } catch (error: any) {
      console.error("Narrative endpoint failure:", error);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "Failed to process narrative request.");
    }
  });
}

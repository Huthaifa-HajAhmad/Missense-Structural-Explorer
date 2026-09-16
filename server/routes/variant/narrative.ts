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
import {
  performGeminiAnalysis,
  GeminiError,
  getConfiguredGeminiModels,
  isGeminiApiKeyPlaceholder,
  classifyGeminiFailure,
  failureKindToFallbackReason,
  isTransientFailure,
  sanitizeProviderError,
} from "../../services/gemini.ts";
import { computeRuleBasedACMG } from "../../services/acmg.ts";
import { type AnalysisResult } from "../../../src/shared/contracts.ts";
import {
  type NarrativeFallbackReason,
  describeFallbackReason,
} from "../../../src/shared/narrativeFallback.ts";
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

      const { clinvar, predictorData, conservationData, stringInteractions, gnomadConstraint, gnomadFrequency, uniprotFeatures, sequence } = req.body;

      const mutMatch = variant.match(/([a-zA-Z]{3}|\w)\s*(\d+)\s*([a-zA-Z]{3}|\w)/);
      if (!mutMatch) {
        sendError(res, 400, "BAD_REQUEST", `Invalid protein variant format: ${variant}`);
        return;
      }
      const wildType = mutMatch[1];
      const residueIndex = mutMatch[2];
      const mutant = mutMatch[3];

      const evidencePayload = {
        clinvar,
        predictorData,
        conservationData,
        stringInteractions,
        gnomadConstraint,
        gnomadFrequency,
        uniprotFeatures,
        sequence
      };
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
      const evidenceHash = crypto.createHash("sha256").update(JSON.stringify(evidencePayload)).digest("hex");
      const cacheKey = `clinical_${uniprotId}_${variant}_${acmgWeighting}_${userDirections || ""}_${evidenceHash}_key:${keyHash}_model:${model}_schema:v2`;
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
          stringInteractions
        );
        writeToCache(cacheKey, analysisResult);
      } catch (err: any) {
        console.warn("[Graceful Fallback] Gemini narrative execution failed:", err.stack || err.message);

        const isGeminiErr = err instanceof GeminiError;
        const isKeyMissing = isGeminiErr
          ? err.code === "API_KEY_MISSING"
          : Boolean(err.message && (err.message.includes("placeholder") || err.message.includes("required")));

        // Classify once, here, and hand the client a stable reason code. The client must
        // never have to guess degradation state from prose.
        const failureKind = classifyGeminiFailure(err);
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

        const clinvarText = clinvar
          ? `Listed as **${clinvar.classification || "Unclassified"}** (Review status: *${clinvar.reviewStatus || "unknown"}*).`
          : "Not listed in ClinVar (rare or novel variant).";

        const freqText = (gnomadFrequency && gnomadFrequency.exomeAF)
          ? `Observed in gnomAD with an exome allele frequency of **${gnomadFrequency.exomeAF.toExponential(3)}**.`
          : "Absent from the gnomAD population database (extremely rare or novel variant).";

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
          fallbackRetryable: isTransientFailure(failureKind) || fallbackReason === "API_KEY_INVALID",
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

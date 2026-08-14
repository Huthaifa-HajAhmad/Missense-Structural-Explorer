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
} from "../../utils.ts";
import { analyzeVariantLimiter } from "../../middleware.ts";
import { resolveGeneToUniprot } from "../../services/external.ts";
import {
  performGeminiAnalysis,
  GeminiError,
  getConfiguredGeminiModels,
} from "../../services/gemini.ts";
import { computeRuleBasedACMG } from "../../services/acmg.ts";
import { type AnalysisResult } from "../../../src/types.ts";
import {
  getFromCache,
  writeToCache,
  handleNarrativeResponse,
} from "../shared.ts";

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
      console.log(`[Narrative Debug] customSessionId present: ${!!customSessionId}, length: ${customSessionId?.length ?? 0}`);
      if (customSessionId) {
        customApiKey = getApiKeyFromSession(customSessionId);
        console.log(`[Narrative Debug] getApiKeyFromSession result: ${customApiKey ? `key(len=${customApiKey.length}, prefix=${customApiKey.slice(0,4)})` : "undefined (expired or invalid)"}`);
        if (!customApiKey) {
          sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate in Settings.");
          return;
        }
      }

      const activeApiKey = customApiKey || process.env.GEMINI_API_KEY || "no_key";
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

      const timeoutSignal = AbortSignal.timeout(180000);
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
          timeoutSignal,
          predictorData,
          conservationData,
          stringInteractions
        );
        writeToCache(cacheKey, analysisResult);
      } catch (err: any) {
        console.warn("[Graceful Fallback] Gemini narrative execution failed:", err.stack || err.message);
        await AuditLogger.log("ANALYZE_VARIANT_FAILED", {
          reqId,
          code: err instanceof GeminiError ? err.code : "INTERNAL_SERVER_ERROR",
          message: err.message
        });

        const isKeyMissing = err instanceof GeminiError ? err.code === "API_KEY_MISSING" : (err.message && (err.message.includes("placeholder") || err.message.includes("required")));

        const ruleInsights = computeRuleBasedACMG(
          gene, variant, clinvar, predictorData, conservationData, gnomadConstraint, gnomadFrequency, acmgWeighting, null, uniprotFeatures, sequence
        );

        const clinvarText = clinvar
          ? `Listed as **${clinvar.classification || "Unclassified"}** (Review status: *${clinvar.reviewStatus || "unknown"}*).`
          : "Absent from ClinVar database (rare or novel variant).";

        const freqText = (gnomadFrequency && gnomadFrequency.exomeAF)
          ? `Observed in gnomAD with an allele frequency of **${gnomadFrequency.exomeAF.toExponential(3)}**.`
          : "Absent from gnomAD population database (extremely rare or novel variant).";

        const cadd = predictorData?.caddPhred;
        const am = predictorData?.amClass;
        const revel = conservationData?.revel;

        const predictorSummary = [
          cadd ? `CADD Phred score is **${cadd}**` : null,
          revel ? `REVEL score is **${revel}**` : null,
          am ? `AlphaMissense is **${am}**` : null
        ].filter(Boolean).join(", ");

        let fallbackText = "";
        let biochemicalShiftText = "";
        let structuralImpactText = "";

        if (isKeyMissing) {
          fallbackText =
            `### ⚠️ Gemini API Key Not Configured\n\n` +
            `To view clinical narrative reports and dynamic ACMG classifications, please set a valid \`GEMINI_API_KEY\` in your \`.env\` file, or enter one in the in-app **Settings > Gemini API** tab. A structured clinical summary has been generated from standard database metrics:\n\n` +
            `* **Clinical Consensus**: Rule-based ACMG classification is **${ruleInsights.acmgVerdict || "VUS / Conflicting Evidence"}**.\n` +
            `* **ClinVar Database**: ${clinvarText}\n` +
            `* **Population Frequency**: ${freqText}\n` +
            (predictorSummary ? `* **In-Silico Predictors**: ${predictorSummary}.\n` : "") +
            `* **Biophysical Impact**: Local sequence and structure are fully loaded and functional. You can run FoldX / DynaMut2 simulations via the 3D Molecular Viewer controls below.`;
          biochemicalShiftText = "Key Config Required";
          structuralImpactText = "Key Config Required";
        } else {
          fallbackText =
            `### ⚠️ AI Explanation Service Offline (Fallback Report Loaded)\n\n` +
            `The Gemini AI narrative service is currently experiencing rate/quota limits or model errors (${err.message}). A structured clinical summary has been generated from standard database metrics:\n\n` +
            `* **Clinical Consensus**: Rule-based ACMG classification is **${ruleInsights.acmgVerdict || "VUS / Conflicting Evidence"}**.\n` +
            `* **ClinVar Database**: ${clinvarText}\n` +
            `* **Population Frequency**: ${freqText}\n` +
            (predictorSummary ? `* **In-Silico Predictors**: ${predictorSummary}.\n` : "") +
            `* **Biophysical Impact**: Local sequence and structure are fully loaded and functional. You can run FoldX / DynaMut2 simulations via the 3D Molecular Viewer controls below.`;
          biochemicalShiftText = "Unavailable (AI Service Offline)";
          structuralImpactText = "Unavailable (AI Service Offline)";
        }

        analysisResult = {
          analysis: fallbackText,
          insights: {
            biochemicalShift: biochemicalShiftText,
            structuralImpact: structuralImpactText,
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

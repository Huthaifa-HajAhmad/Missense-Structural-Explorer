import { type Router } from "express";
import { AuditLogger, sendError, onClientDisconnect } from "../../utils.ts";
import { analyzeVariantLimiter } from "../../middleware.ts";
import { fetchLandscapeData } from "../../services/external.ts";
import { validateAndParseVariantRequest } from "./variant-parser.ts";
import {
  runCoreAnalysis,
  runStructuralAnalysis,
} from "../../services/analysis-orchestrator.ts";
import { PrewarmManager } from "../../services/prewarm-manager.ts";

export function registerAnalysisRoutes(apiRouter: Router, jsonParserRegular: any): void {
  // 1. Core Endpoint
  apiRouter.post("/analyze-variant", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    const context = await validateAndParseVariantRequest(req, res);
    if (!context) return;

    await AuditLogger.logVariantQuery("ANALYZE_VARIANT", {
      gene: context.gene,
      variant: context.variant,
      uniprotId: context.uniprotId,
      hasDirections: !!context.userDirections,
      acmgWeighting: context.acmgWeighting,
      requestId: (req.headers["x-request-id"] as string) || undefined,
    });

    try {
      const responseData = await runCoreAnalysis(context);

      // Trigger background FoldX pre-warming asynchronously
      PrewarmManager.getInstance()
        .triggerPrewarm({
          gene: context.gene,
          variant: context.variant,
          uniprotId: context.uniprotId,
          sequence: context.sequence,
          pos: context.pos,
          wt1Letter: context.wt1Letter,
          mutant: context.mutant,
          pdbMapping: responseData._internal?.pdbMapping || null,
        })
        .catch(err => {
          console.warn("[Pre-warm Cache Dispatch Warning]:", err);
        });

      // Exclude internal routing metadata from API response
      const { _internal, ...payload } = responseData;
      res.json({
        ...payload,
        /**
         * Numbering provenance travels WITH the result.
         *
         * `numberingVerified: false` means the residue matched the canonical sequence but no other
         * isoform numbering could be ruled out (UniProt unreachable), so the analysis is disclosed
         * as unverified rather than presented as a clean canonical match. The prose goes in
         * `transcriptWarning` (already rendered) and the machine-readable reason in its own field,
         * which is what the exported report cites.
         */
        ...(context.numberingVerified === undefined
          ? {}
          : {
              numberingVerified: context.numberingVerified,
              ...(context.numberingWarning
                ? {
                    numberingUnverifiedReason: context.numberingWarning,
                    transcriptWarning: payload.transcriptWarning ?? context.numberingWarning,
                  }
                : {}),
            }),
      });
    } catch (error: any) {
      console.error("Endpoint analysis failure:", error);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "An error occurred during variant analysis.");
    }
  });

  // 1b. Progressive Streaming Endpoint (A3)
  apiRouter.post("/analyze-variant/stream", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    const context = await validateAndParseVariantRequest(req, res);
    if (!context) return;

    await AuditLogger.logVariantQuery("ANALYZE_VARIANT_STREAM", {
      gene: context.gene,
      variant: context.variant,
      uniprotId: context.uniprotId,
      hasDirections: !!context.userDirections,
      acmgWeighting: context.acmgWeighting,
      stream: true,
      requestId: (req.headers["x-request-id"] as string) || undefined,
    });

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const abortController = new AbortController();
    // `req.on("close")` fires once the body has been read (express.json has already done so),
    // which would abort the stream before the first chunk. Detect disconnects on `res` instead.
    onClientDisconnect(res, () => abortController.abort());

    try {
      const { streamCoreAnalysis } = await import("../../services/analysis-orchestrator.ts");
      await streamCoreAnalysis(context, (chunk) => {
        if (!res.writableEnded && !abortController.signal.aborted) {
          res.write(JSON.stringify(chunk) + "\n");
        }
      }, abortController.signal);
      if (!res.writableEnded) {
        res.end();
      }
    } catch (error: any) {
      if (abortController.signal.aborted) return;
      console.error("Streaming endpoint analysis failure:", error);
      if (!res.writableEnded) {
        res.write(JSON.stringify({ type: "error", error: error.message || "Streaming failed" }) + "\n");
        res.end();
      }
    }
  });

  // 2. Landscape Endpoint
  apiRouter.post("/analyze-variant/landscape", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    const context = await validateAndParseVariantRequest(req, res);
    if (!context) return;

    const { gene, pos } = context;

    await AuditLogger.logVariantQuery("ANALYZE_VARIANT_LANDSCAPE", {
      gene: context.gene,
      variant: context.variant,
      pos: context.pos,
      requestId: (req.headers["x-request-id"] as string) || undefined,
    });

    try {
      const startPos = pos !== undefined && pos !== null ? Math.max(1, pos - 25) : undefined;
      const endPos = pos !== undefined && pos !== null ? pos + 25 : undefined;

      const landscapeData = await fetchLandscapeData(gene, startPos, endPos);
      res.json({ landscapeData });
    } catch (error: any) {
      console.error("Landscape endpoint failure:", error);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "An error occurred fetching landscape data.");
    }
  });

  // 3. Structural Endpoint
  apiRouter.post("/analyze-variant/structural", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    const context = await validateAndParseVariantRequest(req, res);
    if (!context) return;

    await AuditLogger.logVariantQuery("ANALYZE_VARIANT_STRUCTURAL", {
      gene: context.gene,
      variant: context.variant,
      uniprotId: context.uniprotId,
      acmgWeighting: context.acmgWeighting,
      requestId: (req.headers["x-request-id"] as string) || undefined,
    });

    const biohubToken = (req.headers["x-biohub-token"] as string) || process.env.BIOHUB_API_TOKEN || null;
    const hfToken = (req.headers["x-hf-token"] as string) || process.env.HF_TOKEN || null;

    try {
      const result = await runStructuralAnalysis(context, biohubToken, hfToken);
      res.json(result);
    } catch (error: any) {
      console.error("Structural endpoint failure:", error);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "An error occurred during structural analysis.");
    }
  });
}

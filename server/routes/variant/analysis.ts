import { type Router } from "express";
import { AuditLogger, sendError, onClientDisconnect } from "../../utils.ts";
import { analyzeVariantLimiter } from "../../middleware.ts";
import { fetchLandscape } from "../../services/external.ts";
import { fetchLandscapeContext } from "../../services/prediction/landscape-context.ts";
import { validateAndParseVariantRequest } from "./variant-parser.ts";
import {
  runCoreAnalysis,
  runStructuralAnalysis,
} from "../../services/analysis-orchestrator.ts";
import { PrewarmManager, isPrewarmEnabled } from "../../services/prewarm-manager.ts";

const MAX_LANDSCAPE_WINDOW = 121;

/** A caller-named landscape window, or null when absent or malformed (the default then applies). */
export function parseLandscapeWindow(raw: unknown): { start: number; end: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const start = Number((raw as any).start);
  const end = Number((raw as any).end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
  if (end - start + 1 > MAX_LANDSCAPE_WINDOW) return null;
  return { start, end };
}

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

      /**
       * Speculative FoldX pre-warming — opt-in, OFF by default, and invoked from THIS route only.
       *
       * `isPrewarmEnabled()` is checked here rather than only inside the manager so a deployment that
       * has not opted in does not even build the parameters, and so the disabled path is visible at
       * the call site.
       *
       * The streaming route (`/analyze-variant/stream`) deliberately does NOT prewarm. It serves the
       * same analysis to the same reader, so dispatching from both would enqueue a second speculative
       * FoldX run for one visit; the standalone route is the one place that can legitimately precede
       * an Energetics submission.
       *
       * `numberingVerified` travels with the request because it is an INTERPRETATION fact, not a
       * cache hint: when the numbering could not be verified across the gene's isoforms, the residue
       * index this substitution sits on is unestablished, and a prewarm would compute against a guess
       * the reader's own submit may not share.
       */
      if (isPrewarmEnabled()) {
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
            conditions: { numberingVerified: context.numberingVerified },
          })
          .catch(err => {
            console.warn("[Pre-warm Cache Dispatch Warning]:", err);
          });
      }

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
              ...(context.numberingDisambiguated ? { numberingDisambiguated: true } : {}),
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
      /*
       * Default window: ±25 residues around the variant. A caller may instead name a window
       * (`landscapeWindow: { start, end }`, at most MAX_LANDSCAPE_WINDOW residues) so the tab can
       * load scores where the reader navigates, e.g. a domain far from the variant.
       */
      const requested = parseLandscapeWindow((req.body as any)?.landscapeWindow);
      const startPos = requested ? requested.start : pos !== undefined && pos !== null ? Math.max(1, pos - 25) : undefined;
      const endPos = requested ? requested.end : pos !== undefined && pos !== null ? pos + 25 : undefined;

      const { positions, meta } = await fetchLandscape(gene, startPos, endPos, context.uniprotId);
      res.json({ landscapeData: positions, landscapeMeta: meta });
    } catch (error: any) {
      console.error("Landscape endpoint failure:", error);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "An error occurred fetching landscape data.");
    }
  });

  // 2b. Landscape overview: whole-protein residue summaries plus gene-wide ClinVar, gnomAD and
  // regional-constraint context. Kept apart from the ±25 window so the focus grid never waits on it.
  apiRouter.post("/analyze-variant/landscape-overview", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    const context = await validateAndParseVariantRequest(req, res);
    if (!context) return;

    await AuditLogger.logVariantQuery("ANALYZE_VARIANT_LANDSCAPE_OVERVIEW", {
      gene: context.gene,
      variant: context.variant,
      pos: context.pos,
      requestId: (req.headers["x-request-id"] as string) || undefined,
    });

    try {
      // The regional lane is projected onto the transcript the residue axis is built on, so resolve
      // the axis transcript before mapping the gene-wide context.
      const landscape = await fetchLandscape(context.gene, undefined, undefined, context.uniprotId);
      const geneContext = await fetchLandscapeContext(context.gene, landscape.meta?.transcript ?? null);
      res.json({
        positions: landscape.positions.map(({ substitutions: _omit, ...rest }) => rest),
        meta: landscape.meta,
        context: geneContext
      });
    } catch (error: any) {
      console.error("Landscape overview failure:", error);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "An error occurred fetching the landscape overview.");
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

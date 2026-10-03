import { type Router } from "express";
import { parseGenomicCoordinateString, spliceAiScoreRequestSchema } from "../../../src/shared/contracts.ts";
import { sendError, formatZodError } from "../../utils.ts";
import { analyzeVariantLimiter } from "../../middleware.ts";
import { fetchLiveSpliceAiIfPossible, liveSpliceAiFields } from "../../services/prediction/predictors/conservation-orchestrator.ts";

/**
 * Re-scores ONE variant with SpliceAI under a chosen reporting window.
 *
 * The RNA splicing tab offers the window inline; re-running the whole analysis (structure, FoldX,
 * every predictor) to change one SpliceAI parameter would be a minute of work for a sub-second
 * question. The reply carries the same fields the analysis puts on `conservationData`
 * (`liveSpliceAiFields`), so the client merges them in rather than re-deriving anything.
 */
export function registerSpliceAiRoutes(apiRouter: Router, jsonParserRegular: any): void {
  apiRouter.post("/spliceai/score", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    const parsed = spliceAiScoreRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parsed.error));
      return;
    }
    const coord = parseGenomicCoordinateString(parsed.data.coordinates);
    if (!coord) {
      sendError(res, 400, "BAD_REQUEST", "coordinates must read chrom-pos-ref-alt, for example 16-67946177-C-G");
      return;
    }
    try {
      const outcome = await fetchLiveSpliceAiIfPossible(coord.chrom, coord.pos, coord.ref, coord.alt, parsed.data.assembly, parsed.data.distance);
      const fields = liveSpliceAiFields(outcome);
      res.json({
        distance: parsed.data.distance,
        spliceai: fields?.spliceai ?? null,
        spliceaiFailure: fields?.spliceaiFailure ?? null,
        // null on both = nothing was asked (the build gate declined); the client says so rather than guessing.
        attempted: outcome !== null,
      });
    } catch (err: any) {
      console.error("[SpliceAI Route] Re-score failed:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", "Failed to re-score the variant with SpliceAI");
    }
  });
}

import { type Router } from "express";
import {
  alphaGenomeRegionSaturationRequestSchema
} from "../../../src/shared/contracts.ts";
import {
  fetchAlphaGenomeRegionSaturation
} from "../../services/alphagenome-bridge.ts";
import { sendError, formatZodError } from "../../utils.ts";
import { sanitizeToken, sanitizeUrl } from "./variant-parser.ts";
import { analyzeVariantLimiter } from "../../middleware.ts";

export function registerAlphaGenomeRoutes(apiRouter: Router, jsonParserRegular: any): void {
  apiRouter.post("/alphagenome/region-saturation", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    const parseResult = alphaGenomeRegionSaturationRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }

    const userApiKey = sanitizeToken(req.headers["x-alphagenome-key"]) || sanitizeToken((req.body as any)?.alphagenomeApiKey) || sanitizeToken(process.env.ALPHAGENOME_API_KEY);
    const userApiUrl = sanitizeUrl(req.headers["x-alphagenome-url"]) || sanitizeUrl((req.body as any)?.alphagenomeApiUrl) || sanitizeUrl(process.env.ALPHAGENOME_API_URL);

    try {
      const data = await fetchAlphaGenomeRegionSaturation(parseResult.data, {
        apiKey: userApiKey,
        apiUrl: userApiUrl
      });
      res.json(data);
    } catch (err: any) {
      console.error("[AlphaGenome Route] Error fetching region saturation:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", "Failed to fetch AlphaGenome region saturation data");
    }
  });
}

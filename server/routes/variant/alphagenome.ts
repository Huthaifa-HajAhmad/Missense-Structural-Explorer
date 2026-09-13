import { type Router } from "express";
import {
  alphaGenomeRegionSaturationRequestSchema
} from "../../../src/shared/contracts.ts";
import {
  fetchAlphaGenomeRegionSaturation
} from "../../services/alphagenome-bridge.ts";
import { sendError, formatZodError } from "../../utils.ts";

export function registerAlphaGenomeRoutes(apiRouter: Router, jsonParserRegular: any): void {
  apiRouter.post("/alphagenome/region-saturation", jsonParserRegular, async (req, res) => {
    const parseResult = alphaGenomeRegionSaturationRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }

    try {
      const data = await fetchAlphaGenomeRegionSaturation(parseResult.data);
      res.json(data);
    } catch (err: any) {
      console.error("[AlphaGenome Route] Error fetching region saturation:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", "Failed to fetch AlphaGenome region saturation data");
    }
  });
}

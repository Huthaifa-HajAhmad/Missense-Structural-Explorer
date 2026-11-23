import { type Router } from "express";
import { z } from "zod";

import { sendError, formatZodError } from "../../utils.ts";
import { testTamarindConnection } from "../../services/biophysics.ts";
import { ownCredential } from "../../services/infra/credentials.ts";

const testTamarindConnectionSchema = z.object({
  tamarindApiKey: z.string().optional()
});

export function registerStabilityRoutes(apiRouter: Router, jsonParserRegular: any): void {

  apiRouter.post("/test-tamarind-connection", jsonParserRegular, async (req, res) => {
    const parseResult = testTamarindConnectionSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      // Tests the person's own key (typed or saved), never the team's (WP-I4).
      const apiKey = ownCredential("tamarind", (req.headers["x-tamarind-api-key"] as string) || req.body?.tamarindApiKey);
      if (!apiKey) return res.json({ valid: false, message: "No Tamarind Bio API Key provided." });
      const result = await testTamarindConnection(apiKey);
      return res.json(result);
    } catch (err: any) {
      return sendError(res, 500, "INTERNAL_SERVER_ERROR", `Failed to test Tamarind connection: ${err.message}`);
    }
  });

}

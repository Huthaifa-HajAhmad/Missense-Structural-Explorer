import { type Router } from "express";
import {
  alphaGenomeRegionSaturationRequestSchema
} from "../../../src/shared/contracts.ts";
import {
  fetchAlphaGenomeRegionSaturation
} from "../../services/alphagenome-bridge.ts";
import {
  verifyAlphaGenomeConnection
} from "../../services/alphagenome-client.ts";
import { sendError, formatZodError } from "../../utils.ts";
import { sanitizeToken, sanitizeUrl } from "./variant-parser.ts";
import { analyzeVariantLimiter } from "../../middleware.ts";
import { CONFIG } from "../../config.ts";

export function registerAlphaGenomeRoutes(apiRouter: Router, jsonParserRegular: any): void {
  apiRouter.post("/alphagenome/verify-connection", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    const userApiKey = sanitizeToken(req.headers["x-alphagenome-key"]) ||
      sanitizeToken((req.body as any)?.apiKey) ||
      sanitizeToken((req.body as any)?.alphagenomeApiKey) ||
      sanitizeToken(process.env.ALPHAGENOME_API_KEY) ||
      sanitizeToken(CONFIG.services.alphagenomeApiKey);

    const userApiUrl = sanitizeUrl(req.headers["x-alphagenome-url"]) ||
      sanitizeUrl((req.body as any)?.apiUrl) ||
      sanitizeUrl((req.body as any)?.alphagenomeApiUrl) ||
      sanitizeUrl(process.env.ALPHAGENOME_API_URL) ||
      sanitizeUrl(CONFIG.services.alphagenomeUrl);

    if (!userApiKey && !userApiUrl) {
      sendError(res, 400, "BAD_REQUEST", "AlphaGenome API Key is required to test connection");
      return;
    }

    if (userApiUrl) {
      const startTime = Date.now();
      try {
        const pingUrl = `${userApiUrl.replace(/\/+$/, "")}/health`;
        const abortCtrl = new AbortController();
        const timeout = setTimeout(() => abortCtrl.abort(), 4000);
        const pingRes = await fetch(pingUrl, {
          method: "GET",
          signal: abortCtrl.signal,
          headers: userApiKey ? { Authorization: `Bearer ${userApiKey}` } : {}
        }).finally(() => clearTimeout(timeout));

        const latencyMs = Date.now() - startTime;
        if (pingRes.ok) {
          res.json({ ok: true, latencyMs, mode: "custom-proxy", url: userApiUrl });
        } else {
          res.json({ ok: false, latencyMs, mode: "custom-proxy", error: `Proxy returned HTTP ${pingRes.status}` });
        }
      } catch (err: any) {
        res.json({ ok: false, latencyMs: Date.now() - startTime, mode: "custom-proxy", error: err.message || "Failed to reach custom endpoint" });
      }
      return;
    }

    try {
      const result = await verifyAlphaGenomeConnection(userApiKey!, 5000);
      res.json({
        ok: result.ok,
        latencyMs: result.latencyMs,
        scorersCount: result.scorersCount,
        mode: "grpc",
        target: "gdmscience.googleapis.com:443",
        error: result.error
      });
    } catch (err: any) {
      console.error("[AlphaGenome Route] Error verifying connection:", err);
      res.json({
        ok: false,
        latencyMs: 0,
        mode: "grpc",
        error: err.message || "Failed to verify connection"
      });
    }
  });

  apiRouter.post("/alphagenome/region-saturation", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    const parseResult = alphaGenomeRegionSaturationRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }

    const userApiKey = sanitizeToken(req.headers["x-alphagenome-key"]) ||
      sanitizeToken((req.body as any)?.apiKey) ||
      sanitizeToken((req.body as any)?.alphagenomeApiKey) ||
      sanitizeToken(process.env.ALPHAGENOME_API_KEY) ||
      sanitizeToken(CONFIG.services.alphagenomeApiKey);

    const userApiUrl = sanitizeUrl(req.headers["x-alphagenome-url"]) ||
      sanitizeUrl((req.body as any)?.apiUrl) ||
      sanitizeUrl((req.body as any)?.alphagenomeApiUrl) ||
      sanitizeUrl(process.env.ALPHAGENOME_API_URL) ||
      sanitizeUrl(CONFIG.services.alphagenomeUrl);

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

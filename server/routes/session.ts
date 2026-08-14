/** session.ts — POST /session/keys route */
import { type Router } from "express";
import { sendError, encryptSession } from "../utils.ts";
import {
  GeminiError,
  isGeminiApiKeyPlaceholder,
  validateGeminiApiKey,
} from "../services/gemini.ts";

export function registerSessionRoutes(apiRouter: Router, jsonParserRegular: any): void {
  apiRouter.post("/session/keys", jsonParserRegular, async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey || typeof apiKey !== "string") {
        sendError(res, 400, "BAD_REQUEST", "API key parameter is required.");
        return;
      }
      const cleanKey = apiKey.trim();
      if (cleanKey.length < 10 || cleanKey.length > 200 || !/^[a-zA-Z0-9_\-\.\+\=\/]+$/.test(cleanKey) || isGeminiApiKeyPlaceholder(cleanKey)) {
        sendError(res, 400, "BAD_REQUEST", "Invalid API key format or placeholder value.");
        return;
      }
      // Do not call a syntactically valid key "active" until Google accepts it.
      // This prevents the UI from showing a green session while every analysis
      // request later falls back because the key is invalid, exhausted, or unusable.
      await validateGeminiApiKey(cleanKey);

      const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes session (SEC-13)
      const secret = process.env.APP_SESSION_SECRET;
      if (!secret) {
        throw new Error("APP_SESSION_SECRET is not configured in the environment.");
      }
      const sessionId = encryptSession({ apiKey: cleanKey, expiresAt }, secret);

      res.json({ sessionId, expiresAt });
    } catch (err: any) {
      if (err instanceof GeminiError) {
        sendError(res, err.status, err.code, err.message);
        return;
      }
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to create session.");
    }
  });
}

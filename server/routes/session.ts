/** session.ts — POST /session/keys route */
import { type Router } from "express";
import { sendError, encryptSession } from "../utils.ts";

export function registerSessionRoutes(apiRouter: Router, jsonParserRegular: any): void {
  apiRouter.post("/session/keys", jsonParserRegular, async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey || typeof apiKey !== "string") {
        sendError(res, 400, "BAD_REQUEST", "API key parameter is required.");
        return;
      }
      const cleanKey = apiKey.trim();
      if (cleanKey.length < 10 || cleanKey.length > 200 || !/^[a-zA-Z0-9_\-\.\+\=\/]+$/.test(cleanKey)) {
        sendError(res, 400, "BAD_REQUEST", "Invalid API key format or length.");
        return;
      }
      const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour session
      const secret = process.env.APP_SESSION_SECRET;
      if (!secret) {
        throw new Error("APP_SESSION_SECRET is not configured in the environment.");
      }
      const sessionId = encryptSession({ apiKey, expiresAt }, secret);

      res.json({ sessionId, expiresAt });
    } catch (err: any) {
      sendError(res, 500, "INTERNAL_ERROR", err.message || "Failed to create session.");
    }
  });
}

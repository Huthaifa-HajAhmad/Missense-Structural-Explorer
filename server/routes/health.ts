/** health.ts — GET /health and GET /version routes */
import { type Router } from "express";
import fs from "fs";
import path from "path";
import { AuditLogger } from "../utils.ts";

export function registerHealthRoutes(apiRouter: Router): void {
  apiRouter.get("/health", async (req, res) => {
    // foldxReady: check binary exists (no exec)
    const foldxBinEnv = process.env.FOLDX_BINARY || "";
    let foldxReady = false;
    if (foldxBinEnv) {
      foldxReady = fs.existsSync(foldxBinEnv);
    } else {
      try {
        const toolsDir = path.join(process.cwd(), "tools", "foldx");
        if (fs.existsSync(toolsDir)) {
          const files = fs.readdirSync(toolsDir);
          foldxReady = files.some(f => /^foldx.*\.exe$/i.test(f));
        }
      } catch { foldxReady = false; }
    }
    // geminiReady: key is set and not a placeholder
    const geminiKey = process.env.GEMINI_API_KEY || "";
    const placeholders = ["YOUR_GEMINI_API_KEY", "CHANGE_ME", "MY_GEMINI_API_KEY", ""];
    const geminiReady = !!(geminiKey && !placeholders.some(p => geminiKey.includes(p)) && geminiKey.trim().length >= 10);

    // modelServerReady: query local FastAPI sidecar health endpoint (A-6)
    let modelServerReady = false;
    try {
      const sidecarRes = await fetch("http://127.0.0.1:8000/health", { signal: AbortSignal.timeout(500) });
      if (sidecarRes.ok) {
        const data = await sidecarRes.json() as any;
        modelServerReady = data.status === "healthy";
      }
    } catch (_) {
      modelServerReady = false;
    }

    res.json({ status: "ok", timestamp: new Date().toISOString(), foldxReady, geminiReady, modelServerReady, auditLogFailures: AuditLogger.failureCount });
  });

  apiRouter.get("/version", (req, res) => {
    res.json({ version: "1.0.0", env: process.env.NODE_ENV || "development" });
  });
}

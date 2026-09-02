/** health.ts — GET /health, GET /version, GET /diagnostics, and POST /debug/clear-caches routes */
import { type Router } from "express";
import fs from "fs";
import path from "path";
import { AuditLogger } from "../utils.ts";
import {
  clearAllCaches,
  pdbCache,
  uniprotCache,
  clinvarCache,
  afUrlCache,
  predictorCache,
  conservationCache,
  stringCache,
  popEVECache,
  popEveOnlineCache,
  refseqCache,
  gnomadFreqCache,
  gnomadConstraintCache,
  uniprotFeaturesCache,
  landscapeCache
} from "../services/cache.ts";
import { mutantCache } from "../services/foldx.ts";
import { geminiCache } from "./shared.ts";
import { getConfiguredGeminiModels, isGeminiApiKeyPlaceholder } from "../services/gemini.ts";
import { adapterRegistry } from "../services/adapters/service-adapters.ts";
import { CONFIG } from "../config.ts";

export function registerHealthRoutes(apiRouter: Router): void {
  apiRouter.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  apiRouter.get("/diagnostics", async (req, res) => {
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
    // geminiReady: key is set and not a known placeholder
    const geminiKey = process.env.GEMINI_API_KEY || "";
    const geminiReady = !isGeminiApiKeyPlaceholder(geminiKey) && geminiKey.trim().length >= 10;
    const geminiModel = getConfiguredGeminiModels()[0];

    // modelServerReady: query local FastAPI sidecar health endpoint (A-6)
    let modelServerReady = false;
    try {
      const sidecarRes = await fetch(`${CONFIG.services.sidecarBaseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (sidecarRes.ok) {
        const data = await sidecarRes.json() as any;
        modelServerReady = data.status === "healthy";
      }
    } catch (_) {
      modelServerReady = false;
    }

    const cacheDiagnostics = {
      pdbCache: { size: pdbCache.size, max: pdbCache.max, ttl: "none" },
      uniprotCache: { size: uniprotCache.size, max: uniprotCache.max, ttl: "none" },
      clinvarCache: { size: clinvarCache.size, max: clinvarCache.max, ttl: "1h" },
      afUrlCache: { size: afUrlCache.size, max: afUrlCache.max, ttl: "24h" },
      predictorCache: { size: predictorCache.size, max: predictorCache.max, ttl: "1h" },
      conservationCache: { size: conservationCache.size, max: conservationCache.max, ttl: "1h" },
      stringCache: { size: stringCache.size, max: stringCache.max, ttl: "1h" },
      popEVECache: { size: popEVECache.size, max: popEVECache.max, ttl: "1h" },
      popEveOnlineCache: { size: popEveOnlineCache.size, max: popEveOnlineCache.max, ttl: "24h" },
      refseqCache: { size: refseqCache.size, max: refseqCache.max, ttl: "7d" },
      gnomadFreqCache: { size: gnomadFreqCache.size, max: gnomadFreqCache.max, ttl: "24h" },
      gnomadConstraintCache: { size: gnomadConstraintCache.size, max: gnomadConstraintCache.max, ttl: "7d" },
      uniprotFeaturesCache: { size: uniprotFeaturesCache.size, max: uniprotFeaturesCache.max, ttl: "3d" },
      landscapeCache: { size: landscapeCache.size, max: landscapeCache.max, ttl: "24h" },
      mutantCache: { size: mutantCache.size, max: mutantCache.max, ttl: "24h" },
      geminiCache: { size: geminiCache.size, max: 200, ttl: "24h" }
    };

    const serviceHealth = await adapterRegistry.checkAllHealth();

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      foldxReady,
      geminiReady,
      geminiModel,
      modelServerReady,
      auditLogFailures: AuditLogger.failureCount,
      cacheDiagnostics,
      serviceHealth
    });
  });

  apiRouter.post("/debug/clear-caches", (req, res) => {
    try {
      // 1. Clear in-memory and persistent SQLite caches
      clearAllCaches(true);
      mutantCache.clear();
      geminiCache.clear();

      // 2. Delete FoldX disk cache files (.json files in logs/foldx_cache)
      const foldxCacheDir = path.join(process.cwd(), "logs", "foldx_cache");
      let deletedFoldx = 0;
      if (fs.existsSync(foldxCacheDir)) {
        const files = fs.readdirSync(foldxCacheDir);
        for (const file of files) {
          if (file.endsWith(".json")) {
            try {
              fs.unlinkSync(path.join(foldxCacheDir, file));
              deletedFoldx++;
            } catch (_) {}
          }
        }
      }

      // 3. Delete Gemini disk cache files (.json files in logs/gemini_cache)
      const geminiCacheDir = path.join(process.cwd(), "logs", "gemini_cache");
      let deletedGemini = 0;
      if (fs.existsSync(geminiCacheDir)) {
        const files = fs.readdirSync(geminiCacheDir);
        for (const file of files) {
          if (file.endsWith(".json")) {
            try {
              fs.unlinkSync(path.join(geminiCacheDir, file));
              deletedGemini++;
            } catch (_) {}
          }
        }
      }

      // 4. Delete job registry JSON
      const registryPath = path.join(process.cwd(), "temp_jobs", "job_registry.json");
      if (fs.existsSync(registryPath)) {
        try {
          fs.unlinkSync(registryPath);
        } catch (_) {}
      }

      res.json({
        status: "success",
        message: "All in-memory and disk caches have been successfully purged.",
        cleared: {
          inMemory: true,
          deletedFoldxFiles: deletedFoldx,
          deletedGeminiFiles: deletedGemini,
          deletedJobRegistry: true,
          sqlite: true
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to clear caches." });
    }
  });

  apiRouter.get("/version", (req, res) => {
    res.json({ version: "1.0.0", env: process.env.NODE_ENV || "development" });
  });
}

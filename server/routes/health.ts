/** health.ts — GET /health, GET /version, GET /diagnostics, and POST /debug/clear-caches routes */
import { type Router } from "express";
import fs from "fs";
import path from "path";
import { AuditLogger, sendError } from "../utils.ts";
import { clearAllCaches, defaultCacheRegistry } from "../services/cache.ts";
import { getConfiguredGeminiModels, isGeminiApiKeyPlaceholder } from "../services/gemini.ts";
import { adapterRegistry } from "../services/adapters/service-adapters.ts";
import { CONFIG } from "../config.ts";
import { checkP2RankCapability } from "../services/pocket.ts";

/**
 * Resolve a disk-cache directory, honouring an environment override.
 *
 * Without this, `/debug/clear-caches` deleted real directories that no test could redirect —
 * and a route suite calls the handler directly, so the suite emptied the developer's FoldX
 * cache on every run.
 */
function resolveCacheDir(envKey: string, dirName: string): string {
  return process.env[envKey] ?? path.join(process.cwd(), "logs", dirName);
}

export function registerHealthRoutes(apiRouter: Router): void {
  apiRouter.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  apiRouter.get("/diagnostics", async (req, res) => {
    // foldxReady: check binary exists across candidate directories and platforms
    const foldxBinEnv = process.env.FOLDX_BINARY || "";
    let foldxReady = false;
    if (foldxBinEnv) {
      foldxReady = fs.existsSync(foldxBinEnv);
    } else {
      const candidateDirs = [
        process.env.FOLDX_DIR,
        path.join(process.cwd(), "tools", process.platform === "win32" ? "foldx" : "foldx_linux"),
        path.join(process.cwd(), "tools", "foldx_linux"),
        path.join(process.cwd(), "tools", "foldx"),
        "/app/tools/foldx_linux",
        "/app/tools/foldx"
      ].filter(Boolean) as string[];

      for (const dir of candidateDirs) {
        if (!fs.existsSync(dir)) continue;
        try {
          const files = fs.readdirSync(dir);
          const found = files.some(f => {
            const lower = f.toLowerCase();
            if (process.platform === "win32") {
              return lower.startsWith("foldx") && lower.endsWith(".exe");
            } else {
              return (
                lower.startsWith("foldx") &&
                !lower.endsWith(".exe") &&
                !lower.endsWith(".txt") &&
                !lower.endsWith(".cmd") &&
                !lower.endsWith(".bat") &&
                !lower.endsWith(".ps1") &&
                !lower.endsWith(".sh") &&
                !lower.endsWith(".zip")
              );
            }
          });
          if (found) {
            foldxReady = true;
            break;
          }
        } catch { }
      }
    }
    // geminiReady: key is set and not a known placeholder
    const geminiKey = process.env.GEMINI_API_KEY || "";
    const geminiReady = !isGeminiApiKeyPlaceholder(geminiKey) && geminiKey.trim().length >= 10;
    const geminiModel = getConfiguredGeminiModels()[0];

    // modelServerReady: query local FastAPI sidecar health endpoint (A-6)
    let modelServerReady = false;
    try {
      const sidecarRes = await fetch(`${CONFIG.services.sidecarBaseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (sidecarRes.ok) {
        const data = await sidecarRes.json() as any;
        modelServerReady = data.status === "ok" || data.status === "healthy" || data.state === "ready" || data.state === "warming_up";
      }
    } catch (_) {
      modelServerReady = false;
    }

    const cacheDiagnostics = defaultCacheRegistry.getDiagnostics();

    const p2rankCap = await checkP2RankCapability();
    const serviceHealth = await adapterRegistry.checkAllHealth();

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      foldxReady,
      geminiReady,
      geminiModel,
      modelServerReady,
      p2rankReady: p2rankCap.ready,
      p2rankStatus: p2rankCap.status,
      p2rankJavaCompatible: p2rankCap.javaVersionCompatible,
      p2rankJavaVersion: p2rankCap.javaVersion,
      auditLogFailures: AuditLogger.failureCount,
      cacheDiagnostics,
      serviceHealth
    });
  });

  apiRouter.get(["/debug/cache-stats", "/api/v1/debug/cache-stats"], (req, res) => {
    const memoryReport = defaultCacheRegistry.getMemoryReport();
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      ...memoryReport
    });
  });

  apiRouter.post("/debug/clear-caches", (req, res) => {
    if (process.env.NODE_ENV === "production" && !req.headers.authorization && !req.headers["x-gemini-session-id"]) {
      sendError(res, 403, "FORBIDDEN", "Administrative cache clearance requires authorization.");
      return;
    }

    try {
      // 1. Clear in-memory and persistent SQLite caches across all registered services
      clearAllCaches(true);

      // 2. Delete FoldX disk cache files (.json files in logs/foldx_cache)
      //
      // Both directories below are resolved from the environment so tests can redirect them.
      // They were hardcoded `process.cwd()` paths that read no variable at all, which made this
      // handler the last unredirectable real-state deleter in the codebase: route suites exercise
      // it directly, so running the test suite emptied the developer's real FoldX cache (hours of
      // recomputation) and deleted the live job registry.
      const foldxCacheDir = resolveCacheDir("FOLDX_CACHE_DIR", "foldx_cache");
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
      const geminiCacheDir = resolveCacheDir("GEMINI_CACHE_DIR", "gemini_cache");
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
      const registryPath = process.env.JOB_REGISTRY_PATH ?? path.join(process.cwd(), "temp_jobs", "job_registry.json");
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

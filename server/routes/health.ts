/** health.ts — GET /health, GET /version, GET /diagnostics, and POST /debug/clear-caches routes */
import { type Router } from "express";
import fs from "fs";
import path from "path";
import { AuditLogger, sendError } from "../utils.ts";
import { clearAllCaches, defaultCacheRegistry } from "../services/cache.ts";
import { getConfiguredGeminiModels, isGeminiApiKeyPlaceholder } from "../services/gemini.ts";
import { adapterRegistry } from "../services/adapters/service-adapters.ts";
import type { HealthStatus } from "../services/adapters/types.ts";
import {
  checkVariantValidatorHealth,
  type VariantValidatorHealth,
} from "../services/translation/variant-validator.ts";
import { CONFIG } from "../config.ts";
import { checkP2RankCapability } from "../services/pocket.ts";
import { resolveFoldxReadiness } from "../services/stability/foldx/readiness.ts";
import { inspectLocalDbnsfpFileForPublic } from "../services/prediction/dbnsfp_local.ts";

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

/**
 * The probe's shape is DERIVED from the probe, never re-declared. A hand-written copy silently
 * swallows any field added to the real thing, which is exactly how a `verdict` field would go
 * missing from the response type while being present at runtime.
 */
export type FallbackProbe = (signal?: AbortSignal) => Promise<VariantValidatorHealth>;

type FallbackVerdict = Awaited<ReturnType<FallbackProbe>>;

/** A verdict is refreshed after this long, but stays displayable for longer. */
const FALLBACK_VERDICT_REFRESH_MS = 20_000;
/** Past this, a stale verdict is worse than none: it would claim coverage that may be gone. */
const FALLBACK_VERDICT_MAX_AGE_MS = 120_000;

/**
 * Hard wall-clock ceiling for one probe attempt.
 *
 * Must exceed the transport timeout, because the transport timer is cleared as soon as
 * response headers arrive: it bounds time-to-headers, not the body read. This signal is what
 * actually bounds the probe, and it is also what stops a provider that sends headers and then
 * stalls from leaving the promise — and therefore the single-flight slot — pending forever.
 *
 * Exported so the diagnostics test can express "the endpoint did not WAIT for the probe" in terms
 * of this budget instead of a magic wall-clock literal, which drifted into flakiness: a 2000ms
 * bound failed at 2068ms on a loaded CI runner while the guarded behaviour was correct.
 */
export const FALLBACK_PROBE_HARD_CAP_MS = 25_000;

/**
 * Independent watchdog on the in-flight slot.
 *
 * `AbortSignal.timeout` should make a probe always settle, so this is defence in depth: if a
 * probe is somehow still pending long past its cap, the slot is released rather than wedging
 * the feature for the lifetime of the process. Before this existed, a permanently-pending
 * probe meant `currentFallbackVerdict()` returned null forever, silently and with no log.
 */
const FALLBACK_PROBE_WATCHDOG_MS = 40_000;

let fallbackVerdict: { result: FallbackVerdict; at: number } | null = null;
let fallbackProbeInFlight: Promise<void> | null = null;
let fallbackProbeStartedAt = 0;

/**
 * Test hook: the verdict cache is process-global, so suites must be able to clear it.
 *
 * Clears, but deliberately does NOT cancel a pending probe — a cleared slot plus an
 * in-flight probe means the next call may start a second probe. That only matters to tests,
 * which call this between cases; production never calls it.
 */
export function resetFallbackVerdictCacheForTests(): void {
  fallbackVerdict = null;
  fallbackProbeInFlight = null;
  fallbackProbeStartedAt = 0;
}

/**
 * Latest known fallback verdict, refreshing in the background.
 *
 * DELIBERATELY SYNCHRONOUS AND NEVER AWAITED BY THE REQUEST PATH. The first implementation
 * awaited the probe, which was wrong: `/diagnostics` is a general health poll that fans out to
 * ~10 services, and making it wait on an eleventh — one that only matters when the primary is
 * already down, and that a blackholed network holds open for the full timeout — took the
 * endpoint from instant to multi-second in exactly the outage it exists to describe. So the
 * probe runs off to the side and the response carries whatever verdict is already known.
 *
 * The returned verdict carries `ageMs`; the caller decides whether an old verdict is still
 * worth showing. The client issues bounded follow-up fetches, which is what makes the answer
 * appear without the user refreshing.
 */
export function currentFallbackVerdict(): (FallbackVerdict & { ageMs: number }) | null {
  const now = Date.now();

  // Release a slot that has outlived every reasonable bound. Without this the single-flight
  // guard is a permanent lock whenever a probe fails to settle.
  if (fallbackProbeInFlight && now - fallbackProbeStartedAt > FALLBACK_PROBE_WATCHDOG_MS) {
    console.warn(
      `[Diagnostics] Fallback probe exceeded its ${FALLBACK_PROBE_WATCHDOG_MS}ms watchdog; releasing the single-flight slot.`
    );
    fallbackProbeInFlight = null;
  }

  if (!fallbackVerdict || now - fallbackVerdict.at >= FALLBACK_VERDICT_REFRESH_MS) {
    if (!fallbackProbeInFlight) {
      fallbackProbeStartedAt = now;
      fallbackProbeInFlight = checkVariantValidatorHealth(AbortSignal.timeout(FALLBACK_PROBE_HARD_CAP_MS))
        .then((result) => {
          fallbackVerdict = { result, at: Date.now() };
        })
        // A probe that cannot even be attempted must not become an unhandled rejection; the
        // absence of a verdict is itself the reportable state.
        .catch(() => {})
        .finally(() => {
          fallbackProbeInFlight = null;
        });
    }
  }

  if (fallbackVerdict && now - fallbackVerdict.at < FALLBACK_VERDICT_MAX_AGE_MS) {
    return { ...fallbackVerdict.result, ageMs: now - fallbackVerdict.at };
  }
  return null;
}

/**
 * Attaches the coordinate-translation fallback verdict to the service-health payload.
 *
 * Coordinate resolution is a provider ladder (Ensembl VEP -> VariantValidator, see
 * services/translation/coordinate-resolver.ts). Reporting only the primary's health tells the
 * operator "coordinate translation is down" when the ladder would still answer, and says
 * nothing at all when BOTH tiers are out. The verdict is therefore attached — but only when the
 * primary has already failed, and only when one is known.
 *
 * `checkAllHealth` hands back its cache entry BY REFERENCE (15s TTL), so this copies both the
 * record and the affected entry. Attaching in place would bake the fallback into that cache and
 * leave it on display after Ensembl had already recovered.
 */
export function attachNotationFallback(
  probedHealth: Record<string, HealthStatus>,
  verdict: (FallbackVerdict & { ageMs: number }) | null
): Record<string, HealthStatus> {
  const serviceHealth: Record<string, HealthStatus> = { ...probedHealth };
  const ensemblHealth = serviceHealth.ensembl;
  if (!ensemblHealth || ensemblHealth.healthy || !verdict) {
    return serviceHealth;
  }

  serviceHealth.ensembl = {
    ...ensemblHealth,
    fallback: {
      id: "variant-validator",
      name: "VariantValidator",
      ...verdict,
      // Surfaced so the client can say how current the claim is instead of presenting an old
      // verdict as a live one. A fallback dying while the panel is open previously left
      // "Fallback Ready" on screen indefinitely.
      stale: verdict.ageMs >= FALLBACK_VERDICT_REFRESH_MS,
    },
  };
  return serviceHealth;
}

export type AlphaGenomeKeySource = "server" | "none";

/**
 * Says where the AlphaGenome key comes from, so the rail can count a key the reader supplied in
 * their own browser as ready.
 *
 * The adapter reports `healthy` from server configuration alone, so a browser-only key read as
 * "Standby" even though the browser sends it on every request (`x-alphagenome-key`) and the
 * analysis uses it. This is structured on purpose: a consumer must not string-match `message`,
 * which is prose and changes with its wording.
 */
export function attachAlphaGenomeKeySource(
  probedHealth: Record<string, HealthStatus>,
  keySource: AlphaGenomeKeySource
): Record<string, HealthStatus & { keySource?: AlphaGenomeKeySource }> {
  const alphagenome = probedHealth.alphagenome;
  if (!alphagenome) return { ...probedHealth };
  return { ...probedHealth, alphagenome: { ...alphagenome, keySource } };
}

export function registerHealthRoutes(apiRouter: Router): void {
  apiRouter.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  apiRouter.get("/diagnostics", async (req, res) => {
    const foldx = resolveFoldxReadiness();
    // geminiReady: key is set and not a known placeholder
    const geminiKey = process.env.GEMINI_API_KEY || "";
    const geminiReady = !isGeminiApiKeyPlaceholder(geminiKey) && geminiKey.trim().length >= 10;
    const geminiModel = getConfiguredGeminiModels()[0];

    // modelServerReady: query local FastAPI sidecar health endpoint (A-6)
    //
    // `warming_up` is NOT ready. The sidecar's `/health` returns `status: "healthy"` from the
    // moment uvicorn binds, long before the weights it was spawned to load become usable, and
    // reports that window only in `state`. Counting it as ready put a green "Neural Sidecar Live"
    // on the rail for the whole ~180 s cold start while every ML-backed feature in it failed — so
    // `modelServerReady` now means "can serve", and `modelServerState` carries the three-way
    // distinction the rail needs to say "warming" rather than "up" or "down".
    let modelServerReady = false;
    let modelServerState: "ready" | "warming_up" | "offline" = "offline";
    try {
      const sidecarRes = await fetch(`${CONFIG.services.sidecarBaseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (sidecarRes.ok) {
        const data = await sidecarRes.json() as any;
        const healthy = data.status === "ok" || data.status === "healthy";
        if (healthy && data.state === "warming_up") {
          modelServerState = "warming_up";
        } else if (healthy) {
          modelServerState = "ready";
          modelServerReady = true;
        }
      }
    } catch (_) {
      modelServerReady = false;
    }

    const cacheDiagnostics = defaultCacheRegistry.getDiagnostics();

    const p2rankCap = await checkP2RankCapability();
    const probedHealth = await adapterRegistry.checkAllHealth();
    // Only consulted (and only refreshed) once the primary has actually FAILED — and only when
    // there is a primary entry to report on. The optional-chain form used to treat a missing
    // entry as a failure, spending a real outbound call whose verdict `attachNotationFallback`
    // then discarded. `currentFallbackVerdict` returns immediately; it starts a background
    // refresh rather than waiting on one.
    const ensemblDown = Boolean(probedHealth.ensembl && !probedHealth.ensembl.healthy);
    // The server's own key, the same one `resolveAlphaGenomeAccess` falls back to. A browser key is
    // not part of this probe; the client attaches it per request, and the rail reads it from there.
    const alphagenomeKeySource: AlphaGenomeKeySource =
      process.env.ALPHAGENOME_API_KEY || CONFIG.services.alphagenomeApiKey ? "server" : "none";
    const serviceHealth = attachAlphaGenomeKeySource(
      attachNotationFallback(probedHealth, ensemblDown ? currentFallbackVerdict() : null),
      alphagenomeKeySource
    );

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      foldxReady: foldx.ready,
      // Additive: the rail explains a FoldX that is installed but missing a piece, not "not installed".
      foldxDetail: {
        binaryFound: foldx.binaryFound,
        rotabasePresent: foldx.rotabasePresent,
        box64Required: foldx.box64Required,
        box64Present: foldx.box64Present,
      },
      // Additive: whether predictor scores can be served from the local store, and which release.
      dbnsfp: inspectLocalDbnsfpFileForPublic(),
      geminiReady,
      geminiModel,
      modelServerReady,
      modelServerState,
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
    res.json({
      version: "1.0.0",
      env: process.env.NODE_ENV || "development",
      /**
       * Which revision is actually running.
       *
       * Deployments are gated on CI now, and a broken CI run once deployed anyway; without the
       * revision there is no way to answer "did my fix ship?" from outside the host. Supplied by
       * the deploy pipeline (`BUILD_COMMIT`), with the usual provider aliases as fallbacks.
       */
      commit:
        process.env.BUILD_COMMIT ||
        process.env.GIT_COMMIT ||
        process.env.SOURCE_COMMIT ||
        null,
      builtAt: process.env.BUILD_TIME || null,
    });
  });
}

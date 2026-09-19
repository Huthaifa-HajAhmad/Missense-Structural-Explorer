/**
 * server/config.ts — Centralized, typed configuration for Missense Structural Explorer.
 *
 * All runtime parameters, operational timeouts, queue memory limits, and service ports
 * are managed here with safe defaults and environment variable overrides.
 */

import crypto from "crypto";

/**
 * Ensures a valid, cryptographically secure SIDECAR_SECRET exists in process.env.
 * Generates an in-memory 256-bit hex secret if none is configured.
 */
export function ensureSidecarSecret(): string {
  if (!process.env.SIDECAR_SECRET || !process.env.SIDECAR_SECRET.trim()) {
    process.env.SIDECAR_SECRET = crypto.randomBytes(32).toString("hex");
  }
  return process.env.SIDECAR_SECRET;
}

// Guarantee SIDECAR_SECRET is populated early upon config initialization
ensureSidecarSecret();

export const CONFIG = {
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
    isTest: process.env.NODE_ENV === "test",
    biophysicalConcurrency: parseInt(process.env.BIOPHYSICAL_CONCURRENCY || "4", 10),
  },
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * FOLDX TIME BUDGETS — these MUST nest. Read this before changing any number.
   * ─────────────────────────────────────────────────────────────────────────────
   * A FoldX run is supervised by several independent timers spread across two processes. They were
   * all set to 300 s while the work they supervise can legitimately take 840 s, so the outermost
   * timer always fired first: a *successful* long run was reported to the user as
   * "Simulation timed out after 5 minutes", and because nothing cancels the queued job, the
   * result it eventually produced was orphaned.
   *
   * Required ordering, asserted by `server/tests/foldx-timeout-budget.test.ts`:
   *
   *   semaphoreWait + repair + buildModel + buildModelRetry   ← worst-case work
   *     ≤ foldxSec                                            ← queue job cap
   *     < foldxReaperLeaseMs                                  ← stale-running reaper
   *     ≤ foldxQueuedLeaseMs                                  ← stale-queued reaper
   *     ≤ CLIENT_FOLDX_QUEUE_BUDGET_MS                        ← client, while the job is QUEUED
   *
   *   worst-case work ≤ foldxSec < CLIENT_FOLDX_POLL_BUDGET_MS ← client, while the job is RUNNING
   *
   * The client budgets those two phases separately on purpose. A single budget covering queue wait
   * plus execution abandoned jobs the server completed — a job can wait `foldxQueuedLeaseMs` for a
   * slot and *then* execute for `foldxSec`. There is deliberately **no absolute watchdog**: armed
   * before submission it cannot tell the phases apart, so it is the defect rather than the guard.
   *
   * These are worst-case caps, not expected durations: a typical run on a ~400-residue chain
   * takes minutes, and the stage caps are only reached on pathological structures.
   */
  timeouts: {
    coreAnalysisMs: parseInt(process.env.CORE_TIMEOUT_MS || "45000", 10),
    structuralModelsMs: parseInt(process.env.STRUCTURAL_TIMEOUT_MS || "120000", 10),
    /** Whole-job cap for a queued FoldX job, covering every stage below. */
    foldxSec: parseInt(process.env.FOLDX_TIMEOUT_S || "900", 10),
    /** Wait for a concurrency slot before FoldX starts (counts against the job cap). */
    foldxSemaphoreWaitMs: parseInt(process.env.FOLDX_SEMAPHORE_WAIT_MS || "120000", 10),
    /** FoldX RepairPDB subprocess cap. */
    foldxRepairMs: parseInt(process.env.FOLDX_REPAIR_TIMEOUT_MS || "300000", 10),
    /** FoldX BuildModel subprocess cap (the 5-run ensemble). */
    foldxBuildModelMs: parseInt(process.env.FOLDX_BUILDMODEL_TIMEOUT_MS || "300000", 10),
    /** Second BuildModel attempt, made only after a RepairPDB failure. */
    foldxBuildModelRetryMs: parseInt(process.env.FOLDX_BUILDMODEL_RETRY_MS || "120000", 10),
    /** Reaper lease for a job a crash left in `running`. Must exceed the job cap. */
    foldxReaperLeaseMs: parseInt(process.env.FOLDX_REAPER_LEASE_MS || "960000", 10),
    /** Reaper lease for a job stuck in `queued`; queued jobs legitimately wait behind others. */
    foldxQueuedLeaseMs: parseInt(process.env.FOLDX_QUEUED_LEASE_MS || "1800000", 10),
    p2rankSec: parseInt(process.env.P2RANK_TIMEOUT_S || "120", 10),
    sidecarHealthCheckMs: parseInt(process.env.SIDECAR_HEALTH_MS || "5000", 10),
    httpDefaultTimeoutMs: parseInt(process.env.HTTP_DEFAULT_TIMEOUT_MS || "15000", 10),
    gracefulShutdownWatchdogMs: parseInt(process.env.SHUTDOWN_WATCHDOG_MS || "10000", 10),
    japanfoldZeroShotMs: parseInt(process.env.JAPANFOLD_ZEROSHOT_TIMEOUT_MS || "3500", 10),
    japanfoldFoldingMs: parseInt(process.env.JAPANFOLD_FOLDING_TIMEOUT_MS || "60000", 10),
  },
  memory: {
    minFreeBytes: process.env.NODE_ENV === "test"
      ? 0
      : parseInt(process.env.MIN_FREE_MEMORY_MB || "500", 10) * 1024 * 1024,
  },
  limits: {
    maxAuditLogAgeDays: parseInt(process.env.MAX_AUDIT_LOG_AGE_DAYS || "30", 10),
  },
  services: {
    sidecarBaseUrl: (process.env.SIDECAR_URL || "http://127.0.0.1:8000").replace(/\/+$/, ""),
    japanfoldBaseUrl: (process.env.JAPANFOLD_URL || "https://api.japanfold.aiand.com").replace(/\/+$/, ""),
    japanfoldApiKey: process.env.JAPANFOLD_API_KEY || null,
    alphagenomeUrl: process.env.ALPHAGENOME_API_URL || null,
    alphagenomeApiKey: process.env.ALPHAGENOME_API_KEY || null,
  }
} as const;

/**
 * Performs fail-closed security assertions on environment variables before booting Express.
 */
export function validateStartupEnvironment(): void {
  const apiToken = process.env.APP_API_TOKEN;
  if (!apiToken) {
    console.error("FATAL: APP_API_TOKEN is not set. Refusing to start.");
    process.exit(1);
  }
  if (CONFIG.server.isProduction && (apiToken === "a_secure_arbitrary_api_token" || apiToken.length < 16)) {
    console.error("FATAL: APP_API_TOKEN is insecure (using default example or too short) for production. Refusing to start.");
    process.exit(1);
  }

  const sessionSecret = process.env.APP_SESSION_SECRET;
  const defaultValues = [
    "dev-secret-change-me",
    "dev_session_secret",
    "dev-session-secret",
    "must-be-changed",
    "must_be_changed",
    "change_me",
    "change-me",
    "placeholder",
    "secret",
    "dev-session-secret-must-be-changed-in-prod",
    "dev_session_secret_must_be_changed_in_prod_32_bytes_long"
  ];
  if (!sessionSecret || (CONFIG.server.isProduction && (defaultValues.some(d => sessionSecret.toLowerCase().includes(d)) || sessionSecret.length < 32))) {
    console.error("FATAL: APP_SESSION_SECRET is not set or is using a weak/development fallback in production (must be 32+ characters). Refusing to start.");
    process.exit(1);
  }

  const sidecarUrl = CONFIG.services.sidecarBaseUrl;
  const isLocalSidecar = sidecarUrl.includes("localhost") || sidecarUrl.includes("127.0.0.1") || sidecarUrl.includes("0.0.0.0");
  if (!isLocalSidecar && (!process.env.SIDECAR_SECRET || !process.env.SIDECAR_SECRET.trim())) {
    console.warn("[WARNING] SIDECAR_URL points to an external host, but SIDECAR_SECRET is not configured in .env. Ephemeral in-memory secret will cause authentication failures on the remote sidecar.");
  }
}


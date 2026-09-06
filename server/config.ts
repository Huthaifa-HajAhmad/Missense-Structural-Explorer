/**
 * server/config.ts — Centralized, typed configuration for Missense Structural Explorer.
 *
 * All runtime parameters, operational timeouts, queue memory limits, and service ports
 * are managed here with safe defaults and environment variable overrides.
 */

export const CONFIG = {
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
    isTest: process.env.NODE_ENV === "test",
    biophysicalConcurrency: parseInt(process.env.BIOPHYSICAL_CONCURRENCY || "4", 10),
  },
  timeouts: {
    coreAnalysisMs: parseInt(process.env.CORE_TIMEOUT_MS || "45000", 10),
    structuralModelsMs: parseInt(process.env.STRUCTURAL_TIMEOUT_MS || "45000", 10),
    foldxSec: parseInt(process.env.FOLDX_TIMEOUT_S || "300", 10),
    p2rankSec: parseInt(process.env.P2RANK_TIMEOUT_S || "120", 10),
    sidecarHealthCheckMs: parseInt(process.env.SIDECAR_HEALTH_MS || "5000", 10),
    httpDefaultTimeoutMs: parseInt(process.env.HTTP_DEFAULT_TIMEOUT_MS || "15000", 10),
    gracefulShutdownWatchdogMs: parseInt(process.env.SHUTDOWN_WATCHDOG_MS || "10000", 10),
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
}


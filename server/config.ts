/**
 * server/config.ts — Centralized, typed configuration for Missense Structural Explorer.
 *
 * All runtime parameters, operational timeouts, queue memory limits, and service ports
 * are managed here with safe defaults and environment variable overrides.
 */

import crypto from "crypto";
import os from "os";
import { authEnvironmentProblems } from "./auth/config.ts";

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

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * How many biophysical jobs the queue runs at once: `BIOPHYSICAL_CONCURRENCY`, default 4.
 *
 * This is the UPPER bound for every tool. It is deliberately not reduced to the CPU count: P2Rank jobs
 * do not take the FoldX semaphore, so on a 2-core host a queue of `cpus - 1 = 1` slot made every pocket
 * job wait behind whatever FoldX run was in progress (a regression shipped and reverted, 2026-10-10).
 */
export function resolveBiophysicalConcurrency(): number {
  return positiveInt(process.env.BIOPHYSICAL_CONCURRENCY, 4);
}

/**
 * How many FoldX processes run at once: derived from the queue bound so the two cannot disagree upward,
 * and capped by the CPU count when no explicit value is set (FoldX is CPU-bound; under Box64 on the
 * 2-core server two at once only slow both). Unset on that host: queue 4, FoldX 1, exactly as before.
 */
export function resolveFoldxConcurrency(): number {
  const explicit = positiveInt(process.env.BIOPHYSICAL_CONCURRENCY, 0);
  if (explicit > 0) return explicit;
  return Math.min(resolveBiophysicalConcurrency(), Math.max(1, os.cpus().length - 1));
}

export const CONFIG = {
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
    isTest: process.env.NODE_ENV === "test",
    biophysicalConcurrency: resolveBiophysicalConcurrency(),
  },
  /**
   * Queue safety limit (doc/COMPUTE_ROUTING_PLAN.md section 4.4). This protects the host; fairness
   * between people comes from the scheduler's rotation. Per-person limits (`QUOTA_QUEUED_PER_USER`,
   * `QUOTA_SERVER_SECONDS_PER_DAY`) are account settings: `authSettings()` and the user's overrides.
   */
  queue: {
    /** Queued + running across everyone; the backstop behind the per-person limit. */
    maxTotal: positiveInt(process.env.QUEUE_MAX_TOTAL, 50),
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
   *   semaphoreWait + max(repair + buildModel(≤400 res), buildModelMax) + buildModelRetry
   *                                                           ← worst-case work (repair and a long
   *                                                             BuildModel never share a job)
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
    /** FoldX RepairPDB subprocess cap (up to ~400 residues rotamer repacking with missing sidechain completion). */
    foldxRepairMs: parseInt(process.env.FOLDX_REPAIR_TIMEOUT_MS || "420000", 10),
    /**
     * FoldX BuildModel subprocess cap (the 5-run ensemble) on a native host, and the FLOOR of the
     * size-aware cap under emulation (`foldx/budget.ts`). Measured with `npm run foldx:timing`:
     *   native Windows x64   154 res 2.3 s · 875 res 4.7 s (~0.5 s per extra run)
     */
    foldxBuildModelMs: parseInt(process.env.FOLDX_BUILDMODEL_TIMEOUT_MS || "180000", 10),
    /** Ceiling of the size-aware BuildModel cap. Repair is skipped at this size, so it fits `foldxSec`. */
    foldxBuildModelMaxMs: parseInt(process.env.FOLDX_BUILDMODEL_MAX_MS || "600000", 10),
    /**
     * Emulated (OCI ARM64 + Box64) BuildModel cost model; see `foldx/budget.ts` for the measurements.
     * Fixed part: the largest measured was 13.4 s (SLC12A4, 1,085 residues).
     */
    foldxEmulatedFixedMs: parseInt(process.env.FOLDX_EMULATED_FIXED_MS || "15000", 10),
    /**
     * Per residue per run, the UPPER ENVELOPE of what was measured (87.7 ms: p53 R175H, 393 residues),
     * not a fit: per-run cost spans 0.6-76 s on this host depending on the substitution, and residue
     * count explains 29% of the variance of the 5-run total.
     */
    foldxEmulatedMsPerResidueRun: parseFloat(process.env.FOLDX_EMULATED_MS_PER_RESIDUE_RUN || "90"),
    /** Per incomplete residue FoldX must rebuild itself (measured 4.68 s: 211 s unrepaired vs 5 s repaired, 44 residues). */
    foldxEmulatedMsPerIncompleteResidue: parseInt(process.env.FOLDX_EMULATED_MS_PER_INCOMPLETE_RESIDUE || "5000", 10),
    /**
     * Per residue, RepairPDB wall time under emulation, as an envelope: 1.77 s (SOD1, 154), 1.16 s
     * (p53, 393) and 1.49 s (6N7E, 305, after the incomplete-residue term). Gates whether RepairPDB is
     * attempted at all (`repairFitsBudget`); a repair that cannot finish in `foldxRepairMs` is wasted time.
     */
    foldxEmulatedRepairMsPerResidue: parseInt(process.env.FOLDX_EMULATED_REPAIR_MS_PER_RESIDUE || "1800", 10),
    /**
     * Ceiling for a BACKGROUND RepairPDB (`foldx/background-repair.ts`), which runs outside the queue's
     * whole-job cap because it only ever uses an idle server and yields to any job. 6N7E needs 660 s.
     */
    foldxBackgroundRepairMaxMs: parseInt(process.env.FOLDX_BACKGROUND_REPAIR_MAX_MS || "1500000", 10),
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
    /**
     * Biohub/EvolutionaryScale sidecar fold attempt, per sequence.
     *
     * Named rather than left as the literal `30000` it was: `src/shared/timeouts.ts` budgets the
     * CLIENT side of this call, and `server/tests/denovo-fold-timeout-budget.test.ts` can only assert
     * that the client outlasts the server if the server's own numbers are readable from here.
     */
    esmfoldSidecarMs: parseInt(process.env.ESMFOLD_SIDECAR_TIMEOUT_MS || "30000", 10),
    /** Keyless public ESM Atlas fold attempt (was a literal `15000` inside `esmfold.ts`). */
    esmAtlasMs: parseInt(process.env.ESM_ATLAS_TIMEOUT_MS || "15000", 10),
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

  // Accounts: an unknown AUTH_MODE or an unbuilt provider must stop the server, never fall back to
  // no login (server/auth/config.ts).
  const authProblems = authEnvironmentProblems();
  if (authProblems.length > 0) {
    for (const problem of authProblems) console.error(`FATAL: ${problem}`);
    console.error("Refusing to start.");
    process.exit(1);
  }

  const sidecarUrl = CONFIG.services.sidecarBaseUrl;
  const isLocalSidecar = sidecarUrl.includes("localhost") || sidecarUrl.includes("127.0.0.1") || sidecarUrl.includes("0.0.0.0");
  if (!isLocalSidecar && (!process.env.SIDECAR_SECRET || !process.env.SIDECAR_SECRET.trim())) {
    console.warn("[WARNING] SIDECAR_URL points to an external host, but SIDECAR_SECRET is not configured in .env. Ephemeral in-memory secret will cause authentication failures on the remote sidecar.");
  }
}


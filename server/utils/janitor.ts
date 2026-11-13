import path from "path";
import fs from "fs";
import { AuditLogger } from "./audit-logger.ts";
import { initialDeploymentPaused } from "../deployment-role.ts";
import { accountsDbPath, authSettings } from "../auth/config.ts";
import { deleteExpiredPairingCodes, deleteExpiredSessions } from "../auth/store.ts";

let janitorTimer: ReturnType<typeof setInterval> | null = null;

/** Stops the background janitor interval on server shutdown or test teardown. */
export function stopTempJobsJanitor(): void {
  if (janitorTimer) {
    clearInterval(janitorTimer);
    janitorTimer = null;
  }
}

/**
 * Starts a background janitor that runs periodically to delete job directories in temp_jobs/
 * that are older than 30 minutes, stale Gemini cache files (>7 days), expired audit logs,
 * and expired auth sessions / agent pairing codes.
 */
export function runTempJobsJanitor(): void {
  if (janitorTimer) return;
  const tempJobsDir = path.join(process.cwd(), "temp_jobs");
  const cacheDir = path.join(process.cwd(), "logs", "gemini_cache");
  const MAX_AGE = 30 * 60 * 1000; // 30 minutes TTL (M-4)
  const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days TTL (M-6)
  const RUN_INTERVAL = 5 * 60 * 1000; // run every 5 minutes (M-4)

  janitorTimer = setInterval(async () => {
    if (initialDeploymentPaused()) return;
    // 1. Sweep temp jobs
    try {
      if (fs.existsSync(tempJobsDir)) {
        const files = await fs.promises.readdir(tempJobsDir);
        const now = Date.now();

        for (const file of files) {
          const filePath = path.join(tempJobsDir, file);
          try {
            const stats = await fs.promises.stat(filePath);
            if (stats.isDirectory()) {
              const age = now - stats.mtimeMs;
              if (age > MAX_AGE) {
                console.log(`[Janitor] Deleting expired job directory: ${filePath} (age: ${Math.round(age / 1000 / 60)} mins)`);
                await fs.promises.rm(filePath, { recursive: true, force: true });
              }
            }
          } catch (fileErr: any) {
            console.error(`[Janitor] Failed to inspect/delete ${filePath}:`, fileErr.message);
          }
        }
      }
    } catch (err: any) {
      console.error("[Janitor] Failed to read temp_jobs directory:", err.message);
    }

    // 2. Sweep stale Gemini disk cache files (prevents unbounded disk growth)
    try {
      if (fs.existsSync(cacheDir)) {
        const files = await fs.promises.readdir(cacheDir);
        const now = Date.now();

        for (const file of files) {
          const filePath = path.join(cacheDir, file);
          try {
            const stats = await fs.promises.stat(filePath);
            const age = now - stats.mtimeMs;
            if (age > CACHE_MAX_AGE) {
              console.log(`[Janitor] Deleting expired Gemini cache file: ${filePath}`);
              await fs.promises.unlink(filePath);
            }
          } catch (fileErr: any) {
            console.error(`[Janitor] Failed to inspect/delete cache file ${filePath}:`, fileErr.message);
          }
        }
      }
    } catch (err: any) {
      console.error("[Janitor] Failed to read Gemini cache directory:", err.message);
    }

    // 3. Sweep expired audit log entries (>30 days old)
    try {
      await AuditLogger.purgeExpiredLogs(30);
    } catch (auditErr: any) {
      console.error("[Janitor] Failed to purge expired audit logs:", auditErr.message);
    }

    // 4. Sweep expired user sessions and pairing codes (skip creating an unused DB file)
    try {
      const dbPath = accountsDbPath();
      if (dbPath === ":memory:" || fs.existsSync(dbPath)) {
        const now = Date.now();
        deleteExpiredSessions(now, authSettings().sessionIdleMs);
        deleteExpiredPairingCodes(now);
      }
    } catch (authErr: any) {
      console.error("[Janitor] Failed to purge expired auth sessions/codes:", authErr.message);
    }
  }, RUN_INTERVAL);
  janitorTimer.unref?.();
}

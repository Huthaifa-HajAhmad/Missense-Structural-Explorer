import path from "path";
import dotenv from "dotenv";

// Resolve deployment secrets from the project working directory, not dist/.
// This is required when the bundled production entrypoint runs as node dist/server.cjs.
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import fs from "fs";
import { runTempJobsJanitor, AuditLogger } from "./server/utils.ts";
import {
  initializeRaspDatabase,
  generateMutantPdb,
  findBindingPocket,
  enrichBiophysicalResult,
  runRaspLocal,
  getRaspCoverage,
  runStabilityOracleAnalysis
} from "./server/services/biophysics.ts";
import { BiophysicalJobQueue } from "./server/services/biophysical-queue.ts";
import { shutdownPool } from "./server/services/biophysics-pool.ts";
import { shutdownDbPool } from "./server/services/infra/analysis-db-pool.ts";
import { startSidecarSupervisor } from "./server/sidecar-supervisor.ts";
import { createExpressApp } from "./server/express-config.ts";
import { registerGracefulShutdown } from "./server/graceful-shutdown.ts";
import { activeBackgroundTasks } from "./server/routes.ts";
import { CONFIG } from "./server/config.ts";

/**
 * Initializes audit log directory and purges stale logs (>30 days old).
 */
async function initAuditLogs(): Promise<void> {
  try {
    const dir = path.join(process.cwd(), "logs");
    await fs.promises.mkdir(dir, { recursive: true });
    const logFile = path.join(dir, "audit.jsonl");
    if (!fs.existsSync(logFile)) {
      await fs.promises.writeFile(logFile, "", "utf8");
    }
    const purged = await AuditLogger.purgeExpiredLogs(CONFIG.limits.maxAuditLogAgeDays);
    if (purged > 0) {
      console.log(`[Startup] Purged ${purged} expired audit log entries (> ${CONFIG.limits.maxAuditLogAgeDays} days old).`);
    }
  } catch (err: any) {
    console.warn("[Startup] Failed to initialize audit logs:", err.message);
  }
}

/**
 * Ensures user-installed Python scripts directories are in PATH on Windows (e.g. uv.exe).
 */
function patchWindowsPythonPath(): void {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || "";
    const pythonDir = path.join(appData, "Python");
    if (fs.existsSync(pythonDir)) {
      try {
        const subdirs = fs.readdirSync(pythonDir);
        for (const subdir of subdirs) {
          const scriptsPath = path.join(pythonDir, subdir, "Scripts");
          if (fs.existsSync(scriptsPath) && !process.env.PATH?.includes(scriptsPath)) {
            process.env.PATH = `${scriptsPath};${process.env.PATH || ""}`;
          }
        }
      } catch (_) {}
    }
  }
}

/**
 * Initializes the scalable persistent BiophysicalJobQueue with worker handlers.
 */
function initBiophysicalJobQueue(): void {
  BiophysicalJobQueue.initialize(CONFIG.server.biophysicalConcurrency, async (type, data, signal, jobId) => {
    try {
      if (type === "foldx") {
        let foldxResult: any = null;
        try {
          /**
           * Phase reporting is what replaced the client's fabricated progress stepper.
           *
           * FoldX is the one engine measured in minutes (a 489-residue template: 205 s of repair,
           * 2 s of modelling), and the UI had no way to learn which half it was in — so it invented
           * a stage from elapsed time and claimed "Finalizing" for most of the wait. The worker
           * knows the truth; it writes it to the job record the client is already polling.
           */
          foldxResult = await generateMutantPdb(
            data.wtPdb,
            data.mutation,
            data.uniprotId,
            data.jobDir,
            signal,
            data.options,
            phase => BiophysicalJobQueue.getInstance().updateJobPhase(jobId!, phase)
          );
        } catch (err: any) {
          const isPdbResidueMissing = /not found in the PDB structure|Mutation mismatch|Invalid mutation code/i.test(err.message);
          const isBinaryMissing = !isPdbResidueMissing && /FoldX binary not found|parameter files missing|cannot be executed|ENOENT/i.test(err.message);
          console.warn(`[Queue Worker] FoldX execution failed (${err.message}). Binary missing: ${isBinaryMissing}. PDB coordinate mismatch: ${isPdbResidueMissing}. Proceeding with independent biophysical predictors.`);
          foldxResult = {
            pdb: null,
            ddG: null,
            status: isBinaryMissing ? "unavailable" : "failed",
            error: err.message,
            energetics: {
              foldxMean: null,
              foldxRepairFailed: !isBinaryMissing && !isPdbResidueMissing && /repair/i.test(err.message),
              foldxBinaryMissing: isBinaryMissing,
              foldxError: err.message
            }
          };
        }

        const queue = BiophysicalJobQueue.getInstance();
        const latestJob = jobId ? await queue.getJobData(jobId) : null;
        const remoteJobs = latestJob?.remoteJobs || data.remoteJobs || {
          dynamut2JobId: null,
          dynamut2Status: "unavailable",
          ddmutJobId: null,
          ddmutStatus: "unavailable",
          thermompnnJobId: null,
          thermompnnStatus: "unavailable",
          thermompnnError: null,
          thermompnnVal: null,
          stabilityoracleVal: null
        };
        const structureProvenance = latestJob?.structureProvenance || data.structureProvenance || {};

        const mutMatch = data.mutation ? data.mutation.trim().match(/^([a-zA-Z])([a-zA-Z])?(\d+)([a-zA-Z])$/) : null;
        const wt1 = mutMatch ? mutMatch[1].toUpperCase() : "";
        const resolvedChain = (mutMatch && mutMatch[2]) ? mutMatch[2].toUpperCase() : "A";
        const posNum = mutMatch ? parseInt(mutMatch[3], 10) : 0;
        const mut1 = mutMatch ? mutMatch[4].toUpperCase() : "";

        // Guarantee RaSP evaluation even if FoldX failed or was skipped
        if ((!foldxResult?.energetics || foldxResult.energetics.rasp === null || foldxResult.energetics.rasp === undefined) && data.uniprotId && posNum && wt1 && mut1) {
          try {
            const raspRes = await runRaspLocal("", "", resolvedChain, posNum, wt1, mut1, data.uniprotId);
            if (raspRes) {
              if (!foldxResult.energetics) foldxResult.energetics = {};
              foldxResult.energetics.rasp = raspRes.score;
              foldxResult.energetics.raspReason = raspRes.reason;
              foldxResult.energetics.raspSource = raspRes.source;
              foldxResult.energetics.raspCoverage = getRaspCoverage() ?? undefined;
            }
          } catch (raspErr: any) {
            console.warn("[Queue Worker] Independent RaSP evaluation error:", raspErr.message);
          }
        }

        // Guarantee StabilityOracle evaluation even if FoldX failed
        if ((remoteJobs.stabilityoracleVal === null || remoteJobs.stabilityoracleVal === undefined) && (data.wtPdb || data.uniprotId)) {
          try {
            const soRes = await runStabilityOracleAnalysis(
              data.uniprotId || "UNKNOWN",
              `${wt1}${posNum}${mut1}`,
              data.uniprotId || "",
              "",
              data.wtPdb
            );
            if (soRes) {
              remoteJobs.stabilityoracleVal = soRes.ddG;
            }
          } catch (soErr: any) {
            console.warn("[Queue Worker] Independent StabilityOracle evaluation error:", soErr.message);
          }
        }

        return enrichBiophysicalResult(foldxResult, remoteJobs, structureProvenance, posNum);
      } else if (type === "p2rank") {
        return await findBindingPocket(data.pdbText, data.mutIndex, data.jobDir, data.targetChain, signal);
      }
      throw new Error(`Unknown biophysical job type: ${type}`);
    } finally {
      try {
        if (data.jobDir && fs.existsSync(data.jobDir)) {
          await fs.promises.rm(data.jobDir, { recursive: true, force: true });
          console.log(`[Queue Worker] Cleaned up temporary job directory: ${data.jobDir}`);
        }
      } catch (cleanupErr: any) {
        console.error(`[Queue Worker Cleanup Error] Failed to delete ${data.jobDir}:`, cleanupErr.message);
      }
    }
  });
}

/**
 * Aborts any pending asynchronous background prewarm tasks.
 */
async function abortActiveBackgroundTasks(): Promise<void> {
  if (activeBackgroundTasks && activeBackgroundTasks.length > 0) {
    console.log(`[Shutdown] Aborting ${activeBackgroundTasks.length} background pre-warm tasks...`);
    for (const task of activeBackgroundTasks) {
      task.controller.abort();
    }
    await Promise.allSettled(activeBackgroundTasks.map(t => t.promise));
    console.log("[Shutdown] All background pre-warm tasks completed/aborted.");
  }
}

/**
 * Cleans up root temp_jobs directory on shutdown.
 */
async function cleanupTempJobsRoot(): Promise<void> {
  try {
    const tempJobsRoot = path.join(process.cwd(), "temp_jobs");
    if (fs.existsSync(tempJobsRoot)) {
      console.log(`[Shutdown] Cleaning up temporary jobs directory: ${tempJobsRoot}`);
      await fs.promises.rm(tempJobsRoot, { recursive: true, force: true });
    }
  } catch (err: any) {
    console.error(`[Shutdown Error] Failed to clean up temp jobs directory:`, err.message);
  }
}

/**
 * Bootstraps the application, external sidecars, queues, and HTTP server.
 */
async function startServer(): Promise<void> {
  await initAuditLogs();
  patchWindowsPythonPath();

  // Start background janitor & load RaSP SQLite database
  runTempJobsJanitor();
  initializeRaspDatabase();

  // Initialize job worker queue & ML model sidecar
  initBiophysicalJobQueue();
  const sidecar = startSidecarSupervisor();

  // Build configured Express application
  const app = await createExpressApp();
  const PORT = CONFIG.server.port;

  const serverInstance = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  serverInstance.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n[FATAL PORT COLLISION] Port ${PORT} is already in use by another process!`);
      console.error(`Please terminate the conflicting process on port ${PORT} or configure a different port via PORT=...\n`);
      process.exit(1);
    }
  });

  // Register graceful shutdown coordinator
  registerGracefulShutdown(serverInstance, [
    { name: "Sidecar Process", fn: () => sidecar.stop() },
    { name: "Route Background Tasks", fn: abortActiveBackgroundTasks },
    { name: "Biophysical Job Queue", fn: () => BiophysicalJobQueue.getInstance().shutdown() },
    { name: "Biophysics Worker Pool", fn: shutdownPool },
    { name: "Analysis DB Worker Pool", fn: shutdownDbPool },
    { name: "Temp Jobs Cleanup", fn: cleanupTempJobsRoot }
  ]);
}

startServer();

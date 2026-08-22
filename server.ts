import path from "path";
import dotenv from "dotenv";

// Resolve deployment secrets from the project working directory, not dist/.
// This is required when the bundled production entrypoint runs as node dist/server.cjs.
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import crypto from "crypto";
import express from "express";
import fs from "fs";
import { spawn, execSync, exec, ChildProcess } from "child_process";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import { createServer as createViteServer } from "vite";

import { requestLogger, authCheck, validateContentType } from "./server/middleware.ts";
import { apiRouter } from "./server/routes.ts";
import { runTempJobsJanitor, AuditLogger, sendError } from "./server/utils.ts";
import { initializeRaspDatabase, generateMutantPdb, findBindingPocket, enrichBiophysicalResult } from "./server/services/biophysics.ts";
import { BiophysicalJobQueue } from "./server/services/biophysical-queue.ts";
import { shutdownPool } from "./server/services/biophysics-pool.ts";

(async () => {
  try {
    const dir = path.join(process.cwd(), "logs");
    await fs.promises.mkdir(dir, { recursive: true });
    const logFile = path.join(dir, "audit.jsonl");
    if (!fs.existsSync(logFile)) {
      await fs.promises.writeFile(logFile, "", "utf8");
    }
    const purged = await AuditLogger.purgeExpiredLogs(30);
    if (purged > 0) {
      console.log(`[Startup] Purged ${purged} expired audit log entries (> 30 days old).`);
    }
  } catch (err: any) {
    console.warn("[Startup] Failed to initialize audit logs:", err.message);
  }
})();

let modelServerProcess: ChildProcess | null = null;

async function startServer() {
  // Ensure python user scripts directory is in PATH on Windows (helps find user-installed uv.exe)
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

  // Start the background temp_jobs janitor (M-8)
  runTempJobsJanitor();

  // Initialize the RaSP database (background download/load if missing) (E-4)
  initializeRaspDatabase();

  const biophysicalConcurrency = process.env.BIOPHYSICAL_CONCURRENCY 
    ? parseInt(process.env.BIOPHYSICAL_CONCURRENCY, 10) 
    : 4;

  // Initialize persistent/scalable biophysical job queue
  BiophysicalJobQueue.initialize(biophysicalConcurrency, async (type, data, signal, jobId) => {
    try {
      if (type === "foldx") {
        const foldxResult = await generateMutantPdb(data.wtPdb, data.mutation, data.uniprotId, data.jobDir, signal, data.options);
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

        const mutMatch = data.mutation.trim().match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$/);
        const posNum = mutMatch ? parseInt(mutMatch[3], 10) : 0;

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

  // Generate or load SIDECAR_SECRET token for sidecar authentication (P2-7)
  // Kept in-memory only (S1) to prevent filesystem-level credentials access
  if (!process.env.SIDECAR_SECRET) {
    console.warn(`[WARNING] SIDECAR_SECRET is not configured in the environment. Generating a random UUID in-memory. If the model sidecar is deployed separately, this will trigger authentication failures.`);
    process.env.SIDECAR_SECRET = crypto.randomUUID();
  }

  // Spawn the local ML model server sidecar with auto-restart (A-6, P2-7)
  let restartAttempts = 0;
  let stableTimer: NodeJS.Timeout | null = null;
  let restartTimer: NodeJS.Timeout | null = null;
  let isSpawning = false;

  function spawnModelServer() {
    if (isSpawning || restartTimer) {
      console.log("[Startup] Sidecar spawn already in progress or scheduled, ignoring request.");
      return;
    }
    isSpawning = true;
    console.log("[Startup] Launching local ML model server sidecar...");
    const modelServerScript = path.join(process.cwd(), "tools", "model_server.py");
    const cleanSystemKeys = [
      "path", "systemroot", "systemdrive", "appdata", "localappdata", 
      "temp", "tmp", "userprofile", "home", "pwd", "comspec",
      "os", "windir"
    ];
    const sidecarEnv: Record<string, string> = {
      SIDECAR_SECRET: process.env.SIDECAR_SECRET || ""
    };
    for (const key of Object.keys(process.env)) {
      if (cleanSystemKeys.includes(key.toLowerCase()) || key.startsWith("SIDECAR_") || key === "MAX_LOADED_MODELS") {
        sidecarEnv[key] = process.env[key] || "";
      }
    }

    // Auto-discover local virtualenv python
    const venvPythonPath = process.platform === "win32"
      ? path.join(process.cwd(), "tools", ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), "tools", ".venv", "bin", "python");

    let useStandaloneUv = false;
    try {
      const checkCmd = process.platform === "win32" ? "where uv" : "which uv";
      execSync(checkCmd, { stdio: "ignore" });
      useStandaloneUv = true;
    } catch (e) {
      // Standalone uv not on PATH
    }

    if (fs.existsSync(venvPythonPath)) {
      console.log(`[Startup] Found local virtualenv python at ${venvPythonPath}. Launching model server sidecar directly...`);
      modelServerProcess = spawn(venvPythonPath, [modelServerScript], {
        stdio: "inherit",
        env: sidecarEnv
      });
    } else if (useStandaloneUv) {
      console.log("[Startup] Found global uv executable. Launching model server sidecar via standalone uv...");
      modelServerProcess = spawn("uv", ["run", "--project", "tools", modelServerScript], {
        stdio: "inherit",
        env: sidecarEnv
      });
    } else {
      console.log("[Startup] Standalone uv not found in PATH. Launching model server sidecar via python -m uv...");
      modelServerProcess = spawn("python", ["-m", "uv", "run", "--project", "tools", modelServerScript], {
        stdio: "inherit",
        env: sidecarEnv
      });
    }

    // Reset restart counter after 30 seconds of stable running (A2)
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = setTimeout(() => {
      if (modelServerProcess) {
        console.log("[Model Server] Sidecar process stable. Resetting restart attempts counter.");
        restartAttempts = 0;
      }
    }, 30000);
    
    modelServerProcess.on("error", (err) => {
      console.error("[Model Server] Failed to start sidecar:", err.message);
      AuditLogger.log("SIDECAR_ERROR", { message: err.message });
      isSpawning = false;
    });

    modelServerProcess.on("exit", (code, signal) => {
      console.warn(`[Model Server] Sidecar exited with code ${code} and signal ${signal}.`);
      modelServerProcess = null;
      isSpawning = false;
      if (stableTimer) {
        clearTimeout(stableTimer);
        stableTimer = null;
      }

      // Exponential backoff recovery (A2)
      if (restartAttempts < 10) {
        restartAttempts++;
        const backoffDelay = Math.min(2000 * Math.pow(2, restartAttempts - 1), 60000);
        console.log(`[Model Server] Restarting sidecar process (attempt ${restartAttempts}/10) in ${backoffDelay / 1000} seconds...`);
        AuditLogger.log("SIDECAR_RESTART", { attempt: restartAttempts, code, signal });
        
        if (restartTimer) clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          restartTimer = null;
          spawnModelServer();
        }, backoffDelay);
      } else {
        console.error("[Model Server] Max restart attempts reached. Sidecar will remain offline until health check recovery.");
        AuditLogger.log("SIDECAR_FATAL_OFFLINE", { restartAttempts, code, signal });
      }
    });
  }

  spawnModelServer();

  // Background health-check recovery loop with adaptive timeout and 2-strike retry (A2, B4)
  let healthCheckConsecutiveFailures = 0;
  setInterval(async () => {
    let sidecarHealthy = false;
    try {
      const sidecarRes = await fetch("http://127.0.0.1:8000/health", { signal: AbortSignal.timeout(5000) });
      if (sidecarRes.ok) {
        const data = await sidecarRes.json() as any;
        sidecarHealthy = data.status === "healthy";
      }
    } catch (_) {
      sidecarHealthy = false;
    }

    if (sidecarHealthy) {
      healthCheckConsecutiveFailures = 0;
      restartAttempts = 0;
    } else {
      healthCheckConsecutiveFailures++;
      console.warn(`[Model Server] Background health check failed (strike ${healthCheckConsecutiveFailures}/2).`);

      if (healthCheckConsecutiveFailures >= 2) {
        healthCheckConsecutiveFailures = 0;
        console.warn("[Model Server] 2 consecutive health checks failed. Initiating sidecar recovery...");
        if (modelServerProcess) {
          console.warn("[Model Server] Terminating unresponsive sidecar process tree...");
          try {
            if (process.platform === "win32" && modelServerProcess.pid) {
              execSync(`taskkill /F /T /PID ${modelServerProcess.pid}`, { stdio: "ignore" });
            } else {
              modelServerProcess.kill("SIGKILL");
            }
          } catch (_) {}
        } else if (!restartTimer) {
          console.warn("[Model Server] Sidecar not running and no restart scheduled. Spawning new process...");
          restartAttempts = 0;
          spawnModelServer();
        }
      }
    }
  }, 60000);

  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Set trust proxy to true (or 1) for reverse proxies.
  // Architectural Assumption: The application is deployed behind a single reverse proxy (e.g., GCP LB or Caddy).
  // This instructs Express to trust the first hop upstream and correctly parse X-Forwarded-For headers for rate limiting.
  app.set('trust proxy', 1);

  // Fail-closed API token validation on startup
  const apiToken = process.env.APP_API_TOKEN;
  if (!apiToken) {
    console.error("FATAL: APP_API_TOKEN is not set. Refusing to start.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && (apiToken === "a_secure_arbitrary_api_token" || apiToken.length < 16)) {
    console.error("FATAL: APP_API_TOKEN is insecure (using the default example or too short) for production. Refusing to start.");
    process.exit(1);
  }

  // Fail-closed session secret validation on startup (D-2) (H-1)
  const sessionSecret = process.env.APP_SESSION_SECRET;
  if (!sessionSecret || (process.env.NODE_ENV === "production" && 
    (sessionSecret === "dev-session-secret-must-be-changed-in-prod" || 
     sessionSecret === "dev_session_secret_must_be_changed_in_prod_32_bytes_long"))) {
    console.error("FATAL: APP_SESSION_SECRET is not set or is using a development fallback in production. Refusing to start.");
    process.exit(1);
  }

  // [MOD-12] Global custom request logging middleware
  app.use(compression());
  app.use(requestLogger);
  app.use(validateContentType);

  // Security Middleware (SEC-3, SEC-8, A-7)
  app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString("base64");
    next();
  });

  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    console.warn("[WARNING] Content-Security-Policy enables 'unsafe-inline' and 'unsafe-eval' in development. Do NOT deploy this configuration to production.");
  }

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isProd 
          ? [
              "'self'",
              "'wasm-unsafe-eval'",
              (req, res) => `'nonce-${(res as any).locals.nonce}'`
            ]
          : [
              "'self'",
              "'unsafe-inline'",
              "'unsafe-eval'"
            ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: isProd
          ? [
              "'self'",
              "https://*.ebi.ac.uk",
              "https://alphafold.ebi.ac.uk",
              "https://*.uniprot.org",
              "https://myvariant.info",
              "https://*.rcsb.org"
            ]
          : [
              "'self'",
              "https://*.ebi.ac.uk",
              "https://alphafold.ebi.ac.uk",
              "https://*.uniprot.org",
              "https://myvariant.info",
              "https://*.rcsb.org",
              "ws://localhost:*",
              "ws://127.0.0.1:*",
              "ws:",
              "wss:"
            ]
      }
    }
  }));

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:3000"];
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true
  }));

  // Mount versioned API router
  app.use("/api/v1", apiRouter);

  // Global Express JSON error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[Global Error Handler]:", err);
    const status = err.status || err.statusCode || 500;
    const code = err.code || "INTERNAL_SERVER_ERROR";
    const message = err.message || "An internal server error occurred.";
    sendError(res, status, code, message);
  });

  // Vite middleware for development / Static assets serving for production
  // Note (A-5): SPA fallback app.get('*') is mounted after API routes and error handler so API calls are never shadowed.
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', async (req, res) => {
      try {
        const htmlPath = path.join(distPath, 'index.html');
        let html = await fs.promises.readFile(htmlPath, 'utf8');
        const nonce = res.locals.nonce;
        if (nonce) {
          html = html.replace(/<script/g, `<script nonce="${nonce}"`);
        }
        res.type('html').send(html);
      } catch (err: any) {
        console.error("[SPA Fallback Warning] Failed to inject CSP nonce into index.html:", err.message);
        res.sendFile(path.join(distPath, 'index.html'));
      }
    });
  }

  const serverInstance = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[Shutdown] Received ${signal}. Starting graceful shutdown...`);
    
    if (modelServerProcess && modelServerProcess.pid) {
      console.log("[Shutdown] Terminating model server sidecar process tree...");
      if (process.platform === "win32") {
        try {
          execSync(`taskkill /F /T /PID ${modelServerProcess.pid}`, { stdio: "ignore" });
        } catch (_) {}
      } else {
        try {
          modelServerProcess.kill("SIGTERM");
        } catch (_) {}
      }
    }

    // Abort all active background tasks in routes.ts (graceful shutdown)
    try {
      const { activeBackgroundTasks } = await import("./server/routes.ts");
      if (activeBackgroundTasks && activeBackgroundTasks.length > 0) {
        console.log(`[Shutdown] Aborting ${activeBackgroundTasks.length} background pre-warm tasks...`);
        for (const task of activeBackgroundTasks) {
          task.controller.abort();
        }
        await Promise.allSettled(activeBackgroundTasks.map(t => t.promise));
        console.log("[Shutdown] All background pre-warm tasks completed/aborted.");
      }
    } catch (taskErr: any) {
      console.error("[Shutdown Warning] Failed to abort background tasks:", taskErr.message);
    }

    // Shutdown and abort active jobs in the queue
    try {
      const queue = BiophysicalJobQueue.getInstance();
      await queue.shutdown();
      console.log("[Shutdown] BiophysicalJobQueue shut down successfully.");
    } catch (_) {}

    // Shutdown biophysics worker pool
    try {
      await shutdownPool();
      console.log("[Shutdown] Biophysics worker pool shut down successfully.");
    } catch (_) {}

    serverInstance.close(async () => {
      console.log("[Shutdown] HTTP server closed.");
      try {
        const tempJobsRoot = path.join(process.cwd(), "temp_jobs");
        if (fs.existsSync(tempJobsRoot)) {
          console.log(`[Shutdown] Cleaning up temporary jobs directory: ${tempJobsRoot}`);
          await fs.promises.rm(tempJobsRoot, { recursive: true, force: true });
        }
      } catch (err: any) {
        console.error(`[Shutdown Error] Failed to clean up temp jobs directory:`, err.message);
      }
      process.exit(0);
    });

    // Force exit after 10 seconds if shutdown hangs
    setTimeout(() => {
      console.error("[Shutdown] Force exiting after timeout.");
      process.exit(1);
    }, 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();

import express from "express";
import path from "path";
import fs from "fs";
import { spawn, ChildProcess } from "child_process";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";

import { requestLogger, authCheck, validateContentType } from "./server/middleware.ts";
import { apiRouter } from "./server/routes.ts";
import { runTempJobsJanitor } from "./server/utils.ts";
import { initializeRaspDatabase } from "./server/services/biophysics.ts";

dotenv.config();

let modelServerProcess: ChildProcess | null = null;

async function startServer() {
  // Start the background temp_jobs janitor (M-8)
  runTempJobsJanitor();

  // Initialize the RaSP database (background download/load if missing) (E-4)
  initializeRaspDatabase();

  // Spawn the local ML model server sidecar with auto-restart (A-6)
  let restartAttempts = 0;
  function spawnModelServer() {
    console.log("[Startup] Launching local ML model server sidecar...");
    const modelServerScript = path.join(process.cwd(), "tools", "model_server.py");
    modelServerProcess = spawn("python", ["-m", "uv", "run", modelServerScript], {
      stdio: "inherit"
    });
    
    modelServerProcess.on("error", (err) => {
      console.error("[Model Server] Failed to start sidecar:", err.message);
    });

    modelServerProcess.on("exit", (code, signal) => {
      console.warn(`[Model Server] Sidecar exited with code ${code} and signal ${signal}.`);
      modelServerProcess = null;
      if (restartAttempts < 10) {
        restartAttempts++;
        console.log(`[Model Server] Restarting sidecar process (attempt ${restartAttempts}/10) in 2 seconds...`);
        setTimeout(() => {
          spawnModelServer();
        }, 2000);
      } else {
        console.error("[Model Server] Max restart attempts reached. Sidecar will remain offline.");
      }
    });
  }

  spawnModelServer();

  const app = express();
  const PORT = 3000;

  // Set trust proxy to true (or 1) for reverse proxies
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
  if (!sessionSecret || (process.env.NODE_ENV === "production" && sessionSecret === "dev-session-secret-must-be-changed-in-prod")) {
    console.error("FATAL: APP_SESSION_SECRET is not set or is using the development fallback in production. Refusing to start.");
    process.exit(1);
  }

  // [MOD-12] Global custom request logging middleware
  app.use(requestLogger);
  app.use(validateContentType);

  // Security Middleware (SEC-3, SEC-8)
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === "production" ? undefined : false,
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
    res.status(status).json({
      error: {
        message: err.message || "An internal server error occurred.",
        code: err.code || "INTERNAL_SERVER_ERROR"
      }
    });
  });

  // Vite middleware for development / Static assets serving for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const serverInstance = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[Shutdown] Received ${signal}. Starting graceful shutdown...`);
    
    if (modelServerProcess) {
      console.log("[Shutdown] Terminating model server sidecar...");
      modelServerProcess.kill();
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

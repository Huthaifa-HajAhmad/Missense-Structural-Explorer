import express from "express";
import path from "path";
import fs from "fs";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";

import { requestLogger, authCheck } from "./server/middleware.ts";
import { apiRouter } from "./server/routes.ts";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Fail-closed API token validation on startup
  const apiToken = process.env.APP_API_TOKEN;
  if (!apiToken) {
    if (process.env.NODE_ENV === "production") {
      console.error("FATAL: APP_API_TOKEN is not set in production. Refusing to start.");
      process.exit(1);
    } else {
      console.warn("WARNING: APP_API_TOKEN is not set. All endpoints bypass authentication in development.");
    }
  }

  // [MOD-12] Global custom request logging middleware
  app.use(requestLogger);

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

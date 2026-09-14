import path from "path";
import fs from "fs";
import crypto from "crypto";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import { createServer as createViteServer } from "vite";

import { requestLogger, validateContentType } from "./middleware.ts";
import { apiRouter } from "./routes.ts";
import { sendError } from "./utils.ts";
import { CONFIG, validateStartupEnvironment } from "./config.ts";

export { validateStartupEnvironment };

/**
 * Creates and configures the Express application with security middleware,
 * API routes, and Vite dev / production SPA static serving.
 */
export async function createExpressApp(): Promise<express.Express> {
  validateStartupEnvironment();

  const app = express();

  // Set trust proxy for reverse proxies (GCP LB or Caddy)
  app.set("trust proxy", 1);

  // Global custom middleware
  app.use(compression());
  app.use(requestLogger);
  app.use(validateContentType);

  // Crypto nonce generation for CSP
  app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString("base64");
    next();
  });

  const isProd = CONFIG.server.isProduction;
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
        // Note on styleSrc: 'unsafe-inline' is required for Mol* 3D WebGL viewer canvas CSS and dynamic chart tooltips
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: isProd
          ? [
              "'self'",
              "https://*.ebi.ac.uk",
              "https://alphafold.ebi.ac.uk",
              "https://*.uniprot.org",
              "https://myvariant.info",
              "https://*.rcsb.org",
              "https://*.trycloudflare.com",
              "wss://*.trycloudflare.com",
              "https://*.duckdns.org",
              "wss://*.duckdns.org"
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

  const allowedOrigins = (process.env.ALLOWED_ORIGINS?.split(",") || [`http://localhost:${CONFIG.server.port}`]).map(o => o.trim());
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      try {
        const url = new URL(origin);
        if (url.hostname.endsWith(".trycloudflare.com") || url.hostname.endsWith(".duckdns.org")) {
          return callback(null, true);
        }
      } catch (_) {}
      callback(new Error(`Origin '${origin}' not allowed by CORS`));
    },
    credentials: true
  }));

  // Mount versioned API router
  app.use("/api/v1", apiRouter);

  // Vite middleware for development / Static assets serving for production
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use("/assets", express.static(path.join(distPath, "assets"), {
      immutable: true,
      maxAge: "1y"
    }));
    app.use(express.static(distPath));

    // Never return index.html for missing /assets/* or /api/* endpoints
    app.all("/assets/*", (_req, res) => {
      res.status(404).type("text/plain").send("Asset not found");
    });
    app.all("/api/*", (_req, res) => {
      res.status(404).json({ error: "API endpoint not found" });
    });

    app.get("*", async (req, res) => {
      try {
        const htmlPath = path.join(distPath, "index.html");
        let html = await fs.promises.readFile(htmlPath, "utf8");
        const nonce = res.locals.nonce;
        if (nonce) {
          html = html.replace(/<script/g, `<script nonce="${nonce}"`);
        }
        res.type("html").send(html);
      } catch (err: any) {
        console.error("[SPA Fallback Warning] Failed to inject CSP nonce into index.html:", err.message);
        res.sendFile(path.join(distPath, "index.html"));
      }
    });
  }

  // Global Express JSON error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[Global Error Handler]:", err);
    const status = err.status || err.statusCode || 500;
    const code = err.code || "INTERNAL_SERVER_ERROR";
    const message = err.message || "An internal server error occurred.";
    sendError(res, status, code, message);
  });

  return app;
}

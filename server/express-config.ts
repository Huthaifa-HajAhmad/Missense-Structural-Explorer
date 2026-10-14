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
import { createSpaShellHandler, setStaticShellHeaders } from "./spa-shell-cache.ts";
import { CONFIG, validateStartupEnvironment } from "./config.ts";
import { installDeploymentControl } from "./deployment-control.ts";
import { STALE_DATA_HEADER } from "../src/shared/providerLimits.ts";

export { validateStartupEnvironment };

/**
 * Creates and configures the Express application with security middleware,
 * API routes, and Vite dev / production SPA static serving.
 */
/**
 * Which cross-origin callers may use the API, and which of them may do so signed in.
 *
 * Credentialed access (cookies, so a signed-in session) goes only to EXACT origins: `ALLOWED_ORIGINS`
 * and the public origin (`PUBLIC_BASE_URL`). Any other `*.duckdns.org` / `*.trycloudflare.com` origin
 * still gets plain CORS, as before, but never with credentials: those are subdomains anyone can
 * register, and with credentials a page there could read `/my-jobs`, `/auth/me` or `/admin/users` in a
 * signed-in browser. `ALLOWED_ORIGINS=*` allows any origin, also without credentials.
 */
export function corsDecision(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): { allowed: boolean; credentials: boolean } {
  if (!origin) return { allowed: true, credentials: true }; // same-origin and non-browser callers
  const listed = (env.ALLOWED_ORIGINS?.split(",") || [`http://localhost:${CONFIG.server.port}`]).map(o => o.trim());
  const exact = new Set(listed.filter(o => o !== "*"));
  try {
    exact.add(new URL(env.PUBLIC_BASE_URL || "https://missense-resolve.duckdns.org").origin);
  } catch (_) {}
  if (exact.has(origin)) return { allowed: true, credentials: true };
  if (listed.includes("*")) return { allowed: true, credentials: false };
  try {
    const host = new URL(origin).hostname;
    if (host.endsWith(".trycloudflare.com") || host.endsWith(".duckdns.org")) return { allowed: true, credentials: false };
  } catch (_) {}
  return { allowed: false, credentials: false };
}

export async function createExpressApp(): Promise<express.Express> {
  validateStartupEnvironment();

  const app = express();
  installDeploymentControl(app);

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

  app.use(cors((req, callback) => {
    const decision = corsDecision(req.headers.origin);
    // A disallowed origin is not a server error. Answer WITHOUT CORS headers (the browser then blocks
    // the response) instead of throwing: throwing produced a 500 whose body echoed the caller's own
    // Origin back at them and reported "server error" for a client-side refusal — `Origin: null` from
    // a sandboxed iframe or a `file://` page met exactly that. A cookie write from a foreign origin is
    // refused in its own right, with 403 CROSS_SITE_REQUEST (see `crossSiteWrite`).
    if (!decision.allowed) return callback(null, { origin: false });
    // `X-MSE-Stale` says a response used saved data past its expiry (WP-I2); a browser only lets an
    // allowed cross-origin page read it when it is exposed.
    callback(null, { origin: true, credentials: decision.credentials, exposedHeaders: [STALE_DATA_HEADER] });
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
    const spaShell = createSpaShellHandler(distPath);
    // `/` and `/index.html` first, and `index: false` below: the static middleware would otherwise
    // answer them from disk with no CSP nonce on the scripts.
    app.get(["/", "/index.html"], spaShell);
    app.use(express.static(distPath, { index: false, setHeaders: setStaticShellHeaders }));

    // Never return index.html for missing /assets/* or /api/* endpoints
    app.all("/assets/*", (_req, res) => {
      res.status(404).type("text/plain").send("Asset not found");
    });
    app.all("/api/*", (_req, res) => {
      res.status(404).json({ error: "API endpoint not found" });
    });

    app.get("*", spaShell);
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

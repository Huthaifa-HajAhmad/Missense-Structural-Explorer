/**
 * routes.ts — Thin orchestrator barrel.
 *
 * Responsibility:
 *   1. Re-exports shared types & state from ./routes/state.ts
 *   2. Creates and configures the Express router (apiRouter)
 *   3. Delegates all route registration to ./routes/index.ts
 *
 * Route implementations live in server/routes/<domain>.ts
 */
import express from "express";

import { authCheck, apiLimiter } from "./middleware.ts";
import { registerAllRoutes } from "./routes/index.ts";

// Re-export shared types and state so that server.ts sees them at the same import path
export type { FoldXResult, BackgroundTask } from "./routes/state.ts";
export { activeBackgroundTasks, inFlightPrewarms } from "./routes/state.ts";

// ---------------------------------------------------------------------------
// SEC-1: Fail-loud production session-secret validation
// ---------------------------------------------------------------------------
(function enforceSessionSecret() {
  if (process.env.NODE_ENV !== "production") return;
  const secret = process.env.APP_SESSION_SECRET;
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
    ""
  ];
  if (!secret || defaultValues.some(d => secret.toLowerCase().includes(d)) || secret.length < 32) {
    console.error(
      "[SECURITY] FATAL: APP_SESSION_SECRET is not set or retains a default/weak value in production. " +
      "Generate a 32+ byte secret (e.g.: node -e \"require('crypto').randomBytes(32).toString('hex')\" ) " +
      "and set it as APP_SESSION_SECRET in your .env. Refusing to start."
    );
    process.exit(1);
  }
})();

// ---------------------------------------------------------------------------
// Router setup
// ---------------------------------------------------------------------------
export const apiRouter = express.Router();

const jsonParserRegular = express.json({ limit: "5mb" });
const jsonParserPdb = express.json({ limit: "10mb" });

// Apply authCheck and apiLimiter globally to the API Router
apiRouter.use(authCheck);
apiRouter.use(apiLimiter);

// Delegate all route registrations to domain modules
registerAllRoutes(apiRouter, jsonParserRegular, jsonParserPdb);

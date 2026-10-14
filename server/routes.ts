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
import { sendError } from "./utils.ts";
import { attributeEgressOwner } from "./auth/egress-owner.ts";
import { markStaleResponses } from "./services/infra/stale-response.ts";
import { reportCredentialUse } from "./services/infra/credential-response.ts";

// Re-export shared types and state so that server.ts sees them at the same import path
export type { FoldXResult, BackgroundTask } from "./routes/state.ts";
export { activeBackgroundTasks, inFlightPrewarms } from "./routes/state.ts";

// ---------------------------------------------------------------------------
// Router setup
// ---------------------------------------------------------------------------
export const apiRouter = express.Router();

const jsonParserRegular = express.json({ limit: "5mb" });
const jsonParserPdb = express.json({ limit: "10mb" });

// Apply authCheck and apiLimiter globally to the API Router
apiRouter.use(authCheck);
// Every outbound call a request makes is attributed to its signed-in person (else the queue's `legacy`
// owner), so the egress governor can share providers fairly between people (WP-I1).
apiRouter.use(attributeEgressOwner);
// A response that used saved data past its expiry, because a provider was limiting requests, says so in
// `X-MSE-Stale` (WP-I2).
apiRouter.use(markStaleResponses);
// Whose token each response's remote model calls used (your own or the team's) is in `X-MSE-Credentials` (WP-I4).
apiRouter.use(reportCredentialUse);
apiRouter.use(apiLimiter);

// Delegate all route registrations to domain modules
registerAllRoutes(apiRouter, jsonParserRegular, jsonParserPdb);

// Catch-all 404 handler for unhandled API endpoints
apiRouter.use((req, res) => {
  sendError(res, 404, "NOT_FOUND", `Endpoint ${req.method} ${req.originalUrl} not found`);
});

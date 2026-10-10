/**
 * auth/middleware.ts — the account rules `authCheck` applies, and guards for account routes.
 *
 * WHY WRITES, NOT A LIST OF "HEAVY" ROUTES
 * ----------------------------------------
 * `PUBLIC_ENDPOINTS` (routes/state.ts) already lists nearly every compute route (`/generate-mutant`,
 * `/foldx-job`, `/esmfold`, `/pocket-finder` …), so the shared token protects almost none of the
 * compute today. A hand-kept list of heavy routes would drift the same way the next time a route is
 * added. The rule here cannot drift: once accounts are switched on, every WRITE needs a principal,
 * and only the sign-in endpoints themselves are exempt. Reads keep today's behaviour.
 *
 *   legacy   — nothing changes.
 *   hybrid   — writes need a signed-in user or the legacy token.
 *   accounts — writes need a signed-in user; the legacy token may only read.
 */
import type express from "express";
import { sendError } from "../utils.ts";
import { authSettings } from "./config.ts";
import { isAgentPath, resolvePrincipal, type Principal } from "./principal.ts";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Writes that must work while signed out, or nobody could ever sign in. Paths without `/api/v1`. */
export const SIGN_IN_WRITES = new Set(["/auth/login", "/auth/logout", "/auth/accept-invite", "/auth/invite-info", "/auth/reset", "/setup"]);

export const SIGN_IN_REQUIRED_MESSAGE =
  "Sign in to run this. If you do not have an account, ask your workspace admin for an invite link.";

/** Resolve without ever failing the request: an unreadable account database means "anonymous". */
export function attachPrincipal(req: express.Request): Principal {
  let principal: Principal;
  try {
    principal = resolvePrincipal(req);
  } catch (err) {
    console.error("[auth] Could not resolve the principal; treating the request as anonymous:", (err as Error).message);
    principal = { kind: "anonymous", userId: null };
  }
  req.principal = principal;
  return principal;
}

function allowedOrigins(req: express.Request): Set<string> {
  const set = new Set<string>();
  for (const o of process.env.ALLOWED_ORIGINS?.split(",") ?? []) if (o.trim() && o.trim() !== "*") set.add(o.trim());
  try {
    set.add(new URL(authSettings().publicBaseUrl).origin);
  } catch (_) {}
  const host = req.get("host");
  if (host) set.add(`${req.protocol}://${host}`);
  return set;
}

/**
 * CSRF for cookie-authenticated writes: the body must be JSON (`validateContentType`) AND, when the
 * browser sends an Origin, it must be this site's. CORS here accepts any `*.duckdns.org` origin
 * with credentials, so this exact-match check — not CORS — is what stops another DuckDNS site from
 * acting as a signed-in user.
 */
export function crossSiteWrite(req: express.Request): boolean {
  if (!UNSAFE_METHODS.has(req.method)) return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  return !allowedOrigins(req).has(origin);
}

export type AccessVerdict =
  | { allow: true }
  | { allow: false; status: 401 | 403; code: string; message: string }
  | { allow: "continue" };

/**
 * The account part of `authCheck`, run before its existing public/Gemini/token checks.
 * `allow: "continue"` hands the request to those checks unchanged.
 */
export function accountAccess(req: express.Request, principal: Principal): AccessVerdict {
  const path = req.path;

  // Paired machines: only an agent token opens `/agent/*`, and an agent token opens nothing else.
  if (isAgentPath(path)) {
    return principal.kind === "agent"
      ? { allow: true }
      : { allow: false, status: 401, code: "AGENT_TOKEN_REQUIRED", message: "This endpoint accepts only a paired computer's token." };
  }

  if (principal.kind === "user") {
    if (crossSiteWrite(req)) {
      return { allow: false, status: 403, code: "CROSS_SITE_REQUEST", message: "This request did not come from this site." };
    }
    return { allow: true };
  }

  const { mode } = authSettings();
  // Case-folded like Express's own routing, so `/Auth/Login` is exempt exactly when `/auth/login` is.
  const signInWrite = SIGN_IN_WRITES.has(path.toLowerCase().replace(/\/+$/, ""));
  if (mode === "legacy" || !UNSAFE_METHODS.has(req.method) || signInWrite) return { allow: "continue" };

  if (mode === "hybrid" && principal.kind === "service") return { allow: true };
  return { allow: false, status: 401, code: "SIGN_IN_REQUIRED", message: SIGN_IN_REQUIRED_MESSAGE };
}

// ── Route guards ────────────────────────────────────────────────────────────────────────────────────

export function requireUser(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (req.principal?.kind === "user") return next();
  sendError(res, 401, "SIGN_IN_REQUIRED", "Sign in first.");
}

export function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const p = req.principal;
  if (p?.kind !== "user") return sendError(res, 401, "SIGN_IN_REQUIRED", "Sign in first.");
  if (p.user.role !== "admin") return sendError(res, 403, "ADMIN_ONLY", "Only a workspace admin can do this.");
  next();
}

/** Account responses carry personal data and one-time links: never cache them anywhere. */
export function noStore(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  next();
}

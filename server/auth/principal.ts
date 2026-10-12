/**
 * auth/principal.ts — who is making this request.
 *
 * `resolvePrincipal` is provider-shaped: it asks the configured sign-in provider for a user and the
 * rest of the system (queue, quotas, agents, UI) only ever sees the Principal, never which provider
 * answered. Today the only provider is the app's own password login; a Cloudflare Access provider
 * (WP-A2) would slot in beside it. See `doc/COMPUTE_ROUTING_PLAN.md` section 4.2.
 *
 *   user      — a signed-in person (session cookie).
 *   service   — the legacy shared `APP_API_TOKEN` bearer.
 *   agent     — a paired machine's token, only on `/agent/*` (WP-F).
 *   anonymous — nothing valid was presented.
 *
 * The Gemini session header (`X-Gemini-Session-ID`) carries a Gemini key, not an identity, and is
 * deliberately not a principal.
 */
import type express from "express";
import { safeCompare } from "../utils.ts";
import { getAgentByTokenHash, getUserById, hashToken, type User } from "./store.ts";
import { resolveSession } from "./sessions.ts";
import { authSettings } from "./config.ts";
import type { SubmitterLimits } from "../services/infra/queue-owners.ts";

export type Principal =
  | { kind: "user"; userId: string; user: User; sessionIdHash: string }
  | { kind: "service"; userId: "service" }
  | { kind: "agent"; userId: string; agentId: string }
  | { kind: "anonymous"; userId: null };

declare module "express-serve-static-core" {
  interface Request {
    principal?: Principal;
  }
}

const ANONYMOUS: Principal = { kind: "anonymous", userId: null };

function bearer(req: express.Request): string | null {
  const h = req.headers.authorization;
  return h && h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/**
 * Paths under `/agent` that are not a paired machine's: a signed-in PERSON asks for a pairing code from
 * the browser (`POST /agent/pair`), and a computer that is not paired yet trades that code for its token
 * (`POST /agent/pair/redeem`, public and throttled). Everything else under `/agent` is agent-only.
 */
const AGENT_USER_PATHS = new Set(["/agent/pair", "/agent/pair/redeem"]);

/**
 * The agent-token-only path. Lower-cased first: Express routes case-insensitively, so `/Agent/claim`
 * reaches the same handler and must meet the same rule. A user cookie is neither required nor
 * sufficient here.
 */
export function isAgentPath(path: string): boolean {
  const p = path.toLowerCase().replace(/\/+$/, "");
  return (p === "/agent" || p.startsWith("/agent/")) && !AGENT_USER_PATHS.has(p);
}

/**
 * The id a job is filed under: the signed-in person's, or `undefined` for everything else (the
 * shared service token, anonymous legacy use), which the queue files as `legacy`. Agents never
 * submit server jobs, so they have no entry here.
 */
export function submitterId(req: express.Request): string | undefined {
  return req.principal?.kind === "user" ? req.principal.userId : undefined;
}

/**
 * The queue limits that apply to this request's submitter: the account settings, overridden per
 * person by an admin (`quota_json`). `undefined` for unowned work, which meets only the host backstop.
 */
export function submitterLimits(req: express.Request): SubmitterLimits | undefined {
  if (req.principal?.kind !== "user") return undefined;
  const s = authSettings();
  const q = req.principal.user.quota;
  return {
    queuedPerUser: q?.queuedPerUser ?? s.queuedPerUser,
    queuedPerUserExplicit: q?.queuedPerUser != null,
    serverSecondsPerDay: q?.serverSecondsPerDay ?? s.serverSecondsPerDay,
  };
}

/** The signed-in submitter's placement preference; `undefined` for unowned work. */
export function submitterPlacementPref(req: express.Request): User["placementPref"] | undefined {
  return req.principal?.kind === "user" ? req.principal.user.placementPref : undefined;
}

export function resolvePrincipal(req: express.Request, now: number = Date.now()): Principal {
  const token = bearer(req);

  if (isAgentPath(req.path)) {
    if (!token || token.length > 128) return ANONYMOUS;
    const agent = getAgentByTokenHash(hashToken(token));
    if (!agent || agent.revoked_at != null) return ANONYMOUS;
    // Disabling an account revokes its tokens; this also covers a token issued in the same instant.
    return getUserById(agent.user_id)?.status === "active" ? { kind: "agent", userId: agent.user_id, agentId: agent.id } : ANONYMOUS;
  }

  const session = resolveSession(req, now);
  if (session) return { kind: "user", userId: session.user.id, user: session.user, sessionIdHash: session.sessionIdHash };

  const legacy = process.env.APP_API_TOKEN;
  if (token && legacy && safeCompare(token, legacy)) return { kind: "service", userId: "service" };

  return ANONYMOUS;
}

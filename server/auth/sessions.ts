/**
 * auth/sessions.ts — server-side sign-in sessions behind the `mse_session` cookie.
 *
 * The cookie holds 32 random bytes; the database holds only their SHA-256. A session ends 14 days
 * after sign-in or after 24 hours unused, whichever comes first (`SESSION_TTL_DAYS`,
 * `SESSION_IDLE_HOURS`), so people are not asked for their password every day but an abandoned
 * browser does not stay signed in for two weeks.
 *
 * The cookie is `HttpOnly` (scripts cannot read it), `SameSite=Lax` (not sent on cross-site POSTs)
 * and `Secure` in production. It never appears in a URL.
 */
import type express from "express";
import { CONFIG } from "../config.ts";
import { authSettings } from "./config.ts";
import { deleteSession, getSession, getUserById, hashToken, insertSession, newToken, touchSession, type User } from "./store.ts";

export const SESSION_COOKIE = "mse_session";

/** `last_seen` is written at most once a minute per session, not on every request. */
const TOUCH_INTERVAL_MS = 60_000;

export function readCookie(req: express.Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function cookieAttributes(maxAgeSec: number): string {
  const attrs = [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAgeSec}`];
  if (CONFIG.server.isProduction) attrs.push("Secure");
  return attrs.join("; ");
}

export function setSessionCookie(res: express.Response, token: string): void {
  res.append("Set-Cookie", `${SESSION_COOKIE}=${token}; ${cookieAttributes(Math.floor(authSettings().sessionTtlMs / 1000))}`);
}

export function clearSessionCookie(res: express.Response): void {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; ${cookieAttributes(0)}`);
}

/** Start a session and set its cookie. Returns the session's id hash. */
export function startSession(req: express.Request, res: express.Response, userId: string, now: number): string {
  const token = newToken();
  const idHash = hashToken(token);
  const ua = req.headers["user-agent"];
  insertSession({
    id_hash: idHash,
    user_id: userId,
    created_at: now,
    expires_at: now + authSettings().sessionTtlMs,
    last_seen: now,
    user_agent: typeof ua === "string" ? ua.slice(0, 256) : null,
    ip: req.ip ?? null,
  });
  setSessionCookie(res, token);
  return idHash;
}

/**
 * The signed-in user behind this request's cookie, or null. Expired, idle and disabled sessions
 * resolve to null (and the stale row is removed), so disabling a user takes effect on their next request.
 */
export function resolveSession(req: express.Request, now: number): { user: User; sessionIdHash: string } | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 128) return null;
  const idHash = hashToken(token);
  const session = getSession(idHash);
  if (!session) return null;
  const settings = authSettings();
  if (session.expires_at <= now || now - session.last_seen > settings.sessionIdleMs) {
    deleteSession(idHash);
    return null;
  }
  const user = getUserById(session.user_id);
  if (!user || user.status !== "active") {
    deleteSession(idHash);
    return null;
  }
  if (now - session.last_seen >= TOUCH_INTERVAL_MS) touchSession(idHash, now);
  return { user, sessionIdHash: idHash };
}

export function endSession(req: express.Request, res: express.Response): void {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) deleteSession(hashToken(token));
  clearSessionCookie(res);
}

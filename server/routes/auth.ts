/**
 * auth.ts — sign-in, invites, password reset, first-admin setup, and "my preferences".
 *
 * Design: `doc/COMPUTE_ROUTING_PLAN.md` sections 4.0–4.6. Invite-only, no email service: an admin
 * hands over invite and reset links (`routes/admin.ts`). Links carry their token in the URL FRAGMENT
 * (`#invite=…`, `#reset=…`), which browsers never send to a server, so it cannot land in a proxy or
 * access log; the page posts it back in a JSON body.
 *
 *   GET  /setup                 200 {needed:true} while the first admin can be created, else 404
 *   POST /setup                 {secret,email,displayName,password}       -> 201 {user} + cookie
 *   POST /auth/login            {email,password}                          -> 200 {user} + cookie | 401 | 429
 *   POST /auth/logout                                                     -> 204
 *   GET  /auth/session                                                    -> 200 {mode,user|null,setupAvailable,accountsExist}
 *   GET  /auth/me                                                         -> 200 {user,mode,quota} | 401
 *   POST /auth/invite-info      {token}                                   -> 200 {email,role} | 404
 *   POST /auth/accept-invite    {token,password,displayName}              -> 201 {user} + cookie
 *   POST /auth/reset            {token,password}                          -> 200 {user} + cookie
 *   POST /auth/change-password  {current,next}                            -> 204
 *   GET|PUT /me/preferences     {shareResults?,placementPref?}
 */
import { type Router } from "express";
import { z } from "zod";
import { AuditLogger, safeCompare, sendError } from "../utils.ts";
import { authSettings } from "../auth/config.ts";
import { isValidEmail } from "../../src/shared/accountPolicy.ts";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/password.ts";
import { endSession, startSession } from "../auth/sessions.ts";
import { noStore, requireUser } from "../auth/middleware.ts";
import { signInWithPassword } from "../auth/providers/password.ts";
import { lockedFor, recordFailure, recordSuccess, throttleKeys } from "../auth/throttle.ts";
import {
  consumeInvite,
  consumePasswordReset,
  countUsers,
  createUser,
  deleteUserSessions,
  emailExists,
  getInvite,
  getPasswordHash,
  getUserById,
  hashToken,
  inTransaction,
  setPasswordHash,
  touchLastLogin,
  updateUser,
  type User,
} from "../auth/store.ts";

/** What the browser may see of a user. Never the password hash. */
export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    shareResults: u.shareResults,
    placementPref: u.placementPref,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

const email = z.string().trim().toLowerCase().refine(isValidEmail, "Enter a valid email address.");
const displayName = z.string().trim().min(1, "Enter your name.").max(80);
const token = z.string().min(16).max(128);

function badRequest(res: Parameters<typeof sendError>[0], err: z.ZodError): void {
  sendError(res, 400, "BAD_REQUEST", err.issues[0]?.message ?? "Invalid request.");
}

function retryAfter(res: Parameters<typeof sendError>[0], ms: number): void {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  res.setHeader("Retry-After", String(Math.ceil(ms / 1000)));
  sendError(res, 429, "TOO_MANY_ATTEMPTS", `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask your workspace admin for a reset link.`);
}

/** True while `/setup` may create the first admin: a secret is configured and no user exists. */
function setupOpen(): boolean {
  return Boolean(authSettings().adminSetupSecret) && countUsers() === 0;
}

export function registerAuthRoutes(apiRouter: Router, jsonParserRegular: any): void {
  apiRouter.use(["/auth", "/setup", "/me", "/admin"], noStore);
  apiRouter.use("/me", requireUser);
  const passwordProvider = () => authSettings().provider === "password";

  // ── First admin ─────────────────────────────────────────────────────────────────────────────────
  apiRouter.get("/setup", (_req, res) => {
    if (!passwordProvider() || !setupOpen()) return sendError(res, 404, "NOT_FOUND", "Not found.");
    res.json({ needed: true });
  });

  apiRouter.post("/setup", jsonParserRegular, async (req, res) => {
    // 404, not 403, once used: the endpoint stops existing rather than advertising that it did.
    if (!passwordProvider() || !setupOpen()) return sendError(res, 404, "NOT_FOUND", "Not found.");
    const now = Date.now();
    const keys = [`setup:${req.ip ?? "unknown"}`];
    const wait = lockedFor(keys, now);
    if (wait > 0) return retryAfter(res, wait);

    const parsed = z.object({ secret: z.string().max(256), email, displayName, password: z.string() }).safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    if (!safeCompare(parsed.data.secret, authSettings().adminSetupSecret ?? "")) {
      recordFailure(keys, now);
      return sendError(res, 401, "SETUP_SECRET_INVALID", "That setup secret is not correct. It is the ADMIN_SETUP_SECRET value in the server's .env file.");
    }
    const problem = passwordProblem(parsed.data.password);
    if (problem) return sendError(res, 400, "WEAK_PASSWORD", problem);

    const passwordHash = await hashPassword(parsed.data.password);
    // Re-check inside one write transaction: two concurrent submissions create one admin, not two.
    const user = inTransaction(() =>
      countUsers() === 0 ? createUser({ email: parsed.data.email, displayName: parsed.data.displayName, passwordHash, role: "admin", now }) : null,
    );
    if (!user) return sendError(res, 404, "NOT_FOUND", "Not found.");
    recordSuccess(keys);
    startSession(req, res, user.id, now);
    touchLastLogin(user.id, now); // creating the account signs them in; record it like any sign-in
    void AuditLogger.log("auth.setup_first_admin", { userId: user.id, ip: req.ip });
    res.status(201).json({ user: publicUser({ ...user, lastLoginAt: now }) });
  });

  // ── Sign in / out ───────────────────────────────────────────────────────────────────────────────
  apiRouter.post("/auth/login", jsonParserRegular, async (req, res) => {
    if (!passwordProvider()) return sendError(res, 404, "NOT_FOUND", "Not found.");
    const now = Date.now();
    const result = await signInWithPassword(req.body?.email, req.body?.password, req.ip, now);
    if (result.kind === "locked") return retryAfter(res, result.retryAfterMs);
    if (result.kind === "invalid") {
      void AuditLogger.log("auth.login_failed", { ip: req.ip });
      return sendError(res, 401, "INVALID_CREDENTIALS", "That email and password do not match an active account.");
    }
    startSession(req, res, result.user.id, now);
    void AuditLogger.log("auth.login", { userId: result.user.id, ip: req.ip });
    res.json({ user: publicUser(result.user) });
  });

  apiRouter.post("/auth/logout", jsonParserRegular, (req, res) => {
    const userId = req.principal?.kind === "user" ? req.principal.userId : null;
    endSession(req, res);
    if (userId) void AuditLogger.log("auth.logout", { userId });
    res.status(204).end();
  });

  /**
   * What the browser needs at start-up to decide what to show, and never a 401: the sign-in screen,
   * the app, or the "Sign in" button. Signed out, it reveals only the mode and whether any account
   * exists — both visible anyway from how the app behaves.
   */
  apiRouter.get("/auth/session", (req, res) => {
    const s = authSettings();
    const p = req.principal;
    let accountsExist = false;
    try {
      accountsExist = countUsers() > 0;
    } catch (err) {
      console.error("[auth] Could not read the account database:", (err as Error).message);
    }
    res.json({
      mode: s.mode,
      provider: s.provider,
      user: p?.kind === "user" ? publicUser(p.user) : null,
      setupAvailable: s.provider === "password" && Boolean(s.adminSetupSecret) && !accountsExist,
      accountsExist,
    });
  });

  apiRouter.get("/auth/me", (req, res) => {
    const p = req.principal;
    if (p?.kind !== "user") return sendError(res, 401, "SIGN_IN_REQUIRED", "Not signed in.");
    const s = authSettings();
    res.json({
      user: publicUser(p.user),
      mode: s.mode,
      quota: {
        queuedPerUser: p.user.quota?.queuedPerUser ?? s.queuedPerUser,
        serverSecondsPerDay: p.user.quota?.serverSecondsPerDay ?? s.serverSecondsPerDay,
      },
      // Server seconds used today and this week arrive with queue ownership (WP-B).
      usage: null,
    });
  });

  // ── Invites ─────────────────────────────────────────────────────────────────────────────────────
  apiRouter.post("/auth/invite-info", jsonParserRegular, (req, res) => {
    const parsed = z.object({ token }).safeParse(req.body);
    const invite = parsed.success ? getInvite(hashToken(parsed.data.token)) : null;
    if (!invite || invite.used_at || invite.expires_at <= Date.now()) {
      return sendError(res, 404, "INVITE_INVALID", "This invite link has expired or was already used. Ask your workspace admin for a new one.");
    }
    res.json({ email: invite.email, role: invite.role });
  });

  apiRouter.post("/auth/accept-invite", jsonParserRegular, async (req, res) => {
    if (!passwordProvider()) return sendError(res, 404, "NOT_FOUND", "Not found.");
    const parsed = z.object({ token, password: z.string(), displayName }).safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const problem = passwordProblem(parsed.data.password);
    if (problem) return sendError(res, 400, "WEAK_PASSWORD", problem);

    const now = Date.now();
    const tokenHash = hashToken(parsed.data.token);
    const passwordHash = await hashPassword(parsed.data.password);
    const outcome = inTransaction(() => {
      const invite = getInvite(tokenHash);
      if (!invite || invite.used_at || invite.expires_at <= now) return { error: "invalid" as const };
      // Checked before consuming, so a mistaken invite for an existing account is not burnt.
      if (emailExists(invite.email)) return { error: "exists" as const };
      if (!consumeInvite(tokenHash, now)) return { error: "invalid" as const };
      return { user: createUser({ email: invite.email, displayName: parsed.data.displayName, passwordHash, role: invite.role, now }) };
    });
    if ("error" in outcome) {
      return outcome.error === "exists"
        ? sendError(res, 409, "ACCOUNT_EXISTS", "An account with this email already exists. Sign in instead.")
        : sendError(res, 404, "INVITE_INVALID", "This invite link has expired or was already used. Ask your workspace admin for a new one.");
    }
    startSession(req, res, outcome.user.id, now);
    touchLastLogin(outcome.user.id, now);
    void AuditLogger.log("auth.invite_accepted", { userId: outcome.user.id, ip: req.ip });
    res.status(201).json({ user: publicUser({ ...outcome.user, lastLoginAt: now }) });
  });

  // ── Passwords ───────────────────────────────────────────────────────────────────────────────────
  apiRouter.post("/auth/reset", jsonParserRegular, async (req, res) => {
    if (!passwordProvider()) return sendError(res, 404, "NOT_FOUND", "Not found.");
    const parsed = z.object({ token, password: z.string() }).safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const problem = passwordProblem(parsed.data.password);
    if (problem) return sendError(res, 400, "WEAK_PASSWORD", problem);

    const now = Date.now();
    const passwordHash = await hashPassword(parsed.data.password);
    const userId = consumePasswordReset(hashToken(parsed.data.token), now);
    const user = userId ? getUserById(userId) : null;
    if (!user || user.status !== "active") {
      return sendError(res, 404, "RESET_INVALID", "This reset link has expired or was already used. Ask your workspace admin for a new one.");
    }
    setPasswordHash(user.id, passwordHash);
    deleteUserSessions(user.id); // every other browser signs out
    // The usual reason for a reset is a locked account: a new password must not stay locked out.
    recordSuccess(throttleKeys(req.ip, user.email));
    startSession(req, res, user.id, now);
    touchLastLogin(user.id, now);
    void AuditLogger.log("auth.password_reset", { userId: user.id, ip: req.ip });
    res.json({ user: publicUser({ ...user, lastLoginAt: now }) });
  });

  apiRouter.post("/auth/change-password", jsonParserRegular, requireUser, async (req, res) => {
    if (!passwordProvider() || req.principal?.kind !== "user") return sendError(res, 404, "NOT_FOUND", "Not found.");
    const parsed = z.object({ current: z.string(), next: z.string() }).safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const p = req.principal;
    // Guessing the current password from a stolen session is throttled exactly like signing in.
    const keys = throttleKeys(req.ip, p.user.email);
    const now = Date.now();
    const wait = lockedFor(keys, now);
    if (wait > 0) return retryAfter(res, wait);
    if (!(await verifyPassword(parsed.data.current, getPasswordHash(p.userId)))) {
      recordFailure(keys, now);
      return sendError(res, 401, "INVALID_CREDENTIALS", "Your current password is not correct.");
    }
    recordSuccess(keys);
    const problem = passwordProblem(parsed.data.next);
    if (problem) return sendError(res, 400, "WEAK_PASSWORD", problem);
    setPasswordHash(p.userId, await hashPassword(parsed.data.next));
    deleteUserSessions(p.userId, p.sessionIdHash); // sign out everywhere else, keep this browser
    void AuditLogger.log("auth.password_changed", { userId: p.userId });
    res.status(204).end();
  });

  // ── My preferences ──────────────────────────────────────────────────────────────────────────────
  apiRouter.get("/me/preferences", (req, res) => {
    if (req.principal?.kind !== "user") return;
    const { shareResults, placementPref } = req.principal.user;
    res.json({ shareResults, placementPref });
  });

  apiRouter.put("/me/preferences", jsonParserRegular, (req, res) => {
    if (req.principal?.kind !== "user") return;
    const parsed = z
      .object({ shareResults: z.boolean().optional(), placementPref: z.enum(["auto", "my_machine", "server_only"]).optional() })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const user = updateUser(req.principal.userId, parsed.data);
    res.json({ shareResults: user?.shareResults, placementPref: user?.placementPref });
  });
}

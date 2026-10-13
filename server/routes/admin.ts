/**
 * admin.ts — the workspace admin's account tools (role `admin`; section 4.5 of the compute-routing plan).
 *
 *   POST  /admin/invites                {email, role}           -> 201 {inviteUrl, expiresAt}
 *   GET   /admin/invites                                        -> 200 {invites} (unused, unexpired)
 *   DELETE /admin/invites/:id                                   -> 204 (withdraw an unused invite)
 *   GET   /admin/users                                          -> 200 {users}
 *   PATCH /admin/users/:id              {status?, role?, quota?} -> 200 {user}
 *   POST  /admin/users/:id/reset-link                           -> 201 {resetUrl, expiresAt}
 *   POST  /admin/users/:id/sign-out                             -> 204
 *
 * There is no email service, so links come back to the admin to hand over. They carry the token in
 * the URL fragment, which never reaches a server log.
 *
 * Lock-out guard: no change may leave the workspace without an active admin.
 */
import { type Router } from "express";
import { z } from "zod";
import { AuditLogger, sendError } from "../utils.ts";
import { authSettings } from "../auth/config.ts";
import { isValidEmail } from "../../src/shared/accountPolicy.ts";
import { requireAdmin } from "../auth/middleware.ts";
import {
  countActiveAdmins,
  deleteInvite,
  deleteUserSessions,
  emailExists,
  getUserById,
  hashToken,
  insertPasswordReset,
  inTransaction,
  listPendingInvites,
  listUsers,
  newToken,
  replaceInvite,
  revokeUserAgentTokens,
  updateUser,
} from "../auth/store.ts";
import { publicUser } from "./auth.ts";
import { BiophysicalJobQueue } from "../services/infra/biophysical-queue.ts";
import { routingMode } from "../services/infra/admission.ts";

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const RESET_TTL_MS = 24 * 60 * 60 * 1000;

const quotaSchema = z
  .object({
    queuedPerUser: z.number().int().min(1).max(500).optional(),
    serverSecondsPerDay: z.number().int().min(60).optional(),
  })
  .strict()
  .nullable();

export function registerAdminRoutes(apiRouter: Router, jsonParserRegular: any): void {
  apiRouter.use("/admin", requireAdmin);

  apiRouter.post("/admin/invites", jsonParserRegular, (req, res) => {
    const parsed = z
      .object({ email: z.string().trim().toLowerCase().refine(isValidEmail, "Enter a valid email address."), role: z.enum(["admin", "member"]).default("member") })
      .safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request.");
    if (emailExists(parsed.data.email)) {
      return sendError(res, 409, "ACCOUNT_EXISTS", "This person already has an account. Use a reset link if they cannot sign in.");
    }
    const now = Date.now();
    const token = newToken();
    const expiresAt = now + INVITE_TTL_MS;
    replaceInvite({ tokenHash: hashToken(token), email: parsed.data.email, role: parsed.data.role, expiresAt, createdBy: req.principal!.userId as string });
    void AuditLogger.log("admin.invite_created", { adminId: req.principal!.userId, role: parsed.data.role });
    res.status(201).json({ inviteUrl: `${authSettings().publicBaseUrl}/#invite=${token}`, expiresAt });
  });

  apiRouter.get("/admin/invites", (_req, res) => {
    res.json({ invites: listPendingInvites(Date.now()) });
  });

  apiRouter.delete("/admin/invites/:id", (req, res) => {
    if (!/^[0-9a-f]{64}$/.test(req.params.id) || !deleteInvite(req.params.id)) {
      return sendError(res, 404, "NOT_FOUND", "That invite was already used, withdrawn or has expired.");
    }
    void AuditLogger.log("admin.invite_withdrawn", { adminId: req.principal!.userId });
    res.status(204).end();
  });

  apiRouter.get("/admin/users", (_req, res) => {
    res.json({ users: listUsers().map((u) => ({ ...publicUser(u), quota: u.quota })) });
  });

  apiRouter.patch("/admin/users/:id", jsonParserRegular, (req, res) => {
    const parsed = z
      .object({ status: z.enum(["active", "disabled"]).optional(), role: z.enum(["admin", "member"]).optional(), quota: quotaSchema.optional() })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "BAD_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request.");
    const now = Date.now();

    const outcome = inTransaction(() => {
      const target = getUserById(req.params.id);
      if (!target) return { error: 404 as const };
      const losesAdmin =
        target.role === "admin" && target.status === "active" && (parsed.data.role === "member" || parsed.data.status === "disabled");
      if (losesAdmin && countActiveAdmins() <= 1) return { error: 409 as const };
      const updated = updateUser(target.id, parsed.data);
      if (parsed.data.status === "disabled") {
        // Disabled means out now: sessions and paired computers stop working on their next request,
        // and (below, outside the transaction) their queued and running jobs are cancelled.
        deleteUserSessions(target.id);
        revokeUserAgentTokens(target.id, now);
      }
      return { user: updated! };
    });

    if ("error" in outcome) {
      return outcome.error === 404
        ? sendError(res, 404, "NOT_FOUND", "No such user.")
        : sendError(res, 409, "LAST_ADMIN", "This is the only active admin. Make someone else an admin first.");
    }
    let jobsCancelled = 0;
    if (parsed.data.status === "disabled") {
      try {
        jobsCancelled = BiophysicalJobQueue.getInstance().cancelAllFor(outcome.user.id);
      } catch {
        // The queue is not running (a minimal deployment): there is nothing of theirs to cancel.
      }
    }
    void AuditLogger.log("admin.user_updated", { adminId: req.principal!.userId, userId: outcome.user.id, jobsCancelled, ...parsed.data });
    res.json({ user: { ...publicUser(outcome.user), quota: outcome.user.quota }, jobsCancelled });
  });

  apiRouter.post("/admin/users/:id/reset-link", jsonParserRegular, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target) return sendError(res, 404, "NOT_FOUND", "No such user.");
    if (target.status !== "active") return sendError(res, 409, "USER_DISABLED", "Enable this account before sending a reset link.");
    const token = newToken();
    const expiresAt = Date.now() + RESET_TTL_MS;
    insertPasswordReset({ tokenHash: hashToken(token), userId: target.id, expiresAt, createdBy: req.principal!.userId as string });
    void AuditLogger.log("admin.reset_link_created", { adminId: req.principal!.userId, userId: target.id });
    res.status(201).json({ resetUrl: `${authSettings().publicBaseUrl}/#reset=${token}`, expiresAt });
  });

  /**
   * Forget the out-of-memory size limits the server has learned (WP-D). For when a limit is wrong: a
   * misclassified failure, or the host got more memory. Jobs of any size are admitted again until two
   * new out-of-memory deaths teach a limit afresh.
   */
  /** What `DELETE` would forget, and whether it is enforced at all (only with `COMPUTE_ROUTING=on`). */
  apiRouter.get("/admin/compute/ceilings", (_req, res) => {
    let ceilings: ReturnType<BiophysicalJobQueue["learnedCeilings"]> = [];
    try {
      ceilings = BiophysicalJobQueue.getInstance().learnedCeilings();
    } catch {
      // No queue in this process: nothing learned.
    }
    res.json({ enforced: routingMode() === "on", ceilings });
  });

  apiRouter.delete("/admin/compute/ceilings", (req, res) => {
    let removed = 0;
    try {
      removed = BiophysicalJobQueue.getInstance().forgetOomCeilings();
    } catch {
      // No queue in this process: nothing learned to forget.
    }
    void AuditLogger.log("admin.compute_ceilings_reset", { adminId: req.principal!.userId, removed });
    res.json({ removed });
  });

  apiRouter.post("/admin/users/:id/sign-out", jsonParserRegular, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target) return sendError(res, 404, "NOT_FOUND", "No such user.");
    deleteUserSessions(target.id);
    void AuditLogger.log("admin.user_signed_out", { adminId: req.principal!.userId, userId: target.id });
    res.status(204).end();
  });
}

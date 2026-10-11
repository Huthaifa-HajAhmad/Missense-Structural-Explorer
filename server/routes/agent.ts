/**
 * agent.ts — paired computers ("agents", plan WP-F1): pairing, the job protocol, and the team FoldX bundle.
 *
 * A person lends their own computer to their own jobs. The computer is outbound-only (it works behind a
 * home or lab NAT): it long-polls for work over HTTPS and is authenticated by its own token, never by a
 * person's cookie (`accountAccess`, auth/middleware.ts). It can only ever be handed its OWNER's jobs.
 *
 *   Signed-in person (cookie):
 *   POST   /agent/pair                                   -> 201 {code, expiresAt}         one-time, 10 min
 *   GET    /me/agents                                    -> 200 {agents}
 *   DELETE /me/agents/:id                                -> 204                           disconnect
 *   GET    /me/agent-downloads                           -> 200 {platforms}               agent zips on this server
 *   GET    /me/agent-download/:platform                  -> 200 zip | 404
 *
 *   The computer being paired (no token yet; throttled):
 *   POST   /agent/pair/redeem  {code, name}              -> 201 {agentId, token}           token shown once
 *
 *   A paired computer (Authorization: Bearer <agent token>); 503 on a paused standby:
 *   POST   /agent/register     {report}                  -> 200 {agentId, name, leaseSec, heartbeatSec, claimWaitMaxSec, foldxBundleVersion}
 *   POST   /agent/claim        {report, waitSec<=25}     -> 200 {job|null, foldxBundleVersion}   long poll
 *   POST   /agent/jobs/:jobId/heartbeat {phase?, rssBytes?} -> 200 {leaseExpiresAt, foldxBundleVersion} | 410
 *   POST   /agent/jobs/:jobId/result {result, wallMs, peakRssBytes, toolVersion} -> 200 {accepted, reasons?} | 409
 *   POST   /agent/jobs/:jobId/fail   {errorClass, message?, wallMs?, peakRssBytes?, toolVersion?} -> 200 | 409
 *   DELETE /agent/self                                   -> 204                           the computer disconnects itself
 *   GET    /agent/tools/foldx?platform=win32|linux|darwin -> 200 zip + X-Bundle-Sha256/X-Bundle-Version + ETag | 304 | 404
 *
 *   Workspace admin:
 *   GET    /admin/tools/foldx                            -> 200 {platforms}
 *   PUT    /admin/tools/foldx/:platform   raw zip, X-Foldx-Licence-Confirmed: yes -> 201 {bundle}
 *   DELETE /admin/tools/foldx                            -> 204                           remove FoldX from the team
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { type Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { AuditLogger, sendError } from "../utils.ts";
import { noStore, requireUser } from "../auth/middleware.ts";
import { lockedFor, recordFailure } from "../auth/throttle.ts";
import {
  consumePairingCode,
  deleteExpiredPairingCodes,
  getAgent,
  getUserById,
  hashToken,
  insertAgentToken,
  listActiveAgents,
  listAgentsFor,
  newToken,
  replacePairingCode,
  revokeAgent,
  updateAgentReport,
} from "../auth/store.ts";
import { BiophysicalJobQueue, type SQLiteQueue } from "../services/infra/biophysical-queue.ts";
import {
  agentHostFeatures,
  agentTimings,
  agentView,
  isAgentOnline,
  newPairingCode,
  offeredJobTypes,
  pairingCodeHash,
  parseHostReport,
  storedReport,
} from "../services/infra/agent-registry.ts";
import {
  acceptAgentFailure,
  acceptAgentResult,
  AGENT_FAILURE_CLASSES,
  agentResultsShareable,
  agentTelemetryClass,
  onAgentClaimed,
  payloadFor,
} from "../services/infra/agent-jobs.ts";
import { routingPolicyFromEnv } from "../services/infra/admission.ts";
import { checkFoldxArchive, isFoldxPlatform, MAX_ARCHIVE_BYTES, PLATFORM_LABEL } from "../services/infra/foldx-archive.ts";
import { foldxBundleFor, foldxBundlePath, listFoldxBundles, newUploadTempPath, revokeFoldxBundles, storeFoldxBundle } from "../services/infra/tool-bundles.ts";
import { decidePlacement, foldxRepairApplies, type JobFeatures } from "../../src/shared/computeRouting.ts";
import { AGENT_PROTOCOL_VERSION, formatPairingCode, normalisePairingCode, PAIRING_CODE_TTL_MS, type AgentHostReport } from "../../src/shared/agentProtocol.ts";
import { isFoldxPhase } from "../../src/shared/foldxPhase.ts";

const jobIdParam = /^[a-zA-Z0-9_-]{1,100}$/;

/** The queue, or null on a minimal deployment without one. */
function queueOrNull(): BiophysicalJobQueue | null {
  try {
    return BiophysicalJobQueue.getInstance();
  } catch {
    return null;
  }
}

function agentPrincipal(req: Request): { agentId: string; userId: string } {
  const p = req.principal;
  if (p?.kind !== "agent") throw new Error("agent route reached without an agent principal");
  return { agentId: p.agentId, userId: p.userId };
}

/**
 * The SQLite queue for agent work, or an answer explaining why there is none. A paused standby (blue/green
 * handover) must never hand out work: only the serving process does (plan section 11).
 */
function agentQueue(res: Response): SQLiteQueue | null {
  const queue = queueOrNull();
  if (!queue) {
    sendError(res, 503, "QUEUE_UNAVAILABLE", "The job queue is not running on this server.");
    return null;
  }
  if (queue.getDeploymentState().paused) {
    res.setHeader("Retry-After", "10");
    sendError(res, 503, "STANDBY", "This server is handing over to a new version. Try again in a few seconds.");
    return null;
  }
  const sqlite = queue.agentQueue();
  if (!sqlite) {
    sendError(res, 503, "AGENTS_UNSUPPORTED", "This server's queue (Redis) cannot hand work to computers; everything runs on the server.");
    return null;
  }
  return sqlite;
}

/** One limit per computer, not per address: a lab's computers share one NAT address with its browsers. */
const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => (req.principal?.kind === "agent" ? `agent:${req.principal.agentId}` : `ip:${req.ip}`),
  message: { error: { code: "RATE_LIMITED", message: "This computer is calling the server too often; it will retry shortly." } },
});

/**
 * A coarse per-address backstop for computers, so one person pairing many computers behind one address
 * cannot multiply the per-computer allowance without bound. Generous: a lab's computers share its address.
 */
const agentAddressLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => `agent-ip:${req.ip}`,
  message: { error: { code: "RATE_LIMITED", message: "Too many requests from computers at this address; they will retry shortly." } },
});

/** Most computers one person may have connected at once. */
export const MAX_AGENTS_PER_PERSON = 10;

/** Downloading a tool bundle is tens of megabytes: a handful per hour is plenty, even with retries. */
const bundleLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => (req.principal?.kind === "agent" ? `bundle:${req.principal.agentId}` : `bundle-ip:${req.ip}`),
  message: { error: { code: "RATE_LIMITED", message: "Too many downloads of the FoldX bundle from this computer; it will retry later." } },
});

function bundleVersionFor(report: AgentHostReport | null): string | null {
  return report ? (foldxBundleFor(report.os)?.version ?? null) : null;
}

/** The engine's hard filters, applied to this computer for one job. */
function claimFilter(
  report: AgentHostReport,
  agent: { agentId: string; userId: string },
  sqlite: SQLiteQueue,
): (row: { id: string; type: "foldx" | "p2rank"; residues: number | null; repaired: boolean | null; othersWatching: boolean }) => boolean {
  const owner = getUserById(agent.userId);
  const row = getAgent(agent.agentId);
  if (!owner || owner.status !== "active" || !row) return () => false;
  const host = agentHostFeatures(row, report, sqlite);
  host.online = !report.paused; // it is calling now
  const policy = routingPolicyFromEnv(owner.placementPref);
  const models = sqlite.getCostModels();
  const shareable = agentResultsShareable(agent.userId);
  return (job) => {
    if (!host.tools.some((t) => t.name === job.type)) return false;
    // Someone else joined this job and could not be given a private computer result (Review 3, S2): the
    // server runs it, so everyone waiting gets the answer.
    if (job.othersWatching && !shareable) return false;
    // A person who chose "server only" keeps every job on the server, computer or not.
    if (owner.placementPref === "server_only") return false;
    // Size unknown: no size rule can be applied, and the tool check above is the whole filter.
    if (!job.residues || job.residues <= 0) return true;
    const features: JobFeatures = {
      type: job.type,
      residues: job.residues,
      chains: 1,
      numberOfRuns: job.type === "foldx" ? 5 : 0,
      // `repaired` is stored with the size at submit (foldxRepairApplies); a row without it predates that.
      repair: job.type === "foldx" ? (job.repaired ?? foldxRepairApplies(job.residues, false)) : false,
      ownerId: agent.userId,
      requires: [{ tool: job.type }],
    };
    return decidePlacement(features, [host], policy, models).placement.kind === "agent";
  };
}

/** The agent zips people can download, one per platform, from `AGENT_BUNDLE_DIR` (outside the image, like the data). */
const AGENT_BUNDLE_PLATFORMS: readonly [string, string][] = [
  ["win32-x64", "Windows"],
  ["darwin-arm64", "Mac (Apple silicon)"],
  ["darwin-x64", "Mac (Intel)"],
  ["linux-x64", "Linux"],
  ["linux-arm64", "Linux (ARM)"],
];

function agentBundleFile(platform: string): string {
  const dir = process.env.AGENT_BUNDLE_DIR || path.join(process.cwd(), "data", "agent-bundles");
  return path.join(dir, `MissenseAgent-${platform}.zip`);
}

let housekeeping: NodeJS.Timeout | null = null;

/**
 * Once a minute: release jobs placed on a computer that went away, and drop dead pairing codes. Skipped on
 * a paused standby, like every other queue reaper.
 */
function startHousekeeping(): void {
  if (housekeeping) return;
  housekeeping = setInterval(() => {
    try {
      const queue = queueOrNull();
      if (queue && !queue.getDeploymentState().paused) {
        const online = new Set(listActiveAgents().filter((a) => isAgentOnline(a)).map((a) => a.id));
        queue.agentQueue()?.releasePlacementsOf((id) => online.has(id));
      }
      deleteExpiredPairingCodes(Date.now());
    } catch (err: any) {
      console.warn("[agent] Housekeeping failed:", err?.message ?? err);
    }
  }, 60_000);
  housekeeping.unref();
}

/**
 * Express 4 does not catch a rejected async handler: an unexpected error (a busy database during a
 * handover, a throw while finishing a result) would become an unhandled rejection. Answer 500 instead.
 */
function guarded(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((err) => {
      console.error(`[agent] ${req.method} ${req.path} failed:`, err?.message ?? err);
      if (!res.headersSent) sendError(res, 500, "AGENT_ROUTE_FAILED", "The server could not handle this request; the computer will retry.");
    });
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms).unref?.());
}

export function registerAgentRoutes(apiRouter: Router, jsonParserRegular: any): void {
  apiRouter.use("/agent", noStore);
  apiRouter.use("/agent", (req: Request, res: Response, next: NextFunction) =>
    req.principal?.kind === "agent" ? agentAddressLimiter(req, res, () => agentLimiter(req, res, next)) : next(),
  );
  startHousekeeping();

  // ── Pairing ─────────────────────────────────────────────────────────────────────────────────────
  apiRouter.post("/agent/pair", jsonParserRegular, requireUser, (req, res) => {
    const now = Date.now();
    const code = newPairingCode();
    const expiresAt = now + PAIRING_CODE_TTL_MS;
    replacePairingCode({ codeHash: pairingCodeHash(code), userId: req.principal!.userId as string, expiresAt });
    void AuditLogger.log("agent.pairing_code_created", { userId: req.principal!.userId });
    // `expiresInSec` too: the browser counts down from its own clock, which may not agree with the server's.
    res.status(201).json({ code: formatPairingCode(code), expiresAt, expiresInSec: Math.round(PAIRING_CODE_TTL_MS / 1000) });
  });

  apiRouter.post("/agent/pair/redeem", jsonParserRegular, (req, res) => {
    const now = Date.now();
    const keys = [`ip:pair:${req.ip ?? "unknown"}`];
    const wait = lockedFor(keys, now);
    if (wait > 0) {
      res.setHeader("Retry-After", String(Math.ceil(wait / 1000)));
      return sendError(res, 429, "TOO_MANY_ATTEMPTS", `Too many wrong codes. Try again in ${Math.max(1, Math.ceil(wait / 60_000))} minutes.`);
    }
    const parsed = z.object({ code: z.string().max(20), name: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "BAD_REQUEST", "Send the six-character code and a name for this computer.");
    const code = normalisePairingCode(parsed.data.code);
    const userId = code ? consumePairingCode(pairingCodeHash(code), now) : null;
    const owner = userId ? getUserById(userId) : null;
    if (!userId || !owner || owner.status !== "active") {
      recordFailure(keys, now);
      return sendError(res, 401, "PAIRING_CODE_INVALID", "That code is not valid. Codes work once, for 10 minutes: press Connect my computer in the app for a new one.");
    }
    if (listAgentsFor(userId).length >= MAX_AGENTS_PER_PERSON) {
      return sendError(res, 409, "TOO_MANY_COMPUTERS", `You already have ${MAX_AGENTS_PER_PERSON} computers connected. Disconnect one in Settings → Account first.`);
    }
    const agentId = crypto.randomUUID();
    const token = newToken();
    insertAgentToken({ id: agentId, userId, tokenHash: hashToken(token), name: parsed.data.name, now });
    void AuditLogger.log("agent.paired", { userId, agentId });
    res.status(201).json({ agentId, token, ownerName: owner.displayName });
  });

  apiRouter.get("/me/agents", (req, res) => {
    const sqlite = queueOrNull()?.agentQueue() ?? null;
    res.json({ agents: listAgentsFor(req.principal!.userId as string).map((row) => agentView(row, sqlite)) });
  });

  apiRouter.delete("/me/agents/:id", (req, res) => {
    const userId = req.principal!.userId as string;
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !revokeAgent(req.params.id, Date.now(), userId)) {
      return sendError(res, 404, "NOT_FOUND", "No such computer, or it was already disconnected.");
    }
    void AuditLogger.log("agent.revoked", { userId, agentId: req.params.id, by: "owner" });
    res.status(204).end();
  });

  // ── The agent itself, for people to download (built by `npm run build:agent-bundle`) ─────────────
  apiRouter.get("/me/agent-downloads", (_req, res) => {
    res.json({
      platforms: AGENT_BUNDLE_PLATFORMS.flatMap(([platform, label]) => {
        const file = agentBundleFile(platform);
        return fs.existsSync(file) ? [{ platform, label, sizeBytes: fs.statSync(file).size, url: `/api/v1/me/agent-download/${platform}` }] : [];
      }),
    });
  });

  apiRouter.get("/me/agent-download/:platform", (req, res) => {
    const known = AGENT_BUNDLE_PLATFORMS.find(([p]) => p === req.params.platform);
    const file = known ? agentBundleFile(known[0]) : null;
    if (!file || !fs.existsSync(file)) return sendError(res, 404, "NOT_FOUND", "The agent for this kind of computer is not available on this workspace yet. Ask your workspace admin.");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="MissenseAgent-${known![0]}.zip"`);
    fs.createReadStream(file).pipe(res);
  });

  // ── The paired computer ─────────────────────────────────────────────────────────────────────────
  apiRouter.post("/agent/register", jsonParserRegular, (req, res) => {
    if (!agentQueue(res)) return;
    const agent = agentPrincipal(req);
    const parsed = parseHostReport(req.body?.report);
    if (!parsed.ok) return sendError(res, 400, "BAD_REPORT", parsed.message);
    if (parsed.report.protocol !== AGENT_PROTOCOL_VERSION) {
      return sendError(res, 426, "AGENT_OUTDATED", "This agent is a different version from the server. Download the current agent from Settings → Account.");
    }
    updateAgentReport(agent.agentId, { now: Date.now(), hostJson: JSON.stringify(parsed.report), agentVersion: parsed.report.agentVersion, paused: parsed.report.paused });
    const row = getAgent(agent.agentId)!;
    const t = agentTimings();
    res.json({
      agentId: row.id,
      name: row.name,
      leaseSec: t.leaseMs / 1000,
      heartbeatSec: t.heartbeatSec,
      claimWaitMaxSec: t.claimWaitMaxSec,
      foldxBundleVersion: bundleVersionFor(parsed.report),
    });
  });

  apiRouter.post("/agent/claim", jsonParserRegular, guarded(async (req, res) => {
    let sqlite = agentQueue(res);
    if (!sqlite) return;
    const agent = agentPrincipal(req);
    const parsed = parseHostReport(req.body?.report);
    if (!parsed.ok) return sendError(res, 400, "BAD_REPORT", parsed.message);
    const report = parsed.report;
    const t = agentTimings();
    const waitSec = Math.min(t.claimWaitMaxSec, Math.max(0, Number(req.body?.waitSec) || 0));
    updateAgentReport(agent.agentId, { now: Date.now(), hostJson: JSON.stringify(report), agentVersion: report.agentVersion, paused: report.paused });

    let gone = false;
    res.on("close", () => { gone = true; });
    const deadline = Date.now() + waitSec * 1000;
    // A team FoldX copy that no longer matches the workspace's bundle (revoked or replaced) is not offered:
    // the computer erases or updates it first, and FoldX jobs never run on a revoked copy.
    const teamFoldxStale = report.foldxSource === "team" && report.foldxBundleVersion !== bundleVersionFor(report);
    const types = offeredJobTypes(report).filter((t) => !(t === "foldx" && teamFoldxStale));
    for (;;) {
      const queue = queueOrNull();
      if (!queue || queue.getDeploymentState().paused) {
        if (!res.headersSent && !gone) agentQueue(res); // answers 503 with the reason
        return;
      }
      sqlite = queue.agentQueue()!;
      const claimed = types.length > 0 ? sqlite.claimForAgent(agent, types, claimFilter(report, agent, sqlite), t.leaseMs) : null;
      if (claimed) {
        if (gone) {
          // Nobody to hand it to: give it straight back rather than wait for the lease to run out.
          sqlite.requeueAgentJobToServer(claimed.id, agent.agentId, { outcome: "requeued", telemetry: "cancelled", errorClass: "agent:disconnected", host: { hostId: `agent:${agent.agentId}`, hostClass: agentTelemetryClass(report), wallMs: null, peakRssBytes: null, toolVersion: null } });
          return;
        }
        const payload = payloadFor(claimed);
        if (!payload) {
          sqlite.requeueAgentJobToServer(claimed.id, agent.agentId, { outcome: "requeued", telemetry: "failed", errorClass: "agent:payload", host: { hostId: `agent:${agent.agentId}`, hostClass: agentTelemetryClass(report), wallMs: null, peakRssBytes: null, toolVersion: null } });
          continue;
        }
        onAgentClaimed(claimed);
        void AuditLogger.log("agent.job_claimed", { agentId: agent.agentId, jobId: claimed.id, type: claimed.type });
        return res.json({ job: payload, foldxBundleVersion: bundleVersionFor(report) });
      }
      if (gone) return;
      if (Date.now() >= deadline) return res.json({ job: null, foldxBundleVersion: bundleVersionFor(report) });
      await sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
      updateAgentReport(agent.agentId, { now: Date.now() });
    }
  }));

  apiRouter.post("/agent/jobs/:jobId/heartbeat", jsonParserRegular, guarded(async (req, res) => {
    const sqlite = agentQueue(res);
    if (!sqlite) return;
    const agent = agentPrincipal(req);
    if (!jobIdParam.test(req.params.jobId)) return sendError(res, 400, "BAD_REQUEST", "Invalid job id.");
    updateAgentReport(agent.agentId, { now: Date.now() });
    const leaseExpiresAt = sqlite.renewAgentLease(req.params.jobId, agent.agentId, agentTimings().leaseMs);
    if (leaseExpiresAt == null) {
      return sendError(res, 410, "LEASE_LOST", "This job is no longer yours (cancelled, finished, or handed to the server). Stop working on it.");
    }
    if (isFoldxPhase(req.body?.phase)) {
      try {
        await BiophysicalJobQueue.getInstance().updateJobPhase(req.params.jobId, req.body.phase);
      } catch { /* progress must never fail the heartbeat */ }
    }
    res.json({ leaseExpiresAt, foldxBundleVersion: bundleVersionFor(storedReport(getAgent(agent.agentId)!)) });
  }));

  apiRouter.post("/agent/jobs/:jobId/result", jsonParserRegular, guarded(async (req, res) => {
    const sqlite = agentQueue(res);
    if (!sqlite) return;
    const agent = agentPrincipal(req);
    if (!jobIdParam.test(req.params.jobId)) return sendError(res, 400, "BAD_REQUEST", "Invalid job id.");
    const parsed = z
      .object({
        result: z.unknown(),
        wallMs: z.number().finite().min(0).nullable().optional(),
        peakRssBytes: z.number().finite().min(0).nullable().optional(),
        toolVersion: z.string().max(40),
      })
      .safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "BAD_REQUEST", "A result needs `result` and `toolVersion`.");
    updateAgentReport(agent.agentId, { now: Date.now() });
    const outcome = await acceptAgentResult(sqlite, agent, storedReport(getAgent(agent.agentId)!), req.params.jobId, parsed.data);
    if (outcome.status === 404) return sendError(res, 404, "NOT_FOUND", outcome.reason);
    if (outcome.status === 409) return sendError(res, 409, "LEASE_LOST", outcome.reason);
    if (outcome.accepted) void AuditLogger.log("agent.job_completed", { agentId: agent.agentId, jobId: req.params.jobId });
    res.json(outcome.accepted ? { accepted: true } : { accepted: false, reasons: outcome.reasons });
  }));

  apiRouter.post("/agent/jobs/:jobId/fail", jsonParserRegular, (req, res) => {
    const sqlite = agentQueue(res);
    if (!sqlite) return;
    const agent = agentPrincipal(req);
    if (!jobIdParam.test(req.params.jobId)) return sendError(res, 400, "BAD_REQUEST", "Invalid job id.");
    const parsed = z
      .object({
        errorClass: z.enum(AGENT_FAILURE_CLASSES),
        message: z.string().max(500).optional(),
        wallMs: z.number().finite().min(0).nullable().optional(),
        peakRssBytes: z.number().finite().min(0).nullable().optional(),
        toolVersion: z.string().max(40).nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "BAD_REQUEST", `errorClass must be one of ${AGENT_FAILURE_CLASSES.join(", ")}.`);
    updateAgentReport(agent.agentId, { now: Date.now() });
    if (!sqlite.jobExists(req.params.jobId)) return sendError(res, 404, "NOT_FOUND", "No such job.");
    const out = acceptAgentFailure(sqlite, agent, storedReport(getAgent(agent.agentId)!), req.params.jobId, parsed.data);
    if (out.status === 409) return sendError(res, 409, "LEASE_LOST", "This job is no longer yours.");
    res.json({ handedToServer: true });
  });

  apiRouter.delete("/agent/self", (req, res) => {
    const agent = agentPrincipal(req);
    revokeAgent(agent.agentId, Date.now());
    // Whatever it was running goes back to the server now, not after the lease runs out. Not from a paused
    // standby, which never changes the shared queue: the serving process's lease reaper does it there.
    const queue = queueOrNull();
    const sqlite = queue && !queue.getDeploymentState().paused ? queue.agentQueue() : null;
    if (sqlite) sqlite.reapAgentLeases(Date.now(), agent.agentId);
    void AuditLogger.log("agent.revoked", { userId: agent.userId, agentId: agent.agentId, by: "agent" });
    res.status(204).end();
  });

  apiRouter.get("/agent/tools/foldx", bundleLimiter, (req, res) => {
    const platform = req.query.platform;
    if (!isFoldxPlatform(platform)) return sendError(res, 400, "BAD_REQUEST", "platform must be win32, linux or darwin.");
    const info = foldxBundleFor(platform);
    if (!info) return sendError(res, 404, "NO_BUNDLE", `Your workspace has no FoldX for ${PLATFORM_LABEL[platform]}.`);
    const etag = `"${info.sha256}"`;
    res.setHeader("ETag", etag);
    res.setHeader("X-Bundle-Sha256", info.sha256);
    res.setHeader("X-Bundle-Version", info.version);
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(info.sizeBytes));
    void AuditLogger.log("agent.foldx_bundle_downloaded", { agentId: req.principal?.kind === "agent" ? req.principal.agentId : null, platform, version: info.version });
    const stream = fs.createReadStream(foldxBundlePath(info));
    stream.on("error", () => (res.headersSent ? res.destroy() : sendError(res, 500, "BUNDLE_UNREADABLE", "The bundle could not be read.")));
    stream.pipe(res);
  });

  // ── Team FoldX bundle (admin; `/admin` is already guarded by requireAdmin in admin.ts) ───────────
  apiRouter.get("/admin/tools/foldx", (_req, res) => {
    res.json({
      platforms: listFoldxBundles().map((b) => {
        const by = getUserById(b.uploadedBy);
        return { ...b, uploadedByName: by?.displayName ?? null };
      }),
    });
  });

  apiRouter.put("/admin/tools/foldx/:platform", async (req, res) => {
    const platform = req.params.platform;
    if (!isFoldxPlatform(platform)) return sendError(res, 400, "BAD_REQUEST", "platform must be win32, linux or darwin.");
    if (String(req.headers["x-foldx-licence-confirmed"] ?? "").toLowerCase() !== "yes") {
      return sendError(res, 400, "LICENCE_NOT_CONFIRMED", "Confirm that your FoldX licence permits sharing it with your team for research use.");
    }
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
      return sendError(res, 413, "TOO_LARGE", "That file is larger than any FoldX download.");
    }
    const temp = newUploadTempPath();
    const hash = crypto.createHash("sha256");
    let size = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(temp);
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_ARCHIVE_BYTES) {
            req.unpipe(out);
            out.destroy();
            reject(Object.assign(new Error("too large"), { tooLarge: true }));
            req.resume();
            return;
          }
          hash.update(chunk);
        });
        req.on("error", reject);
        out.on("error", reject);
        out.on("finish", resolve);
        req.pipe(out);
      });
    } catch (err: any) {
      fs.rmSync(temp, { force: true });
      return err?.tooLarge
        ? sendError(res, 413, "TOO_LARGE", "That file is larger than any FoldX download.")
        : sendError(res, 400, "UPLOAD_FAILED", "The upload did not complete. Try again.");
    }
    const check = await checkFoldxArchive(fs.readFileSync(temp), platform);
    if (!check.ok) {
      fs.rmSync(temp, { force: true });
      return sendError(res, 422, "NOT_FOLDX", check.problem);
    }
    const now = Date.now();
    const adminId = req.principal!.userId as string;
    const bundle = storeFoldxBundle({
      platform,
      tempFile: temp,
      sha256: hash.digest("hex"),
      sizeBytes: size,
      binaryName: check.plan.binaryName,
      expiry: check.plan.expiry,
      uploadedBy: adminId,
      now,
    });
    // The licence position is the admin's, recorded with who and when (plan decision 6).
    void AuditLogger.log("admin.foldx_bundle_uploaded", {
      adminId,
      platform,
      version: bundle.version,
      sha256: bundle.sha256,
      binaryName: bundle.binaryName,
      licenceConfirmed: true,
      licenceConfirmedAt: now,
      host: os.hostname(),
    });
    res.status(201).json({ bundle });
  });

  apiRouter.delete("/admin/tools/foldx", (req, res) => {
    const removed = revokeFoldxBundles();
    void AuditLogger.log("admin.foldx_bundle_revoked", { adminId: req.principal!.userId, platformsRemoved: removed });
    res.status(204).end();
  });
}

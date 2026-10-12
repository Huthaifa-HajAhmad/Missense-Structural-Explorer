/**
 * agent-registry.ts — paired computers as the server knows them (plan WP-F1).
 *
 * A computer ("agent") is a row in `agent_tokens` (accounts database): its owner, its name, a hash of
 * its token, and what it last said about itself (`host_json`, an `AgentHostReport`). This module turns
 * that into what the rest of the server needs:
 *
 *   - `AgentHostReport` validation (the report is untrusted input like everything an agent sends);
 *   - a `HostFeatures` for the placement engine, so a claim applies the SAME hard filters (tool present
 *     and verified, size under the class's learned ceiling, memory, owner, placement preference) that
 *     admission applies to the server;
 *   - the owner's view of their computers (`GET /me/agents`);
 *   - the timing contract: lease, heartbeat, long-poll length.
 *
 * Online is "called in within `AGENT_ONLINE_WINDOW_MS`"; a claim long-polls for up to 25 s, so a working
 * computer is seen at least that often.
 */
import crypto from "crypto";
import { z } from "zod";
import { hostClassOf, type HostFeatures } from "../../../src/shared/computeRouting.ts";
import {
  AGENT_ONLINE_WINDOW_MS,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  type AgentHostReport,
  type AgentView,
} from "../../../src/shared/agentProtocol.ts";
import { CONFIG } from "../../config.ts";
import type { AgentRow } from "../../auth/store.ts";
import type { SQLiteQueue } from "./biophysical-queue.ts";

/** Lease, heartbeat and long-poll timings, from the environment (plan section 8). */
export function agentTimings(): { leaseMs: number; heartbeatSec: number; claimWaitMaxSec: number } {
  const n = (name: string, fallback: number, min: number, max: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  };
  const heartbeatSec = n("AGENT_HEARTBEAT_SEC", 20, 5, 120);
  // The lease must outlast at least two heartbeats, or one late heartbeat would lose the job.
  const leaseSec = Math.max(n("AGENT_LEASE_SEC", 60, 15, 600), heartbeatSec * 2 + 5);
  return { leaseMs: leaseSec * 1000, heartbeatSec, claimWaitMaxSec: 25 };
}

const toolReport = z.object({
  state: z.enum(["ready", "installing", "missing", "failed"]),
  version: z.string().max(40).nullable(),
  detail: z.string().max(300).nullable(),
});

export const hostReportSchema = z.object({
  agentVersion: z.string().max(40),
  protocol: z.number().int().min(1).max(100),
  os: z.enum(["win32", "linux", "darwin"]),
  arch: z.enum(["x64", "arm64"]),
  cores: z.number().int().min(1).max(1024),
  totalRamBytes: z.number().finite().min(0).max(2 ** 50),
  freeRamBytes: z.number().finite().min(0).max(2 ** 50),
  paused: z.boolean(),
  tools: z.object({ foldx: toolReport, p2rank: toolReport }),
  foldxSource: z.enum(["team", "guided", "none"]),
  foldxBundleVersion: z.string().max(20).nullable(),
});

export function parseHostReport(raw: unknown): { ok: true; report: AgentHostReport } | { ok: false; message: string } {
  const parsed = hostReportSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, message: `The computer's report is not valid (${i?.path.join(".") || "report"}: ${i?.message ?? "invalid"}).` };
  }
  return { ok: true, report: parsed.data };
}

export function storedReport(row: AgentRow): AgentHostReport | null {
  if (!row.host_json) return null;
  try {
    const parsed = hostReportSchema.safeParse(JSON.parse(row.host_json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function isAgentOnline(row: Pick<AgentRow, "last_seen_at" | "revoked_at">, now = Date.now()): boolean {
  return row.revoked_at == null && row.last_seen_at != null && now - row.last_seen_at <= AGENT_ONLINE_WINDOW_MS;
}

/** Host class of a computer: agents run tools natively (never under Box64). */
export function agentHostClass(report: Pick<AgentHostReport, "arch" | "cores" | "totalRamBytes">): string {
  return hostClassOf({ arch: report.arch, emulated: false, cores: report.cores, totalRamBytes: report.totalRamBytes });
}

/** The tools this computer offers right now: only ones that passed their self-test, and only if not paused. */
export function offeredJobTypes(report: AgentHostReport): ("foldx" | "p2rank")[] {
  if (report.paused) return [];
  return (["foldx", "p2rank"] as const).filter((t) => report.tools[t].state === "ready" && report.tools[t].version);
}

/** This computer as a placement-engine host. */
export function agentHostFeatures(row: AgentRow, report: AgentHostReport, queue: SQLiteQueue | null, now = Date.now()): HostFeatures {
  // What is already running on it and placed on it, priced by the engine's own predictions (WP-G2), so a
  // second job does not see an idle computer when the first is still waiting for it.
  const load = queue?.agentLoad(row.id, now) ?? { runningJobs: 0, runningCostMs: 0, queuedCostMs: 0 };
  return {
    id: `agent:${row.id}`,
    kind: "agent",
    ownerId: row.user_id,
    label: row.name,
    online: isAgentOnline(row, now) && !report.paused,
    arch: report.arch,
    emulated: false,
    os: report.os,
    cores: report.cores,
    totalRamBytes: report.totalRamBytes,
    freeRamBytes: report.freeRamBytes,
    tools: offeredJobTypes(report).map((t) => ({ name: t, version: report.tools[t].version as string, verified: true, selfTest: "passed" as const })),
    runningJobs: load.runningJobs,
    runningCostMs: load.runningCostMs,
    queuedCostMs: load.queuedCostMs,
    linkRttMs: null,
    leaseLossRate: queue?.leaseLossRate(row.id) ?? 0,
    minFreeBytes: CONFIG.memory.minFreeBytes,
  };
}

/** One computer, as its owner sees it. */
export function agentView(row: AgentRow, queue: SQLiteQueue | null, now = Date.now()): AgentView {
  const report = storedReport(row);
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    online: isAgentOnline(row, now),
    paused: Boolean(report?.paused ?? row.paused),
    runningJobs: queue?.runningOnAgent(row.id) ?? 0,
    os: report?.os ?? null,
    totalRamBytes: report?.totalRamBytes ?? null,
    tools: report?.tools ?? null,
    foldxSource: report?.foldxSource ?? null,
    recent: queue?.agentRecentWork(row.id, 30, now) ?? null,
  };
}

/** A fresh pairing code, uniformly drawn (rejection sampling, so no letter is likelier than another). */
export function newPairingCode(): string {
  let code = "";
  const limit = 256 - (256 % PAIRING_ALPHABET.length);
  while (code.length < PAIRING_CODE_LENGTH) {
    for (const b of crypto.randomBytes(PAIRING_CODE_LENGTH * 2)) {
      if (b < limit && code.length < PAIRING_CODE_LENGTH) code += PAIRING_ALPHABET[b % PAIRING_ALPHABET.length];
    }
  }
  return code;
}

/** Pairing codes are stored hashed like every other credential. Namespaced so a code never equals a token's hash. */
export function pairingCodeHash(code: string): string {
  return crypto.createHash("sha256").update(`pairing:${code}`).digest("hex");
}

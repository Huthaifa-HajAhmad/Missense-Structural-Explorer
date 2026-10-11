/**
 * agent-jobs.ts — what the server does when a paired computer claims, finishes or gives up a job
 * (plan WP-F1).
 *
 * The rules, in one place:
 *
 *   CLAIM    A computer gets only the payload its job kind needs, never a server path: FoldX
 *            `{wtPdb, mutation, uniprotId, options}`, P2Rank `{pdbText, mutIndex, targetChain}`
 *            (decision 4: PDB text goes to the owner's own computer). For FoldX the server starts
 *            RaSP and StabilityOracle at once, beside the computer's FoldX run, exactly as its own
 *            worker does.
 *   RESULT   Untrusted input. `validateAgentResult` (agent-results.ts) must pass; then the result is
 *            stamped with agent provenance (`computedOn: "agent"`, `validated: true`, `shared` from the
 *            owner's `share_results`), written to the shared cache under a key that includes the tool
 *            version when it differs from the server's, finished like a server run, and completes the
 *            job. A result for a job that is no longer this computer's is a 409 and is discarded.
 *   INVALID  The attempt is recorded as `invalid_result` and the job goes to the server, once.
 *   FAILURE  Whatever the computer's reason (tool missing, out of memory, paused mid-job, a bad
 *            input), the job goes to the server, once. The computer is never trusted to fail a job for
 *            everyone: another person may have joined it, and the server's own run gives the true answer.
 */
import { CONFIG } from "../../config.ts";
import type { AgentHostReport } from "../../../src/shared/agentProtocol.ts";
import type { ComputeProvenance } from "../../../src/shared/computeProvenance.ts";
import { getUserById } from "../../auth/store.ts";
import { finishFoldxQueueJob, startFoldxCompanions } from "../stability/foldx-queue-job.ts";
import { writeMutantToCache } from "../stability/foldx/cache.ts";
import { pocketCache, pocketResultCacheKey } from "../structure/pocket/runner.ts";
import type { AgentClaimedJob, AgentHostStamp, SQLiteQueue } from "./biophysical-queue.ts";
import { agentHostClass } from "./agent-registry.ts";
import { validateFoldxAgentResult, validateP2RankAgentResult } from "./agent-results.ts";
import { buildFoldxCacheKey } from "./foldx-job-registry.ts";
import { serverToolVersion } from "./host-probe.ts";

/** The job as the computer receives it. */
export interface AgentJobPayload {
  id: string;
  type: "foldx" | "p2rank";
  payload: Record<string, unknown>;
  leaseExpiresAt: number;
  /** The job cap: the computer stops the tool and reports a timeout after this long. */
  deadlineMs: number;
}

/** The payload for a claimed job, or null when the stored job lacks what its kind needs. */
export function payloadFor(job: AgentClaimedJob): AgentJobPayload | null {
  const d = job.data ?? {};
  let payload: Record<string, unknown> | null = null;
  if (job.type === "foldx" && typeof d.wtPdb === "string" && typeof d.mutation === "string") {
    payload = { wtPdb: d.wtPdb, mutation: d.mutation, uniprotId: typeof d.uniprotId === "string" ? d.uniprotId : null, options: d.options ?? {} };
  } else if (job.type === "p2rank" && typeof d.pdbText === "string" && Number.isFinite(d.mutIndex)) {
    payload = { pdbText: d.pdbText, mutIndex: d.mutIndex, targetChain: typeof d.targetChain === "string" ? d.targetChain : null };
  }
  if (!payload) return null;
  const deadlineMs = (job.type === "foldx" ? CONFIG.timeouts.foldxSec : CONFIG.timeouts.p2rankSec) * 1000;
  return { id: job.id, type: job.type, payload, leaseExpiresAt: job.leaseExpiresAt, deadlineMs };
}

/** Side work the server does at claim time. Never throws into the claim. */
export function onAgentClaimed(job: AgentClaimedJob): void {
  if (job.type !== "foldx") return;
  void startFoldxCompanions(job.id, job.data).catch((err) => {
    console.warn(`[agent] Companion engines for ${job.id} failed to start:`, err?.message ?? err);
  });
}

export interface AgentResultBody {
  result: unknown;
  wallMs?: number | null;
  peakRssBytes?: number | null;
  toolVersion: string;
}

export type AgentResultOutcome =
  | { status: 200; accepted: true }
  | { status: 200; accepted: false; reasons: string[] }
  | { status: 409; reason: string }
  | { status: 404; reason: string };

/**
 * Telemetry for a computer's attempt is filed under `agent/<host class>`, never the bare class. A computer
 * reports its own cores and memory, so a bare class could be made to equal the server's (or a colleague's)
 * and teach it a false out-of-memory ceiling. Agent classes learn only from agents.
 */
export function agentTelemetryClass(report: AgentHostReport | null): string {
  return report ? `agent/${agentHostClass(report)}` : "agent/unknown";
}

function stamp(agentId: string, report: AgentHostReport | null, body: { wallMs?: number | null; peakRssBytes?: number | null; toolVersion?: string | null }): AgentHostStamp {
  const finiteOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const peak = finiteOrNull(body.peakRssBytes);
  return {
    hostId: `agent:${agentId}`,
    hostClass: agentTelemetryClass(report),
    wallMs: finiteOrNull(body.wallMs),
    // A peak above the memory the computer says it has is not a measurement.
    peakRssBytes: peak != null && report && peak > report.totalRamBytes ? null : peak,
    toolVersion: typeof body.toolVersion === "string" ? body.toolVersion.slice(0, 40) : null,
  };
}

/**
 * Cache-key version for an agent's result: none when the computer ran the same version as the server
 * (one tool, one result, shared under the existing key), its own version otherwise, so two versions
 * never answer for each other.
 */
function keyVersion(type: "foldx" | "p2rank", toolVersion: string): string | undefined {
  const server = serverToolVersion(type);
  // A server without the tool has no results of its own under the plain key, and the read paths look the
  // plain key up: a versioned key there would make the computer's result unreachable.
  return server == null || server === toolVersion ? undefined : toolVersion;
}

/**
 * May a computer's results be given to people other than its owner? Only when the workspace opts in
 * (`AGENT_SHARE_RESULTS=on`, off by default) AND the owner shares results. The server checks a computer's
 * result for shape and identity, not for whether the number is right: a modified agent could return a
 * plausible, wrong value, so sharing such results is a workspace decision, not a per-person default.
 */
export function agentResultsShareable(ownerId: string): boolean {
  if (!/^(1|on|true|yes)$/i.test((process.env.AGENT_SHARE_RESULTS ?? "").trim())) return false;
  return getUserById(ownerId)?.shareResults === true;
}

/** For the submit routes: may `requesterId` join (and so be given the result of) an in-flight job? */
export function agentJoinGuard(queue: { agentQueue(): SQLiteQueue | null }, requesterId: string | null): (jobId: string) => boolean {
  return (jobId) => {
    const sqlite = queue.agentQueue();
    return sqlite ? sqlite.mayJoin(jobId, requesterId, agentResultsShareable) : true;
  };
}

/** While the server finishes a validated FoldX result (companions, enrichment), the lease must not run out. */
const FINISH_LEASE_MS = 15 * 60 * 1000;

export async function acceptAgentResult(
  queue: SQLiteQueue,
  agent: { agentId: string; userId: string },
  report: AgentHostReport | null,
  jobId: string,
  body: AgentResultBody,
): Promise<AgentResultOutcome> {
  const job = await queue.getJob(jobId);
  if (!job) return { status: 404, reason: "No such job." };
  if (!queue.isClaimedBy(jobId, agent.agentId)) {
    return { status: 409, reason: "This job is no longer yours (it was cancelled, finished, or handed to the server). The result was discarded." };
  }
  const host = stamp(agent.agentId, report, body);
  const toolVersion = typeof body.toolVersion === "string" ? body.toolVersion : "";

  const validation =
    job.type === "foldx"
      ? validateFoldxAgentResult({ wtPdb: job.data?.wtPdb ?? "", mutation: job.data?.mutation ?? "" }, body.result, toolVersion)
      : validateP2RankAgentResult({ pdbText: job.data?.pdbText ?? "" }, body.result, toolVersion);
  if (!validation.ok) {
    console.warn(`[agent] ${host.hostId} sent an invalid ${job.type} result for ${jobId}: ${validation.reasons.join("; ")}`);
    queue.requeueAgentJobToServer(jobId, agent.agentId, { outcome: "invalid_result", telemetry: "failed", errorClass: "invalid_result", host });
    return { status: 200, accepted: false, reasons: validation.reasons };
  }

  const provenance: ComputeProvenance = {
    computedOn: "agent",
    hostClass: report ? agentHostClass(report) : null,
    toolVersion,
    ownerId: agent.userId,
    shared: agentResultsShareable(agent.userId),
    validated: true,
  };

  if (job.type === "p2rank") {
    const result = { ...validation.result, computeProvenance: provenance };
    const d = job.data ?? {};
    pocketCache.set(pocketResultCacheKey(d.pdbText, d.mutIndex, d.targetChain ?? undefined, keyVersion("p2rank", toolVersion)), result);
    return queue.completeAgentJob(jobId, agent.agentId, result, host)
      ? { status: 200, accepted: true }
      : { status: 409, reason: "This job is no longer yours. The result was discarded." };
  }

  // FoldX: keep the job this computer's while the server finishes it, so the lease cannot run out mid-way.
  if (queue.renewAgentLease(jobId, agent.agentId, FINISH_LEASE_MS) == null) {
    return { status: 409, reason: "This job is no longer yours. The result was discarded." };
  }
  const foldxResult = { ...validation.result, computeProvenance: provenance };
  const d = job.data ?? {};
  try {
    writeMutantToCache(buildFoldxCacheKey(d.wtPdb, d.mutation, { ...(d.options ?? {}), toolVersion: keyVersion("foldx", toolVersion) }), foldxResult);
  } catch (err: any) {
    console.warn(`[agent] Could not cache ${jobId}'s result:`, err?.message ?? err);
  }
  const final = await finishFoldxQueueJob(jobId, d, foldxResult, startFoldxCompanions(jobId, d));
  if (final && typeof final === "object") final.computeProvenance = provenance;
  return queue.completeAgentJob(jobId, agent.agentId, final, host)
    ? { status: 200, accepted: true }
    : { status: 409, reason: "This job was cancelled while its result was being stored. The result was discarded." };
}

/** Why a computer gave a job back; free text is never trusted, this is. */
export const AGENT_FAILURE_CLASSES = ["tool_missing", "tool_failed", "oom", "timeout", "aborted", "input", "other"] as const;
export type AgentFailureClass = (typeof AGENT_FAILURE_CLASSES)[number];

export function acceptAgentFailure(
  queue: SQLiteQueue,
  agent: { agentId: string },
  report: AgentHostReport | null,
  jobId: string,
  body: { errorClass: AgentFailureClass; message?: string; wallMs?: number | null; peakRssBytes?: number | null; toolVersion?: string | null },
): { status: 200 | 409; handedToServer: boolean } {
  const host = stamp(agent.agentId, report, body);
  const telemetry = body.errorClass === "oom" ? "oom" : body.errorClass === "timeout" ? "timeout" : body.errorClass === "aborted" ? "cancelled" : "failed";
  const ok = queue.requeueAgentJobToServer(jobId, agent.agentId, {
    outcome: body.errorClass === "aborted" ? "cancelled" : "requeued",
    telemetry,
    errorClass: `agent:${body.errorClass}`,
    host,
  });
  if (ok) console.log(`[agent] ${host.hostId} gave ${jobId} back (${body.errorClass}); the server will run it.`);
  return ok ? { status: 200, handedToServer: true } : { status: 409, handedToServer: false };
}

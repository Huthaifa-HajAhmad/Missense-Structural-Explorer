import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { DatabaseSync } from "node:sqlite";
import { Queue, Worker } from "bullmq";
import { CONFIG, resolveFoldxConcurrency } from "../../config.ts";
import { initialDeploymentPaused } from "../../deployment-role.ts";
import { LEGACY_OWNER, NEWCOMER_RESERVE, SYSTEM_OWNER, SYSTEM_PRIORITY, QueueLimitError, type SubmitterLimits } from "./queue-owners.ts";
import { CostModelCache, ensureTelemetryTable, recordTelemetry } from "./compute-telemetry.ts";
import { runInJobMeter } from "./job-meter.ts";
import { ProcessTreeSampler } from "./process-sampler.ts";
import { classifyJobFailure, DID_NOT_FIT_IN_MEMORY } from "./failure-class.ts";
import { AdmissionError, ceilingRefusal, decide, logShadow, routingMode, type AdmissionInput } from "./admission.ts";
import { probeServerHost, serverHostFacts, serverProvenance, serverToolVersion, SERVER_HOST_ID } from "./host-probe.ts";
import { foldxRepairApplies, hostClassOf, type CostModels, type JobType, type PlacementPref } from "../../../src/shared/computeRouting.ts";

export interface QueueJob {
  id: string;
  type: "foldx" | "p2rank";
  data: any;
  status: "queued" | "running" | "completed" | "failed";
  result?: any;
  error?: string;
  createdAt: number;
  /** When the queue started EXECUTING this job; null while it is still queued. */
  startedAt?: number | null;
  /** Who submitted it: a user id, `system` (pre-warm) or `legacy` (rows from before accounts). */
  ownerId?: string;
  priority?: number;
  costEstimateMs?: number | null;
  /** `agent:<id>` while (or after) a paired computer ran it; null when the server did. */
  claimedBy?: string | null;
  residues?: number | null;
}

/**
 * Rows the SERVER is (or was) executing, as opposed to a paired computer (WP-F). An agent's job is not
 * server load: it holds no server slot, is not ahead of anyone in the server's queue, and its time is
 * never counted against a person's server time (plan 4.4: "Agent compute is never counted against the
 * server"). `claimed_by` stays set on a job an agent finished, so the history stays attributable.
 */
const ON_SERVER = "(claimed_by IS NULL OR claimed_by NOT LIKE 'agent:%')";

/**
 * Queued rows the server may start. A job PLACED on a paired computer (`placement = 'agent:<id>'`, set by
 * live routing, WP-G) waits for that computer; the agent registry clears the placement if the computer
 * goes away, so such a job can never wait forever.
 */
const SERVER_CLAIMABLE = "(placement IS NULL OR placement NOT LIKE 'agent:%')";

/**
 * A lease longer than this is the server's own "finish" lease on a delivered result (agent-jobs.ts,
 * 15 min), never a heartbeat lease (`AGENT_LEASE_SEC` is capped at 600 s).
 */
const FINISHING_LEASE_FLOOR_MS = 10 * 60 * 1000;

/** A computer's job is handed back after this long even if it keeps renewing its lease: the job cap plus slack. */
function agentHardCapMs(type: string): number {
  return (type === "foldx" ? CONFIG.timeouts.foldxSec : CONFIG.timeouts.p2rankSec) * 1000 + 60_000;
}

/** What an agent is handed when it claims a job (`SQLiteQueue.claimForAgent`). */
export interface AgentClaimedJob {
  id: string;
  type: "foldx" | "p2rank";
  data: any;
  ownerId: string;
  residues: number | null;
  repaired: boolean | null;
  leaseExpiresAt: number;
}

/** How an agent's claim ended, for its lease-loss rate (the engine's reliability penalty). */
export type AgentClaimOutcome = "completed" | "failed" | "requeued" | "lease_lost" | "over_cap" | "disconnected" | "invalid_result" | "cancelled";

/** The host an agent ran on, for its telemetry row. */
export interface AgentHostStamp {
  hostId: string;
  hostClass: string;
  wallMs: number | null;
  peakRssBytes: number | null;
  toolVersion: string | null;
}

export { LEGACY_OWNER, SYSTEM_OWNER, SYSTEM_PRIORITY, QueueLimitError, AdmissionError };

export interface EnqueueOptions {
  ownerId?: string;
  priority?: number;
  costEstimateMs?: number | null;
  placement?: string | null;
  /** The submitter's own limits; omitted for unowned work, which only meets the host backstop. */
  limits?: SubmitterLimits;
  /** Residues of the structure the job will run on; 0/absent = unknown (admission is then skipped). */
  residues?: number;
  /** FoldX skips RepairPDB on AlphaFold models; needed to predict and to record what ran. */
  isAlphaFoldModel?: boolean;
  /** The submitter's placement preference (accounts); the engine reads it once agents exist. */
  placementPref?: PlacementPref;
}

export interface JobSummary {
  id: string;
  type: "foldx" | "p2rank";
  status: QueueJob["status"];
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error?: string;
  /** The caller's own id when they own it; null when they only joined someone else's. */
  ownerId: string | null;
  /** True when the caller owns the job; false when they only joined it. */
  mine: boolean;
  /** Jobs ahead of this one while it is queued; null otherwise. */
  queuedAhead: number | null;
  /** Estimated wait before it starts, while queued; null when unknown or not waiting (see `getEta`). */
  etaMs: number | null;
  /**
   * How long it has been running, measured on the HOST that started it, or null when it is not running.
   * The client must not subtract the server's `startedAt` from its own clock (a lagging clock reads
   * "under a minute" forever), so the elapsed time travels as a duration.
   */
  elapsedMs: number | null;
  /** Short human label taken from the job's own input (mutation / protein), when it has one. */
  label: string | null;
  /**
   * How many people are waiting on this job, the owner included (each is a watcher row). More than one
   * means somebody else asked for the same result, so stopping it here would only remove THIS person's
   * interest — the row says so before they click, and the owner is told too (they are a watcher as well).
   * A count, not a list: another person's identity is not the caller's business.
   */
  watchers: number;
}

export type CancelOutcome =
  | { ok: true; aborted: boolean; remainingWatchers: number }
  | { ok: false; reason: "not_found" | "forbidden" | "finished" };

export class SQLiteQueue {
  private db: DatabaseSync;
  private concurrency: number;
  private runningCount = 0;
  private activeJobs = new Map<string, { abortController?: AbortController; meter?: ProcessTreeSampler }>();
  private processCallback: (type: string, data: any, signal?: AbortSignal, jobId?: string) => Promise<any>;

  private timer: NodeJS.Timeout | null = null;
  private reaperInterval: NodeJS.Timeout | null = null;
  private isShutdown = false;
  private processingPaused: boolean;
  private costModels!: CostModelCache;
  private lastStartedAt = 0;
  private lastPrunedAt = 0;

  constructor(
    dbPath: string,
    concurrency: number,
    processCallback: (type: string, data: any, signal?: AbortSignal, jobId?: string) => Promise<any>,
    paused = false
  ) {
    this.processingPaused = paused;
    this.concurrency = concurrency;
    this.processCallback = processCallback;

    if (dbPath !== ":memory:") {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS biophysical_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );
    `);
    this.migrateOwnership();
    ensureTelemetryTable(this.db);
    this.costModels = new CostModelCache(this.db);

    // A standby shares the database with the serving process. Its running jobs are still alive.
    if (!paused) this.recoverInterruptedJobs();
    this.scheduleNext();
    if (!paused) this.startReaper();
  }

  /**
   * Additive migration. `CREATE TABLE IF NOT EXISTS` never adds a column to a table that already
   * exists, so a database written by an earlier version gets each column here, once. Existing rows
   * take the column default, which is what makes them `legacy` rather than ownerless.
   */
  private migrateOwnership() {
    const have = new Set((this.db.prepare("PRAGMA table_info(biophysical_jobs)").all() as any[]).map(c => c.name));
    const add = (name: string, ddl: string) => {
      if (!have.has(name)) this.db.exec(`ALTER TABLE biophysical_jobs ADD COLUMN ${name} ${ddl}`);
    };
    add("owner_id", `TEXT NOT NULL DEFAULT '${LEGACY_OWNER}'`);
    add("priority", "INTEGER NOT NULL DEFAULT 0");
    add("cost_estimate_ms", "INTEGER");
    add("placement", "TEXT");
    add("lease_expires_at", "INTEGER");
    add("claimed_by", "TEXT");
    add("residues", "INTEGER");
    // When a job last went back to waiting after a paired computer gave it up (WP-F). The stale-queued
    // reaper measures the wait from here, not from submission: a computer takes a job only while the
    // server is busy, so on hand-back the server usually still is, and the original clock may be spent.
    add("requeued_at", "INTEGER");
    add("repaired", "INTEGER");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_owner_status ON biophysical_jobs(owner_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_owner_started ON biophysical_jobs(owner_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON biophysical_jobs(status, created_at);
      CREATE TABLE IF NOT EXISTS job_watchers (
        job_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (job_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_job_watchers_user ON job_watchers(user_id);
      CREATE TABLE IF NOT EXISTS agent_claims (
        job_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        ended_at INTEGER,
        outcome TEXT,
        PRIMARY KEY (job_id, claimed_at)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_claims_agent ON agent_claims(agent_id, claimed_at);
    `);
  }

  private recoverInterruptedJobs() {
    // Reset any running jobs from a previous crash/restart back to queued status.
    //
    // The phase is cleared with it. A job re-queued by a restart has NOT been repaired or modelled,
    // and leaving the old phase in the record made the poll route report "Structure repair —
    // repacking side chains" for work that was waiting for a worker slot.
    //
    // A job a paired computer holds under a LIVE lease is not interrupted: the computer is still working
    // on it and will heartbeat this (new) process. It is left running; if its lease runs out, the lease
    // reaper hands it back to the server.
    const interrupted = `status = 'running' AND (${ON_SERVER} OR lease_expires_at IS NULL OR lease_expires_at < ${Date.now()})`;
    try {
      const requeued = this.db.prepare(`SELECT id, data FROM biophysical_jobs WHERE ${interrupted}`).all() as any[];
      for (const row of requeued) {
        try {
          const data = JSON.parse(row.data);
          delete data.phase;
          delete data.phaseAt;
          this.db.prepare("UPDATE biophysical_jobs SET data = ? WHERE id = ?").run(JSON.stringify(data), row.id);
        } catch (_) {
          // A record that cannot be parsed must still be re-queued, not left running forever.
        }
      }
    } catch (err: any) {
      console.warn("[Queue] Failed to clear stale phases on startup:", err.message);
    }
    // A paired computer whose lease ran out while the server was down lost that job: it goes to the server
    // like any other hand-back (placement 'server', a fresh wait clock), and the loss is recorded.
    const now = Date.now();
    try {
      for (const row of this.db.prepare(`SELECT id, claimed_by FROM biophysical_jobs WHERE ${interrupted} AND claimed_by LIKE 'agent:%'`).all() as any[]) {
        this.endClaim(row.id, String(row.claimed_by).slice("agent:".length), "lease_lost", now);
        this.db.prepare("UPDATE biophysical_jobs SET placement = 'server', requeued_at = ? WHERE id = ?").run(now, row.id);
      }
    } catch (err: any) {
      console.warn("[Queue] Failed to hand expired agent jobs to the server on startup:", err.message);
    }
    // Lease and placement go too: a re-queued job is decided again, never left "leased" to an agent. A job
    // marked for the server just above keeps that placement.
    this.db.exec(`
      UPDATE biophysical_jobs
      SET status = 'queued', started_at = NULL, lease_expires_at = NULL, claimed_by = NULL,
          placement = CASE WHEN placement = 'server' THEN 'server' ELSE NULL END
      WHERE ${interrupted};
    `);

  }

  get activeCount(): number { return this.activeJobs.size; }
  get paused(): boolean { return this.processingPaused; }

  pauseProcessing(): void {
    this.processingPaused = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.reaperInterval) clearInterval(this.reaperInterval);
    this.timer = null;
    this.reaperInterval = null;
  }

  resumeProcessing(): void {
    if (this.isShutdown) throw new Error("Cannot resume a closed queue");
    if (!this.processingPaused) return;
    // Ownership transfers only after the old process drains. Never reset another process's jobs.
    this.processingPaused = false;
    this.startReaper();
    this.scheduleNext();
  }

  async addJob(id: string, type: "foldx" | "p2rank", data: any, opts: EnqueueOptions = {}): Promise<void> {
    const now = Date.now();
    const owner = opts.ownerId || LEGACY_OWNER;
    this.db.prepare(`
      INSERT INTO biophysical_jobs (id, type, data, status, created_at, owner_id, priority, cost_estimate_ms, placement, residues, repaired)
      VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, type, JSON.stringify(data), now, owner,
      opts.priority ?? (owner === SYSTEM_OWNER ? SYSTEM_PRIORITY : 0),
      opts.costEstimateMs ?? null, opts.placement ?? null,
      opts.residues && opts.residues > 0 ? opts.residues : null,
      type === "foldx" && opts.residues && opts.residues > 0 ? (foldxRepairApplies(opts.residues, Boolean(opts.isAlphaFoldModel)) ? 1 : 0) : null,
    );
    // The submitter is the first watcher: cancelling "my watch" then means the same thing for the
    // person who started a job and for someone who later joins it.
    if (owner !== LEGACY_OWNER && owner !== SYSTEM_OWNER) this.addWatcher(id, owner);

    this.scheduleNext();
  }

  /**
   * `userId` now waits on this job. Background (pre-warm) work that a person is waiting on stops
   * being background: it is lifted to the default priority so it is not stuck behind other
   * people's newer jobs, while still rotating under its own owner.
   */
  addWatcher(jobId: string, userId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO job_watchers (job_id, user_id) VALUES (?, ?)").run(jobId, userId);
    this.db.prepare("UPDATE biophysical_jobs SET priority = 0 WHERE id = ? AND status = 'queued' AND priority = ?").run(jobId, SYSTEM_PRIORITY);
  }

  watchersOf(jobId: string): string[] {
    return (this.db.prepare("SELECT user_id FROM job_watchers WHERE job_id = ? ORDER BY user_id").all(jobId) as any[]).map(r => r.user_id);
  }

  /**
   * Server time this owner's jobs have used since `since` (ms), counting the running part of jobs
   * still running. Failed and cancelled jobs count too: the host spent the time either way.
   */
  serverMsSince(ownerId: string, since: number, now = Date.now()): number {
    const row = this.db.prepare(`
      SELECT coalesce(sum(max(0, coalesce(completed_at, ?) - max(started_at, ?))), 0) AS ms
      FROM biophysical_jobs
      WHERE owner_id = ? AND started_at IS NOT NULL AND coalesce(completed_at, ?) > ? AND ${ON_SERVER}
    `).get(now, since, ownerId, now, since) as any;
    return row?.ms ?? 0;
  }

  /**
   * How many OTHER parties have jobs waiting: people, plus unowned (`legacy`) work. Background
   * pre-warm does not count; it always yields to people anyway.
   */
  othersWaiting(ownerId: string): number {
    const row = this.db.prepare(`
      SELECT count(DISTINCT owner_id) AS c FROM biophysical_jobs
      WHERE status = 'queued' AND owner_id != ? AND owner_id != ?
    `).get(ownerId, SYSTEM_OWNER) as any;
    return row?.c ?? 0;
  }

  /**
   * Predicted server time of this owner's jobs that have not finished yet, beyond what they have
   * already used: the estimate of every waiting job plus the remaining estimate of every running one.
   * Charged against the daily cap at submit, so a burst queued before anything starts cannot overrun it.
   */
  pendingEstimateMsFor(ownerId: string, now = Date.now()): number {
    let ms = 0;
    for (const r of this.db.prepare(`
      SELECT status, cost_estimate_ms AS c, started_at AS s FROM biophysical_jobs
      WHERE owner_id = ? AND status IN ('queued', 'running') AND cost_estimate_ms IS NOT NULL AND ${ON_SERVER}
    `).all(ownerId) as any[]) {
      ms += r.status === "queued" ? r.c : Math.max(0, r.c - (now - (r.s ?? now)));
    }
    return ms;
  }

  /** Queued jobs this owner has waiting (running ones are not counted against the queue limit). */
  countQueuedFor(ownerId: string): number {
    const row = this.db.prepare("SELECT count(*) AS c FROM biophysical_jobs WHERE owner_id = ? AND status = 'queued'").get(ownerId) as any;
    return row?.c ?? 0;
  }

  addCompletedJob(id: string, type: "foldx" | "p2rank", data: any, result: any): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO biophysical_jobs (id, type, data, status, result, created_at, completed_at)
      VALUES (?, ?, ?, 'completed', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = 'completed',
        result = excluded.result,
        completed_at = excluded.completed_at
    `).run(id, type, JSON.stringify(data), JSON.stringify(result), now, now);
  }

  getJobCount(status?: string): number {
    if (status) {
      const row = this.db.prepare("SELECT count(*) as count FROM biophysical_jobs WHERE status = ?").get(status) as any;
      return row ? row.count : 0;
    }
    // The host backstop: jobs running on a paired computer hold no server slot and do not count.
    const row = this.db.prepare(`SELECT count(*) as count FROM biophysical_jobs WHERE status IN ('queued', 'running') AND ${ON_SERVER}`).get() as any;
    return row ? row.count : 0;
  }

  async getJob(id: string): Promise<QueueJob | null> {
    const row = this.db.prepare("SELECT * FROM biophysical_jobs WHERE id = ?").get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      type: row.type as any,
      data: JSON.parse(row.data),
      status: row.status as any,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error || undefined,
      createdAt: row.created_at,
      startedAt: row.started_at ?? null,
      ownerId: row.owner_id ?? LEGACY_OWNER,
      priority: row.priority ?? 0,
      costEstimateMs: row.cost_estimate_ms ?? null,
      claimedBy: row.claimed_by ?? null,
      residues: row.residues ?? null,
    };
  }

  updateJobData(id: string, data: any): void {
    this.db.prepare(`
      UPDATE biophysical_jobs
      SET data = ?
      WHERE id = ?
    `).run(JSON.stringify(data), id);
  }

  /**
   * Records which stage the running job is in, and when it entered it.
   *
   * Read-modify-write on the job's own data column, like every other remote-data update in this
   * codebase, rather than a schema change: the column is the job record's single extension point
   * and a new table for one string would have to be migrated on every deployment.
   */
  updateJobPhase(id: string, phase: string): void {
    const row = this.db.prepare("SELECT data FROM biophysical_jobs WHERE id = ?").get(id) as any;
    if (!row) return;
    try {
      const data = JSON.parse(row.data);
      data.phase = phase;
      data.phaseAt = Date.now();
      this.db.prepare("UPDATE biophysical_jobs SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
    } catch (err: any) {
      // A job row that cannot be annotated must not fail the job it describes.
      console.warn(`[Queue] Failed to record phase "${phase}" for ${id}:`, err.message);
    }
  }

  /**
   * Queued jobs in the order the scheduler will start them, given nothing finishes in between.
   *
   * This is the same rule `pickNext` applies in SQL, applied repeatedly in memory: highest priority,
   * then the owner with the fewest running jobs, then the owner served least recently, then the owner
   * whose oldest queued job is oldest, then that owner's oldest job. Picking a job makes its owner
   * "running" and "just served", exactly as claiming it would. A test drains the real scheduler and
   * compares, so the two cannot drift apart.
   */
  private queuedInStartOrder(): { id: string; ownerId: string; type: JobType; costEstimateMs: number | null }[] {
    const rows = this.db.prepare(`
      SELECT id, owner_id, type, priority, cost_estimate_ms, created_at, rowid AS rid
      FROM biophysical_jobs WHERE status = 'queued' AND ${SERVER_CLAIMABLE} LIMIT 1000
    `).all() as any[];
    if (rows.length === 0) return [];
    const running = new Map<string, number>();
    for (const r of this.db.prepare(`SELECT owner_id, count(*) AS c FROM biophysical_jobs WHERE status = 'running' AND ${ON_SERVER} GROUP BY owner_id`).all() as any[]) {
      running.set(r.owner_id, r.c);
    }
    const served = new Map<string, number>();
    for (const r of this.db.prepare(`SELECT owner_id, max(started_at) AS s FROM biophysical_jobs WHERE started_at IS NOT NULL AND ${ON_SERVER} GROUP BY owner_id`).all() as any[]) {
      served.set(r.owner_id, r.s ?? 0);
    }
    let tick = Number.MAX_SAFE_INTEGER - rows.length - 1; // after every real timestamp, increasing
    const remaining = rows.slice();
    const order: { id: string; ownerId: string; type: JobType; costEstimateMs: number | null }[] = [];
    while (remaining.length) {
      const oldestOf = new Map<string, number>();
      for (const r of remaining) {
        const cur = oldestOf.get(r.owner_id);
        if (cur === undefined || r.created_at < cur) oldestOf.set(r.owner_id, r.created_at);
      }
      let best = 0;
      for (let i = 1; i < remaining.length; i++) {
        const a = remaining[i], b = remaining[best];
        const cmp =
          (b.priority - a.priority) ||
          ((running.get(a.owner_id) ?? 0) - (running.get(b.owner_id) ?? 0)) ||
          ((served.get(a.owner_id) ?? 0) - (served.get(b.owner_id) ?? 0)) ||
          (oldestOf.get(a.owner_id)! - oldestOf.get(b.owner_id)!) ||
          (a.created_at - b.created_at) ||
          (a.rid - b.rid);
        if (cmp < 0) best = i;
      }
      const [pick] = remaining.splice(best, 1);
      running.set(pick.owner_id, (running.get(pick.owner_id) ?? 0) + 1);
      served.set(pick.owner_id, ++tick);
      order.push({ id: pick.id, ownerId: pick.owner_id, type: pick.type, costEstimateMs: pick.cost_estimate_ms ?? null });
    }
    return order;
  }

  /**
   * Jobs ahead of this one in the queue, or `null` when the store cannot answer.
   *
   * A queued job's place follows the scheduler's real order (`queuedInStartOrder`), not arrival
   * time: with several people waiting, a later job can start first, and a number computed from
   * `created_at` would then be a claim about the queue that was false. Running jobs count as ahead,
   * as they always have. A job that is no longer queued keeps the arrival-order answer.
   */
  getQueuePosition(id: string): number | null {
    try {
      const row = this.db.prepare("SELECT created_at, rowid, status FROM biophysical_jobs WHERE id = ?").get(id) as any;
      if (!row) return null;
      if (row.status === "queued") {
        const running = (this.db.prepare(`SELECT count(*) AS c FROM biophysical_jobs WHERE status = 'running' AND ${ON_SERVER}`).get() as any).c as number;
        const idx = this.queuedInStartOrder().findIndex(j => j.id === id);
        return idx < 0 ? null : running + idx;
      }
      const ahead = this.db.prepare(`
        SELECT count(*) AS count FROM biophysical_jobs
        WHERE status IN ('queued', 'running')
          AND (created_at < ? OR (created_at = ? AND rowid <= ?)) AND ${ON_SERVER}
      `).get(row.created_at, row.created_at, row.rowid) as any;
      return ahead ? Math.max(0, ahead.count - 1) : 0;
    } catch {
      return null;
    }
  }

  /**
   * Estimated wait before a queued job starts, from the cost estimates of what is ahead of it.
   * `waitMs` is `null` when any job ahead has no estimate: a partial sum would read as a promise.
   *
   * The divisor is the number of slots the job's OWN tool can use, not the queue's bound. FoldX takes
   * a semaphore of its own (`resolveFoldxConcurrency`: 1 on the 2-core server, because FoldX is
   * CPU-bound and two Box64 processes only slow each other). The queue still claims up to
   * `concurrency` jobs, so four FoldX jobs can be "running" with three of them blocked on the
   * semaphore — dividing their cost by 4 reported a quarter of the real wait, and the client shows
   * this number ("starts in about 4 min"). P2Rank does not take that semaphore, so it keeps the
   * queue bound.
   *
   * Work of the other tool is not counted as ahead for this reason: it never holds the slot this job
   * is waiting for. (It does share the CPU, which this model deliberately does not attempt to price.)
   */
  getEta(id: string): { waitMs: number | null; runMs: number | null } | null {
    try {
      const row = this.db.prepare("SELECT status, type, cost_estimate_ms FROM biophysical_jobs WHERE id = ?").get(id) as any;
      if (!row) return null;
      const runMs = row.cost_estimate_ms ?? null;
      if (row.status !== "queued") return { waitMs: 0, runMs };
      const isFoldx = row.type === "foldx";
      // FoldX can only use as many processes as BOTH the queue bound and its own semaphore allow.
      const slots = isFoldx
        ? Math.max(1, Math.min(this.concurrency, resolveFoldxConcurrency()))
        : Math.max(1, this.concurrency);
      const now = Date.now();
      let total = 0;
      let known = true;
      for (const r of this.db.prepare(`SELECT type, cost_estimate_ms AS c, started_at AS s FROM biophysical_jobs WHERE status = 'running' AND ${ON_SERVER}`).all() as any[]) {
        if (isFoldx && r.type !== "foldx") continue;
        if (r.c == null) known = false;
        else total += Math.max(0, r.c - (now - (r.s ?? now)));
      }
      let found = false;
      for (const j of this.queuedInStartOrder()) {
        if (j.id === id) { found = true; break; }
        if (isFoldx && j.type !== "foldx") continue;
        if (j.costEstimateMs == null) known = false;
        else total += j.costEstimateMs;
      }
      if (!found) return { waitMs: 0, runMs }; // claimed between the two reads
      return { waitMs: known ? Math.round(total / slots) : null, runMs };
    } catch {
      return null;
    }
  }

  /**
   * Removes `userId`'s interest in a job, and stops the job when nobody else is waiting for it.
   *
   * The owner and anyone who joined are all watchers, so "cancel" never destroys work another
   * person is waiting on. An administrator who is not a watcher stops the job outright.
   */
  cancelFor(id: string, userId: string, isAdmin: boolean): CancelOutcome {
    const row = this.db.prepare("SELECT status, owner_id FROM biophysical_jobs WHERE id = ?").get(id) as any;
    if (!row) return { ok: false, reason: "not_found" };
    const watchers = this.watchersOf(id);
    const mine = row.owner_id === userId || watchers.includes(userId);
    if (!mine && !isAdmin) return { ok: false, reason: "forbidden" };
    if (row.status !== "queued" && row.status !== "running") return { ok: false, reason: "finished" };
    if (mine && !isAdmin) {
      this.db.prepare("DELETE FROM job_watchers WHERE job_id = ? AND user_id = ?").run(id, userId);
      const left = this.watchersOf(id).length;
      if (left > 0) return { ok: true, aborted: false, remainingWatchers: left };
    }
    this.stopJob(id, "Cancelled.");
    this.db.prepare("DELETE FROM job_watchers WHERE job_id = ?").run(id);
    return { ok: true, aborted: true, remainingWatchers: 0 };
  }

  /**
   * Withdraws `userId` from every job they own or joined that has not finished, stopping those
   * nobody else is waiting for. Used when an account is disabled. Returns how many jobs stopped.
   */
  cancelAllFor(userId: string): number {
    const ids = (this.db.prepare(`
      SELECT id FROM biophysical_jobs
      WHERE status IN ('queued', 'running')
        AND (owner_id = ? OR id IN (SELECT job_id FROM job_watchers WHERE user_id = ?))
    `).all(userId, userId) as any[]).map(r => r.id as string);
    let stopped = 0;
    for (const id of ids) {
      const outcome = this.cancelFor(id, userId, false);
      if (outcome.ok && outcome.aborted) stopped++;
    }
    return stopped;
  }

  /** Ends a queued or running job as failed with `reason`; a running one is also aborted. */
  private stopJob(id: string, reason: string) {
    // A paired computer learns of the stop at its next heartbeat (410) and kills its tool then.
    const holder = (this.db.prepare("SELECT claimed_by FROM biophysical_jobs WHERE id = ? AND status = 'running'").get(id) as any)?.claimed_by;
    if (typeof holder === "string" && holder.startsWith("agent:")) this.endClaim(id, holder.slice("agent:".length), "cancelled", Date.now());
    this.db.prepare(`
      UPDATE biophysical_jobs SET status = 'failed', error = ?, completed_at = ?
      WHERE id = ? AND status IN ('queued', 'running')
    `).run(reason, Date.now(), id);
    this.abortJob(id);
    this.scheduleNext();
  }

  /** Jobs this user submitted or joined, newest first. */
  listFor(userId: string, limit = 50): JobSummary[] {
    const rows = this.db.prepare(`
      SELECT * FROM biophysical_jobs
      WHERE owner_id = ? OR id IN (SELECT job_id FROM job_watchers WHERE user_id = ?)
      ORDER BY created_at DESC, rowid DESC LIMIT ?
    `).all(userId, userId, limit) as any[];
    const anyQueued = rows.some(r => r.status === "queued");
    const queued = anyQueued ? this.queuedInStartOrder() : [];
    const running = anyQueued
      ? (this.db.prepare(`SELECT count(*) AS c FROM biophysical_jobs WHERE status = 'running' AND ${ON_SERVER}`).get() as any).c as number
      : 0;
    // One grouped query for every row's watcher count, so a row can say whether stopping it here would
    // stop the work for anyone else (the owner is a watcher too: see `addJob`).
    const watcherCounts = new Map<string, number>();
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const holders = ids.map(() => "?").join(",");
      for (const w of this.db.prepare(`SELECT job_id, count(*) AS c FROM job_watchers WHERE job_id IN (${holders}) GROUP BY job_id`).all(...ids) as any[]) {
        watcherCounts.set(w.job_id as string, w.c as number);
      }
    }
    return rows.map(r => {
      let label: string | null = null;
      try {
        const d = JSON.parse(r.data);
        label = typeof d.mutation === "string" ? d.mutation : typeof d.uniprotId === "string" ? d.uniprotId : null;
      } catch { /* unparseable data only loses the label */ }
      const idx = r.status === "queued" ? queued.findIndex(j => j.id === r.id) : -1;
      return {
        id: r.id,
        type: r.type,
        status: r.status,
        createdAt: r.created_at,
        startedAt: r.started_at ?? null,
        completedAt: r.completed_at ?? null,
        error: r.error || undefined,
        // Another person's internal id is not the caller's business; "mine: false" says what matters.
        ownerId: r.owner_id === userId ? userId : null,
        mine: r.owner_id === userId,
        queuedAhead: idx < 0 ? null : running + idx,
        etaMs: r.status === "queued" ? (this.getEta(r.id)?.waitMs ?? null) : null,
        elapsedMs: r.status === "running" && r.started_at ? Math.max(0, Date.now() - r.started_at) : null,
        label,
        watchers: watcherCounts.get(r.id) ?? 0,
      };
    });
  }

  abortJob(id: string) {
    const active = this.activeJobs.get(id);
    if (active && active.abortController) {
      console.log(`[Queue] Aborting SQLite job: ${id}`);
      active.abortController.abort();
    }
  }

  private scheduleNext(delayMs = 50) {
    if (this.isShutdown || this.processingPaused) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.processQueue(), delayMs);
    this.timer.unref();
  }

  /** What the server is doing now, for the engine: running jobs and the predicted cost of running and waiting work. */
  loadSnapshot(now = Date.now()): { runningJobs: number; runningCostMs: number; queuedCostMs: number } {
    let runningCostMs = 0;
    for (const r of this.db.prepare(`SELECT cost_estimate_ms AS c, started_at AS s FROM biophysical_jobs WHERE status = 'running' AND ${ON_SERVER}`).all() as any[]) {
      if (r.c != null) runningCostMs += Math.max(0, r.c - (now - (r.s ?? now)));
    }
    const queued = this.db.prepare("SELECT coalesce(sum(cost_estimate_ms), 0) AS c FROM biophysical_jobs WHERE status = 'queued'").get() as any;
    return { runningJobs: this.activeJobs.size, runningCostMs, queuedCostMs: queued?.c ?? 0 };
  }

  /** The learned cost models (wall-time curves, size ceilings) for this database's telemetry. */
  getCostModels(): CostModels {
    return this.costModels.get();
  }

  /**
   * One telemetry row for a job that has just ended. Never throws: bookkeeping must not be able to
   * change how the job itself ended.
   */
  private recordEnding(
    jobId: string,
    outcome: "completed" | ReturnType<typeof classifyJobFailure>,
    errorClass: string | null,
    peakRssBytes: number | null = null,
    /** The tool version that actually ran the job; `undefined` means "ask the probe by job type". */
    toolVersion?: string | null,
    /** A paired computer ran it (WP-F): its host, and the wall time it measured for the tool itself. */
    agent?: Pick<AgentHostStamp, "hostId" | "hostClass" | "wallMs">,
  ) {
    try {
      const row = this.db.prepare("SELECT type, residues, repaired, started_at, completed_at FROM biophysical_jobs WHERE id = ?").get(jobId) as any;
      if (!row) return;
      const measuredWall = row.started_at ? Math.max(0, (row.completed_at ?? Date.now()) - row.started_at) : null;
      recordTelemetry(this.db, {
        // An agent's attempt gets its own row: a job handed back to the server is recorded again under its
        // plain id, and that row must not erase what the computer's attempt taught (an out-of-memory death
        // sets a ceiling for the computer's class).
        jobId: agent ? `${jobId}@${agent.hostId}` : jobId,
        type: row.type,
        hostId: agent?.hostId ?? SERVER_HOST_ID,
        hostClass: agent?.hostClass ?? hostClassOf(serverHostFacts()),
        residues: row.residues ?? 0,
        repaired: row.repaired == null ? null : row.repaired === 1,
        runs: row.type === "foldx" ? 5 : null,
        // An agent's own measurement excludes the network; the server's clock bounds it, so a computer
        // cannot report a time longer than the job was actually out.
        wallMs: agent?.wallMs != null && measuredWall != null ? Math.min(agent.wallMs, measuredWall) : measuredWall,
        peakRssBytes,
        outcome,
        errorClass,
        toolVersion: toolVersion === undefined ? serverToolVersion(row.type) : toolVersion,
        createdAt: Date.now(),
      });
      this.costModels.noteRecorded(outcome);
    } catch (err: any) {
      console.warn(`[Queue] Could not record telemetry for ${jobId}:`, err?.message ?? err);
    }
  }

  // ── Paired computers (WP-F) ─────────────────────────────────────────────────────────────────────────
  //
  // An agent claims only its OWNER's queued jobs that are not placed elsewhere, under a lease it renews by
  // heartbeat. Every write below is guarded by `claimed_by`, so a computer whose lease was lost (reaped,
  // cancelled, handed back) can never write over what happened since: its late result is a 409.

  /**
   * Hand `agentId` the first of its owner's queued jobs that `accept` (the engine's hard filters for
   * this computer) allows, or null. Atomic: two computers racing for one job get it once.
   */
  claimForAgent(
    agent: { agentId: string; userId: string },
    types: readonly ("foldx" | "p2rank")[],
    accept: (row: { id: string; type: "foldx" | "p2rank"; residues: number | null; repaired: boolean | null; othersWatching: boolean }) => boolean,
    leaseMs: number,
    now = Date.now(),
  ): AgentClaimedJob | null {
    if (this.isShutdown || this.processingPaused || types.length === 0) return null;
    const claimant = `agent:${agent.agentId}`;
    const candidates = this.db.prepare(`
      SELECT id, type, data, owner_id, residues, repaired FROM biophysical_jobs
      WHERE status = 'queued' AND owner_id = ? AND type IN (${types.map(() => "?").join(", ")})
        AND (placement IS NULL OR placement = ?)
      ORDER BY priority DESC, created_at ASC, rowid ASC
      LIMIT 25
    `).all(agent.userId, ...types, claimant) as any[];
    for (const row of candidates) {
      const repaired = row.repaired == null ? null : row.repaired === 1;
      const othersWatching = Boolean(this.db.prepare("SELECT 1 FROM job_watchers WHERE job_id = ? AND user_id != ? LIMIT 1").get(row.id, agent.userId));
      if (!accept({ id: row.id, type: row.type, residues: row.residues ?? null, repaired, othersWatching })) continue;
      const leaseExpiresAt = now + leaseMs;
      const won = this.db.prepare(`
        UPDATE biophysical_jobs SET status = 'running', started_at = ?, claimed_by = ?, lease_expires_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(now, claimant, leaseExpiresAt, row.id);
      if (Number(won.changes ?? 0) === 0) continue; // the server or another computer took it first
      this.db.prepare("INSERT OR REPLACE INTO agent_claims (job_id, agent_id, claimed_at) VALUES (?, ?, ?)").run(row.id, agent.agentId, now);
      let data: any = {};
      try { data = JSON.parse(row.data); } catch { /* the payload builder reports what is missing */ }
      return { id: row.id, type: row.type, data, ownerId: row.owner_id, residues: row.residues ?? null, repaired, leaseExpiresAt };
    }
    return null;
  }

  /** Renew the lease. False when the job is no longer this computer's (cancelled, reaped, finished). */
  renewAgentLease(jobId: string, agentId: string, leaseMs: number, now = Date.now()): number | null {
    const leaseExpiresAt = now + leaseMs;
    const r = this.db.prepare(`
      UPDATE biophysical_jobs SET lease_expires_at = max(coalesce(lease_expires_at, 0), ?)
      WHERE id = ? AND status = 'running' AND claimed_by = ?
    `).run(leaseExpiresAt, jobId, `agent:${agentId}`);
    if (Number(r.changes ?? 0) !== 1) return null;
    // Never shortened: a heartbeat still in flight when the server took a long "finish" lease must not cut it.
    return (this.db.prepare("SELECT lease_expires_at AS l FROM biophysical_jobs WHERE id = ?").get(jobId) as any)?.l ?? leaseExpiresAt;
  }

  /**
   * May `requesterId` (null = no account) JOIN this in-flight job and so receive its result? Always for a
   * job the server runs. For a job a paired computer is running, only its owner, or anyone when that
   * owner's agent results may be shared (`ownerShares`). Review 3's finding S2: the de-duplication join
   * was owner-blind, so joining would have handed a private agent result to someone else.
   */
  mayJoin(jobId: string, requesterId: string | null, ownerShares: (ownerId: string) => boolean): boolean {
    const row = this.db.prepare("SELECT owner_id, claimed_by FROM biophysical_jobs WHERE id = ?").get(jobId) as any;
    if (!row || !(typeof row.claimed_by === "string" && row.claimed_by.startsWith("agent:"))) return true;
    if (requesterId && requesterId === row.owner_id) return true;
    return ownerShares(row.owner_id);
  }

  jobExists(jobId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM biophysical_jobs WHERE id = ?").get(jobId));
  }

  /** Is this job running on this computer right now? */
  isClaimedBy(jobId: string, agentId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM biophysical_jobs WHERE id = ? AND status = 'running' AND claimed_by = ?").get(jobId, `agent:${agentId}`));
  }

  /**
   * The computer's validated result ends the job. False (409 to the agent) when the job is no longer
   * its own: the result is then discarded, whatever it says.
   */
  completeAgentJob(jobId: string, agentId: string, result: unknown, host: AgentHostStamp, now = Date.now()): boolean {
    const r = this.db.prepare(`
      UPDATE biophysical_jobs SET status = 'completed', result = ?, completed_at = ?, lease_expires_at = NULL
      WHERE id = ? AND status = 'running' AND claimed_by = ?
    `).run(JSON.stringify(result), now, jobId, `agent:${agentId}`);
    if (Number(r.changes ?? 0) === 0) return false;
    this.endClaim(jobId, agentId, "completed", now);
    this.recordEnding(jobId, "completed", null, host.peakRssBytes, host.toolVersion, host);
    return true;
  }

  /**
   * The computer could not finish (or its result failed validation): give the job back to the SERVER.
   * `placement = 'server'` keeps any computer from claiming it again, so the hand-back happens once. The
   * computer's attempt is recorded under its own host. False when the job was no longer its own.
   */
  requeueAgentJobToServer(
    jobId: string,
    agentId: string,
    ending: { outcome: AgentClaimOutcome; telemetry: ReturnType<typeof classifyJobFailure>; errorClass: string; host: AgentHostStamp },
    now = Date.now(),
  ): boolean {
    // Telemetry first, while the row still carries this attempt's start time.
    if (!this.isClaimedBy(jobId, agentId)) return false;
    this.recordEnding(jobId, ending.telemetry, ending.errorClass, ending.host.peakRssBytes, ending.host.toolVersion, ending.host);
    const r = this.db.prepare(`
      UPDATE biophysical_jobs
      SET status = 'queued', started_at = NULL, claimed_by = NULL, lease_expires_at = NULL, placement = 'server', requeued_at = ?
      WHERE id = ? AND status = 'running' AND claimed_by = ?
    `).run(now, jobId, `agent:${agentId}`);
    if (Number(r.changes ?? 0) === 0) return false;
    this.clearPhase(jobId);
    this.endClaim(jobId, agentId, ending.outcome, now);
    this.scheduleNext();
    return true;
  }

  /** Share of this computer's last 20 claims whose lease ran out (0 with no history). */
  leaseLossRate(agentId: string): number {
    const rows = this.db.prepare("SELECT outcome FROM agent_claims WHERE agent_id = ? AND outcome IS NOT NULL ORDER BY claimed_at DESC LIMIT 20").all(agentId) as any[];
    if (rows.length === 0) return 0;
    return rows.filter(r => r.outcome === "lease_lost").length / rows.length;
  }

  /** Jobs this computer is running now (normally 0 or 1: an agent runs one heavy job at a time). */
  runningOnAgent(agentId: string): number {
    return (this.db.prepare("SELECT count(*) AS c FROM biophysical_jobs WHERE status = 'running' AND claimed_by = ?").get(`agent:${agentId}`) as any).c as number;
  }

  /**
   * Placements on a computer that is gone (disconnected, or silent past `offlineAfterMs`) are cleared, so
   * the server takes those jobs. `isOnline` is the registry's view. Returns how many were released.
   */
  releasePlacementsOf(isOnline: (agentId: string) => boolean): number {
    const rows = this.db.prepare("SELECT DISTINCT placement FROM biophysical_jobs WHERE status = 'queued' AND placement LIKE 'agent:%'").all() as any[];
    let released = 0;
    for (const { placement } of rows) {
      if (isOnline(String(placement).slice("agent:".length))) continue;
      released += Number(this.db.prepare("UPDATE biophysical_jobs SET placement = NULL WHERE status = 'queued' AND placement = ?").run(placement).changes ?? 0);
    }
    if (released > 0) this.scheduleNext();
    return released;
  }

  /**
   * Lease reaper for paired computers: a job whose lease ran out (the computer died, lost its network or
   * was closed), or that has been out longer than the job cap, goes back to the server. Run with the
   * other reapers, never on a paused standby.
   */
  reapAgentLeases(now = Date.now(), disconnectedAgentId?: string): number {
    // `disconnectedAgentId`: that computer has disconnected itself; everything it holds goes back now.
    const rows = (disconnectedAgentId
      ? this.db.prepare("SELECT id, type, claimed_by, started_at, lease_expires_at FROM biophysical_jobs WHERE status = 'running' AND claimed_by = ?").all(`agent:${disconnectedAgentId}`)
      : this.db.prepare("SELECT id, type, claimed_by, started_at, lease_expires_at FROM biophysical_jobs WHERE status = 'running' AND claimed_by LIKE 'agent:%'").all()) as any[];
    let handedBack = 0;
    for (const row of rows) {
      const leaseLost = disconnectedAgentId != null || row.lease_expires_at == null || row.lease_expires_at < now;
      // The server itself is finishing a delivered result (agent-jobs.ts holds a long "finish" lease):
      // the cap guards against a computer that never delivers, not against the server's own finishing.
      const finishing = row.lease_expires_at != null && row.lease_expires_at - now > FINISHING_LEASE_FLOOR_MS;
      const overCap = !finishing && row.started_at != null && now - row.started_at > agentHardCapMs(row.type);
      if (!leaseLost && !overCap) continue;
      const r = this.db.prepare(`
        UPDATE biophysical_jobs
        SET status = 'queued', started_at = NULL, claimed_by = NULL, lease_expires_at = NULL, placement = 'server', requeued_at = ?
        WHERE id = ? AND status = 'running' AND claimed_by = ?
      `).run(now, row.id, row.claimed_by);
      if (Number(r.changes ?? 0) === 0) continue;
      console.warn(`[Queue Reaper] ${row.claimed_by} ${leaseLost ? "lost its lease on" : "held past the job cap"} ${row.id}; handing it to the server.`);
      this.clearPhase(row.id);
      // Only a lease that ran out counts against the computer's reliability; a deliberate disconnect or a
      // job held past its cap is recorded as what it was.
      const outcome: AgentClaimOutcome = disconnectedAgentId != null ? "disconnected" : leaseLost ? "lease_lost" : "over_cap";
      this.endClaim(row.id, String(row.claimed_by).slice("agent:".length), outcome, now);
      handedBack++;
    }
    return handedBack;
  }

  private endClaim(jobId: string, agentId: string, outcome: AgentClaimOutcome, now: number): void {
    try {
      this.db.prepare(`
        UPDATE agent_claims SET ended_at = ?, outcome = ?
        WHERE job_id = ? AND agent_id = ? AND outcome IS NULL
      `).run(now, outcome, jobId, agentId);
    } catch (err: any) {
      console.warn(`[Queue] Could not record the end of ${agentId}'s claim on ${jobId}:`, err?.message ?? err);
    }
  }

  /** A job handed back has not been repaired or modelled on its new host yet. */
  private clearPhase(jobId: string): void {
    const row = this.db.prepare("SELECT data FROM biophysical_jobs WHERE id = ?").get(jobId) as any;
    if (!row) return;
    try {
      const data = JSON.parse(row.data);
      delete data.phase;
      delete data.phaseAt;
      this.db.prepare("UPDATE biophysical_jobs SET data = ? WHERE id = ?").run(JSON.stringify(data), jobId);
    } catch { /* an unparseable record keeps its data; the job is still handed back */ }
  }

  /**
   * The next job to start: one query, fair and work-conserving.
   *
   * Order: `priority` first (pre-warm sorts last), then the owner with the fewest running jobs,
   * then the owner served least recently (so a single slot still rotates between people instead of
   * degrading to arrival order), then the owner whose oldest queued job is oldest, then that
   * owner's oldest job. There is deliberately no per-owner cap: if only one person has queued work
   * they take every free slot, and the rotation only matters once somebody else is waiting.
   * `queuedInStartOrder` applies the same rule in memory to report queue positions.
   */
  private pickNext(): any {
    return this.db.prepare(`
      SELECT j.* FROM biophysical_jobs j
      WHERE j.status = 'queued' AND (j.placement IS NULL OR j.placement NOT LIKE 'agent:%')
      ORDER BY
        j.priority DESC,
        (SELECT count(*) FROM biophysical_jobs r WHERE r.owner_id = j.owner_id AND r.status = 'running'
           AND (r.claimed_by IS NULL OR r.claimed_by NOT LIKE 'agent:%')) ASC,
        (SELECT coalesce(max(s.started_at), 0) FROM biophysical_jobs s WHERE s.owner_id = j.owner_id
           AND (s.claimed_by IS NULL OR s.claimed_by NOT LIKE 'agent:%')) ASC,
        (SELECT min(q.created_at) FROM biophysical_jobs q WHERE q.owner_id = j.owner_id AND q.status = 'queued'
           AND (q.placement IS NULL OR q.placement NOT LIKE 'agent:%')) ASC,
        j.created_at ASC,
        j.rowid ASC
      LIMIT 1
    `).get();
  }

  private async processQueue() {
    while (this.runningCount < this.concurrency) {
      if (this.isShutdown || this.processingPaused) return;

      // Check system memory (backpressure protection)
      const freeMem = os.freemem();
      const memoryLimit = CONFIG.memory.minFreeBytes;
      if (freeMem < memoryLimit) {
        console.warn(`[Queue] High memory pressure (${(freeMem / 1024 / 1024).toFixed(0)} MB free). Stalling job scheduling.`);
        this.scheduleNext();
        return;
      }

      const row = this.pickNext();

      if (!row) {
        // A standby may enqueue into the shared database without waking this process.
        this.scheduleNext(1000);
        return;
      }

      const jobId = row.id;
      const type = row.type;

      // A ceiling learned after this job was queued (another job of this size or smaller ran out of
      // memory) stops it here, with the reason, instead of running it into the same death.
      let refusal: string | null = null;
      if (routingMode() === "on") {
        try {
          refusal = ceilingRefusal(type, row.residues ?? 0, serverHostFacts(), this.costModels.get());
        } catch (err: any) {
          // The size check must never stop the queue: run the job as if no ceiling were known.
          console.warn("[routing] Claim-time ceiling check failed; running the job:", err?.message ?? err);
        }
        if (refusal) {
          this.db.prepare(`
            UPDATE biophysical_jobs SET status = 'failed', error = ?, completed_at = ?
            WHERE id = ? AND status = 'queued'
          `).run(refusal, Date.now(), jobId);
          // Every other ending writes a telemetry row; this one used to be the exception, so a refusal
          // was invisible in the data that decides future ceilings.
          this.recordEnding(jobId, "failed", "ceiling-refused");
          continue;
        }
      }

      const data = JSON.parse(row.data);

      // Atomically set status to running. Start times strictly increase within this process, so the
      // scheduler's "served least recently" term never ties for jobs claimed in the same millisecond,
      // and the in-memory model behind queue positions (`queuedInStartOrder`) orders them the same way.
      const now = Math.max(Date.now(), this.lastStartedAt + 1);
      this.lastStartedAt = now;
      const result = this.db.prepare(`
        UPDATE biophysical_jobs
        SET status = 'running', started_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(now, jobId);

      if ((result.changes ?? 0) === 0) {
        // Competed/aborted concurrently
        continue;
      }

      this.runningCount++;
      const abortController = new AbortController();
      // Peak memory of the tool processes this job starts (FoldX, Java). Stored with the controller so
      // the reaper can record a lease-expiry timeout's peak as well.
      const meter = new ProcessTreeSampler();
      this.activeJobs.set(jobId, { abortController, meter });

      // Run job asynchronously in the background
      (async () => {
        let isAccounted = true;
        let timeoutId: NodeJS.Timeout | null = null;
        try {
          const timeoutMs = type === "foldx" ? CONFIG.timeouts.foldxSec * 1000 : CONFIG.timeouts.p2rankSec * 1000;
          
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error("Job execution timed out"));
            }, timeoutMs);
          });

          const jobPromise = runInJobMeter(meter, () => this.processCallback(type, data, abortController.signal, jobId));
          const resData = await Promise.race([jobPromise, timeoutPromise]);

          if (timeoutId) clearTimeout(timeoutId);
          if (this.isShutdown) return;

          // Double-decrement guard: make sure job wasn't reaped/aborted early
          if (!this.activeJobs.has(jobId)) {
            isAccounted = false;
            return;
          }

          // Where it ran and for whom (WP-E). An agent's own stamp is left alone; a server stamp written
          // earlier without an owner (the FoldX cache writes before the queue knows) gets the owner.
          const owner = row.owner_id && row.owner_id !== LEGACY_OWNER && row.owner_id !== SYSTEM_OWNER ? row.owner_id : null;
          if (resData && typeof resData === "object") {
            const p = resData.computeProvenance;
            if (!p) resData.computeProvenance = serverProvenance(owner, type);
            else if (p.computedOn === "server" && p.ownerId == null && owner) resData.computeProvenance = { ...p, ownerId: owner };
          }
          const written = this.db.prepare(`
            UPDATE biophysical_jobs
            SET status = 'completed', result = ?, completed_at = ?
            WHERE id = ? AND status = 'running'
          `).run(JSON.stringify(resData), Date.now(), jobId);
          // Settle the sampler and read its peak BEFORE writing telemetry, so the last in-flight sample
          // (the one that can catch an out-of-memory spike) is counted. stop() only awaits one listing.
          const peak = await meter.stop();
          // The tool that RAN is not always the job's tool (a P2Rank job can fall back to fpocket), so
          // prefer the result's own provenance version; `undefined` falls back to the probe by job type.
          const resultTool = resData && typeof resData === "object" && resData.computeProvenance
            ? (resData.computeProvenance.toolVersion ?? null)
            : undefined;
          if ((written.changes ?? 0) === 0) {
            // Cancelled while it was finishing: the cancel's ending stands, and it was not a completed run.
            this.recordEnding(jobId, "cancelled", "cancelled", peak, resultTool);
          } else {
            // A worker can resolve with a failure instead of throwing (FoldX soft failure, P2Rank
            // "unavailable", or an fpocket "fallback" that ran a DIFFERENT tool): that is not a
            // completed run of this job's tool, and must not teach its time or memory curves.
            const soft = resData && typeof resData === "object" && (resData.status === "failed" || resData.status === "unavailable" || resData.status === "fallback");
            this.recordEnding(jobId, soft ? "failed" : "completed", soft ? `result:${resData.status}` : null, peak, resultTool);
          }
        } catch (err: any) {
          // Read BEFORE abortJob below, which aborts the controller itself: did WE stop it?
          const abortedByUs = abortController.signal.aborted;
          if (timeoutId) clearTimeout(timeoutId);
          if (this.isShutdown) return;

          this.abortJob(jobId);

          if (!this.activeJobs.has(jobId)) {
            isAccounted = false;
            return;
          }

          console.error(`[Queue] SQLite job ${jobId} failed:`, err.message);
          // A cancel already wrote its own ending; the error this callback unwinds with is the abort.
          const ended = this.db.prepare("SELECT status, error, residues FROM biophysical_jobs WHERE id = ?").get(jobId) as any;
          let outcome = ended?.status === "failed" && ended.error === "Cancelled." ? "cancelled" : classifyJobFailure(err);
          // We killed it (cancel, our timeout, reaper, shutdown): a SIGKILL from us must never be read as
          // the kernel's OOM killer, or it would teach a size ceiling that refuses healthy jobs.
          if (outcome === "oom" && abortedByUs) outcome = "cancelled";
          let message = err.message || "Unknown error";
          if (outcome === "oom" && !message.includes(DID_NOT_FIT_IN_MEMORY)) {
            const size = ended?.residues ? ` (${ended.residues} residues)` : "";
            message = `This structure${size} ${DID_NOT_FIT_IN_MEMORY}. ${message}`;
          }
          try {
            this.db.prepare(`
              UPDATE biophysical_jobs
              SET status = 'failed', error = ?, completed_at = ?
              WHERE id = ? AND status = 'running'
            `).run(message, Date.now(), jobId);
          } catch (_) {}
          this.recordEnding(jobId, outcome, outcome === "failed" ? (err?.name ?? null) : outcome, await meter.stop());
        } finally {
          void meter.stop();
          if (!this.isShutdown && isAccounted) {
            if (this.activeJobs.has(jobId)) {
              this.activeJobs.delete(jobId);
              this.runningCount--;
            }
            this.scheduleNext();
          }
        }
      })();
    }
  }

  private startReaper() {
    this.reaperInterval = setInterval(() => {
      this.reapStaleJobs();
    }, 30000);
    this.reaperInterval.unref();
  }

  private reapStaleJobs() {
    if (this.isShutdown || this.processingPaused) return;
    // The reaper must outlive the job cap, or it would kill jobs that are still legitimately
    // running. Both are now configurable and their ordering is asserted by
    // server/tests/foldx-timeout-budget.test.ts.
    const maxExecutionTime = CONFIG.timeouts.foldxReaperLeaseMs;
    const cutoff = Date.now() - maxExecutionTime;

    try {
      // A paired computer's job is judged by its lease instead (`reapAgentLeases`, below).
      const staleJobs = this.db.prepare(`
        SELECT id FROM biophysical_jobs
        WHERE status = 'running' AND started_at < ? AND ${ON_SERVER}
      `).all(cutoff) as { id: string }[];

      for (const job of staleJobs) {
        console.warn(`[Queue Reaper] Found stale running job: ${job.id}. Reaping and resetting.`);
        
        // Abort the job first if it's active
        this.abortJob(job.id);

        // Transition the job to failed in the database
        try {
          this.db.prepare(`
            UPDATE biophysical_jobs
            SET status = 'failed', error = 'Job execution timed out (lease expired)', completed_at = ?
            WHERE id = ? AND status = 'running'
          `).run(Date.now(), job.id);
        } catch (dbErr: any) {
          console.error(`[Queue Reaper] Failed to update database status for ${job.id}:`, dbErr.message);
        }

        // Remove it and decrement runningCount. Capture the meter BEFORE the delete: a lease-expiry reap
        // is the one ending the job's own path cannot write (it bails once it is no longer active), so
        // without this its peak would always be null.
        const active = this.activeJobs.get(job.id);
        if (active) {
          this.activeJobs.delete(job.id);
          this.runningCount = Math.max(0, this.runningCount - 1);
        }
        this.recordEnding(job.id, "timeout", "lease-expired", active?.meter?.peakBytes ?? null);
      }

      // Also reap stuck queued jobs. The wait is longer than the running lease because a queued
      // job is legitimately waiting behind others rather than executing.
      const maxQueueWait = CONFIG.timeouts.foldxQueuedLeaseMs;
      const queueCutoff = Date.now() - maxQueueWait;
      const staleQueuedJobs = this.db.prepare(`
        SELECT id FROM biophysical_jobs
        WHERE status = 'queued' AND coalesce(requeued_at, created_at) < ?
      `).all(queueCutoff) as { id: string }[];

      for (const job of staleQueuedJobs) {
        console.warn(`[Queue Reaper] Found stale queued job: ${job.id}. Reaping and failing.`);
        try {
          this.db.prepare(`
            UPDATE biophysical_jobs
            SET status = 'failed', error = 'Job execution timed out (waiting in queue too long)', completed_at = ?
            WHERE id = ? AND status = 'queued'
          `).run(Date.now(), job.id);
        } catch (dbErr: any) {
          console.error(`[Queue Reaper] Failed to update queued job status for ${job.id}:`, dbErr.message);
        }
      }

      const handedBack = this.reapAgentLeases();

      if (staleJobs.length > 0 || staleQueuedJobs.length > 0 || handedBack > 0) {
        this.scheduleNext();
      }
      this.pruneHistory();
    } catch (err: any) {
      console.error(`[Queue Reaper] Error during reaping:`, err.message);
    }
  }

  /**
   * Finished jobs are kept `JOB_RETENTION_DAYS` (14) so a result can still be polled and listed, then
   * deleted with their watchers; telemetry is kept `TELEMETRY_RETENTION_DAYS` (180). Without this the
   * shared database grew by one row per request forever (a cached pocket answer is a row too).
   * At most once an hour.
   */
  pruneHistory(now = Date.now()): void {
    if (now - this.lastPrunedAt < 60 * 60 * 1000) return;
    const days = (name: string, fallback: number) => {
      const n = Number(process.env[name]);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    const jobCutoff = now - days("JOB_RETENTION_DAYS", 14) * 86_400_000;
    const telemetryCutoff = now - days("TELEMETRY_RETENTION_DAYS", 180) * 86_400_000;
    try {
      this.db.prepare(`
        DELETE FROM job_watchers WHERE job_id IN (
          SELECT id FROM biophysical_jobs WHERE status IN ('completed', 'failed') AND coalesce(completed_at, created_at) < ?
        )
      `).run(jobCutoff);
      this.db.prepare("DELETE FROM biophysical_jobs WHERE status IN ('completed', 'failed') AND coalesce(completed_at, created_at) < ?").run(jobCutoff);
      this.db.prepare("DELETE FROM job_telemetry WHERE created_at < ?").run(telemetryCutoff);
      this.db.prepare("DELETE FROM agent_claims WHERE claimed_at < ?").run(telemetryCutoff);
      // Only now: the stamp throttles the next run, and setting it before the deletes meant one
      // transient SQLite error suppressed pruning for a further hour.
      this.lastPrunedAt = now;
    } catch (err: any) {
      console.warn("[Queue] History prune failed:", err?.message ?? err);
    }
  }

  /** Forget every learned out-of-memory ceiling (admin action). Returns how many OOM rows were removed. */
  forgetOomCeilings(): number {
    const r = this.db.prepare("DELETE FROM job_telemetry WHERE outcome = 'oom'").run();
    this.costModels.noteRecorded("oom"); // invalidates the cached models
    return Number(r.changes ?? 0);
  }

  shutdown() {
    this.isShutdown = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.reaperInterval) {
      clearInterval(this.reaperInterval);
      this.reaperInterval = null;
    }
    console.log("[Queue] Aborting all active SQLite jobs...");
    for (const [id, active] of this.activeJobs.entries()) {
      if (active.abortController) {
        active.abortController.abort();
      }
    }
    try {
      this.db.close();
    } catch (_) {}
  }
}

function startOfUtcDay(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 120 ? `${m} min` : `${(m / 60).toFixed(1).replace(/\.0$/, "")} h`;
}

export class BiophysicalJobQueue {
  private static instance: BiophysicalJobQueue | null = null;
  private sqliteQueue: SQLiteQueue | null = null;
  private bullQueue: Queue | null = null;
  private bullWorker: Worker | null = null;
  private redisUrl: string | undefined;

  private concurrency: number;
  /** Global backstop on queued + running jobs; a person meets their own limits (`opts.limits`) first. */
  private maxQueueLength = CONFIG.queue.maxTotal;
  /**
   * Per-job write chains, so two read-modify-write writers cannot interleave on one record.
   * Entries are dropped once nothing is queued behind them, so the map stays bounded by in-flight
   * jobs rather than by jobs ever seen.
   */
  private jobWriteChains = new Map<string, Promise<void>>();

  private constructor(
    concurrency = 2,
    processCallback: (type: string, data: any, signal?: AbortSignal, jobId?: string) => Promise<any>
  ) {
    this.concurrency = concurrency;
    this.redisUrl = process.env.REDIS_URL;
    if (this.redisUrl && initialDeploymentPaused()) {
      throw new Error("Standby deployments currently require the SQLite queue");
    }

    if (this.redisUrl) {
      try {
        console.log(`[Queue] Initializing Redis/BullMQ connection to: ${this.redisUrl}`);
        const connectionOpts = { url: this.redisUrl, maxRetriesPerRequest: null };

        this.bullQueue = new Queue("biophysical_jobs", {
          connection: connectionOpts,
          defaultJobOptions: { 
            removeOnComplete: true, 
            removeOnFail: false,
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 5000
            }
          }
        });

        this.bullWorker = new Worker(
          "biophysical_jobs",
          async (job) => {
            // Memory check before starting job
            const freeMem = os.freemem();
            if (freeMem < 500 * 1024 * 1024) {
              throw new Error("Job execution stalled: server out of memory");
            }
            return await processCallback(job.name, job.data, undefined, job.id);
          },
          {
            connection: connectionOpts,
            concurrency: this.concurrency
          }
        );

        this.bullWorker.on("failed", (job, err) => {
          console.error(`[Queue] Redis job ${job?.id} failed:`, err.message);
        });
      } catch (err: any) {
        console.warn("[Queue] BullMQ initialization failed, falling back to SQLite:", err.message);
        this.bullQueue = null;
        this.bullWorker = null;
      }
    }

    if (!this.bullQueue) {
      /**
       * Under test the queue stays IN-MEMORY, and that ordering is deliberate.
       *
       * `SHARED_STATE_DB_PATH` is honoured first in production, but if it took precedence under
       * test the queue would become file-backed: the resulting disk write per enqueue is slower
       * and asynchronous in a way some of these tests are sensitive to (a job observed as
       * "queued" that the old in-memory queue had already flipped to "running"). The path is
       * still redirected by the test setup, so production state is untouched either way — this
       * keeps the tests measuring queue behaviour rather than SQLite latency.
       */
      const dbPath = process.env.NODE_ENV === "test"
        ? ":memory:"
        : (process.env.SHARED_STATE_DB_PATH ?? path.join(process.cwd(), "data", "shared_state.sqlite"));
      this.sqliteQueue = new SQLiteQueue(dbPath, this.concurrency, processCallback, initialDeploymentPaused());
    }
  }

  static initialize(
    concurrency = 2,
    processCallback: (type: string, data: any, signal?: AbortSignal, jobId?: string) => Promise<any>
  ): BiophysicalJobQueue {
    if (!BiophysicalJobQueue.instance) {
      BiophysicalJobQueue.instance = new BiophysicalJobQueue(concurrency, processCallback);
    }
    return BiophysicalJobQueue.instance;
  }

  static resetForTesting() {
    if (BiophysicalJobQueue.instance) {
      BiophysicalJobQueue.instance.shutdown();
      BiophysicalJobQueue.instance = null;
    }
  }

  static getInstance(): BiophysicalJobQueue {
    if (!BiophysicalJobQueue.instance) {
      throw new Error("BiophysicalJobQueue not initialized. Call initialize() first.");
    }
    return BiophysicalJobQueue.instance;
  }

  /**
   * `opts.ownerId` is the submitter (`req.principal.userId`); without it the job is `legacy` and
   * shares one rotation slot with every other unowned job. The Redis backend ignores ownership.
   */
  /**
   * Submissions are serialised: every limit below is check-then-insert with `await`s in between (the
   * host probe, the queue length), so two concurrent submissions from one person could both pass a
   * limit they jointly exceed. Submitting is rare and cheap next to the jobs, so one chain is enough.
   */
  private submitChain: Promise<unknown> = Promise.resolve();

  pushJob(type: "foldx" | "p2rank", data: any, opts: EnqueueOptions = {}): Promise<string> {
    const run = this.submitChain.then(() => this.pushJobNow(type, data, opts), () => this.pushJobNow(type, data, opts));
    this.submitChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async pushJobNow(type: "foldx" | "p2rank", data: any, opts: EnqueueOptions = {}): Promise<string> {
    const jobId = crypto.randomUUID();
    const owner = opts.ownerId || LEGACY_OWNER;

    // A runaway script must not be able to fill the queue for everyone else.
    if (this.sqliteQueue && opts.limits && owner !== SYSTEM_OWNER && owner !== LEGACY_OWNER) {
      const { queuedPerUser, queuedPerUserExplicit, serverSecondsPerDay } = opts.limits;
      const queued = this.sqliteQueue.countQueuedFor(owner);
      /**
       * Work-conserving, like the scheduler: the per-person limit is a SHARE, so it only binds while
       * somebody else is waiting. Alone, a person may fill the queue up to the host backstop, less a
       * small reserve so a colleague who arrives can still submit. When someone else starts waiting,
       * the share applies again: jobs already queued stay queued, new ones wait until the person is
       * back under it, and the scheduler's rotation lets the newcomer's work start first.
       * An admin's explicit limit is a restriction, not a share, and always applies.
       */
      const othersWaiting = this.sqliteQueue.othersWaiting(owner);
      const alone = othersWaiting === 0 && !queuedPerUserExplicit;
      const limit = alone ? Math.max(queuedPerUser, this.maxQueueLength - NEWCOMER_RESERVE) : queuedPerUser;
      if (queued >= limit) {
        const waiting = `You already have ${queued} job${queued === 1 ? "" : "s"} waiting`;
        throw new QueueLimitError(
          "QUEUED_PER_USER",
          alone
            ? `${waiting}, which is as many as the server holds for one person. Cancel one, or wait for one to start.`
            : queuedPerUserExplicit
              ? `${waiting} (your limit is ${queuedPerUser}). Cancel one, or wait for one to start.`
              : `${waiting}, and ${othersWaiting === 1 ? "someone else is" : `${othersWaiting} others are`} waiting too, so the limit is ${queuedPerUser} each for now. Your queued jobs are kept; you can add more as they start.`,
        );
      }
      if (serverSecondsPerDay != null) {
        const nowMs = Date.now();
        const usedS = Math.floor(this.sqliteQueue.serverMsSince(owner, startOfUtcDay(nowMs), nowMs) / 1000);
        const pendingS = Math.floor(this.sqliteQueue.pendingEstimateMsFor(owner, nowMs) / 1000);
        if (usedS + pendingS >= serverSecondsPerDay) {
          throw new QueueLimitError(
            "DAILY_SERVER_TIME",
            pendingS > 0
              ? `You have used ${formatMinutes(usedS)} of your ${formatMinutes(serverSecondsPerDay)} of server time today, and the jobs you already have waiting need about ${formatMinutes(pendingS)} more. It resets at 00:00 UTC.`
              : `You have used ${formatMinutes(usedS)} of your ${formatMinutes(serverSecondsPerDay)} of server time today. It resets at 00:00 UTC.`,
          );
        }
      }
    }
    // The placement engine: off, logged only (shadow), or allowed to refuse (on). Skipped when the
    // structure's size is unknown, because every rule it applies is about size or tools.
    if (this.sqliteQueue && opts.residues && opts.residues > 0) {
      const mode = routingMode();
      if (mode !== "off") {
        const input: AdmissionInput = {
          type,
          residues: opts.residues,
          isAlphaFoldModel: opts.isAlphaFoldModel,
          ownerId: owner,
          placementPref: opts.placementPref,
        };
        let decision;
        try {
          decision = decide(input, await probeServerHost(this.sqliteQueue.loadSnapshot()), this.sqliteQueue.getCostModels());
        } catch (err: any) {
          // The engine must never be the reason a job cannot be submitted.
          console.warn("[routing] Admission check failed; submitting without it:", err?.message ?? err);
        }
        if (decision) {
          if (mode === "shadow") logShadow(input, decision, "server");
          else if (decision.placement.kind === "reject") throw new AdmissionError(decision.reasons);
        }
      }
    }

    // Backstop for the whole host.
    const totalJobs = await this.getQueueLength();
    if (totalJobs >= this.maxQueueLength) {
      throw new Error("BUSY: Concurrency and queue limits reached (503)");
    }

    if (this.bullQueue) {
      await this.bullQueue.add(type, data, { jobId });
    } else if (this.sqliteQueue) {
      await this.sqliteQueue.addJob(jobId, type, data, opts);
    }

    return jobId;
  }

  /**
   * The SQLite queue, for the paired-computer protocol (WP-F), or null on the Redis backend, which has
   * no owners or leases: agents are then refused with a plain reason, and everything runs on the server.
   */
  agentQueue(): SQLiteQueue | null {
    return this.sqliteQueue;
  }

  /** The person (or `legacy`/`system`) a job belongs to; `null` when unknown or on Redis. */
  async getJobOwner(id: string): Promise<string | null> {
    if (!this.sqliteQueue) return null;
    return (await this.sqliteQueue.getJob(id))?.ownerId ?? null;
  }

  /** Someone else asked for the same work: they now wait on this job and may cancel their own interest. */
  addWatcher(jobId: string, userId: string): void {
    this.sqliteQueue?.addWatcher(jobId, userId);
  }

  /** Cancel on behalf of a person. See `SQLiteQueue.cancelFor` for the watcher rule. */
  async cancelFor(jobId: string, userId: string, isAdmin: boolean): Promise<CancelOutcome> {
    if (!this.sqliteQueue) return { ok: false, reason: "not_found" };
    return this.sqliteQueue.cancelFor(jobId, userId, isAdmin);
  }

  /** Server seconds this person's jobs used today (UTC) and in the last 7 days. Informational. */
  usageFor(userId: string, now = Date.now()): { todaySeconds: number; weekSeconds: number } | null {
    if (!this.sqliteQueue) return null;
    return {
      todaySeconds: Math.round(this.sqliteQueue.serverMsSince(userId, startOfUtcDay(now), now) / 1000),
      weekSeconds: Math.round(this.sqliteQueue.serverMsSince(userId, now - 7 * 86_400_000, now) / 1000),
    };
  }

  /** Admin action: forget learned out-of-memory ceilings (e.g. after a misclassified failure or more RAM). */
  forgetOomCeilings(): number {
    return this.sqliteQueue ? this.sqliteQueue.forgetOomCeilings() : 0;
  }

  /** A disabled account stops costing the host anything: its waiting and running work is cancelled. */
  cancelAllFor(userId: string): number {
    return this.sqliteQueue ? this.sqliteQueue.cancelAllFor(userId) : 0;
  }

  async listFor(userId: string, limit?: number): Promise<JobSummary[]> {
    return this.sqliteQueue ? this.sqliteQueue.listFor(userId, limit) : [];
  }

  async getEta(id: string): Promise<{ waitMs: number | null; runMs: number | null } | null> {
    return this.sqliteQueue ? this.sqliteQueue.getEta(id) : null;
  }

  async addCompletedJob(id: string, type: "foldx" | "p2rank", data: any, result: any): Promise<void> {
    if (this.sqliteQueue) {
      this.sqliteQueue.addCompletedJob(id, type, data, result);
    }
  }

  async getQueueLength(): Promise<number> {
    if (this.bullQueue) {
      const counts = await this.bullQueue.getJobCounts("wait", "active");
      return (counts.wait ?? 0) + (counts.active ?? 0);
    }
    if (this.sqliteQueue) {
      return this.sqliteQueue.getJobCount();
    }
    return 0;
  }

  async getJobStatus(id: string): Promise<{
    status: "queued" | "running" | "completed" | "failed";
    result?: any;
    error?: string;
    /**
     * Timestamps, so a caller can report the job's AGE.
     *
     * The client used to derive elapsed time from when its own spinner mounted, which is why a
     * queued job and a repairing job looked identical for minutes. `createdAt`/`startedAt` make the
     * number the job's, not the component's.
     */
    createdAt?: number | null;
    startedAt?: number | null;
  } | null> {
    if (this.bullQueue) {
      const job = await this.bullQueue.getJob(id);
      if (!job) return null;
      const state = await job.getState();
      const returnval = job.returnvalue;
      const failedReason = job.failedReason;

      let status: "queued" | "running" | "completed" | "failed" = "queued";
      if (state === "active") status = "running";
      else if (state === "completed") status = "completed";
      else if (state === "failed") status = "failed";

      return {
        status,
        result: returnval,
        error: failedReason,
        createdAt: typeof job.timestamp === "number" ? job.timestamp : null,
        startedAt: typeof job.processedOn === "number" ? job.processedOn : null
      };
    }

    if (this.sqliteQueue) {
      const job = await this.sqliteQueue.getJob(id);
      if (!job) return null;
      return {
        status: job.status,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt ?? null,
        startedAt: job.startedAt ?? null
      };
    }

    return null;
  }

  async getJobData(id: string): Promise<any | null> {
    if (this.bullQueue) {
      const job = await this.bullQueue.getJob(id);
      return job ? job.data : null;
    }
    if (this.sqliteQueue) {
      const job = await this.sqliteQueue.getJob(id);
      return job ? job.data : null;
    }
    return null;
  }

  /**
   * Records the stage a running job is in. Best-effort by design: progress reporting must never be
   * able to fail the calculation whose progress it describes.
   */
  async updateJobPhase(id: string, phase: string): Promise<void> {
    await this.mutateJobData(id, data => ({ ...(data || {}), phase, phaseAt: Date.now() }));
  }

  /**
   * Read-modify-write of one job's `data` blob, serialised per job.
   *
   * WHY THIS EXISTS
   * ---------------
   * Two writers touch the same JSON blob while a job runs: the FoldX worker records its phase, and
   * `updateQueueJobRemoteData` records newly-resolved remote job ids. Both are read-modify-write, and
   * the remote-data writer's read and write straddle `await`s, so a phase written in that window was
   * silently dropped by the later write (and, on the BullMQ backend, either write could lose the
   * other). The visible symptom was a run that stopped reporting its stage mid-flight.
   *
   * Serialising per job id removes the class rather than the instance: every write for a given job
   * is queued behind the previous one, so a read always sees the previous write's result.
   */
  async mutateJobData(id: string, mutate: (data: any) => any): Promise<any | null> {
    const previous = this.jobWriteChains.get(id) ?? Promise.resolve();
    const run = previous.then(
      () => this.applyJobDataMutation(id, mutate),
      () => this.applyJobDataMutation(id, mutate)
    );
    const settled = run.then(() => undefined, () => undefined);
    this.jobWriteChains.set(id, settled);
    settled.then(() => {
      // Bounded: the chain entry is dropped once no further write is queued behind it.
      if (this.jobWriteChains.get(id) === settled) this.jobWriteChains.delete(id);
    });
    return run;
  }

  private async applyJobDataMutation(id: string, mutate: (data: any) => any): Promise<any | null> {
    try {
      const current = await this.getJobData(id);
      if (!current) return null;
      /**
       * AWAITED, and that is not defensive style.
       *
       * A mutator may be async (the test that pins this race uses one), and `mutate(current) ?? current`
       * treats a returned Promise as truthy — so the row was written as `JSON.stringify(Promise)`, i.e.
       * `{}`, silently discarding the job's entire data blob. Verified by driving it: the mutator's
       * resolved value was correct and the stored value was empty.
       */
      const next = (await mutate(current)) ?? current;
      await this.updateJobData(id, next);
      return next;
    } catch (err: any) {
      // Progress bookkeeping must never be able to fail the calculation it describes.
      console.warn(`[Queue] Job data mutation failed for ${id}:`, err.message);
      return null;
    }
  }

  async getQueuePosition(id: string): Promise<number | null> {
    if (this.sqliteQueue) return this.sqliteQueue.getQueuePosition(id);
    return null;
  }

  async updateJobData(id: string, data: any): Promise<void> {
    if (this.bullQueue) {
      const job = await this.bullQueue.getJob(id);
      if (job) {
        await job.updateData(data);
      }
    } else if (this.sqliteQueue) {
      this.sqliteQueue.updateJobData(id, data);
    }
  }

  async abortJob(id: string) {
    if (this.bullQueue) {
      const job = await this.bullQueue.getJob(id);
      if (job) {
        await (job as any).discard();
      }
    } else if (this.sqliteQueue) {
      this.sqliteQueue.abortJob(id);
    }
  }

  async shutdown() {
    if (this.bullWorker) {
      await this.bullWorker.close();
    }
    if (this.bullQueue) {
      await this.bullQueue.close();
    }
    if (this.sqliteQueue) {
      this.sqliteQueue.shutdown();
    }
  }

  getDeploymentState(): { backend: "sqlite" | "redis"; paused: boolean; activeJobs: number } {
    return {
      backend: this.sqliteQueue ? "sqlite" : "redis",
      paused: this.sqliteQueue?.paused ?? false,
      activeJobs: this.sqliteQueue?.activeCount ?? 0,
    };
  }

  pauseProcessing(): void {
    if (!this.sqliteQueue) throw new Error("Deployment handover requires the SQLite queue");
    this.sqliteQueue.pauseProcessing();
  }

  resumeProcessing(): void {
    if (!this.sqliteQueue) throw new Error("Deployment handover requires the SQLite queue");
    this.sqliteQueue.resumeProcessing();
  }
}

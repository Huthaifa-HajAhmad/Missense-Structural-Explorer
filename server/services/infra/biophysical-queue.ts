import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { DatabaseSync } from "node:sqlite";
import { Queue, Worker } from "bullmq";
import { CONFIG } from "../../config.ts";
import { initialDeploymentPaused } from "../../deployment-role.ts";
import { LEGACY_OWNER, SYSTEM_OWNER, SYSTEM_PRIORITY, QueueLimitError, type SubmitterLimits } from "./queue-owners.ts";

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
}

export { LEGACY_OWNER, SYSTEM_OWNER, SYSTEM_PRIORITY, QueueLimitError };

export interface EnqueueOptions {
  ownerId?: string;
  priority?: number;
  costEstimateMs?: number | null;
  placement?: string | null;
  /** The submitter's own limits; omitted for unowned work, which only meets the host backstop. */
  limits?: SubmitterLimits;
}

export interface JobSummary {
  id: string;
  type: "foldx" | "p2rank";
  status: QueueJob["status"];
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error?: string;
  ownerId: string;
  /** True when the caller owns the job; false when they only joined it. */
  mine: boolean;
  /** Jobs ahead of this one while it is queued; null otherwise. */
  queuedAhead: number | null;
  /** Short human label taken from the job's own input (mutation / protein), when it has one. */
  label: string | null;
}

export type CancelOutcome =
  | { ok: true; aborted: boolean; remainingWatchers: number }
  | { ok: false; reason: "not_found" | "forbidden" | "finished" };

export class SQLiteQueue {
  private db: DatabaseSync;
  private concurrency: number;
  private runningCount = 0;
  private activeJobs = new Map<string, { abortController?: AbortController }>();
  private processCallback: (type: string, data: any, signal?: AbortSignal, jobId?: string) => Promise<any>;

  private timer: NodeJS.Timeout | null = null;
  private reaperInterval: NodeJS.Timeout | null = null;
  private isShutdown = false;
  private processingPaused: boolean;

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
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_owner_status ON biophysical_jobs(owner_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_owner_started ON biophysical_jobs(owner_id, started_at);
      CREATE TABLE IF NOT EXISTS job_watchers (
        job_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (job_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_job_watchers_user ON job_watchers(user_id);
    `);
  }

  private recoverInterruptedJobs() {
    // Reset any running jobs from a previous crash/restart back to queued status.
    //
    // The phase is cleared with it. A job re-queued by a restart has NOT been repaired or modelled,
    // and leaving the old phase in the record made the poll route report "Structure repair —
    // repacking side chains" for work that was waiting for a worker slot.
    try {
      const requeued = this.db.prepare("SELECT id, data FROM biophysical_jobs WHERE status = 'running'").all() as any[];
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
    this.db.exec(`
      UPDATE biophysical_jobs
      SET status = 'queued', started_at = NULL
      WHERE status = 'running';
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
      INSERT INTO biophysical_jobs (id, type, data, status, created_at, owner_id, priority, cost_estimate_ms, placement)
      VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)
    `).run(
      id, type, JSON.stringify(data), now, owner,
      opts.priority ?? (owner === SYSTEM_OWNER ? SYSTEM_PRIORITY : 0),
      opts.costEstimateMs ?? null, opts.placement ?? null,
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
    this.db.prepare("UPDATE biophysical_jobs SET priority = 0 WHERE id = ? AND status = 'queued' AND priority < 0").run(jobId);
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
      WHERE owner_id = ? AND started_at IS NOT NULL AND coalesce(completed_at, ?) > ?
    `).get(now, since, ownerId, now, since) as any;
    return row?.ms ?? 0;
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
    const row = this.db.prepare("SELECT count(*) as count FROM biophysical_jobs WHERE status IN ('queued', 'running')").get() as any;
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
  private queuedInStartOrder(): { id: string; ownerId: string; costEstimateMs: number | null }[] {
    const rows = this.db.prepare(`
      SELECT id, owner_id, priority, cost_estimate_ms, created_at, rowid AS rid
      FROM biophysical_jobs WHERE status = 'queued' LIMIT 1000
    `).all() as any[];
    if (rows.length === 0) return [];
    const running = new Map<string, number>();
    for (const r of this.db.prepare("SELECT owner_id, count(*) AS c FROM biophysical_jobs WHERE status = 'running' GROUP BY owner_id").all() as any[]) {
      running.set(r.owner_id, r.c);
    }
    const served = new Map<string, number>();
    for (const r of this.db.prepare("SELECT owner_id, max(started_at) AS s FROM biophysical_jobs WHERE started_at IS NOT NULL GROUP BY owner_id").all() as any[]) {
      served.set(r.owner_id, r.s ?? 0);
    }
    let tick = Number.MAX_SAFE_INTEGER - rows.length - 1; // after every real timestamp, increasing
    const remaining = rows.slice();
    const order: { id: string; ownerId: string; costEstimateMs: number | null }[] = [];
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
      order.push({ id: pick.id, ownerId: pick.owner_id, costEstimateMs: pick.cost_estimate_ms ?? null });
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
        const running = (this.db.prepare("SELECT count(*) AS c FROM biophysical_jobs WHERE status = 'running'").get() as any).c as number;
        const idx = this.queuedInStartOrder().findIndex(j => j.id === id);
        return idx < 0 ? null : running + idx;
      }
      const ahead = this.db.prepare(`
        SELECT count(*) AS count FROM biophysical_jobs
        WHERE status IN ('queued', 'running')
          AND (created_at < ? OR (created_at = ? AND rowid <= ?))
      `).get(row.created_at, row.created_at, row.rowid) as any;
      return ahead ? Math.max(0, ahead.count - 1) : 0;
    } catch {
      return null;
    }
  }

  /**
   * Estimated wait before a queued job starts, from the cost estimates of what is ahead of it.
   * `waitMs` is `null` when any job ahead has no estimate: a partial sum would read as a promise.
   */
  getEta(id: string): { waitMs: number | null; runMs: number | null } | null {
    try {
      const row = this.db.prepare("SELECT status, cost_estimate_ms FROM biophysical_jobs WHERE id = ?").get(id) as any;
      if (!row) return null;
      const runMs = row.cost_estimate_ms ?? null;
      if (row.status !== "queued") return { waitMs: 0, runMs };
      const now = Date.now();
      let total = 0;
      let known = true;
      for (const r of this.db.prepare("SELECT cost_estimate_ms AS c, started_at AS s FROM biophysical_jobs WHERE status = 'running'").all() as any[]) {
        if (r.c == null) known = false;
        else total += Math.max(0, r.c - (now - (r.s ?? now)));
      }
      for (const j of this.queuedInStartOrder()) {
        if (j.id === id) break;
        if (j.costEstimateMs == null) known = false;
        else total += j.costEstimateMs;
      }
      return { waitMs: known ? Math.round(total / Math.max(1, this.concurrency)) : null, runMs };
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
    if (mine) {
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
      ? (this.db.prepare("SELECT count(*) AS c FROM biophysical_jobs WHERE status = 'running'").get() as any).c as number
      : 0;
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
        ownerId: r.owner_id ?? LEGACY_OWNER,
        mine: r.owner_id === userId,
        queuedAhead: idx < 0 ? null : running + idx,
        label,
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
      WHERE j.status = 'queued'
      ORDER BY
        j.priority DESC,
        (SELECT count(*) FROM biophysical_jobs r WHERE r.owner_id = j.owner_id AND r.status = 'running') ASC,
        (SELECT coalesce(max(s.started_at), 0) FROM biophysical_jobs s WHERE s.owner_id = j.owner_id) ASC,
        (SELECT min(q.created_at) FROM biophysical_jobs q WHERE q.owner_id = j.owner_id AND q.status = 'queued') ASC,
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
      const data = JSON.parse(row.data);

      // Atomically set status to running
      const now = Date.now();
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
      this.activeJobs.set(jobId, { abortController });

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

          const jobPromise = this.processCallback(type, data, abortController.signal, jobId);
          const resData = await Promise.race([jobPromise, timeoutPromise]);

          if (timeoutId) clearTimeout(timeoutId);
          if (this.isShutdown) return;

          // Double-decrement guard: make sure job wasn't reaped/aborted early
          if (!this.activeJobs.has(jobId)) {
            isAccounted = false;
            return;
          }

          this.db.prepare(`
            UPDATE biophysical_jobs
            SET status = 'completed', result = ?, completed_at = ?
            WHERE id = ? AND status = 'running'
          `).run(JSON.stringify(resData), Date.now(), jobId);
        } catch (err: any) {
          if (timeoutId) clearTimeout(timeoutId);
          if (this.isShutdown) return;

          this.abortJob(jobId);

          if (!this.activeJobs.has(jobId)) {
            isAccounted = false;
            return;
          }

          console.error(`[Queue] SQLite job ${jobId} failed:`, err.message);
          try {
            this.db.prepare(`
              UPDATE biophysical_jobs
              SET status = 'failed', error = ?, completed_at = ?
              WHERE id = ? AND status = 'running'
            `).run(err.message || "Unknown error", Date.now(), jobId);
          } catch (_) {}
        } finally {
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
      const staleJobs = this.db.prepare(`
        SELECT id FROM biophysical_jobs
        WHERE status = 'running' AND started_at < ?
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

        // If it was in the active map, remove it and decrement runningCount
        if (this.activeJobs.has(job.id)) {
          this.activeJobs.delete(job.id);
          this.runningCount = Math.max(0, this.runningCount - 1);
        }
      }

      // Also reap stuck queued jobs. The wait is longer than the running lease because a queued
      // job is legitimately waiting behind others rather than executing.
      const maxQueueWait = CONFIG.timeouts.foldxQueuedLeaseMs;
      const queueCutoff = Date.now() - maxQueueWait;
      const staleQueuedJobs = this.db.prepare(`
        SELECT id FROM biophysical_jobs
        WHERE status = 'queued' AND created_at < ?
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

      if (staleJobs.length > 0 || staleQueuedJobs.length > 0) {
        this.scheduleNext();
      }
    } catch (err: any) {
      console.error(`[Queue Reaper] Error during reaping:`, err.message);
    }
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
  async pushJob(type: "foldx" | "p2rank", data: any, opts: EnqueueOptions = {}): Promise<string> {
    const jobId = crypto.randomUUID();
    const owner = opts.ownerId || LEGACY_OWNER;

    // A runaway script must not be able to fill the queue for everyone else.
    if (this.sqliteQueue && opts.limits && owner !== SYSTEM_OWNER && owner !== LEGACY_OWNER) {
      const { queuedPerUser, serverSecondsPerDay } = opts.limits;
      const queued = this.sqliteQueue.countQueuedFor(owner);
      if (queued >= queuedPerUser) {
        throw new QueueLimitError(
          "QUEUED_PER_USER",
          `You already have ${queued} job${queued === 1 ? "" : "s"} waiting (your limit is ${queuedPerUser}). Cancel one, or wait for one to start.`,
        );
      }
      if (serverSecondsPerDay != null) {
        const usedS = Math.floor(this.sqliteQueue.serverMsSince(owner, startOfUtcDay(Date.now())) / 1000);
        if (usedS >= serverSecondsPerDay) {
          throw new QueueLimitError(
            "DAILY_SERVER_TIME",
            `You have used ${formatMinutes(usedS)} of your ${formatMinutes(serverSecondsPerDay)} of server time today. It resets at 00:00 UTC.`,
          );
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

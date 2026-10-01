import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { DatabaseSync } from "node:sqlite";
import { Queue, Worker } from "bullmq";
import { CONFIG } from "../../config.ts";
import { initialDeploymentPaused } from "../../deployment-role.ts";

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
}

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

    // A standby shares the database with the serving process. Its running jobs are still alive.
    if (!paused) this.recoverInterruptedJobs();
    this.scheduleNext();
    if (!paused) this.startReaper();
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

  async addJob(id: string, type: "foldx" | "p2rank", data: any): Promise<void> {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO biophysical_jobs (id, type, data, status, created_at)
      VALUES (?, ?, ?, 'queued', ?)
    `).run(id, type, JSON.stringify(data), now);

    this.scheduleNext();
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
      startedAt: row.started_at ?? null
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

  /** Jobs ahead of this one in the queue, or `null` when the store cannot answer. */
  getQueuePosition(id: string): number | null {
    try {
      const row = this.db.prepare("SELECT created_at, rowid FROM biophysical_jobs WHERE id = ?").get(id) as any;
      if (!row) return null;
      /**
       * Two properties the previous `status='queued' AND created_at < ?` did not have:
       *
       *   • Tie-break by `rowid`. `created_at` is `Date.now()` in milliseconds, so two jobs enqueued
       *     in the same millisecond both reported "Next in line" — a claim about the queue that was
       *     simply false. `rowid` is SQLite's insertion order, which is the order the scheduler
       *     itself consumes (`ORDER BY created_at ASC`).
       *   • Count RUNNING jobs too. A job already executing was enqueued before this one and is
       *     genuinely ahead of it, so excluding it under-reported the wait. The row itself is
       *     excluded by the rowid tie-break, hence the `count - 1` never going below zero.
       */
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

      // Grab the oldest queued job
      const row = this.db.prepare(`
        SELECT * FROM biophysical_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      `).get() as any;

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
            WHERE id = ?
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
              WHERE id = ?
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

export class BiophysicalJobQueue {
  private static instance: BiophysicalJobQueue | null = null;
  private sqliteQueue: SQLiteQueue | null = null;
  private bullQueue: Queue | null = null;
  private bullWorker: Worker | null = null;
  private redisUrl: string | undefined;

  private concurrency: number;
  private maxQueueLength = 50;
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

  async pushJob(type: "foldx" | "p2rank", data: any): Promise<string> {
    const jobId = crypto.randomUUID();

    // Check backpressure
    const totalJobs = await this.getQueueLength();
    if (totalJobs >= this.maxQueueLength) {
      throw new Error("BUSY: Concurrency and queue limits reached (503)");
    }

    if (this.bullQueue) {
      await this.bullQueue.add(type, data, { jobId });
    } else if (this.sqliteQueue) {
      await this.sqliteQueue.addJob(jobId, type, data);
    }

    return jobId;
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

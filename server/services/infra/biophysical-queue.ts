import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { DatabaseSync } from "node:sqlite";
import { Queue, Worker } from "bullmq";
import { CONFIG } from "../../config.ts";

export interface QueueJob {
  id: string;
  type: "foldx" | "p2rank";
  data: any;
  status: "queued" | "running" | "completed" | "failed";
  result?: any;
  error?: string;
  createdAt: number;
}

class SQLiteQueue {
  private db: DatabaseSync;
  private concurrency: number;
  private runningCount = 0;
  private activeJobs = new Map<string, { abortController?: AbortController }>();
  private processCallback: (type: string, data: any, signal?: AbortSignal, jobId?: string) => Promise<any>;

  private timer: NodeJS.Timeout | null = null;
  private reaperInterval: NodeJS.Timeout | null = null;
  private isShutdown = false;

  constructor(
    dbPath: string,
    concurrency: number,
    processCallback: (type: string, data: any, signal?: AbortSignal, jobId?: string) => Promise<any>
  ) {
    this.concurrency = concurrency;
    this.processCallback = processCallback;

    if (dbPath !== ":memory:") {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);
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

    // Reset any running jobs from a previous crash/restart back to queued status
    this.db.exec(`
      UPDATE biophysical_jobs
      SET status = 'queued', started_at = NULL
      WHERE status = 'running';
    `);

    // Start scheduler polling loop
    this.scheduleNext();

    // Start stale job reaper
    this.startReaper();
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
      createdAt: row.created_at
    };
  }

  updateJobData(id: string, data: any): void {
    this.db.prepare(`
      UPDATE biophysical_jobs
      SET data = ?
      WHERE id = ?
    `).run(JSON.stringify(data), id);
  }

  abortJob(id: string) {
    const active = this.activeJobs.get(id);
    if (active && active.abortController) {
      console.log(`[Queue] Aborting SQLite job: ${id}`);
      active.abortController.abort();
    }
  }

  private scheduleNext() {
    if (this.isShutdown) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.processQueue(), 50);
  }

  private async processQueue() {
    while (this.runningCount < this.concurrency) {
      if (this.isShutdown) return;

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
    if (this.isShutdown) return;
    const maxExecutionTime = 300000; // 5 minutes
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

      // Also reap stuck queued jobs
      const maxQueueWait = 600000; // 10 minutes
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

  private constructor(
    concurrency = 2,
    processCallback: (type: string, data: any, signal?: AbortSignal, jobId?: string) => Promise<any>
  ) {
    this.concurrency = concurrency;
    this.redisUrl = process.env.REDIS_URL;

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
      const dbPath = process.env.NODE_ENV === "test"
        ? ":memory:"
        : path.join(process.cwd(), "data", "shared_state.sqlite");
      this.sqliteQueue = new SQLiteQueue(dbPath, this.concurrency, processCallback);
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

  async getJobStatus(id: string): Promise<{ status: "queued" | "running" | "completed" | "failed"; result?: any; error?: string } | null> {
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
        error: failedReason
      };
    }

    if (this.sqliteQueue) {
      const job = await this.sqliteQueue.getJob(id);
      if (!job) return null;
      return {
        status: job.status,
        result: job.result,
        error: job.error
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
}

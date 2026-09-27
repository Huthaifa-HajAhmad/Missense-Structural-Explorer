import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BiophysicalJobQueue } from "./biophysical-queue.ts";

describe("BiophysicalJobQueue Unit Tests", () => {
  let originalRedisUrl: string | undefined;

  beforeEach(() => {
    originalRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    BiophysicalJobQueue.resetForTesting();
    // NOTE: this suite used to `fs.rmSync` the shared queue database here and in afterEach.
    // That file is the developer's real state: the queue already runs against `:memory:`
    // under NODE_ENV=test (biophysical-queue.ts:404-406), so `resetForTesting()` alone gives
    // a clean queue and the deletions only ever destroyed real data.
  });

  afterEach(() => {
    BiophysicalJobQueue.resetForTesting();
    if (originalRedisUrl !== undefined) {
      process.env.REDIS_URL = originalRedisUrl;
    } else {
      delete process.env.REDIS_URL;
    }
  });

  it("should process jobs sequentially up to concurrency limit", async () => {
    let runningCount = 0;
    let maxRunning = 0;
    const activeResolvers: (() => void)[] = [];

    const queue = BiophysicalJobQueue.initialize(2, async (type, data) => {
      runningCount++;
      if (runningCount > maxRunning) {
        maxRunning = runningCount;
      }
      return new Promise<string>((resolve) => {
        activeResolvers.push(() => {
          runningCount--;
          resolve(`done:${type}:${data.val}`);
        });
      });
    });

    const job1 = await queue.pushJob("foldx", { val: 1 });
    const job2 = await queue.pushJob("foldx", { val: 2 });
    const job3 = await queue.pushJob("foldx", { val: 3 });

    // Wait short time for queue scheduler to cycle
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Concurrency limit is 2, so 2 should be active/running, 1 queued
    expect(maxRunning).toBe(2);

    let status1 = await queue.getJobStatus(job1);
    let status2 = await queue.getJobStatus(job2);
    let status3 = await queue.getJobStatus(job3);

    expect(status1?.status).toBe("running");
    expect(status2?.status).toBe("running");
    expect(status3?.status).toBe("queued");

    // Resolve first job
    activeResolvers[0]();
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Job 3 should now start running
    status1 = await queue.getJobStatus(job1);
    status3 = await queue.getJobStatus(job3);

    expect(status1?.status).toBe("completed");
    expect(status1?.result).toBe("done:foldx:1");
    expect(status3?.status).toBe("running");

    // Resolve remaining jobs
    activeResolvers[1]();
    activeResolvers[2]();
    await new Promise((resolve) => setTimeout(resolve, 150));

    status2 = await queue.getJobStatus(job2);
    status3 = await queue.getJobStatus(job3);
    expect(status2?.status).toBe("completed");
    expect(status3?.status).toBe("completed");
  });

  it("should reject jobs and return 503 backpressure when queue limit is reached", async () => {
    const queue = BiophysicalJobQueue.initialize(1, async () => {
      return new Promise((resolve) => setTimeout(resolve, 1000));
    });

    // Make the max limit 3 for this test
    (queue as any).maxQueueLength = 3;

    await queue.pushJob("foldx", { val: 1 }); // runs
    await queue.pushJob("foldx", { val: 2 }); // queued 1
    await queue.pushJob("foldx", { val: 3 }); // queued 2

    // 4th job should fail due to backpressure (limit is 3)
    await expect(queue.pushJob("foldx", { val: 4 })).rejects.toThrow("BUSY");
  });

  it("should handle job abort controller signals correctly", async () => {
    let wasAborted = false;

    const queue = BiophysicalJobQueue.initialize(1, async (type, data, signal) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve("done"), 1000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timeout);
          wasAborted = true;
          reject(new Error("Job aborted"));
        });
      });
    });

    const job = await queue.pushJob("foldx", { val: 1 });
    await new Promise((resolve) => setTimeout(resolve, 150));

    let status = await queue.getJobStatus(job);
    expect(status?.status).toBe("running");

    // Abort job
    await queue.abortJob(job);
    await new Promise((resolve) => setTimeout(resolve, 150));

    status = await queue.getJobStatus(job);
    expect(status?.status).toBe("failed");
    expect(status?.error).toContain("Job aborted");
    expect(wasAborted).toBe(true);
  });

  it("should mark jobs failed with the exact engine error when the worker callback rejects", async () => {
    const queue = BiophysicalJobQueue.initialize(1, async () => {
      throw new Error("FoldX binary not found or not executable at: tools/foldx");
    });

    const job = await queue.pushJob("foldx", { val: 1 });
    // Allow the scheduler to pick up and fail the job
    await new Promise((resolve) => setTimeout(resolve, 300));

    const status = await queue.getJobStatus(job);
    expect(status?.status).toBe("failed");
    expect(status?.error).toContain("FoldX binary not found or not executable");
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * PROGRESS THE JOB RECORD CARRIES
   * ─────────────────────────────────────────────────────────────────────────────
   * The UI used to fabricate a stage from elapsed time because nothing ever told it what the FoldX
   * worker was doing. These two accessors are how the truth gets out — and they must not be able to
   * fail the job whose progress they describe.
   */
  it("records the phase on the job record, and reports when the job started executing", async () => {
    let releaseJob: () => void = () => {};
    const queue = BiophysicalJobQueue.initialize(1, async () => {
      return new Promise<string>((resolve) => { releaseJob = () => resolve("done"); });
    });

    const job = await queue.pushJob("foldx", { val: 1 });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const started = await queue.getJobStatus(job);
    expect(started?.status).toBe("running");
    expect(
      typeof started?.startedAt,
      "without startedAt the client can only measure its own spinner, not the job"
    ).toBe("number");
    expect(typeof started?.createdAt).toBe("number");

    await queue.updateJobPhase(job, "repairing");
    const data = await queue.getJobData(job);
    expect(data.phase).toBe("repairing");
    expect(typeof data.phaseAt).toBe("number");
    // The rest of the record survives the annotation — remote job ids in particular.
    await queue.updateJobData(job, { ...data, remoteJobs: { dynamut2JobId: "dyn-1" } });
    await queue.updateJobPhase(job, "modelling");
    const after = await queue.getJobData(job);
    expect(after.phase).toBe("modelling");
    expect(after.remoteJobs.dynamut2JobId).toBe("dyn-1");

    releaseJob();
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  it("counts the jobs ahead of a queued job instead of leaving the wait unexplained", async () => {
    let release: () => void = () => {};
    const queue = BiophysicalJobQueue.initialize(1, async () => {
      return new Promise<string>((resolve) => { release = () => resolve("done"); });
    });

    const first = await queue.pushJob("foldx", { val: 1 }); // runs
    const second = await queue.pushJob("foldx", { val: 2 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // `first` is RUNNING and `second` is waiting behind it: one job is ahead of `second`, not zero.
    // Excluding running jobs (the old query) is what made the count under-report the wait.
    expect(await queue.getQueuePosition(second)).toBe(1);

    const third = await queue.pushJob("foldx", { val: 3 });
    // Two ahead: the running job and the one waiting before it. Pushed in the same millisecond as
    // `second` more often than not, so this also pins the rowid tie-break — `created_at < ?` alone
    // reported "Next in line" for both.
    expect(await queue.getQueuePosition(third)).toBe(2);
    expect(await queue.getQueuePosition(first)).toBe(0);

    // An unknown id answers null rather than throwing.
    expect(await queue.getQueuePosition("no-such-job")).toBeNull();

    release();
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  it("does not lose a phase written while another job-record write is in flight", async () => {
    let release: () => void = () => {};
    const queue = BiophysicalJobQueue.initialize(1, async () => {
      return new Promise<string>((resolve) => { release = () => resolve("done"); });
    });

    const job = await queue.pushJob("foldx", { val: 1 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    /**
     * The real interleaving: a worker recording its phase while the route records a newly-submitted
     * remote job id. Both are read-modify-write of the SAME json blob, and the second writer's read
     * used to happen before the first writer's write — so one of the two updates was silently lost
     * (a run that stopped reporting its stage mid-flight).
     */
    const slowRemoteWrite = queue.mutateJobData(job, async data => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return { ...(data || {}), remoteJobs: { dynamut2JobId: "dyn-9" } };
    });
    const phaseWrite = queue.updateJobPhase(job, "repairing");

    await Promise.all([slowRemoteWrite, phaseWrite]);

    const data = await queue.getJobData(job);
    expect(data.remoteJobs?.dynamut2JobId, "the remote job id was lost").toBe("dyn-9");
    expect(data.phase, "the phase was lost to the other writer").toBe("repairing");

    release();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { BiophysicalJobQueue } from "./biophysical-queue.ts";

describe("BiophysicalJobQueue Unit Tests", () => {
  const dbPath = path.join(process.cwd(), "data", "shared_state.sqlite");

  let originalRedisUrl: string | undefined;

  beforeEach(() => {
    originalRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    BiophysicalJobQueue.resetForTesting();
    // Delete sharing DB if it exists to have clean tests
    try {
      if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { force: true });
      }
    } catch (_) {}
  });

  afterEach(() => {
    BiophysicalJobQueue.resetForTesting();
    if (originalRedisUrl !== undefined) {
      process.env.REDIS_URL = originalRedisUrl;
    } else {
      delete process.env.REDIS_URL;
    }
    try {
      if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { force: true });
      }
    } catch (_) {}
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
});

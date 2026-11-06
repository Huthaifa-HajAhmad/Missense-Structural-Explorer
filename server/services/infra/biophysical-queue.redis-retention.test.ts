import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * On the Redis backend a finished job used to be deleted the moment it completed, so the reader's next
 * poll of `/foldx-job/:id` answered "not found" instead of the result. Finished jobs are now kept as long
 * as the SQLite backend keeps them.
 */
const created: any[] = [];
vi.mock("bullmq", () => ({
  Queue: class {
    constructor(_name: string, opts: any) { created.push(opts); }
    async close() {}
  },
  Worker: class {
    on() { return this; }
    async close() {}
  },
}));

const { BiophysicalJobQueue } = await import("./biophysical-queue.ts");

describe("Redis backend retention", () => {
  afterEach(() => {
    BiophysicalJobQueue.resetForTesting();
    vi.unstubAllEnvs();
  });

  it("keeps finished and failed jobs for the retention period instead of deleting them on completion", () => {
    vi.stubEnv("REDIS_URL", "redis://fake:6379");
    vi.stubEnv("JOB_RETENTION_DAYS", "2");
    BiophysicalJobQueue.initialize(1, async () => "done");
    const options = created.at(-1)?.defaultJobOptions;
    expect(options.removeOnComplete).toEqual({ age: 2 * 86_400 });
    expect(options.removeOnFail).toEqual({ age: 2 * 86_400 });
  });
});

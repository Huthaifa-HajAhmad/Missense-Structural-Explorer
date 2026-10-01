import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SQLiteQueue } from "./biophysical-queue.ts";

describe("SQLite generation handover", () => {
  let directory: string;
  const queues: SQLiteQueue[] = [];
  beforeEach(() => { vi.useFakeTimers(); directory = fs.mkdtempSync(path.join(os.tmpdir(), "mse-handover-")); });
  afterEach(() => {
    queues.splice(0).forEach(queue => queue.shutdown());
    vi.useRealTimers();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const make = (directory: string, worker: ConstructorParameters<typeof SQLiteQueue>[2], paused = false) => {
    const queue = new SQLiteQueue(path.join(directory, "jobs.sqlite"), 1, worker, paused);
    queues.push(queue);
    return queue;
  };

  it("does not reset, reap, or duplicate the old worker's running calculation", async () => {
    let finish!: (value: string) => void;
    const oldWorker = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const old = make(directory, oldWorker);
    await old.addJob("running", "foldx", { phase: "repairing", phaseAt: Date.now() });
    await vi.advanceTimersByTimeAsync(50);
    const newWorker = vi.fn(async () => "new");
    const standby = make(directory, newWorker, true);
    expect((await standby.getJob("running"))?.status).toBe("running");
    expect((await standby.getJob("running"))?.data.phase).toBe("repairing");
    await standby.addJob("waiting", "foldx", {});
    old.pauseProcessing();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(newWorker).not.toHaveBeenCalled();
    expect(old.activeCount).toBe(1);
    finish("old-result");
    await vi.advanceTimersByTimeAsync(100);
    expect(old.activeCount).toBe(0);
    expect((await standby.getJob("running"))?.result).toBe("old-result");
    standby.resumeProcessing();
    await vi.advanceTimersByTimeAsync(100);
    expect(newWorker).toHaveBeenCalledTimes(1);
    expect(oldWorker).toHaveBeenCalledTimes(1);
    expect((await old.getJob("waiting"))?.result).toBe("new");
  });

  it("resumes queued work from a rolled-back standby without a local enqueue", async () => {
    const worker = vi.fn(async () => "done");
    const old = make(directory, worker);
    const standby = make(directory, async () => "must-not-run", true);
    await vi.advanceTimersByTimeAsync(100);
    await standby.addJob("remote", "p2rank", {});
    await vi.advanceTimersByTimeAsync(1100);
    expect(worker).toHaveBeenCalledTimes(1);
    expect((await standby.getJob("remote"))?.status).toBe("completed");
  });
});

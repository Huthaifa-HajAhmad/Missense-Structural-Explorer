import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SQLiteQueue } from "./biophysical-queue.ts";

/**
 * A FoldX job writes `foldxUpdate` when FoldX itself has finished. From then on the job no longer
 * holds the FoldX slot (doc/STATE_MACHINES.md, R9). A job that goes back to the queue starts FoldX
 * again, so it must lose that mark: otherwise its new FoldX run is not counted against the slot, and
 * the screen shows the previous attempt's FoldX value while the new run is still working.
 */

const HOST = { peakRssBytes: null, toolVersion: "v", wallMs: 10, hostId: "agent:A1", hostClass: "agent/x" } as any;

describe("a FoldX job sent back to the queue loses its 'FoldX finished' mark", () => {
  let directory: string;
  const queues: SQLiteQueue[] = [];
  afterEach(() => {
    queues.splice(0).forEach((queue) => queue.shutdown());
    vi.useRealTimers();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const make = (paused = false) => {
    const queue = new SQLiteQueue(path.join(directory, "jobs.sqlite"), 1, () => new Promise(() => {}), paused);
    queues.push(queue);
    return queue;
  };

  it("when the server restarts while the job waits for its companion engines", async () => {
    vi.useFakeTimers();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mse-requeue-mark-"));
    const before = make();
    await before.addJob("f1", "foldx", { name: "f1" });
    await vi.advanceTimersByTimeAsync(50);
    before.updateJobData("f1", { name: "f1", foldxUpdate: { foldx: 1.2, foldxStatus: "success" } });
    before.shutdown();

    // A new process recovers interrupted jobs as it opens the queue; no timer has run yet, so the job
    // is still waiting to be started again.
    const after = make();
    const job = await after.getJob("f1");
    expect(job?.status).toBe("queued");
    expect(job?.data.foldxUpdate).toBeUndefined();
  });

  it("when a paired computer gives the job back to the server", async () => {
    vi.useFakeTimers();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mse-requeue-mark-"));
    const queue = make();
    await queue.addJob("f1", "foldx", { name: "f1" }, { ownerId: "U1", placement: "agent:A1" });
    expect(queue.claimForAgent({ agentId: "A1", userId: "U1" }, ["foldx"], () => true, 60_000)?.id).toBe("f1");
    queue.updateJobData("f1", { name: "f1", foldxUpdate: { foldx: 1.2, foldxStatus: "success" } });

    queue.requeueAgentJobToServer("f1", "A1", { outcome: "requeued", telemetry: "failed", errorClass: "x", host: HOST });
    const job = await queue.getJob("f1");
    expect(job?.data.foldxUpdate).toBeUndefined();
  });
});

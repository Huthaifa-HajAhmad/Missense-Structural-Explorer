import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { SQLiteQueue, BiophysicalJobQueue, AdmissionError } from "./biophysical-queue.ts";
import { classifyJobFailure, isOutOfMemory } from "./failure-class.ts";
import { _resetHostProbe, serverHostFacts } from "./host-probe.ts";
import { recordTelemetry } from "./compute-telemetry.ts";
import { ceilingRefusal } from "./admission.ts";
import { hostClassOf } from "../../../src/shared/computeRouting.ts";
import { classifyFoldxFailure, describeFoldxFailure } from "../stability/foldx/failure.ts";

/**
 * WP-0 (telemetry) and WP-D (admission, out-of-memory) acceptance, against the real queue.
 * The server's tools are pinned so the result does not depend on what this machine has installed.
 */

const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const BOTH_TOOLS = [
  { name: "foldx", version: "unknown", verified: true },
  { name: "p2rank", version: "unknown", verified: true },
];
const serverClass = () => hostClassOf(serverHostFacts());

let savedMode: string | undefined;
beforeEach(() => {
  savedMode = process.env.COMPUTE_ROUTING;
  _resetHostProbe(BOTH_TOOLS);
  BiophysicalJobQueue.resetForTesting();
});
afterEach(() => {
  if (savedMode === undefined) delete process.env.COMPUTE_ROUTING;
  else process.env.COMPUTE_ROUTING = savedMode;
  _resetHostProbe();
  BiophysicalJobQueue.resetForTesting();
  vi.restoreAllMocks();
});

const dbOf = (q: BiophysicalJobQueue) => ((q as any).sqliteQueue as any).db as DatabaseSync;
const sqliteOf = (q: BiophysicalJobQueue) => (q as any).sqliteQueue as SQLiteQueue;

function seedOom(db: DatabaseSync, residues: number, id = `oom-${residues}`) {
  recordTelemetry(db, {
    jobId: id, type: "foldx", hostId: "server", hostClass: serverClass(), residues, repaired: false, runs: 5,
    wallMs: 1000, peakRssBytes: null, outcome: "oom", errorClass: "oom", toolVersion: null, createdAt: Date.now(),
  });
}

describe("failure classification", () => {
  it("tells an out-of-memory death from our own timeout, a cancel and an ordinary failure", () => {
    expect(classifyJobFailure({ message: "Command failed", signal: "SIGKILL", killed: false })).toBe("oom");
    expect(classifyJobFailure({ message: "Command failed", signal: "SIGTERM", killed: true })).toBe("timeout");
    expect(classifyJobFailure(new Error("Exception in thread main java.lang.OutOfMemoryError: Java heap space"))).toBe("oom");
    expect(classifyJobFailure(new Error("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"))).toBe("oom");
    expect(classifyJobFailure(new Error("Job execution timed out"))).toBe("timeout");
    expect(classifyJobFailure(new Error("Cancelled."))).toBe("cancelled");
    expect(classifyJobFailure(new Error("Mutation mismatch at 175"))).toBe("failed");
    expect(isOutOfMemory({ code: 137 })).toBe(true);
  });

  it("FoldX says the structure did not fit in memory instead of calling a kernel kill a crash or a timeout", () => {
    const oomKill = { message: "Command failed: box64 foldx", signal: "SIGKILL", killed: false, stderr: "Unhandled signal caught" };
    expect(classifyFoldxFailure(oomKill)).toBe("out-of-memory");
    const text = describeFoldxFailure(oomKill, false);
    expect(text).toContain("did not fit in memory on the server");
    expect(text).not.toContain("execution budget");
    // Our own budget kill is still a timeout.
    expect(classifyFoldxFailure({ ...oomKill, killed: true, signal: "SIGTERM" })).toBe("timeout");
  });
});

describe("telemetry (WP-0)", () => {
  it("writes a row for a completed job and for a failed one", async () => {
    const q = new SQLiteQueue(":memory:", 2, async (_t, d) => {
      if (d.fail) throw new Error("engine rejected input");
      return "ok";
    });
    try {
      await q.addJob("ok", "foldx", {}, { ownerId: "X", residues: 154 });
      await q.addJob("bad", "p2rank", { fail: true }, { ownerId: "X", residues: 300 });
      await tick(250);
      const rows = ((q as any).db as DatabaseSync).prepare("SELECT job_id, type, residues, repaired, outcome, wall_ms, host_class FROM job_telemetry ORDER BY job_id").all() as any[];
      expect(rows).toEqual([
        expect.objectContaining({ job_id: "bad", type: "p2rank", residues: 300, repaired: null, outcome: "failed", host_class: serverClass() }),
        expect.objectContaining({ job_id: "ok", type: "foldx", residues: 154, repaired: 1, outcome: "completed" }),
      ]);
      expect(rows[1].wall_ms).toBeGreaterThanOrEqual(0);
    } finally {
      q.shutdown();
    }
  });
});

describe("admission (WP-D)", () => {
  it("on: a job larger than the learned ceiling is refused with the reason before it starts", async () => {
    process.env.COMPUTE_ROUTING = "on";
    const started: string[] = [];
    const queue = BiophysicalJobQueue.initialize(1, async (_t, d) => { started.push(d.name); return "ok"; });
    seedOom(dbOf(queue), 800);
    sqliteOf(queue).getCostModels(); // first fit

    const refused = await queue.pushJob("foldx", { name: "big" }, { ownerId: "X", residues: 900 }).catch((e) => e);
    expect(refused).toBeInstanceOf(AdmissionError);
    expect(refused).toMatchObject({ status: 422, code: "CANNOT_RUN_HERE" });
    expect(refused.message).toMatch(/900 residues/);
    expect(refused.message).toMatch(/800/);

    // Below the ceiling it is admitted and runs.
    await expect(queue.pushJob("foldx", { name: "small" }, { ownerId: "X", residues: 300 })).resolves.toBeTruthy();
    await tick();
    expect(started).toEqual(["small"]);
  });

  it("on: a killed child marks the ceiling, and the next larger job is refused, not run into the same death", async () => {
    process.env.COMPUTE_ROUTING = "on";
    const started: string[] = [];
    let releaseFirst!: () => void;
    const queue = BiophysicalJobQueue.initialize(1, (_t, d) => {
      started.push(d.name);
      if (d.name === "first") {
        return new Promise((_res, rej) => {
          releaseFirst = () => rej(Object.assign(new Error("Command failed: box64 foldx"), { signal: "SIGKILL", killed: false }));
        });
      }
      return Promise.resolve("ok");
    });

    const first = await queue.pushJob("foldx", { name: "first" }, { ownerId: "X", residues: 700 });
    // Queued behind it, and larger: admitted now, because nothing has died yet.
    const waiting = await queue.pushJob("foldx", { name: "waiting" }, { ownerId: "Y", residues: 750 });
    await tick();
    releaseFirst();
    await tick(300);

    const firstStatus = await queue.getJobStatus(first);
    expect(firstStatus?.status).toBe("failed");
    expect(firstStatus?.error).toMatch(/This structure \(700 residues\) did not fit in memory on the server/);

    const waitingStatus = await queue.getJobStatus(waiting);
    expect(waitingStatus?.status).toBe("failed");
    expect(waitingStatus?.error).toMatch(/too large to run on the shared server: a structure of 700 residues ran out of memory/);
    expect(started).toEqual(["first"]); // never started

    const later = await queue.pushJob("foldx", { name: "later" }, { ownerId: "Z", residues: 760 }).catch((e) => e);
    expect(later).toBeInstanceOf(AdmissionError);
  });

  it("shadow (the default outside tests): logs the decision and refuses nothing", async () => {
    process.env.COMPUTE_ROUTING = "shadow";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const queue = BiophysicalJobQueue.initialize(1, async () => "ok");
    seedOom(dbOf(queue), 800);

    await expect(queue.pushJob("foldx", { name: "big" }, { ownerId: "X", residues: 900 })).resolves.toBeTruthy();
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[routing:shadow]"));
    expect(line).toBeTruthy();
    expect(JSON.parse(line!.slice("[routing:shadow] ".length))).toMatchObject({ type: "foldx", residues: 900, decision: "reject", actual: "server" });
  });

  it("off: the engine is not consulted at all", async () => {
    process.env.COMPUTE_ROUTING = "off";
    const queue = BiophysicalJobQueue.initialize(1, async () => "ok");
    seedOom(dbOf(queue), 800);
    await expect(queue.pushJob("foldx", { name: "big" }, { ownerId: "X", residues: 900 })).resolves.toBeTruthy();
  });

  it("on: a tool the server does not have is refused up front with that reason", async () => {
    process.env.COMPUTE_ROUTING = "on";
    _resetHostProbe([{ name: "foldx", version: "unknown", verified: true }]);
    const queue = BiophysicalJobQueue.initialize(1, async () => "ok");
    const refused = await queue.pushJob("p2rank", { name: "pocket" }, { ownerId: "X", residues: 300 }).catch((e) => e);
    expect(refused).toBeInstanceOf(AdmissionError);
    expect(refused.message).toMatch(/P2Rank/i);
  });

  it("an unknown size is never refused (every rule is about size or tools)", () => {
    expect(ceilingRefusal("foldx", 0, serverHostFacts(), {})).toBeNull();
  });
});

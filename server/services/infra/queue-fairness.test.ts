import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteQueue, BiophysicalJobQueue, QueueLimitError } from "./biophysical-queue.ts";

/**
 * Ownership, fair claim, queue position and cancel (doc/COMPUTE_ROUTING_PLAN.md WP-B).
 *
 * These drive `SQLiteQueue` directly with a callback the test controls, so "which job started
 * when" is observed rather than inferred.
 */

const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/** A queue whose jobs start immediately and finish only when the test says so. */
function controlled(concurrency: number, paused = false) {
  const started: string[] = [];
  const release = new Map<string, () => void>();
  const q = new SQLiteQueue(
    ":memory:",
    concurrency,
    (_type, data) => {
      started.push(data.name);
      return new Promise((resolve) => release.set(data.name, () => resolve("done")));
    },
    paused,
  );
  return { q, started, release };
}

const open: SQLiteQueue[] = [];
const track = (q: SQLiteQueue) => (open.push(q), q);
afterEach(() => {
  while (open.length) open.pop()!.shutdown();
});

describe("fair claim", () => {
  it("lets a second person's job start before the first person's third, however many X queued", async () => {
    const { q, started } = controlled(2);
    track(q);
    for (let i = 1; i <= 30; i++) await q.addJob(`x${i}`, "foldx", { name: `x${i}` }, { ownerId: "X" });
    await q.addJob("y1", "foldx", { name: "y1" }, { ownerId: "Y" });
    await tick();
    expect(started).toHaveLength(2);
    expect(started).toContain("y1");
    expect(started).toContain("x1");
  });

  it("is work-conserving: one person with queued work takes every free slot", async () => {
    const { q, started } = controlled(3);
    track(q);
    for (let i = 1; i <= 5; i++) await q.addJob(`x${i}`, "foldx", { name: `x${i}` }, { ownerId: "X" });
    await tick();
    expect(started).toEqual(["x1", "x2", "x3"]);
    expect(q.activeCount).toBe(3);
  });

  it("rotates between people even with a single slot, instead of falling back to arrival order", async () => {
    const { q, started, release } = controlled(1);
    track(q);
    for (let i = 1; i <= 3; i++) await q.addJob(`x${i}`, "foldx", { name: `x${i}` }, { ownerId: "X" });
    await q.addJob("y1", "foldx", { name: "y1" }, { ownerId: "Y" });
    await q.addJob("y2", "foldx", { name: "y2" }, { ownerId: "Y" });
    await tick();
    for (let i = 0; i < 5; i++) {
      release.get(started[started.length - 1])!();
      await tick(80);
    }
    expect(started).toEqual(["x1", "y1", "x2", "y2", "x3"]);
  });

  it("runs pre-warm (system) work only after every person's job", async () => {
    const { q, started, release } = controlled(1);
    track(q);
    await q.addJob("blocker", "foldx", { name: "blocker" }, { ownerId: "X" });
    await q.addJob("warm", "foldx", { name: "warm" }, { ownerId: "system" });
    await q.addJob("late", "foldx", { name: "late" }, { ownerId: "Y" });
    await tick();
    release.get("blocker")!();
    await tick();
    expect(started).toEqual(["blocker", "late"]);
  });

  it("a person who joins a pre-warm job lifts it above other people's new work", async () => {
    const { q, started, release } = controlled(1);
    track(q);
    await q.addJob("blocker", "foldx", { name: "blocker" }, { ownerId: "X" });
    await q.addJob("warm", "foldx", { name: "warm" }, { ownerId: "system" });
    await q.addJob("newer", "foldx", { name: "newer" }, { ownerId: "Z" });
    q.addWatcher("warm", "Y");
    await tick();
    release.get("blocker")!();
    await tick();
    // `warm` is now somebody's wait, and it was queued before `newer`.
    expect(started[1]).toBe("warm");
  });
});

describe("queue position follows the order the scheduler consumes", () => {
  it("matches the real claim order for several owners and priorities", async () => {
    const { q } = controlled(3, true); // paused: nothing runs, so the order can be read off first
    track(q);
    const plan: [string, string, number?][] = [
      ["a1", "A"], ["a2", "A"], ["a3", "A"], ["b1", "B"], ["warm", "system", -10],
      ["c1", "C"], ["b2", "B"], ["c2", "C"], ["a4", "A"],
    ];
    for (const [name, owner, priority] of plan) await q.addJob(name, "foldx", { name }, { ownerId: owner, priority });

    const predicted = plan
      .map(([name]) => ({ name, ahead: q.getQueuePosition(name)! }))
      .sort((l, r) => l.ahead - r.ahead)
      .map((p) => p.name);

    // Consume the way processQueue does: pick, mark running, repeat (nothing finishes in between).
    const db = (q as any).db as DatabaseSync;
    const consumed: string[] = [];
    for (let i = 0; i < plan.length; i++) {
      const row = (q as any).pickNext();
      consumed.push(row.id);
      db.prepare("UPDATE biophysical_jobs SET status = 'running', started_at = ? WHERE id = ?").run(1_000_000 + i, row.id);
    }
    expect(consumed).toEqual(predicted);
    expect(new Set(predicted).size).toBe(plan.length); // every position distinct: no two "next in line"
  });
});

describe("legacy rows", () => {
  it("a database written before ownership still runs, its rows owned by `legacy`", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mse-queue-")), "old.sqlite");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE biophysical_jobs (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL,
      result TEXT, error TEXT, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER);`);
    old.prepare("INSERT INTO biophysical_jobs (id, type, data, status, created_at) VALUES ('old1','foldx',?, 'queued', ?)")
      .run(JSON.stringify({ name: "old1" }), Date.now() - 1000);
    old.close();

    const { q, started } = (() => {
      const started: string[] = [];
      const q = new SQLiteQueue(file, 1, async (_t, d) => { started.push(d.name); return "ok"; });
      return { q, started };
    })();
    track(q);
    await tick(250);
    expect(started).toEqual(["old1"]);
    expect((await q.getJob("old1"))?.ownerId).toBe("legacy");
    expect((await q.getJob("old1"))?.status).toBe("completed");
  });
});

describe("cancel", () => {
  it("refuses someone who neither owns nor joined the job", async () => {
    const { q } = controlled(1, true);
    track(q);
    await q.addJob("j", "foldx", { name: "j" }, { ownerId: "X" });
    expect(q.cancelFor("j", "Y", false)).toEqual({ ok: false, reason: "forbidden" });
    expect((await q.getJob("j"))?.status).toBe("queued");
  });

  it("with a second watcher, cancelling withdraws only the caller; the last one stops the job", async () => {
    const { q } = controlled(1, true);
    track(q);
    await q.addJob("j", "foldx", { name: "j" }, { ownerId: "X" });
    q.addWatcher("j", "Y");

    expect(q.cancelFor("j", "X", false)).toEqual({ ok: true, aborted: false, remainingWatchers: 1 });
    expect((await q.getJob("j"))?.status).toBe("queued");

    expect(q.cancelFor("j", "Y", false)).toEqual({ ok: true, aborted: true, remainingWatchers: 0 });
    const job = await q.getJob("j");
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("Cancelled.");
  });

  it("an admin stops a job outright, even one other people are still waiting on", async () => {
    const { q } = controlled(1, true);
    track(q);
    await q.addJob("j", "foldx", { name: "j" }, { ownerId: "X" });
    q.addWatcher("j", "Y");
    expect(q.cancelFor("j", "boss", true)).toMatchObject({ ok: true, aborted: true });
    expect((await q.getJob("j"))?.status).toBe("failed");
  });

  it("cancelling a running job aborts it, frees its slot, and the next job starts", async () => {
    const { q, started } = controlled(1);
    track(q);
    let aborted = false;
    const q2 = track(new SQLiteQueue(":memory:", 1, (_t, d, signal) => {
      started.push(d.name);
      return new Promise((_res, rej) => signal?.addEventListener("abort", () => { aborted = true; rej(new Error("aborted")); }));
    }));
    await q2.addJob("r", "foldx", { name: "r" }, { ownerId: "X" });
    await q2.addJob("n", "foldx", { name: "n" }, { ownerId: "X" });
    await tick();
    expect(q2.cancelFor("r", "X", false)).toMatchObject({ ok: true, aborted: true });
    await tick(200);
    expect(aborted).toBe(true);
    expect((await q2.getJob("r"))?.error).toBe("Cancelled."); // not overwritten by the unwinding callback
    expect(started).toContain("n");
    void q;
  });

  it("a finished or unknown job is reported as such", async () => {
    const { q } = controlled(1, true);
    track(q);
    expect(q.cancelFor("nope", "X", false)).toEqual({ ok: false, reason: "not_found" });
    q.addCompletedJob("done", "foldx", {}, {});
    expect(q.cancelFor("done", "boss", true)).toEqual({ ok: false, reason: "finished" });
  });
});

describe("limits and listing", () => {
  afterEach(() => BiophysicalJobQueue.resetForTesting());

  it("refuses a person's job over their queued limit with a message that says how many, not anyone else's", async () => {
    BiophysicalJobQueue.resetForTesting();
    const queue = BiophysicalJobQueue.initialize(1, () => new Promise(() => {}));
    const limits = { queuedPerUser: 2, serverSecondsPerDay: null };

    await queue.pushJob("foldx", { name: "run" }, { ownerId: "X", limits }); // runs
    await tick(120); // let it start: running jobs do not count against the queued limit
    await queue.pushJob("foldx", { name: "q1" }, { ownerId: "X", limits });
    await queue.pushJob("foldx", { name: "q2" }, { ownerId: "X", limits });
    await tick(80);
    const refused = await queue.pushJob("foldx", { name: "q3" }, { ownerId: "X", limits }).catch((e) => e);
    expect(refused).toBeInstanceOf(QueueLimitError);
    expect(refused).toMatchObject({ status: 429, code: "QUEUED_PER_USER" });
    expect(refused.message).toBe("You already have 2 jobs waiting (your limit is 2). Cancel one, or wait for one to start.");
    // Somebody else is unaffected by X's backlog, and an admin's higher override for X is honoured.
    await expect(queue.pushJob("foldx", { name: "y1" }, { ownerId: "Y", limits })).resolves.toBeTruthy();
    await expect(queue.pushJob("foldx", { name: "q3" }, { ownerId: "X", limits: { ...limits, queuedPerUser: 3 } })).resolves.toBeTruthy();
  });

  it("enforces a daily server-time cap only when one is set, and says when it resets", async () => {
    BiophysicalJobQueue.resetForTesting();
    const queue = BiophysicalJobQueue.initialize(1, async () => "ok");
    const db = ((queue as any).sqliteQueue as any).db as DatabaseSync;
    const now = Date.now();
    // 40 minutes of finished work today.
    db.prepare(`INSERT INTO biophysical_jobs (id, type, data, status, created_at, started_at, completed_at, owner_id)
      VALUES ('done', 'foldx', '{}', 'completed', ?, ?, ?, 'X')`).run(now - 2_400_000, now - 2_400_000, now);

    const uncapped = { queuedPerUser: 25, serverSecondsPerDay: null };
    await expect(queue.pushJob("foldx", { name: "a" }, { ownerId: "X", limits: uncapped })).resolves.toBeTruthy();

    const capped = { queuedPerUser: 25, serverSecondsPerDay: 30 * 60 };
    const refused = await queue.pushJob("foldx", { name: "b" }, { ownerId: "X", limits: capped }).catch((e) => e);
    // Only meaningful when the 40 minutes all fall on today (UTC); skip the assertion in the first 40 min of a day.
    if (new Date(now - 2_400_000).getUTCDate() === new Date(now).getUTCDate()) {
      expect(refused).toMatchObject({ code: "DAILY_SERVER_TIME", status: 429 });
      expect(refused.message).toMatch(/You have used 40 min of your 30 min of server time today\. It resets at 00:00 UTC\./);
      expect(queue.usageFor("X", now)).toEqual({ todaySeconds: 2400, weekSeconds: expect.any(Number) });
    }
    expect(queue.usageFor("X", now)!.weekSeconds).toBeGreaterThanOrEqual(2400);
    expect(queue.usageFor("nobody", now)).toEqual({ todaySeconds: 0, weekSeconds: 0 });
  });

  it("lists a person's own and joined jobs with a queue place, newest first", async () => {
    const { q } = controlled(1);
    track(q);
    await q.addJob("x1", "foldx", { name: "x1", mutation: "VA600E", uniprotId: "P15056" }, { ownerId: "X" });
    await q.addJob("y1", "foldx", { name: "y1", mutation: "R175H" }, { ownerId: "Y" });
    await q.addJob("x2", "foldx", { name: "x2", mutation: "G12D" }, { ownerId: "X" });
    q.addWatcher("y1", "X");
    await tick();

    const mine = q.listFor("X");
    expect(mine.map((j) => j.id)).toEqual(["x2", "y1", "x1"]);
    expect(mine.find((j) => j.id === "y1")).toMatchObject({ mine: false, label: "R175H", status: "queued" });
    expect(mine.find((j) => j.id === "x1")).toMatchObject({ mine: true, status: "running", queuedAhead: null });
    expect(q.listFor("nobody")).toEqual([]);
  });

  it("estimates the wait only when everything ahead has an estimate", async () => {
    const { q } = controlled(1);
    track(q);
    await q.addJob("a", "foldx", { name: "a" }, { ownerId: "X", costEstimateMs: 60_000 });
    await q.addJob("b", "foldx", { name: "b" }, { ownerId: "X", costEstimateMs: 30_000 });
    await q.addJob("c", "foldx", { name: "c" }, { ownerId: "X" });
    await tick();
    const eta = q.getEta("b");
    expect(eta?.waitMs).toBeGreaterThan(55_000);
    expect(eta?.waitMs).toBeLessThanOrEqual(60_000);
    expect(eta?.runMs).toBe(30_000);
    // `c` has no estimate of its own and is behind `b`, which does: wait is known, run is not.
    expect(q.getEta("c")?.runMs).toBeNull();
  });
});

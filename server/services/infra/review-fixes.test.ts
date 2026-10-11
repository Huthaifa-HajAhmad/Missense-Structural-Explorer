import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { SQLiteQueue, BiophysicalJobQueue, QueueLimitError } from "./biophysical-queue.ts";
import { JobRegistry } from "./foldx-job-registry.ts";
import { corsDecision } from "../../express-config.ts";
import { withProvenanceFor, type ComputeProvenance } from "../../../src/shared/computeProvenance.ts";
import { LRUCache } from "lru-cache";
import { shareableCachedPocket } from "../structure/pocket/runner.ts";

/**
 * Regression tests for the findings of the WP-B/D/E senior review (2026-10-10). Each block names the
 * finding it pins, so a later change that reintroduces one fails here with a reason.
 */

const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const dbOf = (q: SQLiteQueue) => (q as any).db as DatabaseSync;
const open: SQLiteQueue[] = [];
const track = (q: SQLiteQueue) => (open.push(q), q);

afterEach(() => {
  while (open.length) open.pop()!.shutdown();
  BiophysicalJobQueue.resetForTesting();
  vi.restoreAllMocks();
});

describe("telemetry endings", () => {
  it("a worker that RESOLVES with a failure is not a completed run (soft failure)", async () => {
    const q = track(new SQLiteQueue(":memory:", 1, async () => ({ status: "unavailable" })));
    await q.addJob("j", "p2rank", {}, { ownerId: "X", residues: 300 });
    await tick(250);
    const row = dbOf(q).prepare("SELECT outcome, error_class FROM job_telemetry WHERE job_id = 'j'").get() as any;
    expect(row).toMatchObject({ outcome: "failed", error_class: "result:unavailable" });
  });

  it("a running job the reaper ends is recorded as a timeout", async () => {
    const q = track(new SQLiteQueue(":memory:", 1, () => new Promise(() => {})));
    await q.addJob("j", "foldx", {}, { ownerId: "X", residues: 300 });
    await tick();
    dbOf(q).prepare("UPDATE biophysical_jobs SET started_at = 1 WHERE id = 'j'").run(); // long ago
    (q as any).reapStaleJobs();
    const row = dbOf(q).prepare("SELECT outcome FROM job_telemetry WHERE job_id = 'j'").get() as any;
    expect(row?.outcome).toBe("timeout");
  });

  it("a job cancelled while its worker was finishing is not recorded as completed", async () => {
    let finish!: () => void;
    const q = track(new SQLiteQueue(":memory:", 1, () => new Promise((res) => { finish = () => res({ status: "success" }); })));
    await q.addJob("j", "foldx", {}, { ownerId: "X", residues: 300 });
    await tick();
    // The worker ignores the abort and finishes anyway, right after the cancel.
    q.cancelFor("j", "X", false);
    finish();
    await tick();
    expect((await q.getJob("j"))?.error).toBe("Cancelled.");
    const row = dbOf(q).prepare("SELECT outcome FROM job_telemetry WHERE job_id = 'j'").get() as any;
    expect(row?.outcome).toBe("cancelled");
  });
});

describe("queue rules", () => {
  it("an admin stops a job outright even when they also joined it", async () => {
    const q = track(new SQLiteQueue(":memory:", 1, () => new Promise(() => {}), true));
    await q.addJob("j", "foldx", {}, { ownerId: "X" });
    q.addWatcher("j", "boss");
    expect(q.cancelFor("j", "boss", true)).toMatchObject({ ok: true, aborted: true });
  });

  it("joining lifts only background (pre-warm) priority, not any deliberately lowered one", async () => {
    const q = track(new SQLiteQueue(":memory:", 1, () => new Promise(() => {}), true));
    await q.addJob("low", "foldx", {}, { ownerId: "X", priority: -5 });
    await q.addJob("warm", "foldx", {}, { ownerId: "system" });
    q.addWatcher("low", "Y");
    q.addWatcher("warm", "Y");
    const prio = (id: string) => (dbOf(q).prepare("SELECT priority FROM biophysical_jobs WHERE id = ?").get(id) as any).priority;
    expect(prio("low")).toBe(-5);
    expect(prio("warm")).toBe(0);
  });

  it("concurrent submissions from one person cannot jointly exceed their limit", async () => {
    const queue = BiophysicalJobQueue.initialize(1, () => new Promise(() => {}));
    const limits = { queuedPerUser: 2, queuedPerUserExplicit: true, serverSecondsPerDay: null };
    await queue.pushJob("foldx", { n: 0 }, { ownerId: "X", limits });
    await tick(); // the first one runs; the limit counts waiting jobs
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => queue.pushJob("foldx", { n }, { ownerId: "X", limits })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof QueueLimitError)).toBe(true);
  });

  it("the daily cap counts the estimated time of jobs already waiting, so a burst cannot overrun it", async () => {
    const queue = BiophysicalJobQueue.initialize(1, () => new Promise(() => {}));
    const limits = { queuedPerUser: 25, serverSecondsPerDay: 30 * 60 };
    const tenMinutes = 10 * 60 * 1000;
    await queue.pushJob("foldx", { n: 1 }, { ownerId: "X", limits, costEstimateMs: tenMinutes });
    await queue.pushJob("foldx", { n: 2 }, { ownerId: "X", limits, costEstimateMs: tenMinutes });
    await queue.pushJob("foldx", { n: 3 }, { ownerId: "X", limits, costEstimateMs: tenMinutes });
    const refused = await queue.pushJob("foldx", { n: 4 }, { ownerId: "X", limits, costEstimateMs: tenMinutes }).catch((e) => e);
    expect(refused).toBeInstanceOf(QueueLimitError);
    expect(refused.message).toMatch(/jobs you already have waiting need about 30 min more/);
  });

  it("restart recovery clears agent lease fields so the job is decided again", () => {
    const q = track(new SQLiteQueue(":memory:", 1, () => new Promise(() => {}), true));
    const db = dbOf(q);
    db.prepare(`INSERT INTO biophysical_jobs (id, type, data, status, created_at, started_at, placement, claimed_by, lease_expires_at)
      VALUES ('j', 'foldx', '{}', 'running', 1, 2, 'agent:a1', 'agent:a1', 999)`).run();
    (q as any).recoverInterruptedJobs();
    // The lease was already spent, so the computer lost the job: like any hand-back it goes to the server
    // (which keeps it), while the lease fields themselves are cleared.
    expect(db.prepare("SELECT status, placement, claimed_by, lease_expires_at FROM biophysical_jobs WHERE id = 'j'").get())
      .toEqual({ status: "queued", placement: "server", claimed_by: null, lease_expires_at: null });
  });

  it("finished jobs and old telemetry are pruned; waiting jobs never are", () => {
    const q = track(new SQLiteQueue(":memory:", 1, () => new Promise(() => {}), true));
    const db = dbOf(q);
    const old = Date.now() - 30 * 86_400_000;
    db.prepare("INSERT INTO biophysical_jobs (id, type, data, status, created_at, completed_at) VALUES ('done', 'foldx', '{}', 'completed', ?, ?)").run(old, old);
    db.prepare("INSERT INTO biophysical_jobs (id, type, data, status, created_at) VALUES ('waiting', 'foldx', '{}', 'queued', ?)").run(old);
    db.prepare("INSERT INTO job_watchers (job_id, user_id) VALUES ('done', 'X')").run();
    q.pruneHistory();
    const ids = (db.prepare("SELECT id FROM biophysical_jobs").all() as any[]).map((r) => r.id);
    expect(ids).toEqual(["waiting"]);
    expect(db.prepare("SELECT count(*) AS c FROM job_watchers").get()).toEqual({ c: 0 });
  });
});

describe("privacy", () => {
  const prov: ComputeProvenance = { computedOn: "server", hostClass: "h", toolVersion: null, ownerId: "owner-id" };

  it("another person never sees the owner's account id in a result", () => {
    const result = { ddG: 1, computeProvenance: prov };
    expect(withProvenanceFor(result, "owner-id").computeProvenance?.ownerId).toBe("owner-id");
    expect(withProvenanceFor(result, "someone-else").computeProvenance?.ownerId).toBeNull();
    expect(withProvenanceFor(result, null).computeProvenance?.ownerId).toBeNull();
    expect(result.computeProvenance.ownerId).toBe("owner-id"); // the stored value is untouched
  });

  it("the pocket worker never reuses a private (unshared agent) result from its cache", () => {
    const cache = new LRUCache<string, any>({ max: 10 });
    cache.set("private", { status: "success", computeProvenance: { computedOn: "agent", hostClass: null, toolVersion: "2.5", ownerId: "o", shared: false, validated: true } });
    cache.set("server", { status: "success", computeProvenance: prov });
    cache.set("legacy", { status: "success" });
    expect(shareableCachedPocket(cache, "private")).toBeNull();
    expect(shareableCachedPocket(cache, "server")).not.toBeNull();
    expect(shareableCachedPocket(cache, "legacy")).not.toBeNull();
  });

  it("my-jobs does not reveal the owner of a job the caller only joined", async () => {
    const q = track(new SQLiteQueue(":memory:", 1, () => new Promise(() => {}), true));
    await q.addJob("j", "foldx", {}, { ownerId: "X" });
    q.addWatcher("j", "Y");
    expect(q.listFor("Y")[0]).toMatchObject({ id: "j", mine: false, ownerId: null });
    expect(q.listFor("X")[0]).toMatchObject({ id: "j", mine: true, ownerId: "X" });
  });

  it("only exact origins get signed-in (credentialed) cross-origin access", () => {
    const env = { PUBLIC_BASE_URL: "https://missense-resolve.duckdns.org", ALLOWED_ORIGINS: "http://localhost:5173" } as NodeJS.ProcessEnv;
    expect(corsDecision("https://missense-resolve.duckdns.org", env)).toEqual({ allowed: true, credentials: true });
    expect(corsDecision("http://localhost:5173", env)).toEqual({ allowed: true, credentials: true });
    expect(corsDecision("https://evil.duckdns.org", env)).toEqual({ allowed: true, credentials: false });
    expect(corsDecision("https://x.trycloudflare.com", env)).toEqual({ allowed: true, credentials: false });
    expect(corsDecision("https://evil.example", env)).toEqual({ allowed: false, credentials: false });
    expect(corsDecision(undefined, env)).toEqual({ allowed: true, credentials: true });
    expect(corsDecision("https://any.example", { ...env, ALLOWED_ORIGINS: "*" })).toEqual({ allowed: true, credentials: false });
  });
});

describe("join registry", () => {
  it("a follower is not handed the leader's refusal; it tries for itself", async () => {
    const reg = new JobRegistry();
    const queue = { getJobStatus: async () => ({ status: "queued" as const }), getJobData: async () => ({}) };
    let releaseLeader!: (e: Error) => void;
    const leader = reg.submitOrJoin({ cacheKey: "k", queue, enqueue: () => new Promise((_res, rej) => { releaseLeader = rej; }) });
    const follower = reg.submitOrJoin({ cacheKey: "k", queue, enqueue: async () => "follower-job" });
    await tick(10); // let the leader reach its enqueue
    releaseLeader(new Error("You already have 25 jobs waiting"));
    await expect(leader).rejects.toThrow(/25 jobs waiting/);
    await expect(follower).resolves.toMatchObject({ queueJobId: "follower-job", joined: false });
  });
});

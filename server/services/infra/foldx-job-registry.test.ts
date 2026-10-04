import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { cleanPdbForFoldX } from "../stability/foldx/pdb-utils.ts";
import { getFoldxCacheKey } from "../stability/foldx/cache.ts";
import {
  activeFoldxJobs,
  buildFoldxCacheKey,
  getActiveFoldxJobId,
  registerActiveFoldxJob,
  releaseActiveFoldxJob,
  resetActiveFoldxJobs,
  submitOrJoinFoldxJob,
  type FoldxQueueLike,
} from "./foldx-job-registry.ts";

const PDB = "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND";
const MUTATION = "SA489C";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE IDENTITY FOR A FOLDX RUN — the pre-warm and the interactive path must agree
 * ─────────────────────────────────────────────────────────────────────────────
 * The defect this module removes (audit R2-F4) was two dedup maps: the interactive path's, keyed by
 * the FoldX cache key, and the pre-warm's, which did not exist. One variant could therefore run two
 * concurrent FoldX jobs.
 *
 * Sharing a map is only worth anything if both callers compute the SAME key, so that is pinned here
 * rather than assumed: the key is the FoldX cache key itself — structure hash + mutation (the chain
 * lives inside it) + conditions — with no prewarm-specific prefix that would make it a second
 * identity for one run.
 */
describe("FoldX job registry", () => {
  beforeEach(() => {
    resetActiveFoldxJobs();
    vi.restoreAllMocks();
  });

  describe("buildFoldxCacheKey", () => {
    it("is the FoldX cache key itself, with no ad-hoc prefix or suffix", () => {
      const key = buildFoldxCacheKey(PDB, MUTATION, {
        pH: 7.0,
        temperature: 298,
        ionicStrength: 0.05,
        seed: 12345,
      });

      const expected = getFoldxCacheKey(
        crypto.createHash("sha256").update(cleanPdbForFoldX(PDB)).digest("hex"),
        MUTATION,
        { pH: 7.0, temperature: 298, ionicStrength: 0.05, seed: 12345 }
      );
      expect(key).toBe(expected);
      // The SHAPE is the guard: hash, then the mutation code (which carries the chain), then the
      // force-field conditions. A `prewarm:` prefix or a gene symbol in here would be a second key.
      expect(key).toMatch(/^[0-9a-f]{64}_SA489C_pH:7_temp:298_ion:0\.05_seed:12345_version:v3$/);
      expect(key).not.toContain("prewarm");
    });

    it("separates runs that differ in chain, substitution or conditions", () => {
      const base = buildFoldxCacheKey(PDB, MUTATION);
      // The CHAIN is part of the mutation code, so a different chain is a different run.
      expect(buildFoldxCacheKey(PDB, "SB489C")).not.toBe(base);
      expect(buildFoldxCacheKey(PDB, "SA489W")).not.toBe(base);
      expect(buildFoldxCacheKey(PDB, MUTATION, { pH: 5 })).not.toBe(base);
      expect(buildFoldxCacheKey(PDB, MUTATION, { temperature: 310 })).not.toBe(base);
      expect(buildFoldxCacheKey(PDB, MUTATION, { seed: 7 })).not.toBe(base);
      // …and a different structure is a different run.
      const movedResidue = PDB.replace("1.000   1.000   1.000", "2.000   1.000   1.000");
      expect(buildFoldxCacheKey(movedResidue, MUTATION)).not.toBe(base);
    });

    it("treats a trailing newline as the same structure, not as a second identity", () => {
      // `cleanPdbForFoldX` keeps only the coordinate records, so whitespace around them cannot
      // create a second key for one run — the pre-warm's fetched text and the client's copy of it
      // differ in exactly this kind of way.
      expect(buildFoldxCacheKey(`${PDB}\n`, MUTATION)).toBe(buildFoldxCacheKey(PDB, MUTATION));
      expect(buildFoldxCacheKey(`${PDB}\r\n`, MUTATION)).toBe(buildFoldxCacheKey(PDB, MUTATION));
    });

    it("normalises undeclared conditions to FoldX's defaults, exactly as the runner does", () => {
      // This is what lets the pre-warm (which declares the defaults explicitly) and the interactive
      // path (which passes whatever the request had, usually nothing) share one key.
      expect(buildFoldxCacheKey(PDB, MUTATION)).toBe(buildFoldxCacheKey(PDB, MUTATION, {}));
      expect(buildFoldxCacheKey(PDB, MUTATION)).toBe(
        buildFoldxCacheKey(PDB, MUTATION, { pH: 7.0, temperature: 298, ionicStrength: 0.05, seed: 12345 })
      );
    });
  });

  describe("submitOrJoinFoldxJob", () => {
    function fakeQueue(overrides: Partial<FoldxQueueLike> = {}): FoldxQueueLike {
      return {
        getJobStatus: vi.fn(async () => ({ status: "running" as const, startedAt: 1_700_000_000_000 })),
        getJobData: vi.fn(async () => ({ phase: "repairing", prewarm: true })),
        ...overrides,
      };
    }

    it("joins a queued or running job for the same key instead of enqueueing a second one", async () => {
      const enqueue = vi.fn(async () => "should-not-be-used");
      registerActiveFoldxJob("KEY", "job-in-flight");

      const result = await submitOrJoinFoldxJob({ cacheKey: "KEY", queue: fakeQueue(), enqueue });

      expect(result).toMatchObject({
        queueJobId: "job-in-flight",
        joined: true,
        status: "running",
        phase: "repairing",
      });
      expect(result.jobData).toMatchObject({ prewarm: true });
      expect(enqueue, "a second FoldX job for one run is the defect this prevents").not.toHaveBeenCalled();
    });

    it("enqueues and registers when nothing is in flight", async () => {
      const enqueue = vi.fn(async () => "job-new");

      const result = await submitOrJoinFoldxJob({ cacheKey: "KEY", queue: fakeQueue(), enqueue });

      expect(result).toMatchObject({ queueJobId: "job-new", joined: false, status: null, jobData: null });
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(getActiveFoldxJobId("KEY")).toBe("job-new");
    });

    it("clears a stale entry and enqueues rather than blocking forever", async () => {
      const enqueue = vi.fn(async () => "job-new");
      registerActiveFoldxJob("KEY", "job-settled");
      const queue = fakeQueue({ getJobStatus: vi.fn(async () => ({ status: "completed" as const })) });

      const result = await submitOrJoinFoldxJob({ cacheKey: "KEY", queue, enqueue });

      expect(result.joined).toBe(false);
      expect(result.queueJobId).toBe("job-new");
      expect(getActiveFoldxJobId("KEY")).toBe("job-new");
    });

    it("clears an entry whose job record has vanished", async () => {
      const enqueue = vi.fn(async () => "job-new");
      registerActiveFoldxJob("KEY", "job-vanished");
      const queue = fakeQueue({ getJobStatus: vi.fn(async () => null) });

      const result = await submitOrJoinFoldxJob({ cacheKey: "KEY", queue, enqueue });

      expect(result.joined).toBe(false);
      expect(enqueue).toHaveBeenCalledTimes(1);
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     * THE SUBMISSION ITSELF IS CHECK-THEN-ACT UNLESS IT IS SINGLE-FLIGHTED
     * ─────────────────────────────────────────────────────────────────────────────
     * The registration map answers only for jobs that already EXIST. Two concurrent callers for one
     * request both read "nothing registered" and both awaited `enqueue` — two FoldX runs for one
     * variant, one level up from the race the map was introduced to remove. These tests hold the
     * enqueue promise open, which is exactly that window.
     */
    it("single-flights two simultaneous submissions for one key: exactly ONE enqueue", async () => {
      let releaseEnqueue!: (jobId: string) => void;
      const held = new Promise<string>((resolve) => { releaseEnqueue = resolve; });
      const enqueue = vi.fn(() => held);
      const queue = fakeQueue({
        getJobStatus: vi.fn(async () => ({ status: "running" as const, startedAt: 42 })),
        getJobData: vi.fn(async () => ({ phase: "modelling", remoteJobs: { dynamut2JobId: "remote-1" } })),
      });

      const first = submitOrJoinFoldxJob({ cacheKey: "KEY", queue, enqueue });
      const second = submitOrJoinFoldxJob({ cacheKey: "KEY", queue, enqueue });

      // Let both callers reach their steady state: the leader parked on the held enqueue, the
      // follower parked on the leader.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(enqueue, "a second enqueue for one run is the race this removes").toHaveBeenCalledTimes(1);

      releaseEnqueue("job-1");
      const [leader, follower] = await Promise.all([first, second]);

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(leader).toMatchObject({ queueJobId: "job-1", joined: false, status: null });
      // The follower did not create the job, so it must not own it: it reports the leader's job as
      // JOINED, with that job's real state read back from the queue.
      expect(follower).toMatchObject({
        queueJobId: "job-1",
        joined: true,
        status: "running",
        startedAt: 42,
        phase: "modelling",
      });
      expect(follower.jobData).toMatchObject({ remoteJobs: { dynamut2JobId: "remote-1" } });
    });

    it("keeps a follower on the leader's job even when it settled before the follower could read it", async () => {
      let releaseEnqueue!: (jobId: string) => void;
      const held = new Promise<string>((resolve) => { releaseEnqueue = resolve; });
      const enqueue = vi.fn(() => held);
      // The job is never observed as queued/running — it settled the instant it was created.
      const queue = fakeQueue({
        getJobStatus: vi.fn(async () => ({ status: "completed" as const })),
        getJobData: vi.fn(async () => ({ prewarm: true })),
      });

      const first = submitOrJoinFoldxJob({ cacheKey: "KEY", queue, enqueue });
      const second = submitOrJoinFoldxJob({ cacheKey: "KEY", queue, enqueue });
      await new Promise((resolve) => setTimeout(resolve, 0));
      releaseEnqueue("job-1");
      const [leader, follower] = await Promise.all([first, second]);

      // Enqueueing a second job here would be the duplicate; the record is still read, because it is
      // what decides ownership (a settled PRE-WARM job still owes the reader its remote engines).
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(leader).toMatchObject({ queueJobId: "job-1", joined: false });
      expect(follower).toMatchObject({ queueJobId: "job-1", joined: true, jobData: { prewarm: true } });
    });

    it("clears the reservation, so a later submission is not blocked by a finished one", async () => {
      let n = 0;
      const enqueue = vi.fn(async () => `job-${++n}`);
      const queue = fakeQueue({ getJobStatus: vi.fn(async () => ({ status: "completed" as const })) });

      const first = await submitOrJoinFoldxJob({ cacheKey: "KEY", queue, enqueue });
      const second = await submitOrJoinFoldxJob({ cacheKey: "KEY", queue, enqueue });

      expect(first.queueJobId).toBe("job-1");
      expect(second.queueJobId).toBe("job-2");
      expect(enqueue).toHaveBeenCalledTimes(2);
    });
  });

  describe("owner-checked release", () => {
    it("removes the entry only for the job that owns it", () => {
      registerActiveFoldxJob("KEY", "job-a");
      expect(releaseActiveFoldxJob("KEY", "job-b")).toBe(false);
      expect(getActiveFoldxJobId("KEY")).toBe("job-a");
      expect(releaseActiveFoldxJob("KEY", "job-a")).toBe(true);
      expect(activeFoldxJobs.has("KEY")).toBe(false);
    });
  });
});

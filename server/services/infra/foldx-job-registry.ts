import crypto from "crypto";
import { cleanPdbForFoldX } from "../stability/foldx/pdb-utils.ts";
import { getFoldxCacheKey, type FoldxCacheKeyOptions } from "../stability/foldx/cache.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE IDENTITY FOR A FOLDX REQUEST, AND ONE PLACE THAT SUBMITS OR JOINS IT
 * ─────────────────────────────────────────────────────────────────────────────
 * A FoldX run is expensive (minutes) and its result is cached under a key derived from the
 * structure, the substitution and the force-field conditions. Two callers can legitimately want the
 * SAME run:
 *
 *   • the interactive path (`routes/biophysics/generation.ts`), when a reader opens the Energetics
 *     tab, and
 *   • the speculative pre-warm (`services/infra/prewarm-manager.ts`), when a deployment opted into
 *     warming that run ahead of the reader.
 *
 * Before this module the two had separate bookkeeping: the interactive path deduplicated through a
 * map keyed by the FoldX cache key, and the pre-warm registered nothing at all. So an in-flight
 * pre-warm was invisible to the interactive path, and one variant could run TWO concurrent FoldX
 * jobs (audit R2-F4). Both now submit through `submitOrJoinFoldxJob`, which joins a registered job
 * and single-flights the submission of a new one.
 *
 * SCOPE OF THE DEDUPLICATION
 * --------------------------
 * Registration and the submission reservation are both PROCESS-LOCAL. The queue's store is shared
 * (SQLite file, or Redis for BullMQ) and a job id is readable from any process, but this module's
 * maps are not — so two replicas can still submit the same run concurrently. Preventing that needs
 * the reservation in the shared store, which is a queue-level change.
 *
 * WHY THE KEY IS BUILT HERE, ONCE
 * -------------------------------
 * `buildFoldxCacheKey` is the single implementation of "which run is this?", and it is the same
 * derivation `generateMutantPdb` performs internally (`cleanPdbForFoldX` → sha256 → `getFoldxCacheKey`).
 * It is not a new key: the CHAIN lives inside the mutation code (`VA600E`), and pH / temperature /
 * ionic strength / seed live inside `getFoldxCacheKey`. Any ad-hoc key assembled beside those would
 * be a second identity for the same request — exactly how a dedup map stops deduplicating.
 */

/**
 * The cache key of a FoldX request: structure hash + mutation (which carries the chain) + conditions.
 *
 * MUST stay identical to `generateMutantPdb`'s own derivation; `foldx-job-registry.test.ts` asserts
 * that equality rather than trusting it.
 */
export function buildFoldxCacheKey(
  wtPdbText: string,
  mutation: string,
  options?: FoldxCacheKeyOptions
): string {
  const normalizedPdb = cleanPdbForFoldX(wtPdbText);
  const pdbHash = crypto.createHash("sha256").update(normalizedPdb).digest("hex");
  return getFoldxCacheKey(pdbHash, mutation, options);
}

/**
 * In-flight queue jobs by cache key, with single-flight submission — one instance per tool.
 *
 * Written for FoldX first; P2Rank uses a second instance (`pocketJobRegistry`) so two people asking for
 * the same pocket at the same time share one job too (WP-E). The FoldX functions below keep their names
 * and delegate to `foldxJobRegistry`.
 *
 * PROCESS-LOCAL, and that is a LIMITATION rather than a design property. The queue's own store is
 * shared (SQLite file, or Redis for BullMQ), so a job id minted here is readable by another process;
 * what is process-bound is this registry, so a second replica does not see that a run is already in
 * flight and can submit it again. Closing that needs the reservation in the shared store.
 */
export class JobRegistry {
  /** Registered queue job per cache key. */
  readonly active = new Map<string, string>();
  /**
   * PER-KEY SINGLE-FLIGHT RESERVATIONS. The registration map can only answer for jobs that already
   * EXIST; creating one is not synchronous (an `await` separates the read from the enqueue), so two
   * concurrent callers would both read "nothing in flight" and both enqueue. The first caller for a
   * key becomes the LEADER and records its in-flight promise here; later callers wait for it and then
   * resolve themselves against the queue, reporting the leader's job as a JOIN.
   */
  private readonly pending = new Map<string, Promise<FoldxSubmitOrJoinResult>>();

  get(cacheKey: string): string | undefined {
    return this.active.get(cacheKey);
  }

  register(cacheKey: string, jobId: string): void {
    this.active.set(cacheKey, jobId);
  }

  /**
   * Removes the entry only when it still points at `jobId`: two callers can share a key across time,
   * and one's cleanup must not delete the other's registration and let a third job start.
   */
  release(cacheKey: string, jobId: string): boolean {
    if (this.active.get(cacheKey) !== jobId) return false;
    return this.active.delete(cacheKey);
  }

  /** A leader still in flight finds its entry gone and simply deletes nothing. */
  reset(): void {
    this.active.clear();
    this.pending.clear();
  }

  /**
   * The job registered for `cacheKey`, if it is still queued or running. Clears the entry when the job
   * has settled or vanished, which makes the map self-healing rather than a permanent block.
   */
  private async readRegistered(cacheKey: string, queue: FoldxQueueLike): Promise<FoldxSubmitOrJoinResult | null> {
    const existingJobId = this.active.get(cacheKey);
    if (!existingJobId) return null;

    const statusInfo = await queue.getJobStatus(existingJobId);
    if (!statusInfo || (statusInfo.status !== "queued" && statusInfo.status !== "running")) {
      this.release(cacheKey, existingJobId);
      return null;
    }

    const jobData = await queue.getJobData(existingJobId);
    return {
      queueJobId: existingJobId,
      joined: true,
      status: statusInfo.status,
      startedAt: statusInfo.startedAt ?? null,
      phase: typeof jobData?.phase === "string" ? jobData.phase : null,
      jobData
    };
  }

  /**
   * Joins an in-flight job for `cacheKey`, or enqueues one — never two.
   *
   * `enqueue` is called ONLY by the leader, and only when nothing is registered and no other caller is
   * already submitting this key, so it owns whatever is specific to a new submission.
   *
   * LIFECYCLE:
   *   leader    → enqueue, register, return `joined: false`; clears its own reservation on settle.
   *   follower  → await the leader, then re-read the queue so it reports that job's REAL state.
   *   degenerate→ the leader's job settled before the follower could read it: the follower still
   *               reports `joined: true` for that job id rather than enqueueing a second one.
   */
  async submitOrJoin(params: { cacheKey: string; queue: FoldxQueueLike; enqueue: () => Promise<string> }): Promise<FoldxSubmitOrJoinResult> {
    const { cacheKey, queue, enqueue } = params;

    const registered = await this.readRegistered(cacheKey, queue);
    if (registered) return registered;

    const leaderInFlight = this.pending.get(cacheKey);
    if (leaderInFlight) {
      let leader: FoldxSubmitOrJoinResult;
      try {
        leader = await leaderInFlight;
      } catch {
        // The leader's submission was refused (its own limit, admission). That refusal is about the
        // leader, so this caller tries for itself rather than reporting someone else's limit.
        if (this.pending.get(cacheKey) === leaderInFlight) this.pending.delete(cacheKey);
        return this.submitOrJoin(params);
      }
      const registeredAfterLeader = await this.readRegistered(cacheKey, queue);
      if (registeredAfterLeader) return registeredAfterLeader;
      // Settled between registration and this read: its record still decides ownership (`prewarm`).
      const jobData = await queue.getJobData(leader.queueJobId);
      return { ...leader, joined: true, jobData };
    }

    const attempt = (async (): Promise<FoldxSubmitOrJoinResult> => {
      const queueJobId = await enqueue();
      this.register(cacheKey, queueJobId);
      return { queueJobId, joined: false, status: null, startedAt: null, phase: null, jobData: null };
    })();

    // Recorded synchronously, before the leader's first `await` yields, so no follower slips past it.
    this.pending.set(cacheKey, attempt);

    try {
      return await attempt;
    } finally {
      if (this.pending.get(cacheKey) === attempt) this.pending.delete(cacheKey);
    }
  }
}

export interface FoldxQueueStatus {
  status: "queued" | "running" | "completed" | "failed";
  error?: string;
  createdAt?: number | null;
  startedAt?: number | null;
}

/** The queue surface this module needs, so it does not import the queue implementation. */
export interface FoldxQueueLike {
  getJobStatus(id: string): Promise<FoldxQueueStatus | null>;
  getJobData(id: string): Promise<any | null>;
}

export interface FoldxSubmitOrJoinResult {
  queueJobId: string;
  /** True when an already-queued/running job for this exact request was joined instead of enqueued. */
  joined: boolean;
  /** The joined job's real state; null for a job this call created. */
  status: "queued" | "running" | null;
  startedAt: number | null;
  /** The joined job's last recorded stage, when it has one. */
  phase: string | null;
  /** The joined job's data blob, so the caller can pick up what the original submitter recorded. */
  jobData: any | null;
}

/** FoldX runs: the interactive path and the pre-warm submit through this one instance. */
export const foldxJobRegistry = new JobRegistry();
/** P2Rank pocket runs (WP-E). */
export const pocketJobRegistry = new JobRegistry();

export const activeFoldxJobs = foldxJobRegistry.active;

export function getActiveFoldxJobId(cacheKey: string): string | undefined {
  return foldxJobRegistry.get(cacheKey);
}

export function registerActiveFoldxJob(cacheKey: string, jobId: string): void {
  foldxJobRegistry.register(cacheKey, jobId);
}

export function releaseActiveFoldxJob(cacheKey: string, jobId: string): boolean {
  return foldxJobRegistry.release(cacheKey, jobId);
}

export function resetActiveFoldxJobs(): void {
  foldxJobRegistry.reset();
}

/** Joins an in-flight FoldX job for `cacheKey`, or enqueues one — never two. See `JobRegistry.submitOrJoin`. */
export function submitOrJoinFoldxJob(params: {
  cacheKey: string;
  queue: FoldxQueueLike;
  enqueue: () => Promise<string>;
}): Promise<FoldxSubmitOrJoinResult> {
  return foldxJobRegistry.submitOrJoin(params);
}

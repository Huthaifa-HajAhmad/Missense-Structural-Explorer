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
 * In-flight FoldX queue jobs by cache key — PROCESS-LOCAL, and that is a LIMITATION rather than a
 * design property.
 *
 * The queue's own store is shared: the SQLite backend keeps every job in `data/shared_state.sqlite`
 * and the BullMQ backend keeps them in Redis, so a job id minted here is perfectly readable by
 * another process — the id is NOT process-bound. What is process-bound is this map (and the
 * reservation below), so a second replica does not see that a run is already in flight and can
 * submit the same run again. Closing that needs the reservation itself in the shared store, which is
 * a queue-level change rather than something this module can do.
 */
export const activeFoldxJobs = new Map<string, string>();

export function getActiveFoldxJobId(cacheKey: string): string | undefined {
  return activeFoldxJobs.get(cacheKey);
}

export function registerActiveFoldxJob(cacheKey: string, jobId: string): void {
  activeFoldxJobs.set(cacheKey, jobId);
}

/**
 * Removes the entry only when it still points at `jobId`.
 *
 * Owner-checked because two callers can share a key across time: if a pre-warm's entry was cleared
 * as stale and an interactive request registered its own job under the same key, the pre-warm's
 * cleanup must not delete the interactive request's entry and let a third job start.
 */
export function releaseActiveFoldxJob(cacheKey: string, jobId: string): boolean {
  if (activeFoldxJobs.get(cacheKey) !== jobId) return false;
  return activeFoldxJobs.delete(cacheKey);
}

export function resetActiveFoldxJobs(): void {
  activeFoldxJobs.clear();
  /**
   * The reservation map is cleared with it. A leader still in flight will find its entry gone and
   * simply not delete anything — its promise is unaffected, and its job id is still registered.
   */
  pendingSubmissions.clear();
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PER-KEY SINGLE-FLIGHT RESERVATIONS — process-local
 * ─────────────────────────────────────────────────────────────────────────────
 * The registration map can only answer for jobs that already EXIST. It cannot reserve a job that is
 * still being created, and creating one is not synchronous: `activeFoldxJobs.get()` and the enqueue
 * are separated by an `await`. Two concurrent callers for one request therefore both read "nothing in
 * flight" and both enqueue — a check-then-act race of exactly the kind the map was introduced to
 * remove, one level up.
 *
 * So the reservation is explicit: the first caller for a key becomes the LEADER and records its
 * in-flight promise here; every later caller waits for that promise and then resolves itself against
 * the queue, reporting the leader's job as a JOIN.
 *
 * Scope: this map is PROCESS-LOCAL, like the registration map. Two processes (two replicas sharing
 * the queue's store) can still submit the same run concurrently; only a reservation in the shared
 * store could prevent that.
 */
const pendingSubmissions = new Map<string, Promise<FoldxSubmitOrJoinResult>>();

/**
 * Reads the job registered for `cacheKey`, if it is still queued or running.
 *
 * Returns null — and clears the entry — when the recorded job has settled or vanished, which is what
 * makes the map self-healing rather than a permanent block after a crash.
 */
async function readRegisteredJob(cacheKey: string, queue: FoldxQueueLike): Promise<FoldxSubmitOrJoinResult | null> {
  const existingJobId = activeFoldxJobs.get(cacheKey);
  if (!existingJobId) return null;

  const statusInfo = await queue.getJobStatus(existingJobId);
  if (!statusInfo || (statusInfo.status !== "queued" && statusInfo.status !== "running")) {
    releaseActiveFoldxJob(cacheKey, existingJobId);
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
 * Joins an in-flight FoldX job for `cacheKey`, or enqueues one — never two.
 *
 * `enqueue` is called ONLY by the leader, and only when nothing is registered and no other caller is
 * already submitting this key, so it owns whatever is specific to a new submission (audit logging,
 * the job payload).
 *
 * LIFECYCLE (leader and followers differ, deliberately):
 *   leader    → enqueue, register, return `joined: false`; clears its own reservation on settle.
 *   follower  → await the leader, then re-read the queue so it reports that job's REAL state
 *               (`joined: true`, with status/phase/data).
 *   degenerate→ the leader's job settled before the follower could read it: the follower still
 *               reports `joined: true` for that job id rather than enqueueing a second one, because
 *               it did not create that job and must not take ownership of its remote engines.
 */
export async function submitOrJoinFoldxJob(params: {
  cacheKey: string;
  queue: FoldxQueueLike;
  enqueue: () => Promise<string>;
}): Promise<FoldxSubmitOrJoinResult> {
  const { cacheKey, queue, enqueue } = params;

  const registered = await readRegisteredJob(cacheKey, queue);
  if (registered) return registered;

  const leaderInFlight = pendingSubmissions.get(cacheKey);
  if (leaderInFlight) {
    const leader = await leaderInFlight;
    const registeredAfterLeader = await readRegisteredJob(cacheKey, queue);
    if (registeredAfterLeader) return registeredAfterLeader;
    /**
     * The leader's job is no longer queued/running — it settled between registration and this read.
     * Its record still carries the facts that decide ownership (notably `prewarm`), so the record is
     * fetched rather than guessed, and the caller is told it joined a job it did not create.
     */
    const jobData = await queue.getJobData(leader.queueJobId);
    return { ...leader, joined: true, jobData };
  }

  const attempt = (async (): Promise<FoldxSubmitOrJoinResult> => {
    const queueJobId = await enqueue();
    registerActiveFoldxJob(cacheKey, queueJobId);
    return { queueJobId, joined: false, status: null, startedAt: null, phase: null, jobData: null };
  })();

  /**
   * Recorded synchronously, in the same turn as the enqueue call: the leader's body runs up to its
   * first `await` before any other caller can observe this key, so no follower can slip past it.
   */
  pendingSubmissions.set(cacheKey, attempt);

  try {
    return await attempt;
  } finally {
    // Only the leader clears it, and only if the entry is still its own.
    if (pendingSubmissions.get(cacheKey) === attempt) {
      pendingSubmissions.delete(cacheKey);
    }
  }
}

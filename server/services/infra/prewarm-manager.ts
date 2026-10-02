import crypto from "crypto";
import path from "path";
import { fetchPdbFromRcsb } from "../structure/index.ts";
import { AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";
import { CONFIG } from "../../config.ts";
import { BiophysicalJobQueue } from "./biophysical-queue.ts";
import { buildFoldxCacheKey, releaseActiveFoldxJob, submitOrJoinFoldxJob } from "./foldx-job-registry.ts";
import { activeBackgroundTasks, inFlightPrewarms } from "../../routes/state.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SPECULATIVE FOLDX PRE-WARMING — OPT-IN, OFF BY DEFAULT
 * ─────────────────────────────────────────────────────────────────────────────
 * This manager queues a FoldX run for a variant *nobody has asked to fold yet*, in the hope that the
 * reader opens the Energetics tab afterwards and finds the mutant cache already warm
 * (`foldx/cache.ts`, keyed by structure hash + mutation + conditions).
 *
 * Why it is OFF unless `PREWARM_FOLDX_ENABLED=true`:
 *
 *   1. It is speculative compute. The interactive path already submits FoldX itself
 *      (`routes/biophysics/generation.ts` → `queue.pushJob("foldx", …)`), so on the default
 *      configuration a prewarm is a second, unrequested FoldX run — minutes of the same
 *      concurrency slots the reader's own run needs.
 *   2. Its cache entry is only ever read when the following interactive submit happens to use the
 *      SAME structure, the SAME substitution and the SAME FoldX conditions. When they differ the
 *      work is simply wasted (the key differs, so no wrong number can be served — see
 *      `getFoldxCacheKey`), but the waste is real.
 *   3. The prewarm job used to be invisible to the interactive path's dedup map, so while it was in
 *      flight a reader request could start a second concurrent FoldX job for the same variant
 *      (audit R2-F4). That hole is closed: the job is registered under the SAME
 *      `buildFoldxCacheKey` identity the interactive path uses (chain inside the mutation code,
 *      conditions inside the key), so a reader request for that exact run JOINS the pre-warm's job
 *      instead of starting another. Opt-in-by-default still removes speculative compute from every
 *      deployment that has not asked for it.
 *
 * Enabling the flag is a DEPLOYMENT-LEVEL DECLARATION that this deployment's interactive FoldX
 * submits use FoldX's own default conditions (pH 7.0, 298 K, 0.05 M, seed 12345) — the only
 * conditions a prewarm can warm for without knowing the request. A caller that *does* know the
 * conditions must say so via `PrewarmParams.conditions`; declaring anything other than the defaults
 * makes the prewarm refuse (see `decidePrewarm`) rather than silently compute under conditions the
 * following submit will not use. This is the "no prewarm while the interpretation conditions are
 * unknown" rule: an assumption about how a result will be interpreted is never made silently.
 *
 * Everything here is additive: `PrewarmManager.getInstance().triggerPrewarm(params)` keeps its
 * signature and remains a no-op at the default configuration.
 *
 * KNOWN RESIDUAL — THE WORKER'S OTHER LEGS
 * ----------------------------------------
 * A prewarm job is executed by the same queue worker as an interactive job, so it also runs the
 * worker's RaSP lookup and StabilityOracle call (`server.ts`), whose results a purely speculative
 * job never serves. Those legs are deliberately NOT skipped for prewarm jobs: RaSP and
 * StabilityOracle have no other producer on the queued path, and a reader request CAN adopt an
 * in-flight prewarm job (see 3 above) — skipping them would hand that reader a result with two
 * engines permanently missing, which is a worse defect than the wasted work. The discarded cost
 * only exists while the capability is switched on; at the default configuration no prewarm job is
 * created at all, so there is nothing to discard.
 */

/** Set to the exact string `"true"` to enable speculative pre-warming. Anything else leaves it off. */
export const PREWARM_OPT_IN_ENV = "PREWARM_FOLDX_ENABLED";

/** The FoldX environment a prewarm can assume when the caller declares nothing. */
export interface FoldxConditions {
  pH?: number;
  temperature?: number;
  ionicStrength?: number;
  seed?: number;
}

/**
 * FoldX's own defaults, mirrored from `getFoldxCacheKey` (`services/stability/foldx/cache.ts`).
 *
 * Mirrored rather than imported because that module builds and registers LRU caches at import time,
 * which a background task manager has no business doing. The mirror is guarded against drift by
 * `prewarm-manager.test.ts`, which asserts that these values and FoldX's implicit defaults produce
 * the SAME cache key — so if `cache.ts` changes its defaults this fails instead of silently warming
 * a key no request will ever read.
 */
export const DEFAULT_FOLDX_CONDITIONS: Required<FoldxConditions> = {
  pH: 7.0,
  temperature: 298,
  ionicStrength: 0.05,
  seed: 12345,
};

/** What the caller knows about the request that will follow. Every field is optional and additive. */
export interface PrewarmConditions {
  /**
   * The FoldX environment the following interactive submit will use.
   *
   * Omit it when the deployment's opt-in flag is the declaration (i.e. the submit will use FoldX's
   * defaults). Declaring values other than the defaults makes the prewarm refuse: warming the
   * default-keyed entry would be work the request never reads, and forwarding conditions the
   * prewarm only *guesses* at would be a silent change to how the result is interpreted.
   */
  foldxOptions?: FoldxConditions;
  /**
   * False when the numbering this substitution sits on could not be verified (UniProt unreachable).
   * The prewarm then refuses: a FoldX run against an unestablished residue index is an
   * interpretation, not a cache warm.
   */
  numberingVerified?: boolean;
}

export interface PrewarmParams {
  gene: string;
  variant: string;
  uniprotId: string;
  sequence?: string;
  pos: number;
  wt1Letter: string;
  mutant: string;
  pdbMapping: { pdbId?: string; chainId?: string; unpStart?: number; structStart?: number } | null;
  /** Interpretation facts the caller has established. Additive; omit for "the deployment asserts defaults". */
  conditions?: PrewarmConditions;
}

/** Why a prewarm was not dispatched. Named so tests and logs can assert the exact gate that fired. */
export type PrewarmSkipReason =
  | "test-environment"
  | "not-opted-in"
  | "structure-unknown"
  | "numbering-unverified"
  | "non-default-conditions";

export interface PrewarmDecision {
  dispatch: boolean;
  reason?: PrewarmSkipReason;
}

/** Poll interval while waiting on a queued job. Unchanged from the original 500 ms. */
const PREWARM_POLL_INTERVAL_MS = 500;

/**
 * Whether speculative pre-warming is enabled for this process.
 *
 * Two independent gates, both fail-closed: the test environment never prewarms (no test may spawn a
 * real FoldX run), and production/development prewarms only on the exact opt-in string.
 *
 * Read LIVE from the environment on every call — never captured at module load — so a process that
 * changes the variable (a test per case, an operator toggling a deployment) is answered for its
 * current state rather than for its state at import time.
 */
export function isPrewarmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "test") return false;
  return env[PREWARM_OPT_IN_ENV] === "true";
}

/**
 * The pre-warm capability, as a typed descriptor.
 *
 * WHY A DESCRIPTOR: this capability is switched by an environment variable, which makes its exact
 * spelling, its exact opt-in value and its default the whole contract — and a contract spread across
 * a getter, a `.env.example` line and a doc sentence drifts. Everything a caller, a test or the
 * documentation needs to state about the switch is here, in one typed place.
 *
 * The opt-in value is the EXACT string `"true"`: `1`, `TRUE`, `yes`, `on` and `""` all leave
 * pre-warming off (asserted in `prewarm-manager.test.ts`), because a capability that spends minutes
 * of shared compute must not be enabled by anything that merely looks affirmative.
 */
export interface PrewarmCapability {
  /** The environment variable that switches it on. */
  readonly envVar: string;
  /** The ONLY value that enables it. */
  readonly optInValue: "true";
  /** What a deployment gets without opting in. */
  readonly enabledByDefault: false;
  /**
   * Whether the capability is on for this process — read live from the environment at call time.
   *
   * `NODE_ENV=test` is always off, so no test can spawn a real FoldX run by setting the opt-in.
   */
  readonly isEnabled: (env?: NodeJS.ProcessEnv) => boolean;
}

export const PREWARM_CAPABILITY: PrewarmCapability = Object.freeze({
  envVar: PREWARM_OPT_IN_ENV,
  optInValue: "true",
  enabledByDefault: false,
  isEnabled: (env: NodeJS.ProcessEnv = process.env) => isPrewarmEnabled(env),
});

/**
 * True when every DECLARED FoldX condition equals FoldX's own default.
 *
 * `undefined` fields count as the default, exactly as `getFoldxCacheKey` treats them (`options?.pH
 * ?? 7.0`), so `{}` and "declared nothing" are equivalent declarations.
 */
export function declaresDefaultConditions(conditions?: FoldxConditions): boolean {
  if (!conditions) return true;
  return (
    (conditions.pH ?? DEFAULT_FOLDX_CONDITIONS.pH) === DEFAULT_FOLDX_CONDITIONS.pH &&
    (conditions.temperature ?? DEFAULT_FOLDX_CONDITIONS.temperature) === DEFAULT_FOLDX_CONDITIONS.temperature &&
    (conditions.ionicStrength ?? DEFAULT_FOLDX_CONDITIONS.ionicStrength) === DEFAULT_FOLDX_CONDITIONS.ionicStrength &&
    (conditions.seed ?? DEFAULT_FOLDX_CONDITIONS.seed) === DEFAULT_FOLDX_CONDITIONS.seed
  );
}

/**
 * The in-flight registry key for one prewarm.
 *
 * Keyed on the PROTEIN (UniProt accession), not the gene symbol, plus the substitution. The previous
 * `gene_variant` key collapsed two isoforms of one gene — or two differently-numbered notations for
 * the same residue — into a single slot, so an in-flight prewarm for one interpretation suppressed a
 * prewarm for the other (`doc/FUTURE_WORK.md` records the same collision). `gene` is only a fallback
 * for a caller that supplies no accession.
 */
export function buildPrewarmKey(params: Pick<PrewarmParams, "gene" | "variant" | "uniprotId">): string {
  const protein = (params.uniprotId || params.gene || "").trim() || params.gene;
  return `${protein}_${params.variant}`.toUpperCase();
}

/**
 * The single place that decides whether this prewarm may run. Pure, so it is directly testable and
 * so the gates read as one list rather than as scattered early returns.
 */
export function decidePrewarm(params: PrewarmParams, env: NodeJS.ProcessEnv = process.env): PrewarmDecision {
  if (env.NODE_ENV === "test") return { dispatch: false, reason: "test-environment" };
  if (env[PREWARM_OPT_IN_ENV] !== "true") return { dispatch: false, reason: "not-opted-in" };
  /**
   * No structure ⇒ nothing to fold. The mapping is resolved by the analysis that just ran, and a
   * prewarm without it would have to fetch and guess a template the interactive submit may not use.
   */
  if (!params.pdbMapping?.pdbId) return { dispatch: false, reason: "structure-unknown" };
  if (params.conditions?.numberingVerified === false) return { dispatch: false, reason: "numbering-unverified" };
  if (!declaresDefaultConditions(params.conditions?.foldxOptions)) {
    return { dispatch: false, reason: "non-default-conditions" };
  }
  return { dispatch: true };
}

export class PrewarmManager {
  private static instance: PrewarmManager;

  private constructor() {}

  public static getInstance(): PrewarmManager {
    if (!PrewarmManager.instance) {
      PrewarmManager.instance = new PrewarmManager();
    }
    return PrewarmManager.instance;
  }

  /**
   * Dispatches a non-blocking FoldX mutant simulation in the background, if this deployment has
   * opted in and the conditions are established.
   *
   * Resolves as soon as the job is queued (or as soon as a gate refuses it); the run itself is
   * tracked in `activeBackgroundTasks` so shutdown can abort it.
   */
  public async triggerPrewarm(params: PrewarmParams): Promise<void> {
    const decision = decidePrewarm(params);
    if (!decision.dispatch) {
      /**
       * Silent for the two configuration gates: this is called on every `/analyze-variant` request,
       * and a log line per request for a capability nobody enabled is noise, not diagnostics. A
       * refusal while the capability IS enabled is a different matter — that is the operator's
       * opt-in not taking effect, so it is reported.
       */
      if (decision.reason !== "not-opted-in" && decision.reason !== "test-environment") {
        console.log(`[Pre-warm] Skipped (${decision.reason}) for ${params.gene} ${params.variant}`);
      }
      return;
    }

    const { gene, variant, uniprotId, sequence, pos, wt1Letter, mutant, pdbMapping } = params;
    const prewarmKey = buildPrewarmKey(params);

    /**
     * ONE atomic claim, not `has()` then `add()`.
     *
     * `has()` and `add()` are two round trips, so two concurrent requests for one variant both read
     * "absent" and both proceeded — `add()` then returned false for the loser, and the loser ignored
     * it. The result was two FoldX jobs for one variant, which is the duplicate-run defect the shared
     * registry exists to prevent. `add()` is the atomic operation (Redis `SET … NX`, SQLite
     * `INSERT OR IGNORE`); its return value is the claim.
     *
     * The claim carries a TOKEN and is released with it, so this caller cannot delete a claim a
     * later caller now holds after this one's TTL expired (`routes/state.ts`, `delete(key, token)`).
     */
    const claimToken = crypto.randomUUID();
    if (!(await inFlightPrewarms.add(prewarmKey, claimToken))) {
      return;
    }

    const prewarmTaskId = crypto.randomUUID();
    const prewarmController = new AbortController();
    /** The conditions this prewarm warms for, pinned explicitly rather than left to the worker's fallback. */
    const foldxConditions = { ...DEFAULT_FOLDX_CONDITIONS, ...(params.conditions?.foldxOptions ?? {}) };

    const prewarmPromise = (async () => {
      try {
        if (pdbMapping && pdbMapping.pdbId) {
          const wtPdbText = await fetchPdbFromRcsb(
            pdbMapping.pdbId,
            pdbMapping.chainId,
            pdbMapping.unpStart,
            pdbMapping.structStart,
            { uniprotId, sequence, pos, expectedWt1: wt1Letter }
          );
          if (wtPdbText) {
            const wt1 = wt1Letter.toUpperCase();
            const chain = (pdbMapping.chainId || "A").toUpperCase();
            const mut1 = AMINO_ACID_3_TO_1[mutant] || (mutant.length === 1 ? mutant.toUpperCase() : mutant[0].toUpperCase());

            const mutation = `${wt1}${chain}${pos}${mut1}`;
            const prewarmJobDir = path.join(process.cwd(), "temp_jobs", crypto.randomUUID());

            const queue = BiophysicalJobQueue.getInstance();
            const foldxCacheKey = buildFoldxCacheKey(wtPdbText, mutation, foldxConditions);

            /**
             * Submitted through the SAME single-flight the interactive path uses, under the SAME key
             * — structure hash + mutation (chain included) + FoldX conditions. Two things follow:
             *
             *   • a reader request for this exact run JOINS this job instead of starting a second
             *     FoldX run (audit R2-F4), including when the two race, because the reservation is
             *     taken before the enqueue;
             *   • if an identical run is ALREADY in flight (a reader's request, or another
             *     pre-warm), this pre-warm has nothing left to warm and returns without enqueueing.
             *     It must also not supervise that job: `awaitQueueJob` aborts a job that has
             *     outlived the queue's lease, and a reader's job is not ours to abort.
             */
            const submission = await submitOrJoinFoldxJob({
              cacheKey: foldxCacheKey,
              queue,
              enqueue: async () => {
                console.log(`[Pre-warm Cache] Queueing FoldX mutant simulation in background for ${gene} ${variant}`);
                return queue.pushJob("foldx", {
                  wtPdb: wtPdbText,
                  mutation,
                  uniprotId,
                  jobDir: prewarmJobDir,
                  /**
                   * `options` is read by the queue worker and forwarded to `generateMutantPdb`, which
                   * puts it in the FoldX cache key. Sending it explicitly means the key this prewarm
                   * warms is the one this manager declared, not whatever the worker's fallback happens
                   * to be.
                   */
                  options: foldxConditions,
                  /**
                   * Marks this job as SPECULATIVE, and it is load-bearing.
                   *
                   * A reader request that joins this job must know that nobody has submitted
                   * DynaMut2 / DDMut / ThermoMPNN / StabilityOracle for it — the pre-warm has no
                   * reader tokens and is only warming FoldX. The interactive path therefore takes
                   * over the remote engines for a joined pre-warm job instead of assuming the
                   * original submitter is running them (`generation.ts`, `joinedJobIsPrewarm`).
                   */
                  prewarm: true
                });
              }
            });

            if (submission.joined) {
              console.log(`[Pre-warm Cache] Skipped: this run is already in flight (${submission.queueJobId})`);
              return;
            }

            try {
              await this.awaitQueueJob(submission.queueJobId, prewarmController.signal);
            } finally {
              // Owner-checked: never removes an entry the interactive path has since taken over.
              releaseActiveFoldxJob(foldxCacheKey, submission.queueJobId);
            }
          }
        }
      } catch (prewarmErr: any) {
        console.warn(`[Pre-warm Cache Warning] Background FoldX pre-warm failed:`, prewarmErr.message);
      } finally {
        /**
         * Released only by the caller that claimed it: every path that reaches here has passed the
         * `add()` above, and a non-owner returned before the promise was created. The token makes
         * that true even across a TTL expiry, where the key may now belong to someone else.
         */
        await inFlightPrewarms.delete(prewarmKey, claimToken);
        const idx = activeBackgroundTasks.findIndex(t => t.id === prewarmTaskId);
        if (idx !== -1) activeBackgroundTasks.splice(idx, 1);
      }
    })();

    activeBackgroundTasks.push({ id: prewarmTaskId, controller: prewarmController, promise: prewarmPromise });
  }

  /**
   * Waits for a queued FoldX job, budgeting its two phases separately and NEVER giving up before the
   * queue itself would.
   *
   * WHY THIS REPLACED A 240 s ABSOLUTE TIMER
   * ----------------------------------------
   * The previous loop armed one 240 s clock before submission and aborted the job when it expired.
   * A job's life has two phases and a queued job legitimately waits behind others, so that timer
   * could only ever fire during the queue phase — where `abortJob` is a NO-OP for a SQLite job that
   * has not started (`SQLiteQueue.abortJob` only aborts entries in `activeJobs`). The observable
   * result was the worst of both: the prewarm stopped waiting, released its registry claim, logged a
   * timeout — and the job it "aborted" ran to completion anyway. That is exactly how one variant got
   * two concurrent FoldX jobs (audit R2-F4), and why prewarming did nothing for a slow structure.
   *
   * The budgets are now the queue's OWN leases, read from `CONFIG.timeouts` — the same numbers the
   * queue's reaper uses to decide a job is stale:
   *
   *   queued  → foldxQueuedLeaseMs   (`biophysical-queue.ts` stale-queued reaper)
   *   running → foldxReaperLeaseMs   (`biophysical-queue.ts` stale-running reaper, > the job cap)
   *
   * So this loop stops waiting exactly when the queue stops considering the job live, and never
   * earlier. `foldx-timeout-budget.test.ts` asserts the ordering of those leases; a test in this
   * module's suite asserts that this loop reads them and aborts nothing before them.
   */
  private async awaitQueueJob(queueJobId: string, signal: AbortSignal): Promise<void> {
    const queue = BiophysicalJobQueue.getInstance();
    const localQueuedAt = Date.now();
    /** When THIS process first saw the job running, for a backend that reports no `startedAt`. */
    let runningSince: number | null = null;

    while (true) {
      if (signal.aborted) {
        await queue.abortJob(queueJobId);
        throw new Error("Pre-warm aborted (server shutting down)");
      }

      const statusInfo = await queue.getJobStatus(queueJobId);
      if (!statusInfo) {
        // The record is gone (reaped, or a backend that lost it). There is nothing left to wait for.
        throw new Error("Pre-warm FoldX job record disappeared");
      }
      if (statusInfo.status === "completed") return;
      if (statusInfo.status === "failed") {
        throw new Error(statusInfo.error || "Prewarm FoldX job failed");
      }

      const now = Date.now();
      if (statusInfo.status === "running") {
        runningSince ??= statusInfo.startedAt ?? now;
        if (now - runningSince > CONFIG.timeouts.foldxReaperLeaseMs) {
          /**
           * Abort is meaningful here (the queue holds an AbortController for a running job), and it
           * is safe: at this instant the job has already outlived the lease the queue's own reaper
           * uses, so this cannot cancel work the queue still considers live. The reaper may simply
           * not have swept yet.
           */
          await queue.abortJob(queueJobId);
          throw new Error(
            `Pre-warm FoldX job exceeded the queue's stale-running lease (${CONFIG.timeouts.foldxReaperLeaseMs} ms)`
          );
        }
      } else {
        /**
         * Queued. Deliberately NO abort: a queued SQLite job has no AbortController, so the call
         * would be a no-op that only released our claim while the job kept its place in the queue.
         * The queue's stale-queued reaper owns this transition; we stop waiting at the same lease it
         * uses and let it record the outcome.
         */
        const queuedAt = typeof statusInfo.createdAt === "number" ? statusInfo.createdAt : localQueuedAt;
        if (now - queuedAt > CONFIG.timeouts.foldxQueuedLeaseMs) {
          throw new Error(
            `Pre-warm FoldX job exceeded the queue's stale-queued lease (${CONFIG.timeouts.foldxQueuedLeaseMs} ms)`
          );
        }
      }

      await new Promise(resolve => setTimeout(resolve, PREWARM_POLL_INTERVAL_MS));
    }
  }
}

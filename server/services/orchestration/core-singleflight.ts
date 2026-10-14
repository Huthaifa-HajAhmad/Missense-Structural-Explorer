/**
 * core-singleflight.ts — ONE running core fetch per scientific identity.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY
 * ─────────────────────────────────────────────────────────────────────────────
 * The three routes that need core data reach it differently and, until this module, all three
 * repeated the same work:
 *
 *   POST /analyze-variant            database miss → fetch all eleven sources
 *   POST /analyze-variant/stream     database miss → fetch all eleven sources (after its triage frame)
 *   POST /analyze-variant/structural database miss → fetch all eleven sources AGAIN, concurrently
 *                                    with the stream the UI had just started for the same variant
 *
 * The third is the expensive one. The UI opens the stream, then requests the structural tab for the
 * same variant a moment later; both miss the same row at the same instant, and both launch
 * STRING + gnomAD + UniProt + conservation + predictors + the rest. The providers see two identical
 * question bursts, the boxes pay twice, and the two answers can disagree in the fractions of a
 * second between them — a real hazard for a report, because a differing gnomAD status between the
 * stream's payload and the structural route's payload makes the same variant look measured in one
 * surface and unmeasured in the other.
 *
 * So a core fetch is now keyed by its SCIENTIFIC IDENTITY (`core-identity.ts`): the residue, the
 * coordinate trail and build, the weighting, the numbering decision, the provider/model
 * configuration, and the auth capability — with credentials reduced to process-local fingerprints.
 * Requests that would model the same thing with the same providers share one run; anything that
 * differs gets its own.
 *
 * WHAT SHARING DOES NOT CHANGE
 * ─────────────────────────────────────────────────────────────────────────────
 * • Each caller keeps its own RESULT. The shared value is `CoreAnalysisData`; every caller still
 *   assembles its own payload from it, so nothing about a fast-triage frame, a structural merge or a
 *   persistence decision is shared.
 * • Each caller keeps its own PROGRESS. Listeners are fanned out per run, so a stream that owns the
 *   run streams previews even while a structural request is riding along. A caller that joins a run
 *   which is already partway through receives only the previews published AFTER it joined — never a
 *   replay of ones it missed, because a preview describes "settled so far", and a replayed stale map
 *   could step a source backwards from `ok` to `pending`.
 * • Only RUNNING runs are shared. The entry is removed the instant the run settles, so this is
 *   concurrency de-duplication, not a cache: the persisted payload and the staleness predicate remain
 *   the only cross-request memo, and a second request a second later re-reads the row it just wrote.
 */
import { CONFIG } from "../../config.ts";
import {
  fetchCoreVariantData,
  type CoreAnalysisData,
  type CoreAnalysisPartial,
  type CoreAnalysisPartialListener,
  type CoreFastTriage,
  type CorePrefetchOptions
} from "../external-api/core-data-fetcher.ts";
import { coreIdentityOf } from "./core-identity.ts";
import { type CacheScope, joinShared, newCacheScope, runInCacheScope } from "../infra/cache-scope.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";

export interface SharedCoreFetchOptions {
  /** Budget for the shared run. The run's own budget is fixed when it starts; a joiner cannot change it. */
  timeoutMs?: number;
  /** Prefetched triage promises. Honoured by the caller that STARTS the run; ignored by joiners. */
  prefetched?: CorePrefetchOptions;
  /** Called once per source as it settles. Every listener of a run is called; one that throws is retired alone. */
  onPartial?: CoreAnalysisPartialListener;
}

interface SharedCoreRun {
  key: string;
  promise: Promise<CoreAnalysisData>;
  listeners: Set<CoreAnalysisPartialListener>;
  /**
   * The run's own ClinVar + predictor outcomes, handed out synchronously as it starts.
   *
   * This is the part of the run that a JOINER can use: a route that arrives while this run is in
   * flight builds its first frame from the same two answers instead of querying the providers again
   * (and, in the crossing order, instead of disagreeing with the payload the run will produce).
   */
  fastTriage: CoreFastTriage | null;
  startedAt: number;
  /** Callers that attached to a run somebody else started. */
  joiners: number;
  /**
   * The cache scope the run's fetches note into (rate limits, stale serves). The run serves several
   * requests, so it has its own; each caller copies it into theirs when the run settles (WP-I2).
   */
  scope: CacheScope;
}

/** What a route can learn about a core fetch that is running RIGHT NOW for its identity. */
export interface RunningCoreFetch {
  promise: Promise<CoreAnalysisData>;
  /** Null only in the microseconds before the run's fast sources exist; it is set synchronously. */
  fastTriage: CoreFastTriage | null;
}

const runs = new Map<string, SharedCoreRun>();

const stats = {
  started: 0,
  joined: 0,
  completed: 0,
  failed: 0
};

/** The identity a core fetch is shared under. Process-local: it contains credential fingerprints. */
export function coreSingleflightKey(context: ParsedVariantContext): string {
  return coreIdentityOf(context).flightKey;
}

/**
 * Fetches the core data for `context`, sharing an already-running identical fetch when one exists.
 *
 * The returned promise resolves with the shared `CoreAnalysisData`. If the run fails, every caller
 * awaiting it sees the same rejection — which is what they would have seen alone, since the fetchers
 * inside catch their own provider errors and this only surfaces an unexpected fault.
 */
export function runSharedCoreFetch(
  context: ParsedVariantContext,
  options: SharedCoreFetchOptions = {}
): Promise<CoreAnalysisData> {
  const key = coreSingleflightKey(context);
  const existing = runs.get(key);

  if (existing) {
    stats.joined += 1;
    existing.joiners += 1;
    if (options.onPartial) existing.listeners.add(options.onPartial);
    return joinShared(existing);
  }

  /**
   * The run object is registered BEFORE the fetch is awaited, so a second caller arriving in the
   * same tick (which is the norm: the stream and the structural tab are fired together) finds it.
   */
  const listeners = new Set<CoreAnalysisPartialListener>();
  if (options.onPartial) listeners.add(options.onPartial);

  const run: SharedCoreRun = {
    key,
    // Assigned below; the dispatch closure needs `run`, so the promise is attached afterwards.
    promise: undefined as unknown as Promise<CoreAnalysisData>,
    listeners,
    fastTriage: null,
    startedAt: Date.now(),
    joiners: 0,
    scope: newCacheScope()
  };

  const dispatch = (partial: CoreAnalysisPartial): void => {
    for (const listener of [...run.listeners]) {
      try {
        listener(partial);
      } catch (err: any) {
        /**
         * One caller's writer threw (a torn socket). It is retired alone: the other callers of this
         * run are still owed their previews, and the run itself is still valid.
         */
        run.listeners.delete(listener);
        console.warn("[Core Singleflight] Retired a failing progress listener:", err?.message ?? err);
      }
    }
  };

  stats.started += 1;
  runs.set(key, run);

  run.promise = runInCacheScope(run.scope, () => fetchCoreVariantData(
    context,
    options.timeoutMs ?? CONFIG.timeouts.coreAnalysisMs,
    options.prefetched,
    dispatch,
    /**
     * Called synchronously, before this function returns — so `run.fastTriage` is populated for any
     * caller that finds this run in the same tick.
     */
    triage => {
      run.fastTriage = triage;
    }
  )).then(
    result => {
      stats.completed += 1;
      return result;
    },
    err => {
      stats.failed += 1;
      throw err;
    }
  ).finally(() => {
    /**
     * Removed on SETTLE, not on a timeout: the next request must not be handed a finished run's
     * value, because "finished a moment ago" is not the same as "still valid" — the persisted row
     * and the staleness predicate decide that.
     */
    if (runs.get(key) === run) runs.delete(key);
    run.listeners.clear();
  });

  return joinShared(run);
}

/**
 * The core fetch running right now for this context, or null.
 *
 * A route that is about to answer the reader asks this FIRST: if a run is in flight it can join it
 * AND build its first frame from the run's own fast sources (`fastTriage`), which is what removes the
 * duplicate ClinVar / predictor query — and the possibility of two disagreeing answers — when another
 * route already opened the run.
 */
export function findRunningCoreFetch(context: ParsedVariantContext): RunningCoreFetch | null {
  const run = runs.get(coreSingleflightKey(context));
  if (!run) return null;
  return { promise: joinShared(run), fastTriage: run.fastTriage };
}

/** Whether a core fetch for this context is running right now. Diagnostics and tests. */
export function isCoreFetchInFlight(context: ParsedVariantContext): boolean {
  return runs.has(coreSingleflightKey(context));
}

export interface CoreSingleflightStats {
  inFlight: number;
  started: number;
  joined: number;
  completed: number;
  failed: number;
}

export function coreSingleflightStats(): CoreSingleflightStats {
  return { inFlight: runs.size, ...stats };
}

/** Test hook: forget every in-flight run and reset the counters. */
export function resetCoreSingleflightForTests(): void {
  runs.clear();
  stats.started = 0;
  stats.joined = 0;
  stats.completed = 0;
  stats.failed = 0;
}

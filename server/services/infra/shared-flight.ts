/**
 * shared-flight.ts — one upstream call per key for every concurrent caller, whoever they are
 * (doc/COMPUTE_ROUTING_PLAN.md WP-I2).
 *
 * `getCachedOrFetch` already does this for registry caches. The expensive remote calls that keep their
 * own caches (JapanFold models, SpliceAI, DynaMut2 and DDMut submits) use this instead, so two people
 * asking for the same answer at the same time cause one call to the provider.
 *
 * The shared work must not use any one caller's AbortSignal: one person closing the tab would fail the
 * call for everyone else. `run` therefore bounds itself (its own timeout), and each caller stops
 * waiting when its own signal aborts while the call carries on for the others (and fills the cache).
 *
 * The call runs in a cache scope of its own (`startShared`), not the first caller's, and every caller
 * copies its notes (a rate limit, a stale serve) into theirs when it settles (`joinShared`).
 */
import { joinShared, startShared, type SharedRun } from "./cache-scope.ts";

export interface SharedFlightOptions<T> {
  /** This caller's signal: aborting it rejects this caller's wait only. */
  signal?: AbortSignal | null;
  /**
   * Keep a settled result joinable for this long (default 0). For a submit whose answer is a job id, a
   * caller arriving just after it settled joins the same job instead of starting a second one.
   */
  lingerMs?: number;
  /** Which results may linger (default: all). A "no answer" must not, or it becomes a cached error. */
  lingerIf?: (value: T) => boolean;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}

function untilAborted<T>(flight: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    flight.then(
      value => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/** The calls in flight for one kind of request, by key. */
export type SharedFlights<T> = Map<string, SharedRun<T>>;

export function sharedFlight<T>(
  flights: SharedFlights<T>,
  key: string,
  run: () => Promise<T>,
  options: SharedFlightOptions<T> = {}
): Promise<T> {
  // A caller that has already given up starts nothing.
  if (options.signal?.aborted) return Promise.reject(abortReason(options.signal));
  let flight = flights.get(key);
  if (!flight) {
    const started = startShared(run);
    flight = started;
    flights.set(key, started);
    const forget = () => {
      if (flights.get(key) === started) flights.delete(key);
    };
    started.promise.then(
      value => {
        const linger = options.lingerMs && options.lingerMs > 0 && (!options.lingerIf || options.lingerIf(value));
        if (linger) setTimeout(forget, options.lingerMs).unref?.();
        else forget();
      },
      // A failure is never lingered: the next caller tries again.
      forget
    );
  }
  const result = joinShared(flight);
  return options.signal ? untilAborted(result, options.signal) : result;
}

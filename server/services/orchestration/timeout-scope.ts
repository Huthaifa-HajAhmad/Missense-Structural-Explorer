/**
 * timeout-scope.ts — disposable race budgets for `Promise.race`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The core fetch races eleven sources against a budget, and the structural fetch races four models
 * against another. Both used the same shape:
 *
 *     const budget = new Promise(resolve => setTimeout(() => resolve(FLAG), ms));
 *     const fast = Promise.race([task, budget]);
 *
 * That shape leaks on both ends:
 *
 *  1. THE TIMER IS NEVER CLEARED. `Promise.race` settles the instant the task does, but the
 *     `setTimeout` stays armed for the rest of its window — so a healthy run that answered in 200 ms
 *     leaves a 45 s (and a 15 s) timer pending, one set per request. In a test run that keeps the
 *     loop alive and makes `vi.getTimerCount()` non-zero after a completed request; in the server it
 *     is retained memory and timer churn proportional to request rate.
 *
 *  2. A LATE REJECTION IS UNOBSERVED. When the budget wins, the task is still running. If it later
 *     rejects and nothing else holds it, that rejection surfaces as an uncaught promise rejection in
 *     whatever context the timer callback ran in — not in the request that already answered. The
 *     producers in this pipeline all `.catch()` internally today, which is exactly why the hazard is
 *     invisible until one of them changes.
 *
 * `createTimeoutScope().race(task, ms)` fixes both: the timer is cleared the moment the task
 * settles, and the task's settlement is observed by a handler that swallows it silently once the
 * budget has already fired. `dispose()` clears anything still armed, so a request that exits early
 * (throw, abort) leaves no timer behind.
 *
 * The sentinel is a module-level symbol, so a caller compares with `===` against one value rather
 * than against a fresh object per race.
 */

/** Distinct from every value a producer can return, because it is a symbol. */
export const BUDGET_EXPIRED: unique symbol = Symbol("TIMEOUT_BUDGET_EXPIRED");

export type BudgetExpired = typeof BUDGET_EXPIRED;

export interface TimeoutScope {
  /**
   * The task's value if it settles inside `ms`, otherwise {@link BUDGET_EXPIRED}.
   *
   * A task that rejects inside the budget rejects the returned promise; one that rejects after the
   * budget has fired is absorbed (the caller already answered, and re-raising it there would be an
   * uncaught rejection in the timer's context, not a failure of the request).
   */
  race<T>(task: Promise<T>, ms: number): Promise<T | BudgetExpired>;
  /** How many timers this scope has armed and not yet cleared. Tests use it; production does not. */
  pending(): number;
  /** Clears every timer still armed. Idempotent, safe to call in a `finally`. */
  dispose(): void;
}

export function createTimeoutScope(): TimeoutScope {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  const release = (timer: ReturnType<typeof setTimeout>): void => {
    timers.delete(timer);
    clearTimeout(timer as any);
  };

  const race = <T>(task: Promise<T>, ms: number): Promise<T | BudgetExpired> =>
    new Promise<T | BudgetExpired>((resolve, reject) => {
      /**
       * A disposed scope cannot start a new budget. The task is still observed below so that a
       * rejection cannot escape as unhandled — the promise simply answers `BUDGET_EXPIRED`, which
       * every caller already treats as "this source produced nothing".
       */
      const effectiveMs = disposed ? 0 : ms;
      let settled = false;

      const timer = setTimeout(() => {
        release(timer);
        if (settled) return;
        settled = true;
        resolve(BUDGET_EXPIRED);
      }, effectiveMs);
      timers.add(timer);
      /**
       * A time budget must never be the reason the process stays alive. The server holds sockets;
       * a test holds nothing at all, and an armed 45 s timer there is a hang, not a liveness guard.
       */
      (timer as any).unref?.();

      task.then(
        value => {
          if (settled) return;
          settled = true;
          release(timer);
          resolve(value);
        },
        err => {
          /**
           * Absorbed, deliberately, when the budget already fired — see the note on `race`. When it
           * has not, the rejection travels: the status rules downstream distinguish an outage
           * (`error`) from an absence (`not_found`), and swallowing it here would erase that.
           */
          if (settled) return;
          settled = true;
          release(timer);
          reject(err);
        }
      );
    });

  return {
    race,
    pending: () => timers.size,
    dispose: () => {
      disposed = true;
      for (const timer of [...timers]) release(timer);
    }
  };
}

/** Value of a raced source, or `null` when its budget expired. */
export function settledOrNull<T>(raw: unknown): T | null {
  return raw === BUDGET_EXPIRED ? null : (raw as T);
}

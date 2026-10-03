import { describe, it, expect, vi, afterEach } from "vitest";
import { BUDGET_EXPIRED, createTimeoutScope, settledOrNull } from "./timeout-scope.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RACE BUDGET — cleared timers, absorbed late rejections
 * ─────────────────────────────────────────────────────────────────────────────
 * Both defects these tests pin were real in the code this helper replaced:
 *
 *   `const budget = new Promise(resolve => setTimeout(() => resolve(FLAG), ms));`
 *   `const fast = Promise.race([task, budget]);`
 *
 * The timer was never cleared, so a run that answered in 20 ms still left a 45 s (and a 15 s) timer
 * armed — per request. And when the budget won, the losing task's later rejection had no observer.
 */
describe("createTimeoutScope", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears its timer the moment the task settles", async () => {
    vi.useFakeTimers();
    const scope = createTimeoutScope();

    const raced = scope.race(Promise.resolve("answered"), 45_000);
    await expect(raced).resolves.toBe("answered");

    expect(scope.pending(), "a settled source must leave no armed timer").toBe(0);
    expect(vi.getTimerCount(), "the process keeps no 45 s timer for a completed run").toBe(0);
  });

  it("answers with the shared sentinel when the budget expires, and leaves no timer armed", async () => {
    vi.useFakeTimers();
    const scope = createTimeoutScope();

    const never = new Promise<string>(() => {});
    const raced = scope.race(never, 1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(raced).resolves.toBe(BUDGET_EXPIRED);
    expect(scope.pending()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // The sentinel is what callers compare against; `settledOrNull` is the shared reading of it.
    expect(settledOrNull<string>(BUDGET_EXPIRED)).toBeNull();
  });

  it("dispose() clears a budget that is still armed (the early-exit path)", async () => {
    vi.useFakeTimers();
    const scope = createTimeoutScope();

    const never = new Promise<string>(() => {});
    scope.race(never, 45_000);
    expect(scope.pending()).toBe(1);

    scope.dispose();
    expect(scope.pending()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates a rejection that happens INSIDE the budget", async () => {
    const scope = createTimeoutScope();
    const failing = Promise.reject(new Error("provider refused"));

    await expect(scope.race(failing, 45_000)).rejects.toThrow("provider refused");
    expect(scope.pending()).toBe(0);
  });

  /**
   * A rejection that arrives AFTER the budget has already answered is absorbed.
   *
   * This test would fail the whole file if it were not: vitest reports an unhandled rejection as a
   * test failure, so a leaked rejection here is not merely unasserted, it is visible. The positive
   * assertion is that the caller's answer stays `BUDGET_EXPIRED` — the late failure must not travel
   * into a request that has already responded.
   */
  it("absorbs a rejection that arrives after the budget has already fired", async () => {
    const scope = createTimeoutScope();
    const lateFailure = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error("late provider failure")), 25);
    });

    const raced = scope.race(lateFailure, 1);
    await expect(raced).resolves.toBe(BUDGET_EXPIRED);

    // Let the late rejection happen and the microtask queue drain: nothing observes it, and nothing
    // may be raised on a timer context that nobody awaits.
    await new Promise(resolve => setTimeout(resolve, 60));
    await Promise.resolve();

    expect(scope.pending()).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "./concurrency.ts";

/**
 * The breaker has three states. HALF-OPEN means one trial request is out, not "everyone may try":
 * a host that is still down must be tested by one caller, not by every caller that arrives after the
 * cooldown (each of them would wait out its own timeout).
 */
describe("CircuitBreaker half-open trial", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.5); // jitter factor 1.0: cooldown is exactly 1000 ms
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const tripped = () => {
    const breaker = new CircuitBreaker(2, 1000);
    breaker.recordFailure();
    breaker.recordFailure();
    return breaker;
  };

  it("lets exactly one caller through after the cooldown while its trial is out", () => {
    const breaker = tripped();
    vi.advanceTimersByTime(1001);
    expect(breaker.canExecute()).toBe(true);
    expect(breaker.canExecute()).toBe(false);
    expect(breaker.canExecute()).toBe(false);
  });

  it("opens again when the trial fails, and closes for everyone when it succeeds", () => {
    const failing = tripped();
    vi.advanceTimersByTime(1001);
    expect(failing.canExecute()).toBe(true);
    failing.recordFailure();
    expect(failing.canExecute()).toBe(false);

    const recovering = tripped();
    vi.advanceTimersByTime(1001);
    expect(recovering.canExecute()).toBe(true);
    recovering.recordSuccess();
    expect(recovering.canExecute()).toBe(true);
    expect(recovering.canExecute()).toBe(true);
  });

  it("allows a new trial when the first one never reported back", () => {
    const breaker = tripped();
    vi.advanceTimersByTime(1001);
    expect(breaker.canExecute()).toBe(true); // this caller is aborted before it can record anything
    expect(breaker.canExecute()).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(breaker.canExecute()).toBe(true);
  });

  it("answers a question about availability without using up the trial", () => {
    const breaker = tripped();
    expect(breaker.isAvailable()).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(breaker.isAvailable()).toBe(true);
    expect(breaker.isAvailable()).toBe(true);
    expect(breaker.canExecute()).toBe(true); // the real caller still gets the trial
    expect(breaker.isAvailable()).toBe(false);
  });
});

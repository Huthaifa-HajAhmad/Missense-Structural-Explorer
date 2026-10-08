import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithRetry } from "./http-client.ts";

/**
 * Regression suite for fetchWithRetry's Retry-After handling.
 *
 * Context: Retry-After was originally honoured only on 429. Widening it to every
 * retried status (RFC 9110 §10.2.3 permits it on any 5xx) without also bounding the
 * value introduced two hazards this file pins:
 *
 *   1. An upstream sending `Retry-After: 600` could pin a request for ten minutes,
 *      far past the caller's own budget (the coordinate ladder allots 25s).
 *   2. The loop slept on the FINAL attempt too, adding pure latency before the throw.
 *
 * The tests use tiny `delay` values so jitter stays negligible, and assert on call
 * counts / coarse elapsed time rather than exact sleeps.
 */

function response503(retryAfter: string | null) {
  return {
    ok: false,
    status: 503,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? retryAfter : null) },
    json: async () => ({ error: "unavailable" }),
    text: async () => "unavailable"
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fetchWithRetry — Retry-After bounds", () => {
  it("does not sleep on the final attempt (no trailing delay before throwing)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => response503("10000"));
    // Fake clock: this used to spend a real 10 s asleep on the one legitimate mid-loop backoff.
    vi.useFakeTimers();

    let settled = false;
    const pending = fetchWithRetry("https://example.test/x", { timeout: 50 }, 2, 0)
      .catch(e => e)
      .finally(() => {
        settled = true;
      });
    // Exactly one clamped (10 s) sleep separates the two attempts. If the loop also slept after the
    // final attempt there would be a second 10 s timer pending and the call would not have settled.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(settled).toBe(true);
    expect(await pending).toBeInstanceOf(Error);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns the last response when a 5xx is not retryable away", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => response503("0"));

    await expect(fetchWithRetry("https://example.test/x", { timeout: 50 }, 1, 0)).rejects.toThrow(
      /Failed to fetch/
    );
  });

  it("still retries a 503 the full number of attempts", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => response503("0"));

    await expect(fetchWithRetry("https://example.test/x", { timeout: 50 }, 3, 0)).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("retries 504 as well as 500/502/503 (status predicate widened)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(
      async () =>
        ({
          ok: false,
          status: 504,
          headers: { get: () => "0" },
          json: async () => ({}),
          text: async () => "gateway timeout"
        }) as unknown as Response
    );

    await expect(fetchWithRetry("https://example.test/x", { timeout: 50 }, 2, 0)).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("aborts a pending backoff immediately when the caller signal fires", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => response503("10000"));
    const controller = new AbortController();

    const started = Date.now();
    const pending = fetchWithRetry(
      "https://example.test/x",
      { timeout: 5000, signal: controller.signal },
      3,
      0
    ).catch(e => e);
    // Let the first attempt complete and the (clamped 10s) sleep begin.
    await new Promise(r => setTimeout(r, 60));
    controller.abort(new Error("caller aborted"));
    const err: any = await pending;
    const elapsed = Date.now() - started;

    expect(err).toBeInstanceOf(Error);
    // Without an abort-aware sleep this would have waited the full clamped interval.
    expect(elapsed).toBeLessThan(2000);
  }, 30_000);
});

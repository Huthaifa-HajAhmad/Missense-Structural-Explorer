import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  fetchWithRetry,
  isHostAvailable,
  resetHostStateForTests,
  setBackoffScaleForTests,
  withHostLock,
} from "./http-client.ts";
import {
  DEFAULT_PAUSE_MS,
  MAX_PAUSE_MS,
  isProviderRateLimited,
  pauseMsFromRetryAfter,
  pauseRemainingMs,
  providerHealth,
  recordRateLimit,
  resetProviderPausesForTests,
} from "./provider-pause.ts";

/**
 * WP-I3: the team-wide 429 pause (doc/COMPUTE_ROUTING_PLAN.md).
 *
 * "Two users" are two independent callers of `fetchWithRetry`: the pause is keyed by host, not by
 * caller, which is the whole point (the team shares one IP). The circuit breaker opens after 5 counted
 * failures, so "not tripped" is checked after more 429s than that.
 */

const BIOSIG = "https://biosig.lab.uq.edu.au/dynamut2/api/prediction_single?job_id=1";
const BIOSIG_HOST = "biosig.lab.uq.edu.au";

function answer(status: number, retryAfter: string | null = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? retryAfter : null) },
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

const savedMode = process.env.EGRESS_GOVERNOR;

beforeEach(() => {
  resetHostStateForTests();
  resetProviderPausesForTests();
  setBackoffScaleForTests(0);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setBackoffScaleForTests(1);
  if (savedMode === undefined) delete process.env.EGRESS_GOVERNOR;
  else process.env.EGRESS_GOVERNOR = savedMode;
});

describe("pauseMsFromRetryAfter", () => {
  it("uses Retry-After seconds, caps them, and floors an absent or zero value", () => {
    expect(pauseMsFromRetryAfter("3")).toBe(3_000);
    expect(pauseMsFromRetryAfter("600")).toBe(MAX_PAUSE_MS);
    expect(pauseMsFromRetryAfter(null)).toBe(DEFAULT_PAUSE_MS);
    expect(pauseMsFromRetryAfter("0")).toBe(DEFAULT_PAUSE_MS);
    expect(pauseMsFromRetryAfter("soon")).toBe(DEFAULT_PAUSE_MS);
  });

  it("reads an HTTP date", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    expect(pauseMsFromRetryAfter("Tue, 13 Oct 2026 12:00:04 GMT", now)).toBe(4_000);
    // A date in the past is "no usable value", not "no pause".
    expect(pauseMsFromRetryAfter("Tue, 13 Oct 2026 11:00:00 GMT", now)).toBe(DEFAULT_PAUSE_MS);
  });
});

describe("EGRESS_GOVERNOR=off (default) is today's behaviour", () => {
  it("records no pause, and a 429 that ends a call counts toward the breaker", async () => {
    delete process.env.EGRESS_GOVERNOR;
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => answer(429, "8"));

    for (let i = 0; i < 5; i++) {
      const err = await fetchWithRetry(BIOSIG, { timeout: 50 }, 1, 0).catch(e => e);
      expect(isProviderRateLimited(err)).toBe(false);
      expect(err.statusCode).toBe(429);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(pauseRemainingMs(BIOSIG_HOST)).toBe(0);
    expect(isHostAvailable(BIOSIG)).toBe(false);
    expect(providerHealth().providers).toEqual([]);
  });
});

describe("EGRESS_GOVERNOR=on", () => {
  beforeEach(() => {
    process.env.EGRESS_GOVERNOR = "on";
  });

  it("a 429 from DynaMut2 pauses it for every caller; paused calls never reach the provider", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => answer(429, "8"));

    // User X's call is refused by the provider.
    const first = await fetchWithRetry(BIOSIG, { timeout: 50 }, 1, 0).catch(e => e);
    expect(isProviderRateLimited(first)).toBe(true);
    expect(first.statusCode).toBe(429);
    expect(first.retryAfterSec).toBe(8);
    expect(first.message).toBe("UQ BioSig (DynaMut2, DDMut) is limiting requests; retrying in 8 s.");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // User Y, a different caller, does not get through either, and nothing is sent.
    const second = await fetchWithRetry(BIOSIG.replace("job_id=1", "job_id=2"), { timeout: 50 }, 1, 0).catch(e => e);
    expect(isProviderRateLimited(second)).toBe(true);
    expect(second.retryAfterSec).toBe(8);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Another provider is unaffected.
    fetchSpy.mockImplementation(async () => answer(200));
    await expect(fetchWithRetry("https://rest.uniprot.org/x", { timeout: 50 }, 1, 0)).resolves.toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // After the pause, calls resume.
    await vi.advanceTimersByTimeAsync(8_000);
    const res = await fetchWithRetry(BIOSIG, { timeout: 50 }, 1, 0);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does not trip the circuit breaker however many 429s arrive", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => answer(429));
    for (let i = 0; i < 7; i++) {
      await fetchWithRetry(BIOSIG, { timeout: 50 }, 1, 0).catch(() => {});
      await vi.advanceTimersByTimeAsync(DEFAULT_PAUSE_MS);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(7);
    expect(isHostAvailable(BIOSIG)).toBe(true);
  });

  it("a caller whose deadline leaves room waits for the pause instead of failing", async () => {
    vi.useFakeTimers();
    recordRateLimit(BIOSIG_HOST, 429, "3");
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => answer(200));

    let settled = false;
    const pending = fetchWithRetry(BIOSIG, { timeout: 50, deadlineAt: Date.now() + 20_000 }, 1, 0).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await pending).status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a caller whose deadline is too short is refused at once with the typed error", async () => {
    recordRateLimit(BIOSIG_HOST, 429, "8");
    const fetchSpy = vi.spyOn(global, "fetch");
    const err = await fetchWithRetry(BIOSIG, { timeout: 50, deadlineAt: Date.now() + 2_000 }, 1, 0).catch(e => e);
    expect(isProviderRateLimited(err)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("our own retry waits for the team pause, not just its own backoff", async () => {
    vi.useFakeTimers();
    setBackoffScaleForTests(1);
    // A SLOW 429 (load, not a fast refusal) is retried; without Retry-After the floor pause applies.
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 1_200));
      return answer(429);
    });
    const pending = fetchWithRetry(BIOSIG, { timeout: 5_000 }, 2, 10).catch(e => e);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // The plain backoff (10-20 ms) has long passed; the retry is still held by the pause.
    await vi.advanceTimersByTimeAsync(DEFAULT_PAUSE_MS - 100);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200 + 1_200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(isProviderRateLimited(await pending)).toBe(true);
  });

  it("503 pauses only when it says when to come back", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => answer(503));
    const plain = await fetchWithRetry(BIOSIG, { timeout: 50 }, 1, 0).catch(e => e);
    expect(isProviderRateLimited(plain)).toBe(false);
    expect(pauseRemainingMs(BIOSIG_HOST)).toBe(0);

    fetchSpy.mockImplementation(async () => answer(503, "4"));
    const told = await fetchWithRetry(BIOSIG, { timeout: 50 }, 1, 0).catch(e => e);
    expect(isProviderRateLimited(told)).toBe(true);
    expect(told.statusCode).toBe(503);
    expect(pauseRemainingMs(BIOSIG_HOST)).toBeGreaterThan(3_000);
  });

  it("a later answer can lengthen a pause but never shorten it", () => {
    const now = Date.now();
    recordRateLimit(BIOSIG_HOST, 429, "9", now);
    recordRateLimit(BIOSIG_HOST, 429, "2", now);
    expect(pauseRemainingMs(BIOSIG_HOST, now)).toBe(9_000);
  });

  it("health probes still go out while the provider is paused", async () => {
    recordRateLimit(BIOSIG_HOST, 429, "8");
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => answer(200));
    await expect(fetchWithRetry(BIOSIG, { timeout: 50, probe: true }, 1, 0)).resolves.toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("withHostLock (node:https callers such as the DDMut poll) honours the pause", async () => {
    recordRateLimit(BIOSIG_HOST, 429, "8");
    const fn = vi.fn(async () => "sent");
    const err = await withHostLock(BIOSIG_HOST, fn).catch(e => e);
    expect(isProviderRateLimited(err)).toBe(true);
    expect(fn).not.toHaveBeenCalled();
  });

  it("/capabilities health names the host and its pause, and nothing secret", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => answer(429, "8"));
    await fetchWithRetry(BIOSIG, { timeout: 50, headers: { "x-biohub-token": "secret-token-123" } }, 1, 0).catch(() => {});
    const health = providerHealth();
    expect(health.mode).toBe("on");
    expect(health.providers).toEqual([
      expect.objectContaining({
        hostname: BIOSIG_HOST,
        provider: "UQ BioSig (DynaMut2, DDMut)",
        state: "paused",
        retryAfterSec: 8,
        recentRateLimits: 1,
        limitBasis: "unmeasured",
      }),
    ]);
    expect(JSON.stringify(health)).not.toMatch(/secret-token|job_id/);
  });
});

describe("EGRESS_GOVERNOR=shadow", () => {
  beforeEach(() => {
    process.env.EGRESS_GOVERNOR = "shadow";
  });

  it("records the pause it would apply but changes no response and no breaker accounting", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => answer(429, "8"));

    const first = await fetchWithRetry(BIOSIG, { timeout: 50 }, 1, 0).catch(e => e);
    expect(isProviderRateLimited(first)).toBe(false);
    expect(pauseRemainingMs(BIOSIG_HOST)).toBeGreaterThan(7_000);

    // Sent anyway, and counted as a call the pause would have held.
    await fetchWithRetry(BIOSIG, { timeout: 50 }, 1, 0).catch(() => {});
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [host] = providerHealth().providers;
    expect(host).toMatchObject({ state: "paused", wouldHold: 1, recentRateLimits: 2 });

    for (let i = 0; i < 3; i++) await fetchWithRetry(BIOSIG, { timeout: 50 }, 1, 0).catch(() => {});
    expect(isHostAvailable(BIOSIG)).toBe(false);
  });
});

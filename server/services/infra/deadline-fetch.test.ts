import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { fetchWithRetry, resetHostStateForTests } from "./http-client";

/**
 * A production 503 came from this loop: Ensembl VEP was answering, but one transient 500 cost a retry
 * that could not finish inside the resolution ladder's window, so the attempt was killed mid-retry and
 * the provider was reported as unreachable for the whole request.
 *
 * `deadlineAt` makes the caller's window authoritative: no attempt or retry is started that cannot
 * finish in the time actually left.
 */
describe("fetchWithRetry — caller deadline", () => {
  let fetchSpy: any;

  beforeEach(() => {
    resetHostStateForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  const alwaysFiveHundred = (delayMs: number) =>
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { ok: false, status: 500, headers: { get: () => null }, text: async () => "boom" } as any;
    });

  it("does not start a retry that cannot finish before the deadline", async () => {
    fetchSpy = alwaysFiveHundred(40);

    await fetchWithRetry("https://example.test/vep", { timeout: 5000, deadlineAt: Date.now() + 150 }, 3, 1000).catch(() => {});

    // One attempt, then the deadline guard refuses the retry instead of consuming the window.
    expect(fetchSpy.mock.calls.length).toBe(1);
  });

  it("still retries when the deadline leaves room", async () => {
    fetchSpy = alwaysFiveHundred(10);

    await fetchWithRetry("https://example.test/vep", { timeout: 5000, deadlineAt: Date.now() + 5000 }, 3, 5).catch(() => {});

    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it("works unchanged for callers that pass no deadline", async () => {
    fetchSpy = alwaysFiveHundred(10);

    await fetchWithRetry("https://example.test/vep", { timeout: 5000 }, 3, 5).catch(() => {});

    expect(fetchSpy.mock.calls.length).toBe(3);
  });
});

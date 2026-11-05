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

  /**
   * A fast refusal is a POLICY answer, not transient load. Measured: Ensembl returns 500 for every
   * endpoint — `/info/ping` included — in ~90ms when it refuses a client, and VariantValidator returns
   * 429. Retrying those multiplied our footprint against services already rate-limiting us, which is
   * how a deployment earns a longer block.
   */
  it("does NOT retry a refusal that arrives in milliseconds", async () => {
    fetchSpy = alwaysFiveHundred(10);

    await fetchWithRetry("https://example.test/vep", { timeout: 5000 }, 3, 5).catch(() => {});

    expect(fetchSpy.mock.calls.length).toBe(1);
  });

  it("still retries a SLOW failure, which is what provider load looks like", async () => {
    fetchSpy = alwaysFiveHundred(1050);

    await fetchWithRetry("https://example.test/vep", { timeout: 5000 }, 2, 5).catch(() => {});

    expect(fetchSpy.mock.calls.length).toBe(2);
  });

  /**
   * NCBI E-utilities is the counter-example the fast-refusal rule had to be told about. Its 500 page
   * says "this could be a transient problem, please try the query again" and arrives from a
   * front-end node in a few hundred milliseconds, while the same query answers 200 in 1-2 s on the
   * next call (measured 2026-11-05: 5 of 10 esearch calls). Treating that as a policy refusal left
   * ClinVar reported as "error" on runs where a single retry resolved the record.
   */
  it("retries a FAST 5xx from a provider that documents it as transient", async () => {
    fetchSpy = alwaysFiveHundred(10);

    await fetchWithRetry("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", {
      timeout: 5000,
      fastFailureIsTransient: true,
    }, 3, 5).catch(() => {});

    expect(fetchSpy.mock.calls.length).toBe(3);
  });

  it("keeps a fast 429 a policy answer even for such a provider", async () => {
    // A rate limit is still a rate limit: retrying it is the burst the team pause exists to stop.
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => {
      return { ok: false, status: 429, headers: { get: () => null }, text: async () => "slow down" } as any;
    });

    await fetchWithRetry("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", {
      timeout: 5000,
      fastFailureIsTransient: true,
    }, 3, 5).catch(() => {});

    expect(fetchSpy.mock.calls.length).toBe(1);
  });

  it("retries a fast 429 when it advertises a cooldown that fits the caller's deadline", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => {
      return {
        ok: false,
        status: 429,
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "0" : null) },
        text: async () => "rate limited",
      } as any;
    });

    await fetchWithRetry("https://example.test/vep", { timeout: 5000, deadlineAt: Date.now() + 5000 }, 3, 5).catch(() => {});

    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it("identifies this deployment on every upstream call", async () => {
    // Both Ensembl and VariantValidator document a User-Agent as a requirement for API clients, and
    // anonymous retrying traffic is what gets throttled.
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => "{}",
    } as any);

    await fetchWithRetry("https://example.test/vep", { timeout: 5000 });

    const init: any = fetchSpy.mock.calls[0][1];
    expect(String(init?.headers?.["User-Agent"])).toContain("Missense-Structural-Explorer");
  });
});

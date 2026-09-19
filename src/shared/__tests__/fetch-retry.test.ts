import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "../fetch-retry";

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return successful response on first attempt", async () => {
    const mockRes = new Response("OK", { status: 200 });
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(mockRes);

    const res = await fetchWithRetry("https://example.com/api/test");
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("should retry on 503 Service Unavailable and succeed", async () => {
    const errorRes = new Response("Unavailable", { status: 503 });
    const okRes = new Response("OK", { status: 200 });
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(errorRes)
      .mockResolvedValueOnce(okRes);

    const res = await fetchWithRetry("https://example.com/api/test", {}, 2, 10, 1.5);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("should bypass retry when response contains API_KEY_MISSING", async () => {
    const errorRes = new Response(JSON.stringify({ error: "API_KEY_MISSING" }), { status: 500 });
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(errorRes);

    const res = await fetchWithRetry("https://example.com/api/test", {}, 3, 10, 2);
    expect(res.status).toBe(500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("should abort immediately when signal is aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      fetchWithRetry("https://example.com/api/test", { signal: abortController.signal }, 2, 10, 2)
    ).rejects.toThrow();
  });

  /**
   * Regression context: `POST /api/v1/translate-variant` answered `503 Retry-After: 60` after
   * exhausting its 25s provider ladder. The client retried 430ms later anyway, the second
   * attempt began another 25s ladder, the caller's 45s watchdog fired inside it, and the user
   * saw "Analysis query error: Request timed out after 45000ms" — the server's actionable
   * guidance replaced by a scheduling artefact.
   */
  describe("Retry-After and caller-budget awareness", () => {
    it("returns the response instead of waiting out a Retry-After longer than a request can afford", async () => {
      const unavailable = new Response("Coordinate translation is temporarily unavailable", {
        status: 503,
        headers: { "Retry-After": "60" },
      });
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(unavailable);

      const res = await fetchWithRetry("https://example.com/api/v1/translate-variant", { timeout: 45000 });

      expect(res.status).toBe(503);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      // The body must still be readable by the caller, which surfaces it to the user.
      await expect(res.text()).resolves.toContain("temporarily unavailable");
    });

    it("honours a short Retry-After as the delay instead of exponential backoff", async () => {
      const throttled = new Response("Too many requests", {
        status: 429,
        headers: { "Retry-After": "0" },
      });
      const ok = new Response("OK", { status: 200 });
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(throttled)
        .mockResolvedValueOnce(ok);

      const startedAt = Date.now();
      const res = await fetchWithRetry("https://example.com/api/test", {}, 2, 500, 2);
      const elapsed = Date.now() - startedAt;

      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      // Exponential backoff from a 500ms base would take >= 400ms; honouring the header does not.
      expect(elapsed).toBeLessThan(300);
    });

    it("does not start a retry that cannot finish inside the caller's budget", async () => {
      const unavailable = new Response("Unavailable", { status: 503 });
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return unavailable.clone();
      });

      const res = await fetchWithRetry(
        "https://example.com/api/test",
        { totalTimeoutMs: 150 },
        2,
        500,
        2
      );

      // One 60ms attempt + ~500ms backoff cannot fit in 150ms, so the response is returned
      // rather than an attempt the watchdog would abort.
      expect(res.status).toBe(503);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("still retries when the budget can accommodate another attempt", async () => {
      const unavailable = new Response("Unavailable", { status: 503 });
      const ok = new Response("OK", { status: 200 });
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(unavailable)
        .mockResolvedValueOnce(ok);

      const res = await fetchWithRetry(
        "https://example.com/api/test",
        { totalTimeoutMs: 5000 },
        2,
        10,
        2
      );

      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MIN_RETRY_AFTER_MS,
  describeConnectionFailure,
  fetchWithRetry,
  isTransientNetworkError,
  parseRetryAfterMs,
  withTransientRetry,
} from "../fetch-retry";

describe("parseRetryAfterMs", () => {
  it("accepts a plain delta-seconds value or a parseable HTTP-date", () => {
    expect(parseRetryAfterMs("60")).toBe(60_000);
    expect(parseRetryAfterMs(" 5 ")).toBe(5_000);
    // Floored: `Retry-After: 0` must not become a zero-delay hot retry.
    expect(parseRetryAfterMs("0")).toBe(MIN_RETRY_AFTER_MS);
    expect(parseRetryAfterMs(new Date(Date.now() + 3_000).toUTCString())).toBeGreaterThan(2_000);
  });

  it("rejects malformed or past values so normal backoff applies", () => {
    // `Number.parseInt("12abc")` used to return 12 — a 12-second delay from a junk header.
    expect(parseRetryAfterMs("12abc")).toBeNull();
    expect(parseRetryAfterMs("1e9")).toBeNull();
    expect(parseRetryAfterMs("-5")).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(new Date(Date.now() - 3_000).toUTCString())).toBeNull();
  });
});

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

    it("caps a retry's own timeout by the caller's remaining deadline", async () => {
      // The guard used to check only that the DELAY fitted, so the retry then ran under a fresh
      // full timeout and the caller's watchdog killed it mid-flight — discarding the server's
      // message behind "Request timed out after 45000ms". With a deadline the attempt itself is
      // capped, so the error it produces is the provider's, not the watchdog's.
      const badGateway = new Response("Bad gateway", { status: 502 });
      let calls = 0;
      vi.spyOn(global, "fetch").mockImplementation((_url: any, init: any) => {
        calls++;
        if (calls === 1) return Promise.resolve(badGateway.clone());
        // A retry that black-holes until its own attempt timeout fires.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("Network request timed out"), { name: "TimeoutError" }))
          );
        }) as any;
      });

      const startedAt = Date.now();
      const err: any = await fetchWithRetry(
        "https://example.com/api/test",
        { timeout: 5000, deadlineAt: Date.now() + 300 },
        2,
        10,
        2
      ).catch((e) => e);
      const elapsed = Date.now() - startedAt;

      expect(err).toBeTruthy();
      expect(calls).toBe(2);
      // Bounded by the caller's ~300ms deadline, NOT by a fresh 5000ms attempt.
      expect(elapsed).toBeLessThan(900);
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

/**
 * The post-headers gap: `fetchWithRetry` returns as soon as the headers are in, so a connection
 * that dies while the caller reads the body had no retry at all — the production failure this
 * covers reported `TypeError: Failed to fetch` from the body-stall watchdog's `pull` frame.
 */
describe("withTransientRetry", () => {
  it("retries a body read severed after the headers arrived, and returns the retry's value", async () => {
    let calls = 0;
    const citations = await withTransientRetry(async () => {
      calls++;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return ["PMID:1"];
    }, { baseDelayMs: 5 });

    expect(citations).toEqual(["PMID:1"]);
    expect(calls).toBe(2);
  });

  it("recognises the engines' connection failures and nothing else", () => {
    // All three engines report a lost connection as a TypeError, each with its own wording.
    expect(isTransientNetworkError(new TypeError("Failed to fetch"))).toBe(true);              // Chrome / Edge
    expect(isTransientNetworkError(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true); // Firefox
    expect(isTransientNetworkError(new TypeError("Load failed"))).toBe(true);                  // Safari
    expect(isTransientNetworkError(new TypeError("The network connection was lost"))).toBe(true);

    // Our OWN messages contain "Failed to fetch" but are server answers, already retried by
    // fetchWithRetry — retrying them here would double the work and mislabel a 500.
    expect(isTransientNetworkError(new Error("Failed to fetch sequence (HTTP 500 Internal Server Error)"))).toBe(false);
    // A decision, not a fault: the caller's watchdog or an explicit cancellation.
    expect(isTransientNetworkError(new DOMException("Response body stalled for 45000ms", "TimeoutError"))).toBe(false);
    expect(isTransientNetworkError(new DOMException("The user aborted a request.", "AbortError"))).toBe(false);
    // A body that ends cleanly but does not parse is a server bug; retrying hides it.
    expect(isTransientNetworkError(new SyntaxError("Unexpected end of JSON input"))).toBe(false);
    expect(isTransientNetworkError("Failed to fetch")).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
  });

  it("does not retry a watchdog timeout or a rejection the server actually sent", async () => {
    const timeoutAttempt = vi.fn(async () => {
      throw new DOMException("Response body stalled for 45000ms", "TimeoutError");
    });
    await expect(withTransientRetry(timeoutAttempt, { baseDelayMs: 5 })).rejects.toThrow("stalled");
    expect(timeoutAttempt).toHaveBeenCalledTimes(1);

    const refusalAttempt = vi.fn(async () => {
      throw new Error("Gene parameter is required.");
    });
    await expect(withTransientRetry(refusalAttempt, { baseDelayMs: 5 })).rejects.toThrow("required");
    expect(refusalAttempt).toHaveBeenCalledTimes(1);
  });

  it("surfaces the ORIGINAL error once the attempts are exhausted", async () => {
    const attempt = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    const err: any = await withTransientRetry(attempt, { retries: 2, baseDelayMs: 5 }).catch((e) => e);

    // Attempts = 1 + retries, and the raw network error is preserved for the console report.
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe("Failed to fetch");
  });

  it("does not start a retry the caller's budget cannot accommodate", async () => {
    const attempt = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    const startedAt = Date.now();
    await expect(
      withTransientRetry(attempt, { retries: 3, baseDelayMs: 500, deadlineAt: Date.now() + 300 })
    ).rejects.toThrow("Failed to fetch");

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBeLessThan(300);
  });

  it("cancels a pending backoff as soon as the caller aborts", async () => {
    const controller = new AbortController();
    const attempt = vi.fn(async () => {
      controller.abort();
      throw new TypeError("Failed to fetch");
    });

    const startedAt = Date.now();
    await expect(
      withTransientRetry(attempt, { retries: 3, baseDelayMs: 5000, signal: controller.signal })
    ).rejects.toThrow();

    // A 5s backoff that is never waited out.
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("turns the leftover browser string into text a clinician can act on", () => {
    expect(describeConnectionFailure(new TypeError("Failed to fetch"), "citations")).toBe(
      "Connection lost while loading citations. Check your connection and try again."
    );
    // Not a connection failure: the caller keeps the server's own message.
    expect(describeConnectionFailure(new Error("Gene parameter is required."))).toBeNull();
    expect(describeConnectionFailure(new DOMException("aborted", "AbortError"))).toBeNull();
  });
});

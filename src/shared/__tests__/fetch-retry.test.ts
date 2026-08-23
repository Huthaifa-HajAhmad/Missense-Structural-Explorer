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
});

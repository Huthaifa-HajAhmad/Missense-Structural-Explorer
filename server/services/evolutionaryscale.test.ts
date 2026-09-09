import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchEvo2Score, fetchGpnStarScore, clearEvo2Cache, clearGpnCache } from "./evolutionaryscale.ts";

describe("EvolutionaryScale Service", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    clearEvo2Cache();
    clearGpnCache();
    process.env = { ...originalEnv };
    delete process.env.BIOHUB_API_TOKEN;
    delete process.env.EVO2_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should return token_required when no token is configured", async () => {
    const result = await fetchEvo2Score("MVKV", 2, "V", "A", null);
    expect(result.status).toBe("token_required");
    expect(result.score).toBeNull();
  });

  it("should parse successful Evo 2 score when API succeeds", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ score: -4.85 })
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchEvo2Score("MVKV", 2, "V", "E", "test-token");
    expect(result.status).toBe("live");
    expect(result.score).toBe(-4.85);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.evolutionaryscale.ai/v1/evo2",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token"
        })
      })
    );
  });

  it("should parse successful GPN-Star score when API succeeds", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ delta_llr: -2.34 })
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchGpnStarScore("MVKV", 2, "V", "E", "test-token");
    expect(result.status).toBe("live");
    expect(result.score).toBe(-2.34);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.evolutionaryscale.ai/v1/evo2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "gpn-star",
          sequence: "MVKV",
          position: 2,
          wt: "V",
          mut: "E"
        })
      })
    );
  });

  it("should avoid cache collisions for distinct sequences of the exact same length", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ score: callCount === 1 ? -1.25 : -8.50 })
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    // Two different sequences of same length (4) mutated at pos 2 V -> E
    const res1 = await fetchEvo2Score("MVKV", 2, "V", "E", "test-token");
    const res2 = await fetchEvo2Score("AVKT", 2, "V", "E", "test-token");

    expect(res1.score).toBe(-1.25);
    expect(res2.score).toBe(-8.50);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should handle 401/403 authorization error gracefully without poisoning the cache", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized"
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ score: -3.14 })
      });
    vi.stubGlobal("fetch", mockFetch);

    // First call with invalid token returns token_required
    const badResult = await fetchEvo2Score("MVKV", 3, "K", "D", "invalid-token");
    expect(badResult.status).toBe("token_required");
    expect(badResult.score).toBeNull();

    // Second call with corrected token should NOT be blocked by cached 401
    const goodResult = await fetchEvo2Score("MVKV", 3, "K", "D", "valid-token");
    expect(goodResult.status).toBe("live");
    expect(goodResult.score).toBe(-3.14);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should handle timeouts / 5xx without throwing", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchEvo2Score("MVKV", 1, "M", "L", "valid-token");
    expect(result.status).toBe("unavailable");
    expect(result.score).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchEvo2Score, fetchGpnStarScore, clearEvo2Cache, clearGpnCache } from "./evolutionaryscale.ts";

describe("Frontier Genomic Models Service (Evo 2 & GPN-Star)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    clearEvo2Cache();
    clearGpnCache();
    process.env = { ...originalEnv };
    delete process.env.BIOHUB_API_TOKEN;
    delete process.env.EVO2_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.EVO2_API_URL;
    delete process.env.HF_TOKEN;
    delete process.env.HUGGINGFACE_API_KEY;
    delete process.env.GPN_API_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should return token_required when no token is configured for Evo 2", async () => {
    const result = await fetchEvo2Score("MVKV", 2, "V", "A", null);
    expect(result.status).toBe("token_required");
    expect(result.score).toBeNull();
  });

  it("should parse successful Evo 2 score via NVIDIA BioNeMo NIM when API succeeds", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ score: -4.85 })
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchEvo2Score("MVKV", 2, "V", "E", "test-nvidia-token");
    expect(result.status).toBe("live");
    expect(result.score).toBe(-4.85);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://integrate.api.nvidia.com/v1/biology/arc/evo2-40b",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-nvidia-token"
        })
      })
    );
  });

  it("should parse successful GPN-Star score via Song Lab Hugging Face inference when API succeeds", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ delta_llr: -2.34 })
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchGpnStarScore("MVKV", 2, "V", "E", "test-hf-token");
    expect(result.status).toBe("live");
    expect(result.score).toBe(-2.34);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://router.huggingface.co/hf-inference/models/songlab/gpn-msa-sapiens",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-hf-token"
        }),
        body: expect.stringContaining("songlab/gpn-msa-sapiens")
      })
    );
  });

  it("should support custom EVO2_API_URL and GPN_API_URL sidecar overrides", async () => {
    process.env.EVO2_API_URL = "http://127.0.0.1:8000/predict/evo2";
    process.env.GPN_API_URL = "http://127.0.0.1:8000/predict/gpn";

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ score: -3.42 })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ score: -1.88 })
      });
    vi.stubGlobal("fetch", mockFetch);

    const evoRes = await fetchEvo2Score("MVKV", 2, "V", "E", null);
    const gpnRes = await fetchGpnStarScore("MVKV", 2, "V", "E", null);

    expect(evoRes.score).toBe(-3.42);
    expect(gpnRes.score).toBe(-1.88);
    expect(mockFetch).toHaveBeenNthCalledWith(1, "http://127.0.0.1:8000/predict/evo2", expect.anything());
    expect(mockFetch).toHaveBeenNthCalledWith(2, "http://127.0.0.1:8000/predict/gpn", expect.anything());
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

    const badResult = await fetchEvo2Score("MVKV", 3, "K", "D", "invalid-token");
    expect(badResult.status).toBe("token_required");
    expect(badResult.score).toBeNull();

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

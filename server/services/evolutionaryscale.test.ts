import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchGpnStarScore,
  fetchGpnStarByCoordinate,
  clearGpnCache,
  setGpnTabixInstance
} from "./gpn.ts";

describe("Frontier Genomic Models Service (GPN-Star)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    clearGpnCache();
    setGpnTabixInstance(null);
    process.env = { ...originalEnv };
    delete process.env.BIOHUB_API_TOKEN;
    delete process.env.HF_TOKEN;
    delete process.env.HUGGINGFACE_API_KEY;
    delete process.env.GPN_API_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
    setGpnTabixInstance(null);
    vi.restoreAllMocks();
  });

  it("should query GPN-Star whole-genome Tabix on-demand when coordinates are provided", async () => {
    const mockTabix = {
      getLines: vi.fn(async (_chrom: string, _start: number, _end: number, opts: any) => {
        // Simulate Tabix lineCallback emitting matching TSV line
        opts.lineCallback("1\t46019605\tC\tT\t-6.920000");
      })
    } as any;
    setGpnTabixInstance(mockTabix);

    const result = await fetchGpnStarByCoordinate("chr1", 46019605, "C", "T");
    expect(result.status).toBe("live");
    expect(result.score).toBe(-6.92);
    expect(mockTabix.getLines).toHaveBeenCalledWith(
      "1",
      46019604,
      46019606,
      expect.objectContaining({ lineCallback: expect.any(Function) })
    );
  });

  it("should handle unindexed coordinates in GPN-Star Tabix cleanly", async () => {
    const mockTabix = {
      getLines: vi.fn(async (_chrom: string, _start: number, _end: number, opts: any) => {
        // Line with different alt allele
        opts.lineCallback("1\t46019605\tC\tG\t-3.500000");
      })
    } as any;
    setGpnTabixInstance(mockTabix);

    const result = await fetchGpnStarByCoordinate("1", 46019605, "C", "A");
    expect(result.status).toBe("unavailable");
    expect(result.score).toBeNull();
    expect(result.message).toContain("Unindexed in GPN-Star");
  });

  it("should prioritize custom GPN_API_URL sidecar override when configured", async () => {
    process.env.GPN_API_URL = "http://127.0.0.1:8000/predict/gpn";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ score: -4.15 })
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await fetchGpnStarByCoordinate("1", 46019605, "C", "T");
    expect(res.status).toBe("live");
    expect(res.score).toBe(-4.15);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/predict/gpn",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ chrom: "1", pos: 46019605, ref: "C", alt: "T" })
      })
    );
  });

  it("should return informative message when fetchGpnStarScore is called with sequence alone", async () => {
    const result = await fetchGpnStarScore("MVKV", 2, "V", "E", null);
    expect(result.status).toBe("unavailable");
    expect(result.score).toBeNull();
    expect(result.message).toContain("genomic coordinates (GRCh38)");
  });

  it("should query custom endpoint when fetchGpnStarScore is provided with customEndpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ delta_llr: -2.85 })
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchGpnStarScore(
      "MVKV",
      2,
      "V",
      "E",
      "test-token",
      undefined,
      "http://127.0.0.1:8000/predict/gpn"
    );
    expect(result.status).toBe("live");
    expect(result.score).toBe(-2.85);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/predict/gpn",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token"
        })
      })
    );
  });

  it("should handle Tabix errors or timeouts gracefully without throwing", async () => {
    const mockTabix = {
      getLines: vi.fn(async () => {
        throw new Error("HTTP Range request failed");
      })
    } as any;
    setGpnTabixInstance(mockTabix);

    const result = await fetchGpnStarByCoordinate("22", 99999999, "A", "C");
    expect(result.status).toBe("unavailable");
    expect(result.score).toBeNull();
    expect(result.message).toContain("Remote GPN Tabix error");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchGpnStarScore,
  fetchGpnStarByCoordinate,
  clearGpnCache,
  setGpnTabixInstance
} from "./gpn.ts";

describe("GPN-Star Foundation Model Service", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    clearGpnCache();
    setGpnTabixInstance(null);
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.HF_TOKEN;
    delete process.env.HUGGINGFACE_API_KEY;
    delete process.env.GPN_API_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
    setGpnTabixInstance(null);
    vi.restoreAllMocks();
  });

  it("should reject invalid coordinates or empty sequence", async () => {
    const res = await fetchGpnStarScore("", 1, "M", "A");
    expect(res.status).toBe("unavailable");
    expect(res.score).toBeNull();
    expect(res.message).toContain("Invalid sequence");

    const coordRes = await fetchGpnStarByCoordinate("", 0, "", "");
    expect(coordRes.status).toBe("unavailable");
    expect(coordRes.score).toBeNull();
    expect(coordRes.message).toContain("Invalid genomic coordinates");
  });

  it("should inform user that genomic coordinates are needed when called without custom endpoint", async () => {
    const res = await fetchGpnStarScore("MKWVTFISLLFLFSSAYS", 2, "K", "R");
    expect(res.status).toBe("unavailable");
    expect(res.score).toBeNull();
    expect(res.message).toContain("genomic coordinates (GRCh38)");
  });

  it("should query custom endpoint when provided for sequence score", async () => {
    let capturedHeaders: Record<string, string> = {};

    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      capturedHeaders = init?.headers || {};
      return {
        ok: true,
        status: 200,
        json: async () => ({ delta_llr: -1.75 })
      };
    });

    const res = await fetchGpnStarScore(
      "MKWVTFISLLFLFSSAYS",
      2,
      "K",
      "R",
      "test_token",
      undefined,
      "https://custom-gpn-inference.internal:8000/predict"
    );

    expect(capturedHeaders["Authorization"]).toBe("Bearer test_token");
    expect(res.status).toBe("live");
    expect(res.score).toBe(-1.75);
  });

  it("should parse score from Tabix query correctly", async () => {
    const mockTabix = {
      getLines: vi.fn(async (_chrom: string, _start: number, _end: number, opts: any) => {
        opts.lineCallback("1\t12345678\tA\tT\t-2.450000");
      })
    } as any;
    setGpnTabixInstance(mockTabix);

    const res = await fetchGpnStarByCoordinate("1", 12345678, "A", "T");
    expect(res.status).toBe("live");
    expect(res.score).toBe(-2.45);
  });
});

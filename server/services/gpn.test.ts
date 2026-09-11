import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchGpnStarScore, clearGpnCache } from "./gpn.ts";

describe("GPN-Star Foundation Model Service", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    clearGpnCache();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.HF_TOKEN;
    delete process.env.HUGGINGFACE_API_KEY;
    delete process.env.GPN_API_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should reject invalid coordinates or empty sequence", async () => {
    const res = await fetchGpnStarScore("", 1, "M", "A");
    expect(res.status).toBe("unavailable");
    expect(res.score).toBeNull();
    expect(res.message).toContain("Invalid sequence");
  });

  it("should return token_required when no credentials or custom endpoints are provided", async () => {
    const res = await fetchGpnStarScore("MKWVTFISLLFLFSSAYS", 2, "K", "R");
    expect(res.status).toBe("token_required");
    expect(res.score).toBeNull();
  });

  it("should NEVER send server environment HF_TOKEN to a customEndpoint (SSRF prevention)", async () => {
    process.env.HF_TOKEN = "server-hf-secret-key";
    let capturedHeaders: Record<string, string> = {};

    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      capturedHeaders = init?.headers || {};
      return {
        ok: true,
        status: 200,
        json: async () => ({ score: 0.82 })
      };
    });

    const res = await fetchGpnStarScore(
      "MKWVTFISLLFLFSSAYS",
      2,
      "K",
      "R",
      null,
      undefined,
      "https://custom-gpn-inference.internal:8000/predict"
    );

    expect(capturedHeaders["Authorization"]).toBeUndefined();
    expect(res.status).toBe("live");
    expect(res.score).toBe(0.82);
  });

  it("should return informative diagnosis when HF serverless returns 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "Model songlab/gpn-msa-sapiens is not available on Serverless Inference" })
    } as any);

    const res = await fetchGpnStarScore(
      "MKWVTFISLLFLFSSAYS",
      2,
      "K",
      "R",
      "hf_user_token"
    );

    expect(res.status).toBe("unavailable");
    expect(res.message).toContain("dedicated Hugging Face Inference Endpoint or local sidecar");
  });

  it("should parse delta_llr or score correctly", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ delta_llr: -1.75 })
    } as any);

    const res = await fetchGpnStarScore(
      "MKWVTFISLLFLFSSAYS",
      2,
      "K",
      "R",
      "hf_user_token"
    );

    expect(res.status).toBe("live");
    expect(res.score).toBe(-1.75);
  });
});

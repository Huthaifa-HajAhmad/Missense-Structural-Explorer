import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchEvo2Score, clearEvo2Cache } from "./evo2.ts";

describe("Evo 2 Foundation Model Service", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    clearEvo2Cache();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.NVIDIA_API_KEY;
    delete process.env.EVO2_API_KEY;
    delete process.env.EVO2_API_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should reject invalid coordinates or empty sequences", async () => {
    const res = await fetchEvo2Score("", 10, "A", "C");
    expect(res.status).toBe("unavailable");
    expect(res.score).toBeNull();
    expect(res.message).toContain("Invalid sequence");
  });

  it("should return token_required when no credentials or custom endpoints are configured", async () => {
    const res = await fetchEvo2Score("ACDEFGHIKLMNPQRSTVWY", 5, "F", "W");
    expect(res.status).toBe("token_required");
    expect(res.score).toBeNull();
  });

  it("should NEVER send server environment token to a customEndpoint (SSRF prevention)", async () => {
    process.env.NVIDIA_API_KEY = "server-secret-key-do-not-leak";
    let capturedHeaders: Record<string, string> = {};

    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      capturedHeaders = init?.headers || {};
      return {
        ok: true,
        status: 200,
        json: async () => ({ score: -0.45 })
      };
    });

    const res = await fetchEvo2Score(
      "ACDEFGHIKLMNPQRSTVWY",
      5,
      "F",
      "W",
      null, // No client token supplied
      undefined,
      "https://custom-untrusted-endpoint.example.com/predict"
    );

    expect(capturedHeaders["Authorization"]).toBeUndefined();
    expect(res.status).toBe("live");
    expect(res.score).toBe(-0.45);
  });

  it("should forward client-supplied token to customEndpoint when provided", async () => {
    let capturedHeaders: Record<string, string> = {};

    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      capturedHeaders = init?.headers || {};
      return {
        ok: true,
        status: 200,
        json: async () => ({ score: -1.2 })
      };
    });

    const res = await fetchEvo2Score(
      "ACDEFGHIKLMNPQRSTVWY",
      5,
      "F",
      "W",
      "user-client-token",
      undefined,
      "https://custom-untrusted-endpoint.example.com/predict/"
    );

    expect(capturedHeaders["Authorization"]).toBe("Bearer user-client-token");
    expect(res.status).toBe("live");
    expect(res.score).toBe(-1.2);
  });

  it("should parse delta_llr from BioNeMo NIM predictions payload", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        predictions: [{ delta_llr: -2.34 }]
      })
    } as any);

    const res = await fetchEvo2Score(
      "ACDEFGHIKLMNPQRSTVWY",
      5,
      "F",
      "W",
      "valid-key"
    );

    expect(res.status).toBe("live");
    expect(res.score).toBe(-2.34);
  });

  it("should handle HTTP 401/403 with token_required", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized"
    } as any);

    const res = await fetchEvo2Score(
      "ACDEFGHIKLMNPQRSTVWY",
      5,
      "F",
      "W",
      "bad-key"
    );

    expect(res.status).toBe("token_required");
    expect(res.message).toContain("401/403");
  });
});

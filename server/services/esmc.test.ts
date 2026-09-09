import { describe, it, expect, vi, beforeEach } from "vitest";
import { runEsmcAnalysis } from "./esmc.ts";
import { clearJapanFoldCache } from "./japanfold-client.ts";

describe("ESMC Service Integration Tests", () => {
  beforeEach(() => {
    clearJapanFoldCache();
    vi.restoreAllMocks();
  });

  it("should prioritize Tier-1 JapanFold ESMC when reachable", async () => {
    const mockJapanFoldResponse = {
      status: "success",
      llr: -2.8,
      wtProbability: 0.15,
      mutProbability: 0.01,
      mutRank: 12,
      positionalEntropy: 1.9,
      embeddingShift: 0.35,
      localShiftMap: [
        { position: 489, residue: "S", shift: 0.35 }
      ]
    };

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockJapanFoldResponse
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEsmcAnalysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null);
    expect(result).toBeDefined();
    expect((result as any).llr).toBe(-2.8);
    expect((result as any).provenance).toBe("JapanFold ESMC (Tier 1)");
  });

  it("should fall back to local sidecar when JapanFold fails", async () => {
    // 1st fetch (JapanFold) rejects
    // 2nd fetch (sidecar) succeeds
    const mockSidecarResponse = {
      status: "success",
      llr: -3.5,
      wtProbability: 0.12,
      mutProbability: 0.005,
      mutRank: 18,
      positionalEntropy: 1.85,
      embeddingShift: 0.45,
      provenance: "VESM-150M (Local)",
      localShiftMap: [
        { position: 488, residue: "S", shift: 0.2 },
        { position: 489, residue: "S", shift: 0.6 },
        { position: 490, residue: "L", shift: 0.4 }
      ]
    };

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("JapanFold offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSidecarResponse
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEsmcAnalysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null);
    expect(result).toBeDefined();
    expect((result as any).llr).toBe(-3.5);
    expect((result as any).provenance).toBe("VESM-150M (Local)");
  });

  it("should return structured error object if both JapanFold and local sidecar fail", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network connection failed"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEsmcAnalysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null);
    expect(result).toBeDefined();
    expect(result?.error).toMatch(/standby|offline|failed/i);
    expect(result?.status).toBe("offline");
  });
});

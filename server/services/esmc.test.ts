import { describe, it, expect, vi, beforeEach } from "vitest";
import { runEsmcAnalysis } from "./esmc.ts";

describe("ESMC Service Integration Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return null if both Biohub API and local sidecar are unreachable/fail", async () => {
    // Mock fetch to reject
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network connection failed"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEsmcAnalysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null);
    expect(result).toBeNull();
  });

  it("should successfully parse sidecar response and map all metrics including mean local shift", async () => {
    const mockSidecarResponse = {
      status: "success",
      llr: -3.5,
      wtProbability: 0.12,
      mutProbability: 0.005,
      mutRank: 18,
      positionalEntropy: 1.85,
      embeddingShift: 0.45,
      localShiftMap: [
        { position: 488, residue: "S", shift: 0.2 },
        { position: 489, residue: "S", shift: 0.6 },
        { position: 490, residue: "L", shift: 0.4 }
      ]
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSidecarResponse
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEsmcAnalysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null);

    expect(result).toBeDefined();
    expect(result!.llr).toBe(-3.5);
    expect(result!.wtProbability).toBe(0.12);
    expect(result!.mutProbability).toBe(0.005);
    expect(result!.mutRank).toBe(18);
    expect(result!.positionalEntropy).toBe(1.85);
    expect(result!.embeddingShift).toBe(0.45);
    
    // Mean of [0.2, 0.6, 0.4] is 0.4
    expect(result!.localEmbeddingShift).toBeCloseTo(0.4, 2);
    expect(result!.localShiftMap).toHaveLength(3);
  });
});

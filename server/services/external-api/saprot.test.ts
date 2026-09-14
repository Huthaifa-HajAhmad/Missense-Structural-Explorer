import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSaprotAnalysis } from "./saprot.ts";
import { clearJapanFoldCache } from "./japanfold-client.ts";

describe("SaProt Service Integration Tests", () => {
  beforeEach(() => {
    clearJapanFoldCache();
    vi.restoreAllMocks();
  });

  it("should prioritize Tier-1 JapanFold SaProt when reachable", async () => {
    const mockJapanFoldResponse = {
      status: "success",
      llr: -3.8,
      wtProbability: 0.10,
      mutProbability: 0.002,
      mutRank: 18,
      positionalEntropy: 2.0,
      embeddingShift: 0.55,
      klDivergence: 1.1,
      conformationState: "A"
    };

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockJapanFoldResponse
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSaprotAnalysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null, "PDB TEXT DUMMY");
    expect(result).toBeDefined();
    expect(result!.llr).toBe(-3.8);
    expect(result!.conformationState).toBe("A");
    expect(result!.provenance).toBe("JapanFold SaProt (Tier 1)");
  });

  it("should fall back to local sidecar (CPU on OCI) when JapanFold fails", async () => {
    const mockSidecarResponse = {
      status: "success",
      llr: -4.2,
      wtProbability: 0.08,
      mutProbability: 0.001,
      mutRank: 19,
      positionalEntropy: 2.1,
      embeddingShift: 0.65,
      klDivergence: 1.25,
      conformationState: "a",
      provenance: "SaProt (SaProt_35M_AF2 - Local CPU)",
      localShiftMap: [
        { position: 488, residue: "S", shift: 0.3 },
        { position: 489, residue: "S", shift: 0.9 },
        { position: 490, residue: "L", shift: 0.6 }
      ]
    };

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("JapanFold timeout"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSidecarResponse
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSaprotAnalysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null, "PDB TEXT DUMMY");
    expect(result).toBeDefined();
    expect(result!.llr).toBe(-4.2);
    expect(result!.provenance).toBe("SaProt (SaProt_35M_AF2 - Local CPU)");
  });

  it("should return null if input is invalid", async () => {
    const result = await runSaprotAnalysis("CNNM2", "invalid_variant", "Q9H8Y5", "MSLS...", null, null);
    expect(result).toBeNull();
  });
});

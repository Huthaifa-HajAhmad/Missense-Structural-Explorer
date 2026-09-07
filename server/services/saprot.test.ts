import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSaprotAnalysis } from "./saprot.ts";

describe("SaProt Service Integration Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return structured error object if sidecar is unreachable/fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network connection failed"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSaprotAnalysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null, null);
    expect(result).toBeDefined();
    expect(result?.error).toMatch(/standby|offline|failed/i);
    expect(result?.status).toBe("offline");
  });

  it("should successfully parse sidecar response and map all metrics including conformationState and klDivergence", async () => {
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
      localShiftMap: [
        { position: 488, residue: "S", shift: 0.3 },
        { position: 489, residue: "S", shift: 0.9 },
        { position: 490, residue: "L", shift: 0.6 }
      ]
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSidecarResponse
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSaprotAnalysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null, "PDB TEXT DUMMY");

    expect(result).toBeDefined();
    expect(result!.llr).toBe(-4.2);
    expect(result!.wtProbability).toBe(0.08);
    expect(result!.mutProbability).toBe(0.001);
    expect(result!.mutRank).toBe(19);
    expect(result!.positionalEntropy).toBe(2.1);
    expect(result!.embeddingShift).toBe(0.65);
    expect(result!.klDivergence).toBe(1.25);
    expect(result!.conformationState).toBe("a");
    expect(result!.localEmbeddingShift).toBeCloseTo(0.6);
  });
});

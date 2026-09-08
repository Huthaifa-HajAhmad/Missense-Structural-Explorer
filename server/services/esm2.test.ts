import { describe, it, expect, vi, beforeEach } from "vitest";
import { runEsm2Analysis } from "./esm2.ts";

describe("ESM-2 Service Integration Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return structured error object if sidecar is unreachable/fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network connection failed"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEsm2Analysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null);
    expect(result).toBeDefined();
    expect(result?.error).toMatch(/standby|offline|failed/i);
    expect(result?.status).toBe("offline");
  });

  it("should successfully parse sidecar response and map all metrics including klDivergence", async () => {
    const mockSidecarResponse = {
      status: "success",
      llr: -3.5,
      wtProbability: 0.12,
      mutProbability: 0.005,
      mutRank: 18,
      positionalEntropy: 1.85,
      embeddingShift: 0.45,
      klDivergence: 0.85,
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

    const result = await runEsm2Analysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null);

    expect(result).toBeDefined();
    expect(result!.llr).toBe(-3.5);
    expect(result!.wtProbability).toBe(0.12);
    expect(result!.mutProbability).toBe(0.005);
    expect(result!.mutRank).toBe(18);
    expect(result!.positionalEntropy).toBe(1.85);
    expect(result!.embeddingShift).toBe(0.45);
    expect(result!.klDivergence).toBe(0.85);
    expect(result!.localEmbeddingShift).toBeCloseTo(0.4);
  });
});

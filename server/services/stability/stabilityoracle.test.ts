import { describe, it, expect, vi, beforeEach } from "vitest";
import { runStabilityOracleAnalysis, runStabilityOracleAnalysisDetailed } from "./stabilityoracle.ts";

describe("StabilityOracle Service Integration Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return null if sidecar is unreachable/fails (No Heuristics Policy)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network connection failed"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runStabilityOracleAnalysis("LMNA", "p.Arg527His", "P02545", "MAEQ...", null);
    expect(result).toBeNull();
  });

  it("should return null for an unparseable variant string", async () => {
    const result = await runStabilityOracleAnalysis("LMNA", "invalid_variant", "P02545", "MAEQ...", null);
    expect(result).toBeNull();
  });

  it("should successfully parse sidecar response and return ddG and provenance", async () => {
    const mockSidecarResponse = {
      status: "success",
      ddG: 1.85,
      isStabilizing: false,
      contactsAnalyzed: 12,
      provenance: "StabilityOracle (Graph-Transformer Local)"
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSidecarResponse
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runStabilityOracleAnalysis("LMNA", "p.Arg527His", "P02545", "MAEQ...", "PDB TEXT DUMMY");

    expect(result).toBeDefined();
    expect(result!.ddG).toBe(1.85);
    expect(result!.isStabilizing).toBe(false);
    expect(result!.contactsAnalyzed).toBe(12);
    expect(result!.provenance).toBe("StabilityOracle (Graph-Transformer Local)");
  });

  it("should correctly parse three-letter variant notation (e.g. p.Arg527His)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", ddG: 0.5, isStabilizing: false, contactsAnalyzed: 8, provenance: "StabilityOracle" })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runStabilityOracleAnalysis("LMNA", "p.Arg527His", "P02545", "MAEQ...", null);
    expect(result).not.toBeNull();
    // Verify fetch was called with correct single-letter codes
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.wt).toBe("R"); // Arg -> R
    expect(body.mut).toBe("H"); // His -> H
    expect(body.position).toBe(527);
  });

  it("should return null when sidecar returns non-success status (No Heuristics Policy)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "error", error: "Model loading failed" })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runStabilityOracleAnalysis("LMNA", "p.Arg527His", "P02545", "MAEQ...", null);
    expect(result).toBeNull();
  });

  it("should parse FoldX 4-part mutation format (RA408W) without mistaking chain for wild-type and forward chain", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "success",
        ddG: 2.15,
        isStabilizing: false,
        contactsAnalyzed: 38,
      })
    } as any);

    const result = await runStabilityOracleAnalysis("PAH", "RA408W", "P00439", "MSTAV...", "ATOM  ...", "B");
    expect(result).not.toBeNull();
    expect(result?.ddG).toBe(2.15);

    const calledBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(calledBody).toEqual({
      sequence: "MSTAV...",
      position: 408,
      wt: "R",
      mut: "W",
      wtPdb: "ATOM  ...",
      chain: "B",
    });
  });

  it("detailed: a live sidecar rejecting the query is an error with its own message, not an unavailability", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: "Wild-type residue mismatch at position 527: structure has GLY, expected ARG." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await runStabilityOracleAnalysisDetailed("LMNA", "p.Arg527Gly", "P02545", "MAEQ...", "PDB TEXT", "A");
    if (outcome.kind !== "error") throw new Error(`expected kind "error", got ${outcome.kind}`);
    expect(outcome.message).toContain("Wild-type residue mismatch");
    // The legacy wrapper keeps its contract: any non-value outcome collapses to null.
    const legacy = await runStabilityOracleAnalysis("LMNA", "p.Arg527Gly", "P02545", "MAEQ...", "PDB TEXT", "A");
    expect(legacy).toBeNull();
  });

  it("detailed: an unreachable sidecar is unavailable — the engine is not running here", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await runStabilityOracleAnalysisDetailed("LMNA", "p.Arg527His", "P02545", "MAEQ...", "PDB TEXT", "A");
    expect(outcome.kind).toBe("unavailable");
  });
});

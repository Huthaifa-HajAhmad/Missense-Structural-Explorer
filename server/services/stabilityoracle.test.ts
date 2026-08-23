import { describe, it, expect, vi, beforeEach } from "vitest";
import { runStabilityOracleAnalysis } from "./stabilityoracle.ts";

describe("StabilityOracle Service Integration Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return fallback stability prediction if sidecar is unreachable/fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network connection failed"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runStabilityOracleAnalysis("LMNA", "p.Arg527His", "P02545", "MAEQ...", null);
    expect(result).not.toBeNull();
    expect(result?.provenance).toContain("Geometric Graph Fallback");
    expect(typeof result?.ddG).toBe("number");
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

  it("should return fallback prediction when sidecar returns non-success status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "error", error: "Model loading failed" })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runStabilityOracleAnalysis("LMNA", "p.Arg527His", "P02545", "MAEQ...", null);
    expect(result).not.toBeNull();
    expect(result?.provenance).toContain("Geometric Graph Fallback");
  });
});

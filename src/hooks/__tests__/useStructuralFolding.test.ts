// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStructuralFolding, StructuralFoldingSink } from "../useStructuralFolding";

describe("useStructuralFolding Hook", () => {
  let mockSink: StructuralFoldingSink;
  let mockApiClient: any;
  let mockAddNotification: any;

  beforeEach(() => {
    mockSink = {
      setEsmFoldWtPdb: vi.fn(),
      setEsmFoldMutPdb: vi.fn(),
      setEsmFoldAlignedPdb: vi.fn(),
      setEsmFoldMetrics: vi.fn(),
      setFoldxMetrics: vi.fn(),
      setIsEsmFolding: vi.fn(),
      setEsmFoldingError: vi.fn(),
      setActive3dModelTab: vi.fn(),
      resetEsmFoldState: vi.fn()
    };

    mockApiClient = {
      foldSequence: vi.fn(),
      structuralAlign: vi.fn()
    };

    mockAddNotification = vi.fn();
  });

  it("synchronizes loading and error state with sink when folding fails with length limit", async () => {
    const limitErrorMsg = "Sequence length (711 aa) exceeds the public ESM Atlas limit of 400 aa. De novo folding for proteins > 400 aa requires an EvolutionaryScale/Biohub API token or local GPU execution.";
    mockApiClient.foldSequence.mockRejectedValue(new Error(limitErrorMsg));

    const { result } = renderHook(() => useStructuralFolding(mockSink));

    await act(async () => {
      await result.current.fetchEsmFold(
        mockApiClient,
        mockAddNotification,
        "Q9H116",
        "p.Arg591Trp",
        "MSEQ...",
        "MSEQ..."
      );
    });

    // Verify hook state
    expect(result.current.isEsmFolding).toBe(false);
    expect(result.current.esmFoldingError).toBe(limitErrorMsg);

    // Verify sink calls
    expect(mockSink.setIsEsmFolding).toHaveBeenCalledWith(true);
    expect(mockSink.setEsmFoldingError).toHaveBeenCalledWith(null);
    expect(mockSink.setEsmFoldingError).toHaveBeenCalledWith(limitErrorMsg);
    expect(mockSink.setIsEsmFolding).toHaveBeenCalledWith(false);
  });

  it("synchronizes structures and metrics with sink on successful folding and alignment", async () => {
    mockApiClient.foldSequence.mockResolvedValue({
      wtPdb: "ATOM WT PDB",
      mutPdb: "ATOM MUT PDB"
    });
    mockApiClient.structuralAlign.mockResolvedValue({
      alignedPdb: "ATOM ALIGNED PDB",
      metrics: { rmsd: 0.45, tmScore: 0.98 }
    });

    const { result } = renderHook(() => useStructuralFolding(mockSink));

    await act(async () => {
      await result.current.fetchEsmFold(
        mockApiClient,
        mockAddNotification,
        "P00439",
        "p.Arg408Trp",
        "MSEQ...",
        "MSEQ..."
      );
    });

    // Verify hook state
    expect(result.current.esmFoldWtPdb).toBe("ATOM WT PDB");
    expect(result.current.esmFoldMutPdb).toBe("ATOM MUT PDB");
    expect(result.current.esmFoldAlignedPdb).toBe("ATOM ALIGNED PDB");
    expect(result.current.esmFoldMetrics).toEqual({ rmsd: 0.45, tmScore: 0.98 });
    expect(result.current.esmFoldingError).toBe(null);

    // Verify sink calls
    expect(mockSink.setEsmFoldWtPdb).toHaveBeenCalledWith("ATOM WT PDB");
    expect(mockSink.setEsmFoldMutPdb).toHaveBeenCalledWith("ATOM MUT PDB");
    expect(mockSink.setEsmFoldAlignedPdb).toHaveBeenCalledWith("ATOM ALIGNED PDB");
    expect(mockSink.setEsmFoldMetrics).toHaveBeenCalledWith({ rmsd: 0.45, tmScore: 0.98 });
  });

  it("resets sink state when resetEsmFoldState is invoked", () => {
    const { result } = renderHook(() => useStructuralFolding(mockSink));

    act(() => {
      result.current.resetEsmFoldState();
    });

    expect(mockSink.resetEsmFoldState).toHaveBeenCalled();
  });
});

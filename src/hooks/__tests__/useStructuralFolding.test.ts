// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useStructuralFolding, StructuralFoldingSink } from "../useStructuralFolding";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";

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

  afterEach(() => {
    useVariantAnalysisStore.setState({ esmAlignmentScope: "local" });
    vi.restoreAllMocks();
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

  it("separates cache entries by esmAlignmentScope", async () => {
    mockApiClient.foldSequence.mockResolvedValue({
      wtPdb: "ATOM WT",
      mutPdb: "ATOM MUT"
    });
    mockApiClient.structuralAlign
      .mockResolvedValueOnce({
        alignedPdb: "ALIGNED_LOCAL",
        metrics: { rmsd: 0.25, tmScore: 0.99 }
      })
      .mockResolvedValueOnce({
        alignedPdb: "ALIGNED_GLOBAL",
        metrics: { rmsd: 1.15, tmScore: 0.91 }
      });

    useVariantAnalysisStore.setState({ esmAlignmentScope: "local" });
    const { result } = renderHook(() => useStructuralFolding(mockSink));

    await act(async () => {
      await result.current.fetchEsmFold(mockApiClient, mockAddNotification, "P04637", "p.Arg175His", "MSEQ", "MSEQ");
    });
    expect(mockApiClient.structuralAlign).toHaveBeenLastCalledWith(
      expect.objectContaining({ alignmentScope: "local" }),
      expect.any(AbortSignal)
    );
    expect(result.current.esmFoldAlignedPdb).toBe("ALIGNED_LOCAL");

    useVariantAnalysisStore.setState({ esmAlignmentScope: "global" });
    await act(async () => {
      await result.current.fetchEsmFold(mockApiClient, mockAddNotification, "P04637", "p.Arg175His", "MSEQ", "MSEQ");
    });
    expect(mockApiClient.foldSequence).toHaveBeenCalledTimes(2);
    expect(mockApiClient.structuralAlign).toHaveBeenLastCalledWith(
      expect.objectContaining({ alignmentScope: "global" }),
      expect.any(AbortSignal)
    );
    expect(result.current.esmFoldAlignedPdb).toBe("ALIGNED_GLOBAL");

    useVariantAnalysisStore.setState({ esmAlignmentScope: "local" });
    await act(async () => {
      await result.current.fetchEsmFold(mockApiClient, mockAddNotification, "P04637", "p.Arg175His", "MSEQ", "MSEQ");
    });
    expect(mockApiClient.foldSequence).toHaveBeenCalledTimes(2);
    expect(result.current.esmFoldAlignedPdb).toBe("ALIGNED_LOCAL");
  });

  it("ignores in-flight fold resolution after resetEsmFoldState", async () => {
    let resolveFold!: (val: { wtPdb: string; mutPdb: string }) => void;
    mockApiClient.foldSequence.mockImplementation(
      () => new Promise((resolve) => {
        resolveFold = resolve;
      })
    );

    const { result } = renderHook(() => useStructuralFolding(mockSink));

    let foldPromise!: Promise<void>;
    act(() => {
      foldPromise = result.current.fetchEsmFold(mockApiClient, mockAddNotification, "Q9Y6K9", "p.Leu10Arg", "MSEQ", "MSEQ");
    });

    act(() => {
      result.current.resetEsmFoldState();
    });

    await act(async () => {
      resolveFold({ wtPdb: "STALE_WT", mutPdb: "STALE_MUT" });
      await foldPromise;
    });

    expect(mockApiClient.structuralAlign).not.toHaveBeenCalled();
    expect(mockSink.setEsmFoldWtPdb).not.toHaveBeenCalled();
    expect(mockSink.setEsmFoldMutPdb).not.toHaveBeenCalled();
    expect(result.current.esmFoldWtPdb).toBeNull();
    expect(result.current.esmFoldMutPdb).toBeNull();
  });
});

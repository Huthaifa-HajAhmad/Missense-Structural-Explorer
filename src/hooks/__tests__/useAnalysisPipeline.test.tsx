// @vitest-environment jsdom
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAnalysisPipeline } from "../useAnalysisPipeline";
import { DevConsoleProvider } from "../../context/DevConsoleContext";

describe("useAnalysisPipeline Hook Integration", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DevConsoleProvider>{children}</DevConsoleProvider>
  );

  let mockApiClient: any;
  let mockFetchWithAuth: any;
  let mockOptions: any;

  beforeEach(() => {
    mockApiClient = {
      getPdb: vi.fn().mockResolvedValue("ATOM 1 N ..."),
      getHomologs: vi.fn().mockResolvedValue([{ pdbId: "1PAH", resolution: 1.8 }]),
      getBiophysicalAnalysis: vi.fn().mockResolvedValue({
        analysis: "Biophysical analysis complete",
        clinvar: { classification: "Pathogenic" },
        metadata: { uniprotId: "P00439", sequence: "MSAQ..." }
      }),
      getNarrative: vi.fn().mockResolvedValue({
        analysis: "Clinical narrative generated",
        insights: { biochemicalShift: "A->V", acmgVerdict: "Pathogenic" }
      }),
      getLandscapeData: vi.fn().mockResolvedValue({ landscapeData: [] }),
      getStructuralAssessments: vi.fn().mockResolvedValue({
        esm3Eval: { score: 0.9 },
        esmcEval: { score: 0.88 },
        esm2Eval: { score: 0.85 },
        saprotEval: { score: 0.92 }
      }),
      findPocket: vi.fn().mockResolvedValue({ pockets: [] }),
      translateVariant: vi.fn().mockResolvedValue({
        gene: "PAH",
        variant: "p.Arg408Trp",
        uniprotId: "P00439"
      })
    };

    mockFetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        pdb: "ATOM MUT ...",
        foldedResidueIndex: 408,
        ddG: 1.5,
        energetics: { totalEnergy: 12.0 }
      })
    });

    mockOptions = {
      fetchWithAuth: mockFetchWithAuth,
      apiClient: mockApiClient,
      settings: { acmgWeighting: {} },
      userDirections: "",
      setAnalysisState: vi.fn(),
      setLoadingStep: vi.fn(),
      setIsBiophysicalLoading: vi.fn(),
      setIsClinicalLoading: vi.fn(),
      setIsNarrativeLoading: vi.fn(),
      setGene: vi.fn(),
      setVariant: vi.fn(),
      setUniprotId: vi.fn(),
      setSearchVal: vi.fn(),
      setCustomGene: vi.fn(),
      setCustomVariant: vi.fn(),
      setCustomUniprot: vi.fn(),
      setSelectedResidueIndex: vi.fn(),
      setDisruptionPredictor: vi.fn(),
      setComputedPocket: vi.fn(),
      setIsPocketLoading: vi.fn(),
      setPocketError: vi.fn(),
      setPdbText: vi.fn(),
      addToHistory: vi.fn(),
      resetViewerState: vi.fn(),
      clearDynaMutPoll: vi.fn(),
      clearDynaMutComparePoll: vi.fn(),
      setIsFolding: vi.fn(),
      setFoldingError: vi.fn(),
      setFoldingStatus: vi.fn(),
      setMutantPdb: vi.fn(),
      setFoldedResidueIndex: vi.fn(),
      setFoldingDdG: vi.fn(),
      setFoldingEnergetics: vi.fn(),
      setDynamut2JobId: vi.fn(),
      setDynamut2Status: vi.fn(),
      setDdmutJobId: vi.fn(),
      setDdmutStatus: vi.fn(),
      setThermompnnJobId: vi.fn(),
      setThermompnnStatus: vi.fn(),
      setThermompnnError: vi.fn(),
      lastFetchedFoldRef: { current: "" }
    };
  });

  it("orchestrates standard variant analysis end-to-end with legacy flat options", async () => {
    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });

    await act(async () => {
      await result.current.executeAnalysis("PAH", "p.Arg408Trp", "P00439", undefined, mockOptions);
    });

    expect(mockOptions.setGene).toHaveBeenCalledWith("PAH");
    expect(mockOptions.setVariant).toHaveBeenCalledWith("p.Arg408Trp");
    expect(mockApiClient.getPdb).toHaveBeenCalledWith("P00439", 408, expect.any(AbortSignal));
    expect(mockOptions.setAnalysisState).toHaveBeenCalled();
  });

  it("orchestrates standard variant analysis with structured PipelineStateSinks", async () => {
    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });

    const searchSink = {
      setGene: vi.fn(),
      setVariant: vi.fn(),
      setUniprotId: vi.fn(),
      setSearchVal: vi.fn(),
      setCustomGene: vi.fn(),
      setCustomVariant: vi.fn(),
      setCustomUniprot: vi.fn(),
      setSelectedResidueIndex: vi.fn(),
      addToHistory: vi.fn()
    };
    const analysisSink = {
      setAnalysisState: vi.fn(),
      setLoadingStep: vi.fn(),
      setIsBiophysicalLoading: vi.fn(),
      setIsClinicalLoading: vi.fn(),
      setIsNarrativeLoading: vi.fn()
    };
    const biophysicalSink = {
      setIsFolding: vi.fn(),
      setFoldingError: vi.fn(),
      setFoldingStatus: vi.fn(),
      setMutantPdb: vi.fn(),
      setFoldedResidueIndex: vi.fn(),
      setFoldingDdG: vi.fn(),
      setFoldingEnergetics: vi.fn(),
      setDynamut2JobId: vi.fn(),
      setDynamut2Status: vi.fn(),
      setDdmutJobId: vi.fn(),
      setDdmutStatus: vi.fn(),
      setThermompnnJobId: vi.fn(),
      setThermompnnStatus: vi.fn(),
      setThermompnnError: vi.fn(),
      lastFetchedFoldRef: { current: "" }
    };
    const structureSink = {
      setPdbText: vi.fn(),
      setComputedPocket: vi.fn(),
      setIsPocketLoading: vi.fn(),
      setPocketError: vi.fn(),
      setHomologs: vi.fn(),
      setIsHomologsLoading: vi.fn(),
      setComputedResiduesCache: vi.fn(),
      setDisruptionPredictor: vi.fn(),
      resetViewerState: vi.fn(),
      clearDynaMutPoll: vi.fn(),
      clearDynaMutComparePoll: vi.fn()
    };

    await act(async () => {
      await result.current.executeAnalysis("PAH", "p.Arg408Trp", "P00439", undefined, {
        fetchWithAuth: mockFetchWithAuth,
        apiClient: mockApiClient,
        settings: { acmgWeighting: {} },
        userDirections: "",
        sinks: {
          search: searchSink,
          analysis: analysisSink,
          biophysical: biophysicalSink,
          structure: structureSink
        }
      });
    });

    expect(searchSink.setGene).toHaveBeenCalledWith("PAH");
    expect(searchSink.setVariant).toHaveBeenCalledWith("p.Arg408Trp");
    expect(mockApiClient.getPdb).toHaveBeenCalledWith("P00439", 408, expect.any(AbortSignal));
    expect(analysisSink.setAnalysisState).toHaveBeenCalled();
  });

  it("handles genomic variant translation before analysis", async () => {
    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });

    await act(async () => {
      await result.current.executeAnalysis("PAH", "c.1222C>T", "", undefined, mockOptions);
    });

    expect(mockApiClient.translateVariant).toHaveBeenCalledWith("c.1222C>T", expect.any(AbortSignal));
    expect(mockOptions.setGene).toHaveBeenCalledWith("PAH");
    expect(mockOptions.setVariant).toHaveBeenCalledWith("p.Arg408Trp");
  });

  it("aborts pending requests on demand and increments active request ID", () => {
    const { result } = renderHook(() => useAnalysisPipeline(), { wrapper });

    const initialId = result.current.activeRequestIdRef.current;
    const clearPollMock = vi.fn();

    act(() => {
      result.current.abortAllPendingRequests(clearPollMock);
    });

    expect(clearPollMock).toHaveBeenCalled();
    expect(result.current.activeRequestIdRef.current).toBe(initialId + 1);
  });
});

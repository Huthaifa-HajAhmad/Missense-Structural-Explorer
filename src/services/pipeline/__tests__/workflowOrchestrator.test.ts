import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeFullAnalysisWorkflow } from "../workflowOrchestrator";
import * as variantCache from "../variantCache";

vi.mock("../biophysicalService", () => ({
  fetchBiophysicalAnalysis: vi.fn().mockResolvedValue({
    analysis: "Mock biophysics completed",
    clinvar: { classification: "Pathogenic" },
    predictorData: { revel: 0.88 },
    metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" }
  }),
  fetchProgressiveLandscape: vi.fn(),
  fetchProgressiveStructuralAssessments: vi.fn(),
  fetchProgressiveMultimer: vi.fn()
}));

vi.mock("../structureService", () => ({
  fetchPdbCoordinates: vi.fn().mockResolvedValue("ATOM 1 N ...")
}));

vi.mock("../foldxService", () => ({
  executeFoldxPipeline: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../narrativeService", () => ({
  generateClinicalNarrative: vi.fn().mockResolvedValue(undefined)
}));

describe("workflowOrchestrator", () => {
  const createMockSinks = () => ({
    search: {
      setGene: vi.fn(),
      setVariant: vi.fn(),
      setUniprotId: vi.fn(),
      setSearchVal: vi.fn(),
      setCustomGene: vi.fn(),
      setCustomVariant: vi.fn(),
      setCustomUniprot: vi.fn(),
      addToHistory: vi.fn(),
      setSelectedResidueIndex: vi.fn()
    },
    analysis: {
      setAnalysisState: vi.fn(),
      setLoadingStep: vi.fn(),
      setIsBiophysicalLoading: vi.fn(),
      setIsStructuralLoading: vi.fn(),
      setIsClinicalLoading: vi.fn(),
      setIsNarrativeLoading: vi.fn()
    },
    biophysical: {
      lastFetchedFoldRef: { current: null },
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
      setThermompnnError: vi.fn()
    },
    structure: {
      setPdbText: vi.fn(),
      setCustomPdbUrl: vi.fn(),
      setIsStructureLoading: vi.fn()
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    variantCache.clearClientVariantCache();
  });

  it("exits early without making calls when activeSignal is already aborted", async () => {
    const sinks = createMockSinks();
    const controller = new AbortController();
    controller.abort();

    const mockApiClient = {
      resolveGene: vi.fn()
    };

    await executeFullAnalysisWorkflow({
      targetGeneArg: "PAH",
      targetVariantArg: "p.Arg408Trp",
      targetUniprotArg: "",
      options: {
        fetchWithAuth: vi.fn(),
        apiClient: mockApiClient,
        settings: { biophysicsConditions: {} },
        userDirections: "",
        sinks: sinks as any
      },
      activeSignal: controller.signal,
      requestId: 1,
      getActiveRequestId: () => 1,
      getTraceContext: () => ({ activeTraceId: "t1", traceStart: 0, addTraceSpan: vi.fn() }),
      fetchHomologs: vi.fn(),
      fetchPocketData: vi.fn(),
      mutantFoldAbortRef: { current: null }
    });

    expect(mockApiClient.resolveGene).not.toHaveBeenCalled();
    expect(sinks.analysis.setAnalysisState).not.toHaveBeenCalled();
  });

  it("restores cached snapshot on cache hit without re-running biophysics pipeline", async () => {
    const sinks = createMockSinks();
    const cachedAnalysis = {
      analysis: "Cached report",
      isFallback: false,
      metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" },
      clinvar: { classification: "Pathogenic" }
    };

    variantCache.setCachedVariant("PAH", "p.Arg408Trp", "P00439", {
      analysisResult: cachedAnalysis,
      pdbText: "ATOM CA ...",
      foldingStatus: "success",
      foldingDdG: 2.1
    });

    await executeFullAnalysisWorkflow({
      targetGeneArg: "PAH",
      targetVariantArg: "p.Arg408Trp",
      targetUniprotArg: "P00439",
      options: {
        fetchWithAuth: vi.fn(),
        apiClient: {},
        settings: { biophysicsConditions: {} },
        userDirections: "",
        sinks: sinks as any
      },
      activeSignal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1,
      getTraceContext: () => ({ activeTraceId: "t1", traceStart: 0, addTraceSpan: vi.fn() }),
      fetchHomologs: vi.fn(),
      fetchPocketData: vi.fn(),
      mutantFoldAbortRef: { current: null }
    });

    expect(sinks.structure.setPdbText).toHaveBeenCalledWith("ATOM CA ...");
    expect(sinks.biophysical.setFoldingDdG).toHaveBeenCalledWith(2.1);
    expect(sinks.analysis.setAnalysisState).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ analysis: "Cached report" })
      })
    );
  });

  it("safely handles fatal errors by setting top-level error state", async () => {
    const sinks = createMockSinks();
    const failingApiClient = {
      resolveGene: vi.fn().mockImplementation(() => {
        throw new Error("Cluster offline");
      })
    };

    await executeFullAnalysisWorkflow({
      targetGeneArg: "PAH",
      targetVariantArg: "invalid_format",
      targetUniprotArg: "P00439",
      options: {
        fetchWithAuth: vi.fn(),
        apiClient: failingApiClient,
        settings: { biophysicsConditions: {} },
        userDirections: "",
        sinks: sinks as any
      },
      activeSignal: new AbortController().signal,
      requestId: 1,
      getActiveRequestId: () => 1,
      getTraceContext: () => ({ activeTraceId: "t1", traceStart: 0, addTraceSpan: vi.fn() }),
      fetchHomologs: vi.fn(),
      fetchPocketData: vi.fn(),
      mutantFoldAbortRef: { current: null }
    });

    expect(sinks.analysis.setIsBiophysicalLoading).toHaveBeenCalledWith(false);
  });
});

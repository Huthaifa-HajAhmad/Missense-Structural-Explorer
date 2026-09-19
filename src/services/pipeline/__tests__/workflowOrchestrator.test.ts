import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeFullAnalysisWorkflow } from "../workflowOrchestrator";
import { executeFoldxPipeline } from "../foldxService";
import * as variantCache from "../variantCache";
import { BIOPHYSICS_RETRY_COOLDOWN_MS } from "../../../shared/timeouts";

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

describe("workflowOrchestrator", () => {
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

/**
 * The backfill gate decides whether revisiting a variant spends minutes of compute.
 *
 * The predicate it replaced was permanently true in any deployment without the Python sidecar
 * (`foldingEnergetics.stabilityoracle == null` can never be satisfied), so every visit re-ran the
 * full FoldX pipeline and the watchdog then stamped a fresh failure onto a good cached snapshot.
 * These tests pin the three replacement rules.
 */
describe("workflowOrchestrator biophysics backfill gate", () => {
  const COMPLETE_ANALYSIS = {
    analysis: "Cached report",
    isFallback: false,
    metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" },
    clinvar: { classification: "Pathogenic" },
    predictorData: { revel: 0.88 }
  };

  const HEALTHY_SNAPSHOT = {
    analysisResult: COMPLETE_ANALYSIS,
    pdbText: "ATOM CA ...",
    mutantPdb: "ATOM CA ...",
    foldingStatus: "success",
    foldingDdG: 2.1,
    // StabilityOracle is null because the sidecar is absent — NOT because the snapshot is stale.
    foldingEnergetics: { foldx: 2.1, dynamut2: -0.5, stabilityoracle: null }
  };

  async function runWithCache(bundle: Record<string, unknown>) {
    const sinks = createMockSinks();
    variantCache.setCachedVariant("PAH", "p.Arg408Trp", "P00439", bundle);
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
    return sinks;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    variantCache.clearClientVariantCache();
  });

  it("does NOT re-run FoldX when a healthy snapshot only lacks an unavailable engine", async () => {
    await runWithCache(HEALTHY_SNAPSHOT);
    expect(executeFoldxPipeline).not.toHaveBeenCalled();
  });

  it("does NOT retry a structurally impossible failure (repair failed)", async () => {
    await runWithCache({
      ...HEALTHY_SNAPSHOT,
      foldingStatus: "failed",
      foldingDdG: null,
      foldingEnergetics: { foldx: null, foldxRepairFailed: true, stabilityoracle: null },
      biophysicsAttemptedAt: Date.now() - BIOPHYSICS_RETRY_COOLDOWN_MS * 2
    });
    expect(executeFoldxPipeline).not.toHaveBeenCalled();
  });

  it("rate-limits a retryable failure instead of re-running on every visit", async () => {
    const bundle = {
      ...HEALTHY_SNAPSHOT,
      foldingStatus: "failed",
      biophysicsAttemptedAt: Date.now() - 1000
    };
    await runWithCache(bundle);
    expect(executeFoldxPipeline).not.toHaveBeenCalled();
  });

  it("retries a transient failure once the cooldown has elapsed", async () => {
    await runWithCache({
      ...HEALTHY_SNAPSHOT,
      foldingStatus: "failed",
      biophysicsAttemptedAt: Date.now() - BIOPHYSICS_RETRY_COOLDOWN_MS - 1000
    });
    expect(executeFoldxPipeline).toHaveBeenCalledTimes(1);
  });

  it("still backfills a snapshot that is genuinely missing its structure", async () => {
    await runWithCache({
      ...HEALTHY_SNAPSHOT,
      mutantPdb: null,
      biophysicsAttemptedAt: Date.now() - BIOPHYSICS_RETRY_COOLDOWN_MS * 2
    });
    expect(executeFoldxPipeline).toHaveBeenCalledTimes(1);
  });

  it("seeds EVERY dispatch with the variant's restored remote state", async () => {
    /**
     * R1. A review's check was that deleting `initialRemoteState` from the real caller failed NOTHING:
     * both new foldxService tests drive the function directly, so the wiring was untested and one of
     * the two dispatch sites was left unseeded — which reproduces the live-poller teardown on that
     * path. This asserts the invariant over the caller instead of over one call site: when the variant
     * has a restored job id, no dispatch may go out unseeded.
     */
    await runWithCache({
      ...HEALTHY_SNAPSHOT,
      foldingStatus: "failed",
      biophysicsAttemptedAt: Date.now() - BIOPHYSICS_RETRY_COOLDOWN_MS - 1000,
      dynamut2Status: "pending",
      dynamut2JobId: "dyn-live-7",
    });

    const calls = (executeFoldxPipeline as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length, "the fixture must actually dispatch").toBeGreaterThan(0);

    for (const [options] of calls as Array<[{ initialRemoteState?: { dynamut2JobId?: string | null } }]>) {
      expect(
        options.initialRemoteState,
        "a dispatch went out unseeded, so it can settle an engine whose poller is live"
      ).toBeDefined();
      expect(options.initialRemoteState?.dynamut2JobId).toBe("dyn-live-7");
    }
  });

  it("restores a pending engine as pending only when a job id can still resolve it", async () => {
    const sinks = await runWithCache({
      ...HEALTHY_SNAPSHOT,
      // DDMut has no score yet but does have an id, so its poller can still report the outcome.
      ddmutStatus: "pending",
      ddmutJobId: "ddm-live-1",
      // ThermoMPNN has neither, so nothing can ever resolve it.
      thermompnnStatus: "pending",
      thermompnnJobId: null
    });

    expect(sinks.biophysical.setDdmutStatus).toHaveBeenCalledWith("pending");
    expect(sinks.biophysical.setThermompnnStatus).toHaveBeenCalledWith("unavailable");
  });

  it("keeps a restored engine with a score as done, whatever its status says", async () => {
    const sinks = await runWithCache({
      ...HEALTHY_SNAPSHOT,
      dynamut2Status: "pending",
      dynamut2JobId: null
    });

    // A value that exists outranks a stale lifecycle status (and a missing id).
    expect(sinks.biophysical.setDynamut2Status).toHaveBeenCalledWith("done");
  });
});

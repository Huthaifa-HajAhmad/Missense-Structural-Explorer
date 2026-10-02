import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeFullAnalysisWorkflow } from "../workflowOrchestrator";
import { executeFoldxPipeline } from "../foldxService";
import { fetchBiophysicalAnalysis } from "../biophysicalService";
import * as variantCache from "../variantCache";
import { createAnalysisCacheContext } from "../analysisContext";
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
      setIsStructureLoading: vi.fn(),
      setComputedPocket: vi.fn(), setIsPocketLoading: vi.fn(), setPocketError: vi.fn(),
      setHomologs: vi.fn(), setIsHomologsLoading: vi.fn(),
      setComputedResiduesCache: vi.fn(), setDisruptionPredictor: vi.fn(),
      resetViewerState: vi.fn(), clearDynaMutPoll: vi.fn()
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
      metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", pipelineContext: createAnalysisCacheContext("P00439", { biophysicsConditions: {} }) },
      clinvar: { classification: "Pathogenic" }
    };

    variantCache.setCachedVariant("PAH", "p.Arg408Trp", "P00439", {
      analysisResult: cachedAnalysis,
      biophysicsContext: createAnalysisCacheContext("P00439", { biophysicsConditions: {} }).simulationConditions,
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

  it("reports core failure as a failed run and preserves its error", async () => {
    const sinks = createMockSinks();
    vi.mocked(fetchBiophysicalAnalysis).mockRejectedValueOnce(new Error("Cluster offline"));
    const failingApiClient = {};


    const outcome = await executeFullAnalysisWorkflow({
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

    expect(outcome).toBe("failed");
    expect(sinks.analysis.setAnalysisState).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("Cluster offline") }));
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
    metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", pipelineContext: createAnalysisCacheContext("P00439", { biophysicsConditions: {} }) },
    clinvar: { classification: "Pathogenic" },
    predictorData: { revel: 0.88 }
  };

  const HEALTHY_SNAPSHOT = {
    analysisResult: COMPLETE_ANALYSIS,
    biophysicsContext: createAnalysisCacheContext("P00439", { biophysicsConditions: {} }).simulationConditions,
    pdbText: "ATOM CA ...",
    mutantPdb: "ATOM CA ...",
    foldingStatus: "success",
    foldingDdG: 2.1,
    // StabilityOracle is null because the sidecar is absent — NOT because the snapshot is stale.
    foldingEnergetics: { foldx: 2.1, dynamut2: -0.5, stabilityoracle: null }
  };

  async function runWithCache(bundle: Record<string, unknown>) {
    const sinks = createMockSinks();
    variantCache.setCachedVariant("PAH", "p.Arg408Trp", "P00439", { biophysicsContext: createAnalysisCacheContext("P00439", { biophysicsConditions: {} }).simulationConditions, ...bundle });
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
     * R1, and a correction to how this test was first written.
     *
     * `analysisResult: undefined` is the point of this fixture, not incidental. The invariant is about
     * EVERY dispatch, and the one that matters is Stage 3. With a complete analysis the orchestrator
     * returns at `if (hasCompleteAnalysis && !userDirections)` BEFORE Stage 3 — so a fixture built on
     * HEALTHY_SNAPSHOT alone can only ever exercise the backfill, and this loop would pass without ever
     * observing the path it is named for. A record-integrity review caught exactly that: the first
     * version asserted the invariant with a fixture that could not reach the dispatch whose missing seed
     * had been deleted on the strength of the same blind spot.
     *
     * A cached bundle with no `analysisResult` is what `variantCache` persists mid-run, and it falls
     * through to Stage 3.
     */
    await runWithCache({
      ...HEALTHY_SNAPSHOT,
      analysisResult: undefined,
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

  it("seeds the settle with the RESOLVED status, not the raw cached one", async () => {
    /**
     * R8, and the reason the seed is resolved once at function scope.
     *
     * The seed carried the RAW cached status, so a bundle holding a dynamut2 score AND a stale "pending"
     * status offered the settle a `pending`-with-no-id — a state it is entitled to clear, for an engine
     * that is finished. The resolver is the same one the sink restore uses, so the store and the seed
     * cannot disagree by construction.
     */
    await runWithCache({
      ...HEALTHY_SNAPSHOT,
      analysisResult: undefined,
      foldingStatus: "failed",
      biophysicsAttemptedAt: Date.now() - BIOPHYSICS_RETRY_COOLDOWN_MS - 1000,
      // A score is present, so the resolver reports "done" — while the stored status still says
      // "pending" and there is no job id to poll.
      foldingEnergetics: { ...(HEALTHY_SNAPSHOT as any).foldingEnergetics, dynamut2: -1.2 },
      dynamut2Status: "pending",
      dynamut2JobId: null,
    });

    const calls = (executeFoldxPipeline as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length, "the fixture must actually dispatch").toBeGreaterThan(0);

    for (const [options] of calls as Array<[{ initialRemoteState?: { dynamut2Status?: string | null } }]>) {
      expect(
        options.initialRemoteState?.dynamut2Status,
        "the raw cached 'pending' was seeded for an engine that already has a score"
      ).toBe("done");
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

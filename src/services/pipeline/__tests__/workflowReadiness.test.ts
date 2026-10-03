import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeFullAnalysisWorkflow } from "../workflowOrchestrator";
import { fetchBiophysicalAnalysis, fetchProgressiveStructuralAssessments } from "../biophysicalService";
import { generateClinicalNarrative } from "../narrativeService";
import { executeFoldxPipeline } from "../foldxService";
import { fetchPdbCoordinates } from "../structureService";
import { createAnalysisCacheContext } from "../analysisContext";
import { clearClientVariantCache, setCachedVariant, getCachedVariant } from "../variantCache";
import { mergeResultPatch } from "../resultMerge";

vi.mock("../biophysicalService", () => ({
  fetchBiophysicalAnalysis: vi.fn(), fetchProgressiveLandscape: vi.fn().mockResolvedValue(undefined),
  fetchProgressiveStructuralAssessments: vi.fn().mockResolvedValue(undefined), fetchProgressiveMultimer: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("../structureService", () => ({ fetchPdbCoordinates: vi.fn().mockResolvedValue("ATOM coordinates") }));
vi.mock("../foldxService", () => ({ executeFoldxPipeline: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../narrativeService", () => ({ generateClinicalNarrative: vi.fn().mockResolvedValue(undefined) }));

const core = { metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" }, predictorData: { revel: 0.88 }, ruleBasedInsights: { acmgVerdict: "Uncertain Significance" } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function sink(names: string[]) { return Object.fromEntries(names.map(name => [name, vi.fn()])); }
function fixture(settings: any = { narrativeMode: "off" }) {
  let state: any = { isLoading: true, error: null, result: null };
  let activeId = 1;
  const sinks: any = {
    search: sink(["setGene", "setVariant", "setUniprotId", "setSearchVal", "setCustomGene", "setCustomVariant", "setCustomUniprot", "addToHistory", "setSelectedResidueIndex"]),
    analysis: sink(["setLoadingStep", "setIsBiophysicalLoading", "setIsClinicalLoading", "setIsStructuralLoading", "setIsNarrativeLoading"]),
    structure: sink(["setPdbText", "setPdbTextProvenance", "setComputedPocket", "setIsPocketLoading", "setPocketError", "setHomologs", "setIsHomologsLoading", "setComputedResiduesCache", "setDisruptionPredictor", "resetViewerState", "clearDynaMutPoll"]),
    biophysical: { ...sink(["setIsFolding", "setFoldingError", "setFoldingStatus", "setMutantPdb", "setFoldxWtPdb", "setFoldedResidueIndex", "setFoldingDdG", "setFoldingEnergetics", "setDynamut2JobId", "setDynamut2Status", "setDdmutJobId", "setDdmutStatus", "setThermompnnJobId", "setThermompnnStatus", "setThermompnnError"]), lastFetchedFoldRef: { current: "" } }
  };
  sinks.analysis.setAnalysisState = vi.fn(updater => { state = typeof updater === "function" ? updater(state) : updater; });
  return {
    settings, sinks, get state() { return state; }, replace: (next: any) => { state = next; activeId++; },
    run: (uniprotId = "P00439") => executeFullAnalysisWorkflow({
      targetGeneArg: "PAH", targetVariantArg: "p.Arg408Trp", targetUniprotArg: uniprotId,
      options: { apiClient: {}, fetchWithAuth: vi.fn(), settings, userDirections: "", sinks },
      activeSignal: new AbortController().signal, requestId: 1, getActiveRequestId: () => activeId,
      getTraceContext: () => ({ activeTraceId: "test", traceStart: performance.now(), addTraceSpan: vi.fn() }),
      fetchHomologs: vi.fn(), fetchPocketData: vi.fn(), mutantFoldAbortRef: { current: null }
    })
  };
}
function cacheCore(settings: any, extra: any = {}) {
  const context = createAnalysisCacheContext("P00439", settings);
  setCachedVariant("PAH", "p.Arg408Trp", "P00439", {
    biophysicsContext: context.simulationConditions, mutantPdb: "ATOM mutant", foldingEnergetics: { foldx: 2.1 }, foldingStatus: "success", pdbText: "ATOM wild type",
    analysisResult: { ...core, analysis: "", landscapeData: [], multimerData: {}, metadata: { ...core.metadata, pipelineContext: context, pipelineStages: { core: "complete", structural: "complete", landscape: "complete", multimer: "complete" } }, ...extra }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearClientVariantCache();
  vi.mocked(fetchBiophysicalAnalysis).mockResolvedValue(core);
  vi.mocked(fetchProgressiveStructuralAssessments).mockReset().mockResolvedValue(undefined);
  vi.mocked(generateClinicalNarrative).mockReset().mockResolvedValue(undefined);
});

describe("foreground readiness and stage ownership", () => {
  it("starts enrichment before a held core response, retaining its verdict when core completes", async () => {
    const held = deferred<any>();
    vi.mocked(fetchBiophysicalAnalysis).mockReturnValueOnce(held.promise);
    vi.mocked(fetchProgressiveStructuralAssessments).mockImplementationOnce(async (_params, _api, _signal, update) => {
      update((prev: any) => mergeResultPatch(prev, { saprotEval: { llr: -4 }, ruleBasedInsights: { acmgVerdict: "Likely Pathogenic" } }, undefined, "structural", "degraded"));
    });
    const f = fixture();
    const work = f.run();
    await vi.waitFor(() => expect(f.state.result?.saprotEval?.llr).toBe(-4));
    // First real evidence opens the shell; the core request remains in flight independently.
    expect(f.state.isLoading).toBe(false);
    expect(generateClinicalNarrative).not.toHaveBeenCalled();
    held.resolve(core);
    expect(await work).toBe("completed");
    expect(f.state.result.ruleBasedInsights.acmgVerdict).toBe("Likely Pathogenic");
    expect(f.state.result.metadata.pipelineStages.structural).toBe("degraded");
    expect(f.state.isLoading).toBe(false);
  });

  it("defers structure and FoldX with no accession, then dispatches once core resolves it", async () => {
    const held = deferred<any>();
    vi.mocked(fetchBiophysicalAnalysis).mockReturnValueOnce(held.promise);
    const f = fixture();
    const work = f.run("");
    expect(fetchPdbCoordinates).not.toHaveBeenCalled();
    expect(executeFoldxPipeline).not.toHaveBeenCalled();
    held.resolve(core);
    await work;
    expect(fetchPdbCoordinates).toHaveBeenCalledOnce();
    expect(vi.mocked(fetchPdbCoordinates).mock.calls[0][2]).toBe("P00439");
    expect(executeFoldxPipeline).toHaveBeenCalledOnce();
    expect(executeFoldxPipeline).toHaveBeenCalledWith(expect.objectContaining({ uniprotId: "P00439" }));
  });

  it("makes evidence usable while models and automatic narrative are both held", async () => {
    const model = deferred<void>(), narrative = deferred<void>();
    vi.mocked(fetchProgressiveStructuralAssessments).mockReturnValueOnce(model.promise);
    vi.mocked(generateClinicalNarrative).mockReturnValueOnce(narrative.promise);
    const f = fixture({ narrativeMode: "automatic" });
    let settled = false;
    const work = f.run().then(outcome => { settled = true; return outcome; });
    await vi.waitFor(() => expect(f.state.result?.predictorData?.revel).toBe(0.88));
    expect(f.state.isLoading).toBe(false);
    expect(f.sinks.analysis.setIsBiophysicalLoading).toHaveBeenLastCalledWith(false);
    expect(f.sinks.analysis.setIsClinicalLoading).toHaveBeenLastCalledWith(false);
    expect(settled).toBe(false);
    model.resolve(); narrative.resolve();
    expect(await work).toBe("completed");
  });

  it.each(["off", "on-demand"])("does not send optional synthesis in %s mode", async mode => {
    const f = fixture({ narrativeMode: mode });
    await f.run();
    expect(generateClinicalNarrative).not.toHaveBeenCalled();
    expect(f.state.result.metadata.pipelineStages.narrative).toBe("skipped");
    expect(f.state.isLoading).toBe(false);
  });

  it("cannot install old-run core or enrichment over the replacement workspace", async () => {
    const held = deferred<any>();
    vi.mocked(fetchBiophysicalAnalysis).mockReturnValueOnce(held.promise);
    const f = fixture();
    const work = f.run();
    const replacement = { isLoading: true, result: { metadata: { pipelineRunId: "replacement" } } };
    f.replace(replacement);
    held.resolve(core);
    expect(await work).toBe("aborted");
    expect(f.state).toBe(replacement);
  });

  it("restores completed core evidence with no narrative, without refetching it", async () => {
    const f = fixture();
    cacheCore(f.settings);
    await f.run();
    expect(fetchBiophysicalAnalysis).not.toHaveBeenCalled();
    expect(executeFoldxPipeline).not.toHaveBeenCalled();
    expect(f.state.result.predictorData.revel).toBe(0.88);
    expect(f.state.result.analysis).toBe("");
  });

  it("claims cached core for the new run before resuming a degraded model cohort", async () => {
    const f = fixture();
    const metadata = { ...core.metadata, pipelineContext: createAnalysisCacheContext("P00439", f.settings), pipelineRunId: "previous-run", pipelineStages: { core: "complete", structural: "degraded", landscape: "complete", multimer: "complete" } };
    cacheCore(f.settings, { metadata });
    vi.mocked(fetchProgressiveStructuralAssessments).mockImplementationOnce(async (params, _api, _signal, update) => {
      expect(getCachedVariant(params.gene, params.variant)?.analysisResult.metadata.pipelineRunId).toBe(params.pipelineRunId);
      expect(params.pipelineRunId).not.toBe("previous-run");
      update((prev: any) => mergeResultPatch(prev, { saprotEval: { llr: 0 } }, undefined, "structural", "complete"));
    });
    await f.run();
    expect(fetchBiophysicalAnalysis).not.toHaveBeenCalled();
    expect(fetchProgressiveStructuralAssessments).toHaveBeenCalledOnce();
    expect(f.state.result.metadata.pipelineStages.structural).toBe("complete");
  });

  it("does not mistake a failed cached core with optional prose for reusable evidence", async () => {
    const f = fixture();
    cacheCore(f.settings, { analysis: "Optional summary", metadata: { ...core.metadata, pipelineContext: createAnalysisCacheContext("P00439", f.settings), pipelineStages: { core: "error" } } });
    await f.run();
    expect(fetchBiophysicalAnalysis).toHaveBeenCalledOnce();
    expect(f.state.result.metadata.pipelineStages.core).toBe("complete");
    expect(f.state.result.analysis).toBe("");
  });

  it("repairs only cached optional prose, never healthy core or FoldX", async () => {
    const f = fixture({ narrativeMode: "automatic", geminiApiKey: "test-credential" });
    cacheCore(f.settings, { analysis: "Rule-based fallback", isFallback: true });
    await f.run();
    expect(generateClinicalNarrative).toHaveBeenCalledOnce();
    expect(fetchBiophysicalAnalysis).not.toHaveBeenCalled();
    expect(executeFoldxPipeline).not.toHaveBeenCalled();
  });
});

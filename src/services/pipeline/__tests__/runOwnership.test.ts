// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Who may write what during a run, proved through the real orchestrator and cache.
 * Only the network-facing stages are replaced, so each test controls the order events arrive in.
 */
const h = vi.hoisted(() => ({
  fold: vi.fn(),
  core: vi.fn(),
  multimer: vi.fn(),
  freshness: vi.fn(() => "current"),
}));

vi.mock("../foldxService", () => ({ executeFoldxPipeline: h.fold }));
vi.mock("../narrativeService", () => ({ generateClinicalNarrative: vi.fn(async () => undefined) }));
vi.mock("../structureService", () => ({ fetchPdbCoordinates: vi.fn(async () => null) }));
vi.mock("../biophysicalService", () => ({
  fetchBiophysicalAnalysis: h.core,
  fetchProgressiveLandscape: vi.fn(async () => undefined),
  fetchProgressiveStructuralAssessments: vi.fn(async () => undefined),
  fetchProgressiveMultimer: h.multimer,
  fetchProgressivePpi: vi.fn(async () => null),
}));
vi.mock("../../../shared/narrativeEvidence", async (original) => ({
  ...(await original<any>()),
  narrativeFreshness: h.freshness,
}));

import { executeFullAnalysisWorkflow } from "../workflowOrchestrator";
import { createAnalysisCacheContext } from "../analysisContext";
import { clearClientVariantCache, setCachedVariant } from "../variantCache";

function harness() {
  let state: any = { result: null, isLoading: true, error: null };
  const inert = new Proxy({}, { get: () => () => {} }) as any;
  const analysis = {
    setAnalysisState: (u: any) => { state = typeof u === "function" ? u(state) : u; },
    setLoadingStep() {}, setIsBiophysicalLoading() {}, setIsStructuralLoading() {},
    setIsClinicalLoading() {}, setIsNarrativeLoading() {},
  };
  let active = 0;
  const run = (uniprot: string, settings: any = {}, signal = new AbortController().signal) => {
    const requestId = ++active;
    return executeFullAnalysisWorkflow({
      targetGeneArg: "PAH", targetVariantArg: "p.Arg408Trp", targetUniprotArg: uniprot,
      options: {
        fetchWithAuth: vi.fn() as any, apiClient: {} as any, settings, userDirections: "",
        getCurrentEvidence: () => (state.result ? { result: state.result, context: {} } : null),
        sinks: { search: inert, analysis, biophysical: inert, structure: inert },
      } as any,
      activeSignal: signal, requestId, getActiveRequestId: () => active, getTraceContext: () => ({}) as any,
      fetchHomologs: vi.fn(async () => null) as any, fetchPocketData: vi.fn(async () => null) as any,
      mutantFoldAbortRef: { current: null },
    });
  };
  return { run, get state() { return state; } };
}

const coreAnswer = (metadata: object = {}) => ({ analysis: "core", ruleBasedInsights: { acmgVerdict: "VUS" }, clinvar: {}, metadata });

beforeEach(() => {
  clearClientVariantCache();
  h.fold.mockReset().mockResolvedValue(undefined);
  h.core.mockReset().mockImplementation(async () => coreAnswer());
  h.multimer.mockReset().mockResolvedValue(null);
  h.freshness.mockReset().mockReturnValue("current");
});

describe("FoldX retry cooldown", () => {
  it("runs FoldX again when the conditions changed, because that is a different calculation", async () => {
    const h1 = harness();
    await h1.run("P00439", { biophysicsConditions: { ph: 7.4 } });
    await h1.run("P00439", { biophysicsConditions: { ph: 5 } });
    expect(h.fold).toHaveBeenCalledTimes(2);
  });

  it("does not start the cooldown for a run the reader abandoned", async () => {
    const h1 = harness();
    const controller = new AbortController();
    h.fold.mockImplementationOnce(async () => { controller.abort(); });
    await h1.run("P00439", {}, controller.signal);
    await h1.run("P00439", {});
    expect(h.fold).toHaveBeenCalledTimes(2);
  });

  it("starts the cooldown once FoldX finished, so a failing variant is not re-run on every visit", async () => {
    const h1 = harness();
    await h1.run("P00439", {});
    await h1.run("P00439", {});
    expect(h.fold).toHaveBeenCalledTimes(1);
  });

  it("starts the cooldown when FoldX fails outright too", async () => {
    const h1 = harness();
    h.fold.mockRejectedValueOnce(new Error("engine crashed"));
    await h1.run("P00439", {});
    await h1.run("P00439", {});
    expect(h.fold).toHaveBeenCalledTimes(1);
  });
});

describe("what a failure after core may do", () => {
  it("keeps the finished evidence when the narrative refresh throws", async () => {
    h.freshness.mockImplementation(() => { throw new Error("freshness check broke"); });
    const h1 = harness();
    const outcome = await h1.run("P00439", { serverGeminiReady: true });
    expect(h1.state.error).toBeNull();
    expect(h1.state.result.metadata.pipelineStages.core).toBe("complete");
    expect(outcome).toBe("completed");
  });
});

describe("stages always reach an honest end", () => {
  it("calls a stage error, not complete, when it was announced late and never reported", async () => {
    h.core.mockImplementation(async () => coreAnswer({ uniprotId: "P00439" }));
    const h1 = harness();
    await h1.run("");
    const stages = h1.state.result.metadata.pipelineStages;
    expect(stages.landscape).toBe("error");
    expect(stages.multimer).toBe("error");
  });

  it("marks resumed enrichment as running, so the rail does not look settled while it loads", async () => {
    const settings = {};
    const context = createAnalysisCacheContext("P00439", settings);
    setCachedVariant("PAH", "p.Arg408Trp", "P00439", {
      biophysicsContext: context.simulationConditions,
      pdbText: "ATOM",
      analysisResult: {
        analysis: "done", clinvar: {}, predictorData: {}, landscapeData: [{ pos: 1 }], ppiBindingData: {}, esm2Eval: {}, saprotEval: {},
        metadata: { pipelineContext: context, pipelineStages: { core: "complete", landscape: "complete", structural: "complete" } },
      },
    });
    let finish!: (v: unknown) => void;
    h.multimer.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const h1 = harness();
    const pending = h1.run("P00439", settings);
    await vi.waitFor(() => expect(h.multimer).toHaveBeenCalled());
    expect(h1.state.result.metadata.pipelineStages.multimer).toBe("running");
    finish(null);
    await pending;
  });
});

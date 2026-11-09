// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What a run does to the screen when it restores a saved variant, driven through the real orchestrator,
 * cache and result merge. Only the network-facing services are replaced.
 */
const h = vi.hoisted(() => ({ narrative: vi.fn(async () => undefined) }));
vi.mock("../foldxService", () => ({ executeFoldxPipeline: vi.fn(async () => undefined) }));
vi.mock("../narrativeService", () => ({ generateClinicalNarrative: h.narrative }));
vi.mock("../structureService", () => ({ fetchPdbCoordinates: vi.fn(async () => null) }));
vi.mock("../biophysicalService", () => ({
  fetchBiophysicalAnalysis: vi.fn(async () => ({ analysis: "core" })),
  fetchProgressiveLandscape: vi.fn(async () => undefined),
  fetchProgressiveStructuralAssessments: vi.fn(async () => undefined),
  fetchProgressiveMultimer: vi.fn(async () => null),
  fetchProgressivePpi: vi.fn(async () => null),
}));

import { executeFullAnalysisWorkflow } from "../workflowOrchestrator";
import { createAnalysisCacheContext } from "../analysisContext";
import { clearClientVariantCache, recordBiophysicsAttempt, setCachedVariant } from "../variantCache";
import { beginNarrativeActivity, endNarrativeActivity, resetNarrativeActivity } from "../../../shared/narrativeResynthesis";

const GENE = "PAH";
const VARIANT = "p.Arg408Trp";
const UNIPROT = "P00439";
const SETTINGS = { acmgWeighting: "standard", narrativeMode: "off" };

/** A sink whose setters write into one plain object, so a test can read what the screen would hold. */
function fakeScreen(initial: Record<string, unknown>) {
  const screen: Record<string, unknown> = { ...initial };
  const field = (setter: string) => setter[3].toLowerCase() + setter.slice(4);
  const sink = new Proxy({}, { get: (_t, name: string) => (value: unknown) => { screen[field(name)] = value; } }) as any;
  return { screen, sink };
}

function drive({ variant = VARIANT, apiClient = {}, settings = SETTINGS, signal = new AbortController().signal, getActiveRequestId = () => 1, screen = {}, extraOptions = {} }: any = {}) {
  let state: any = { result: null, isLoading: false, error: null };
  const { screen: values, sink } = fakeScreen(screen);
  const analysis = new Proxy({ setAnalysisState: (u: any) => { state = typeof u === "function" ? u(state) : u; } } as any, {
    get: (target, name: string) => target[name] ?? ((value: unknown) => { values[name[3].toLowerCase() + name.slice(4)] = value; }),
  });
  const finished = executeFullAnalysisWorkflow({
    targetGeneArg: GENE, targetVariantArg: variant, targetUniprotArg: UNIPROT,
    options: { fetchWithAuth: vi.fn() as any, apiClient, settings, userDirections: "", getCurrentEvidence: () => null,
      sinks: { search: sink, analysis, biophysical: sink, structure: sink }, ...extraOptions } as any,
    activeSignal: signal, requestId: 1, getActiveRequestId, getTraceContext: () => ({}) as any,
    fetchHomologs: vi.fn(async () => null) as any, fetchPocketData: vi.fn(async () => null) as any,
    mutantFoldAbortRef: { current: null },
  });
  return { finished, screen: values };
}

/** Everything a finished, restorable analysis needs, so a restored run has nothing left to fetch. */
function saveFinishedAnalysis(result: object = {}, bundle: object = {}, settings: any = SETTINGS) {
  const context = createAnalysisCacheContext(UNIPROT, settings, {}, "", undefined);
  setCachedVariant(GENE, VARIANT, UNIPROT, {
    analysisResult: {
      analysis: "A finished narrative.", multimerData: {}, ppiBindingData: {}, landscapeData: [], esm2Eval: {},
      metadata: { gene: GENE, variant: VARIANT, uniprotId: UNIPROT, pipelineContext: context,
        pipelineStages: { core: "complete", structural: "complete", landscape: "complete" } },
      ...result,
    },
    biophysicsContext: context.simulationConditions,
    pdbText: "ATOM",
    homologs: [{ id: "1abc" }],
    ...bundle,
  });
  return context;
}

beforeEach(() => {
  clearClientVariantCache();
  resetNarrativeActivity();
  h.narrative.mockClear();
});

describe("restoring a saved variant over another variant's results", () => {
  const previousVariant = {
    mutantPdb: "ATOM other-variant", foldxWtPdb: "ATOM other-wild-type", foldingDdG: 3.2, foldedResidueIndex: 99,
    pdbTextProvenance: { source: "other" }, computedPocket: { id: "other" }, foldingError: "other failure",
  };

  it("removes the other variant's structure, ΔΔG and labels when this one has none saved", async () => {
    const context = saveFinishedAnalysis({}, { mutantPdb: null, foldingDdG: null, foldingEnergetics: { foldxError: "no value" }, foldingStatus: "unavailable" });
    recordBiophysicsAttempt(GENE, VARIANT, context.simulationConditions);
    const { finished, screen } = drive({ screen: previousVariant });
    await finished;
    expect(screen.mutantPdb).toBeNull();
    expect(screen.foldxWtPdb).toBeNull();
    expect(screen.foldingDdG).toBeNull();
    expect(screen.foldedResidueIndex).toBeNull();
    expect(screen.pdbTextProvenance).toBeNull();
    expect(screen.computedPocket).toBeNull();
    expect(screen.foldingError).toBeNull();
  });

  it("installs this variant's own saved FoldX result", async () => {
    const context = saveFinishedAnalysis({}, { mutantPdb: "ATOM mine", foldxWtPdb: "ATOM mine-wt", foldingDdG: 1.5, foldedResidueIndex: 408,
      foldingEnergetics: { foldx: 1.5 }, foldingStatus: "success" });
    recordBiophysicsAttempt(GENE, VARIANT, context.simulationConditions);
    const { finished, screen } = drive({ screen: previousVariant });
    await finished;
    expect(screen.mutantPdb).toBe("ATOM mine");
    expect(screen.foldingDdG).toBe(1.5);
    expect(screen.foldedResidueIndex).toBe(408);
  });
});

describe("a run replaced while its notation was being translated", () => {
  it("does not touch the search fields or the viewer", async () => {
    const controller = new AbortController();
    let active = 1;
    const apiClient = {
      translateVariant: async () => { controller.abort(); active = 2; return { gene: "OLD", variant: VARIANT, uniprotId: UNIPROT }; },
    };
    const { finished, screen } = drive({ variant: "20-23365054-G-A", apiClient, signal: controller.signal, getActiveRequestId: () => active });
    await expect(finished).resolves.toBe("aborted");
    expect(screen.gene).toBeUndefined();
    expect(screen).not.toHaveProperty("resetViewerState");
  });
});

describe("the narrative loading flag at the end of a run", () => {
  it("stays raised while a Re-synthesize request is still in flight", async () => {
    saveFinishedAnalysis();
    const token = beginNarrativeActivity();
    const { finished, screen } = drive({ screen: { isNarrativeLoading: true } });
    await finished;
    expect(screen.isNarrativeLoading).toBe(true);
    endNarrativeActivity(token);
  });

  it("is lowered when nothing is in flight", async () => {
    saveFinishedAnalysis();
    const { finished, screen } = drive({ screen: { isNarrativeLoading: true } });
    await finished;
    expect(screen.isNarrativeLoading).toBe(false);
  });
});

describe("repairing a missing narrative when only the server holds the key", () => {
  const automatic = { acmgWeighting: "standard", narrativeMode: "automatic" };

  it("waits for the first health reading before deciding", async () => {
    saveFinishedAnalysis({ analysis: "" }, {}, automatic);
    const { finished } = drive({ settings: automatic, extraOptions: { waitForServerGemini: async () => true } });
    await finished;
    expect(h.narrative).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a narrative when the server has no key", async () => {
    saveFinishedAnalysis({ analysis: "" }, {}, automatic);
    const { finished } = drive({ settings: automatic, extraOptions: { waitForServerGemini: async () => false } });
    await finished;
    expect(h.narrative).not.toHaveBeenCalled();
  });
});

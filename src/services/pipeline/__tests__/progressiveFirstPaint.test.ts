import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeFullAnalysisWorkflow } from "../workflowOrchestrator";
import * as variantCache from "../variantCache";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FIRST GET, FIRST SHOW
 * ─────────────────────────────────────────────────────────────────────────────
 * The server sends the fast triage payload (ClinVar + predictors) long before the AlphaFold
 * structure arrives. The client merged each chunk into `prev.result` and returned `prev` untouched
 * when there was none — while `result` was created ONLY by the structure warm-up. Everything that
 * arrived first was therefore discarded, and the reader watched a spinner for a payload the browser
 * already held. Verified against the workflow with the structure fetch held open: the chunk landed,
 * `result` stayed null, and the data was gone once the placeholder was finally built.
 *
 * The mirror-image mistake is asserted too: creating the placeholder BEFORE any data arrives would
 * render an empty dashboard as if evidence had started landing. It appears with the first chunk and
 * not before.
 */

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
};

let structureGate: ReturnType<typeof deferred<string>>;
let emitChunk: ((chunk: any) => void) | null;
let biophysicsGate: ReturnType<typeof deferred<any>>;

vi.mock("../structureService", () => ({
  fetchPdbCoordinates: vi.fn(() => structureGate.promise)
}));

vi.mock("../biophysicalService", () => ({
  fetchBiophysicalAnalysis: vi.fn((_params: any, _api: any, _signal: any, onChunk: any) => {
    emitChunk = onChunk;
    return biophysicsGate.promise;
  }),
  fetchProgressiveLandscape: vi.fn(),
  fetchProgressiveStructuralAssessments: vi.fn(),
  fetchProgressiveMultimer: vi.fn(),
  fetchProgressivePpi: vi.fn()
}));

vi.mock("../foldxService", () => ({ executeFoldxPipeline: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../narrativeService", () => ({ generateClinicalNarrative: vi.fn().mockResolvedValue(undefined) }));

/** A store-shaped sink: object or functional updater, starting from "loading, no result". */
function createAnalysisSink() {
  let state: any = { isLoading: true, error: null, result: null };
  const setAnalysisState = vi.fn((input: any) => {
    state = typeof input === "function" ? input(state) : input;
    return state;
  });
  return {
    setAnalysisState,
    get: () => state,
    // The rest of the real sink: the workflow writes to these, and a missing member would surface as
    // a top-level pipeline error rather than as a test failure about the behaviour under test.
    setLoadingStep: vi.fn(),
    setIsBiophysicalLoading: vi.fn(),
    setIsStructuralLoading: vi.fn(),
    setIsClinicalLoading: vi.fn(),
    setIsNarrativeLoading: vi.fn()
  };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function run() {
  const analysis = createAnalysisSink();
  const workflow = executeFullAnalysisWorkflow({
    targetGeneArg: "PAH",
    targetVariantArg: "p.Arg408Trp",
    targetUniprotArg: "P00439",
    options: {
      fetchWithAuth: vi.fn(),
      apiClient: {},
      settings: { biophysicsConditions: {} },
      userDirections: "",
      sinks: {
        search: {
          setGene: vi.fn(), setVariant: vi.fn(), setUniprotId: vi.fn(), setSearchVal: vi.fn(),
          setCustomGene: vi.fn(), setCustomVariant: vi.fn(), setCustomUniprot: vi.fn(),
          addToHistory: vi.fn(), setSelectedResidueIndex: vi.fn()
        },
        analysis,
        biophysical: {
          lastFetchedFoldRef: { current: null },
          setIsFolding: vi.fn(), setFoldingError: vi.fn(), setFoldingStatus: vi.fn(),
          setMutantPdb: vi.fn(), setFoldedResidueIndex: vi.fn(), setFoldingDdG: vi.fn(),
          setFoldingEnergetics: vi.fn(), setDynamut2JobId: vi.fn(), setDynamut2Status: vi.fn(),
          setDdmutJobId: vi.fn(), setDdmutStatus: vi.fn(), setThermompnnJobId: vi.fn(),
          setThermompnnStatus: vi.fn(), setThermompnnError: vi.fn()
        },
        structure: {
          setPdbText: vi.fn(), setComputedPocket: vi.fn(), setIsPocketLoading: vi.fn(),
          setPocketError: vi.fn(), setHomologs: vi.fn(), setIsHomologsLoading: vi.fn(),
          resetViewerState: vi.fn()
        }
      } as any
    },
    activeSignal: new AbortController().signal,
    requestId: 1,
    getActiveRequestId: () => 1,
    getTraceContext: () => ({ activeTraceId: "t1", traceStart: 0, addTraceSpan: vi.fn() }),
    fetchHomologs: vi.fn(),
    fetchPocketData: vi.fn(),
    mutantFoldAbortRef: { current: null }
  });
  return { analysis, workflow };
}

describe("progressive first paint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    variantCache.clearClientVariantCache();
    structureGate = deferred<string>();
    biophysicsGate = deferred<any>();
    emitChunk = null;
  });

  it("paints the first chunk's data while the structure fetch is still pending", async () => {
    const { analysis, workflow } = run();
    await tick();

    expect(emitChunk, "the stream must have been started").toBeTruthy();
    emitChunk!({
      clinvar: { classification: "Pathogenic" },
      predictorData: { revel: 0.88 },
      serviceStatus: { clinvar: "ok", predictorData: "ok" },
      metadata: { serviceStatus: { clinvar: "ok", predictorData: "ok" } }
    });
    await tick();

    const state = analysis.get();
    expect(
      state.result,
      "the first chunk was dropped because the structure had not resolved yet"
    ).not.toBeNull();
    expect(state.result.clinvar).toEqual({ classification: "Pathogenic" });
    expect(state.result.predictorData).toEqual({ revel: 0.88 });
    // The status map travels with the preview; a surface gating on it must not see `undefined`.
    expect(state.result.serviceStatus).toEqual({ clinvar: "ok", predictorData: "ok" });
    // The placeholder is what un-gates the shell: `isLoading` is the loading card.
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();

    // And the structure arriving later must not wipe the preview that is already on screen.
    structureGate.resolve("ATOM 1 N ...");
    await tick();
    await tick();
    expect(analysis.get().result.clinvar).toEqual({ classification: "Pathogenic" });
    expect(analysis.get().result.metadata.gene).toBe("PAH");

    biophysicsGate.resolve({ analysis: "done", clinvar: { classification: "Pathogenic" }, metadata: {} });
    await workflow;
  });

  it("does NOT create a result before any chunk has arrived", async () => {
    const { analysis, workflow } = run();
    await tick();

    // Nothing settled: the shell must stay in its loading state rather than appear as an empty
    // dashboard that claims evidence has started arriving.
    expect(analysis.get().result).toBeNull();
    expect(analysis.get().isLoading).toBe(true);

    structureGate.resolve("ATOM 1 N ...");
    await tick();
    await tick();
    // The structure warm-up is the FALLBACK path (no chunks at all, e.g. non-streaming clients):
    // it still seeds the placeholder so a structure-only run is not left with no result object.
    expect(analysis.get().result).not.toBeNull();
    expect(analysis.get().result.analysis).toBe(""); // No synthesized narrative has arrived.

    biophysicsGate.resolve({ analysis: "done", metadata: {} });
    await workflow;
  });
});

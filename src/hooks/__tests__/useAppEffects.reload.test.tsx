// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppEffects } from "../useAppEffects";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { createAnalysisCacheContext } from "../../services/pipeline/analysisContext";
import { clearClientVariantCache, recordBiophysicsAttempt, setCachedVariant } from "../../services/pipeline/variantCache";

const GENE = "PAH";
const VARIANT = "p.Arg408Trp";
const UNIPROT = "P00439";
const SETTINGS = { acmgWeighting: "standard", narrativeMode: "off" } as any;

/** A finished analysis saved under `saved` settings, with nothing left for a run to do. */
function saveAnalysis(result: object = {}, saved: any = SETTINGS, contextExtras: object = {}) {
  const context = { ...createAnalysisCacheContext(UNIPROT, saved, {}, "", undefined), ...contextExtras };
  setCachedVariant(GENE, VARIANT, UNIPROT, {
    analysisResult: {
      analysis: "A finished narrative.", multimerData: {}, ppiBindingData: {}, landscapeData: [], esm2Eval: {},
      metadata: { gene: GENE, variant: VARIANT, uniprotId: UNIPROT, pipelineContext: context,
        pipelineStages: { core: "complete", structural: "complete", landscape: "complete" } },
      ...result,
    },
    biophysicsContext: context.simulationConditions,
    mutantPdb: "ATOM", foldingEnergetics: { foldx: 1.2 }, foldingStatus: "success", pdbText: "ATOM",
  });
  recordBiophysicsAttempt(GENE, VARIANT, context.simulationConditions);
}

function reload(settings: any = SETTINGS) {
  const executeAnalysis = vi.fn();
  renderHook(() => useAppEffects({
    masterView: "search" as any, setMasterView: vi.fn(), setActiveEvidenceTab: vi.fn(), setIsOffline: vi.fn(),
    fetchWithAuth: vi.fn(async () => new Response("{}")) as any, consoleDispatch: vi.fn(), executeAnalysis, settings,
  } as any));
  return { executeAnalysis, painted: useVariantAnalysisStore.getState().analysisState.result };
}

beforeEach(() => {
  clearClientVariantCache();
  localStorage.clear();
  useVariantAnalysisStore.setState({
    gene: GENE, variant: VARIANT, uniprotId: UNIPROT, history: [],
    analysisState: { result: null, isLoading: false, error: null },
  } as any);
});

describe("reloading the page on a saved analysis", () => {
  it("paints a finished analysis without starting a run", () => {
    saveAnalysis();
    const { executeAnalysis, painted } = reload();
    expect(executeAnalysis).not.toHaveBeenCalled();
    expect(painted).not.toBeNull();
  });

  it("keeps a run the reader gave directions for, which the URL cannot carry", () => {
    saveAnalysis({}, SETTINGS, { userDirections: "ctx1:directions" });
    const { executeAnalysis, painted } = reload();
    expect(executeAnalysis).not.toHaveBeenCalled();
    expect(painted).not.toBeNull();
  });

  it("runs again when the ACMG weighting changed since the analysis was saved", () => {
    saveAnalysis();
    const { executeAnalysis, painted } = reload({ ...SETTINGS, acmgWeighting: "conservative" });
    expect(executeAnalysis).toHaveBeenCalledWith(GENE, VARIANT, UNIPROT);
    expect(painted).toBeNull();
  });

  it("does not paint evidence built against a non-canonical reference", () => {
    saveAnalysis({ predictorData: { source: "fallback lookup" } });
    const { executeAnalysis, painted } = reload();
    expect(executeAnalysis).toHaveBeenCalledTimes(1);
    expect(painted).toBeNull();
  });

  it("does not paint a question the reader has not answered", () => {
    saveAnalysis({ buildHint: { notation: "x" } });
    const { executeAnalysis, painted } = reload();
    expect(executeAnalysis).toHaveBeenCalledTimes(1);
    expect(painted).toBeNull();
  });

  it("goes through a run when a stage failed, so the stage is retried", () => {
    saveAnalysis({ metadata: { gene: GENE, variant: VARIANT, uniprotId: UNIPROT,
      pipelineContext: createAnalysisCacheContext(UNIPROT, SETTINGS, {}, "", undefined),
      pipelineStages: { core: "complete", structural: "complete", landscape: "error" } } });
    const { executeAnalysis } = reload();
    expect(executeAnalysis).toHaveBeenCalledTimes(1);
  });

  it("replays the original submission, so a coordinate keeps its build", () => {
    useVariantAnalysisStore.setState({ history: [{ gene: GENE, variant: VARIANT, uniprotId: UNIPROT, query: "12-100-A-G" }] } as any);
    const { executeAnalysis } = reload();
    expect(executeAnalysis).toHaveBeenCalledWith(GENE, "12-100-A-G", UNIPROT);
  });
});

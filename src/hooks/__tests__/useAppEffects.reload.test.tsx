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

  it("replays the exact genomic allele from a share URL in a fresh context (missense#14)", () => {
    window.history.replaceState({}, "", "/?gene=FGFR3&variant=p.Gly380Arg&uniprot=P22607&allele=4-1804392-G-A&assembly=GRCh38&transcript=NM_000142.5");
    useVariantAnalysisStore.setState({ gene: "FGFR3", variant: "p.Gly380Arg", uniprotId: "P22607", history: [] } as any);
    const { executeAnalysis } = reload();
    expect(executeAnalysis).toHaveBeenCalledWith("FGFR3", "Chr4(GRCh38):g.1804392G>A", "P22607");
    window.history.replaceState({}, "", "/");
  });
});

describe("entering the ESMFold 3D view", () => {
  it("selects esmfold2 tab and clears customPdbUrl without aborting sequence lookup", async () => {
    useVariantAnalysisStore.setState({
      gene: GENE,
      variant: VARIANT,
      uniprotId: UNIPROT,
      customPdbUrl: "https://files.rcsb.org/download/1PAH.pdb",
      esmFoldWtPdb: null,
      isEsmFolding: false,
      esmFoldingError: null,
      active3dModelTab: "alphafold2",
      analysisState: {
        result: {
          metadata: { gene: GENE, variant: VARIANT, uniprotId: UNIPROT, residueIndex: 408, mutant: "W" }
        },
        isLoading: false,
        error: null,
      },
    } as any);

    let capturedSignal: AbortSignal | undefined;
    const fetchWithAuth = vi.fn(async (_url: string, options?: RequestInit) => {
      capturedSignal = options?.signal ?? undefined;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ sequence: "M".repeat(452) }), { status: 200 });
    });
    const fetchEsmFold = vi.fn();

    renderHook(() =>
      useAppEffects({
        masterView: "structure_esmfold",
        setMasterView: vi.fn(),
        setActiveEvidenceTab: vi.fn(),
        setIsOffline: vi.fn(),
        fetchWithAuth: fetchWithAuth as any,
        consoleDispatch: vi.fn(),
        executeAnalysis: vi.fn(),
        settings: SETTINGS,
        fetchEsmFold,
      })
    );

    expect(useVariantAnalysisStore.getState().active3dModelTab).toBe("esmfold2");
    expect(useVariantAnalysisStore.getState().customPdbUrl).toBeNull();
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);

    await vi.waitFor(() => {
      expect(fetchEsmFold).toHaveBeenCalledTimes(1);
    });
    expect(capturedSignal?.aborted).toBe(false);
  });

  it("preserves active3dModelTab='esmfold2' when navigating from structure_esmfold to evidence", () => {
    const { rerender } = renderHook(
      ({ masterView }: { masterView: any }) =>
        useAppEffects({
          masterView,
          setMasterView: vi.fn(),
          setActiveEvidenceTab: vi.fn(),
          setIsOffline: vi.fn(),
          fetchWithAuth: vi.fn() as any,
          consoleDispatch: vi.fn(),
          executeAnalysis: vi.fn(),
          settings: SETTINGS,
          fetchEsmFold: vi.fn(),
        }),
      { initialProps: { masterView: "structure_esmfold" } }
    );
    expect(useVariantAnalysisStore.getState().active3dModelTab).toBe("esmfold2");

    rerender({ masterView: "evidence" });
    expect(useVariantAnalysisStore.getState().active3dModelTab).toBe("esmfold2");

    rerender({ masterView: "structure_alphafold" });
    expect(useVariantAnalysisStore.getState().active3dModelTab).toBe("alphafold2");
  });
});

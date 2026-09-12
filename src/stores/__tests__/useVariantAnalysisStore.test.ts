// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useVariantAnalysisStore,
  useVariantAnalysisActions,
  getVariantAnalysisActions
} from "../useVariantAnalysisStore";

describe("useVariantAnalysisStore State Normalization", () => {
  beforeEach(() => {
    const store = useVariantAnalysisStore.getState();
    store.resetVariantAnalysisState();
    store.setGene("PAH");
    store.setVariant("p.Arg408Trp");
    store.clearHistory();
    try {
      localStorage.clear();
    } catch (_) {}
  });

  it("initializes with normalized primaryBiophysics and compareBiophysics models", () => {
    const state = useVariantAnalysisStore.getState();
    expect(state.primaryBiophysics).toBeDefined();
    expect(state.primaryBiophysics.isFolding).toBe(false);
    expect(state.primaryBiophysics.mutantPdb).toBeNull();
    expect(state.compareBiophysics).toBeDefined();
    expect(state.compareBiophysics.variant).toBe("p.Arg408Pro");
  });

  it("updates both sub-model and flat properties atomically via setVariantBiophysics", () => {
    const actions = useVariantAnalysisActions();
    
    // Primary variant atomic update
    actions.setVariantBiophysics(false, {
      mutantPdb: "ATOM 1 CA ALA A 1",
      foldedResidueIndex: 42,
      isFolding: true,
      foldingStatus: "folding_in_progress",
      foldingDdG: 2.15,
      dynamut2Status: "complete",
      thermompnnStatus: "complete"
    });

    let state = useVariantAnalysisStore.getState();
    expect(state.primaryBiophysics.mutantPdb).toBe("ATOM 1 CA ALA A 1");
    expect(state.primaryBiophysics.foldedResidueIndex).toBe(42);
    expect(state.primaryBiophysics.isFolding).toBe(true);
    expect(state.primaryBiophysics.foldingStatus).toBe("folding_in_progress");
    expect(state.primaryBiophysics.foldingDdG).toBe(2.15);
    expect(state.primaryBiophysics.dynamut2Status).toBe("complete");

    // Verify flat backward-compatible mirrors
    expect(state.mutantPdb).toBe("ATOM 1 CA ALA A 1");
    expect(state.foldedResidueIndex).toBe(42);
    expect(state.isFolding).toBe(true);
    expect(state.foldingStatus).toBe("folding_in_progress");
    expect(state.foldingDdG).toBe(2.15);
    expect(state.dynamut2Status).toBe("complete");

    // Comparison variant atomic update
    actions.setVariantBiophysics(true, {
      variant: "p.Gly12Asp",
      mutantPdb: "ATOM 2 CA ASP A 12",
      foldedResidueIndex: 12,
      isFolding: false,
      foldingStatus: "completed",
      foldingDdG: -1.2
    });

    state = useVariantAnalysisStore.getState();
    expect(state.compareBiophysics.variant).toBe("p.Gly12Asp");
    expect(state.compareBiophysics.mutantPdb).toBe("ATOM 2 CA ASP A 12");
    expect(state.compareBiophysics.foldedResidueIndex).toBe(12);
    expect(state.compareBiophysics.foldingDdG).toBe(-1.2);

    // Verify flat backward-compatible compare mirrors
    expect(state.compareVariant).toBe("p.Gly12Asp");
    expect(state.compareMutantPdb).toBe("ATOM 2 CA ASP A 12");
    expect(state.compareFoldedResidueIndex).toBe(12);
    expect(state.compareFoldingDdG).toBe(-1.2);
  });

  it("synchronizes legacy flat setters into the normalized sub-model", () => {
    const actions = useVariantAnalysisActions();
    
    actions.setMutantPdb("ATOM LEGACY WT");
    actions.setIsFolding(true);
    actions.setFoldingDdG(3.45);

    let state = useVariantAnalysisStore.getState();
    expect(state.mutantPdb).toBe("ATOM LEGACY WT");
    expect(state.primaryBiophysics.mutantPdb).toBe("ATOM LEGACY WT");
    expect(state.primaryBiophysics.isFolding).toBe(true);
    expect(state.primaryBiophysics.foldingDdG).toBe(3.45);

    actions.setCompareMutantPdb("ATOM LEGACY COMP");
    actions.setIsFoldingCompare(true);
    actions.setCompareFoldingDdG(-0.85);

    state = useVariantAnalysisStore.getState();
    expect(state.compareMutantPdb).toBe("ATOM LEGACY COMP");
    expect(state.compareBiophysics.mutantPdb).toBe("ATOM LEGACY COMP");
    expect(state.compareBiophysics.isFolding).toBe(true);
    expect(state.compareBiophysics.foldingDdG).toBe(-0.85);
  });

  it("resets biophysical sub-models and flat properties on resetBiophysics", () => {
    const actions = useVariantAnalysisActions();

    actions.setVariantBiophysics(false, { mutantPdb: "PDB1", foldingDdG: 1.0 });
    actions.setVariantBiophysics(true, { mutantPdb: "PDB2", foldingDdG: -1.0 });

    actions.resetBiophysics(); // resets both
    const state = useVariantAnalysisStore.getState();
    expect(state.mutantPdb).toBeNull();
    expect(state.primaryBiophysics.mutantPdb).toBeNull();
    expect(state.compareMutantPdb).toBeNull();
    expect(state.compareBiophysics.mutantPdb).toBeNull();
  });

  it("updates pipeline loading states in batch via setLoadingStates", () => {
    const actions = useVariantAnalysisActions();

    actions.setLoadingStates({
      biophysical: true,
      structural: true,
      clinical: false,
      narrative: true
    });

    const state = useVariantAnalysisStore.getState();
    expect(state.isBiophysicalLoading).toBe(true);
    expect(state.isStructuralLoading).toBe(true);
    expect(state.isClinicalLoading).toBe(false);
    expect(state.isNarrativeLoading).toBe(true);
    expect(state.isHomologsLoading).toBe(false);
  });

  it("atomically resets biophysics, pipeline analysisState, and structural folding on resetVariantAnalysisState", () => {
    const store = useVariantAnalysisStore.getState();

    // Populate various slices
    store.setMutantPdb("ATOM SOME PDB");
    store.setEsmFoldMutPdb("ATOM ESM MUT");
    store.setAnalysisState({
      result: { variant: "p.Val600Glu" } as any,
      isLoading: true,
      error: "Some error"
    });
    store.setHomologs([{
      pdbId: "1ABC",
      score: 100,
      identity: 99,
      coverage: 0.95,
      title: "Test",
      organism: "Homo sapiens",
      method: "X-ray",
      resolution: 1.5,
      isHuman: true
    }]);

    // Trigger atomic root reset
    store.resetVariantAnalysisState();

    const updated = useVariantAnalysisStore.getState();
    expect(updated.mutantPdb).toBeNull();
    expect(updated.primaryBiophysics.mutantPdb).toBeNull();
    expect(updated.esmFoldMutPdb).toBeNull();
    expect(updated.analysisState.result).toBeNull();
    expect(updated.analysisState.isLoading).toBe(false);
    expect(updated.analysisState.error).toBeNull();
    expect(updated.homologs).toEqual([]);
  });

  it("guards against stale background biophysics updates via targetVariant", () => {
    const actions = getVariantAnalysisActions();
    const store = useVariantAnalysisStore.getState();
    store.setVariant("p.Val600Glu");

    // Stale update from earlier variant calculation (e.g. p.Arg408Trp)
    actions.setVariantBiophysics(
      false,
      { mutantPdb: "STALE PDB", foldingDdG: 9.9 },
      "p.Arg408Trp"
    );

    let state = useVariantAnalysisStore.getState();
    expect(state.mutantPdb).toBeNull();
    expect(state.primaryBiophysics.foldingDdG).toBeNull();

    // Matching update for current variant
    actions.setVariantBiophysics(
      false,
      { mutantPdb: "VALID PDB", foldingDdG: 1.5 },
      "p.Val600Glu"
    );

    state = useVariantAnalysisStore.getState();
    expect(state.mutantPdb).toBe("VALID PDB");
    expect(state.primaryBiophysics.foldingDdG).toBe(1.5);
  });

  it("guards updateAnalysisResultSlice against stale variant overwrites", () => {
    const store = useVariantAnalysisStore.getState();
    store.setVariant("p.Val600Glu");
    store.setAnalysisState({
      result: { variant: "p.Val600Glu", gene: "BRAF" } as any,
      isLoading: false,
      error: null
    });

    // Stale update from another variant
    store.updateAnalysisResultSlice("analysis", "Stale narrative", "p.Lys123Glu");
    let state = useVariantAnalysisStore.getState();
    expect(state.analysisState.result?.analysis).toBeUndefined();

    // Matching update
    store.updateAnalysisResultSlice("analysis", "Active narrative", "p.Val600Glu");
    state = useVariantAnalysisStore.getState();
    expect(state.analysisState.result?.analysis).toBe("Active narrative");
  });

  it("handles preset selection with and without explicit options", () => {
    const actions = useVariantAnalysisActions();
    const preset = {
      gene: "BRAF",
      variant: "p.Val600Glu",
      uniprotId: "P15056",
      condition: "Melanoma",
      description: "B-Raf proto-oncogene V600E activating mutation"
    };

    // 1. Call without options (autonomous cross-slice coordination)
    actions.handleSelectPreset(preset);

    let state = useVariantAnalysisStore.getState();
    expect(state.gene).toBe("BRAF");
    expect(state.variant).toBe("p.Val600Glu");
    expect(state.uniprotId).toBe("P15056");
    expect(state.selectedResidueIndex).toBe(600);

    // 2. Call with explicit options callbacks
    const abortSpy = vi.fn();
    const resetSpy = vi.fn();
    const executeSpy = vi.fn();

    actions.handleSelectPreset(
      { ...preset, variant: "p.Val600Lys" },
      {
        abortAllPendingRequests: abortSpy,
        resetViewerState: resetSpy,
        executeAnalysis: executeSpy
      }
    );

    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith("BRAF", "p.Val600Lys", "P15056");

    state = useVariantAnalysisStore.getState();
    expect(state.variant).toBe("p.Val600Lys");
    expect(state.selectedResidueIndex).toBe(600);
  });

  it("manages history deduplication, truncation, and clearHistory", () => {
    const store = useVariantAnalysisStore.getState();

    store.addToHistory({ gene: "BRAF", variant: "V600E", uniprotId: "P15056" });
    store.addToHistory({ gene: "KRAS", variant: "G12D", uniprotId: "P01116" });
    // Duplicate BRAF V600E should bubble to front
    store.addToHistory({ gene: "BRAF", variant: "V600E", uniprotId: "P15056" });

    let history = useVariantAnalysisStore.getState().history;
    expect(history.length).toBe(2);
    expect(history[0].gene).toBe("BRAF");
    expect(history[0].variant).toBe("V600E");
    expect(history[1].gene).toBe("KRAS");

    // Clear history
    store.clearHistory();
    history = useVariantAnalysisStore.getState().history;
    expect(history).toEqual([]);
  });
});

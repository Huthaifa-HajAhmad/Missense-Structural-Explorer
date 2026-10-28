// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useVariantAnalysisStore,
  useVariantAnalysisActions,
  getVariantAnalysisActions
} from "../useVariantAnalysisStore";
import { selectResidueLetter } from "../slices/searchSlice";

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

  it("initializes with a normalized primaryBiophysics model and no compare-variant state", () => {
    const state = useVariantAnalysisStore.getState() as any;
    expect(state.primaryBiophysics).toBeDefined();
    expect(state.primaryBiophysics.isFolding).toBe(false);
    expect(state.primaryBiophysics.mutantPdb).toBeNull();
    // The compare-variant feature had no UI and was removed; nothing should resurrect its state.
    expect(Object.keys(state).filter(k => /^compare|Compare/.test(k))).toEqual([]);
  });

  it("updates both sub-model and flat properties atomically via setVariantBiophysics", () => {
    const actions = useVariantAnalysisActions();
    
    // Primary variant atomic update
    actions.setVariantBiophysics({
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
  });

  it("synchronizes legacy flat setters into the normalized sub-model", () => {
    const actions = useVariantAnalysisActions();
    
    actions.setMutantPdb("ATOM LEGACY WT");
    actions.setIsFolding(true);
    actions.setFoldingDdG(3.45);

    const state = useVariantAnalysisStore.getState();
    expect(state.mutantPdb).toBe("ATOM LEGACY WT");
    expect(state.primaryBiophysics.mutantPdb).toBe("ATOM LEGACY WT");
    expect(state.primaryBiophysics.isFolding).toBe(true);
    expect(state.primaryBiophysics.foldingDdG).toBe(3.45);
  });

  it("resets biophysical sub-models and flat properties on resetBiophysics", () => {
    const actions = useVariantAnalysisActions();

    actions.setVariantBiophysics({ mutantPdb: "PDB1", foldingDdG: 1.0 });

    actions.resetBiophysics();
    const state = useVariantAnalysisStore.getState();
    expect(state.mutantPdb).toBeNull();
    expect(state.foldingDdG).toBeNull();
    expect(state.primaryBiophysics.mutantPdb).toBeNull();
    expect(state.primaryBiophysics.foldingDdG).toBeNull();
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
      { mutantPdb: "STALE PDB", foldingDdG: 9.9 },
      "p.Arg408Trp"
    );

    let state = useVariantAnalysisStore.getState();
    expect(state.mutantPdb).toBeNull();
    expect(state.primaryBiophysics.foldingDdG).toBeNull();

    // Matching update for current variant
    actions.setVariantBiophysics(
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

describe("published protein sequence", () => {
  const published = () => useVariantAnalysisStore.getState().proteinSequence;

  it("resolves a residue letter for the accession the sequence was fetched under", () => {
    const store = useVariantAnalysisStore.getState();
    store.setUniprotId("P15056");
    store.setProteinSequence("P15056", "MVRKIQ");

    expect(selectResidueLetter(useVariantAnalysisStore.getState(), 1)).toBe("M");
    expect(selectResidueLetter(useVariantAnalysisStore.getState(), 2)).toBe("V");
  });

  it("matches the accession case-insensitively, as the sequence route does", () => {
    const store = useVariantAnalysisStore.getState();
    store.setUniprotId(" p15056 ");
    store.setProteinSequence("P15056", "MVRKIQ");

    expect(selectResidueLetter(useVariantAnalysisStore.getState(), 4)).toBe("K");
  });

  it("yields no letter once the accession changes, even if the new fetch has not published yet", () => {
    const store = useVariantAnalysisStore.getState();
    store.setUniprotId("P15056");
    store.setProteinSequence("P15056", "MVRKIQ");

    // History and preset selection write uniprotId through a bulk set that never touches the
    // publication, so the guard has to come from the key rather than from clearing.
    useVariantAnalysisStore.setState({ uniprotId: "P01116" });

    expect(selectResidueLetter(useVariantAnalysisStore.getState(), 2)).toBe("");
    expect(published()?.accession).toBe("P15056");
  });

  it("yields no letter past the end of the sequence rather than an empty-but-present residue", () => {
    const store = useVariantAnalysisStore.getState();
    store.setUniprotId("P15056");
    store.setProteinSequence("P15056", "MVRKIQ");

    expect(selectResidueLetter(useVariantAnalysisStore.getState(), 7)).toBe("");
    expect(selectResidueLetter(useVariantAnalysisStore.getState(), null)).toBe("");
  });

  it("drops the publication when set without an accession", () => {
    const store = useVariantAnalysisStore.getState();
    store.setProteinSequence("P15056", "MVRKIQ");
    store.setProteinSequence("", "");

    expect(published()).toBeNull();
  });
});

describe("residue focus", () => {
  const focus = { companions: [200], label: "Disulfide bond between Cys150 and Cys200" };

  it("is set together with the selection and cleared by the next selection of any kind", () => {
    const store = useVariantAnalysisStore.getState();
    store.selectResidueWithFocus(150, focus);
    expect(useVariantAnalysisStore.getState().selectedResidueIndex).toBe(150);
    expect(useVariantAnalysisStore.getState().residueFocus).toEqual(focus);

    store.setSelectedResidueIndex(150);
    expect(useVariantAnalysisStore.getState().residueFocus).toBeNull();
  });

  it("does not survive a history replay to another variant", () => {
    const store = useVariantAnalysisStore.getState();
    store.selectResidueWithFocus(150, focus);
    store.handleSelectHistoryItem({ gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", timestamp: 0 } as any);
    expect(useVariantAnalysisStore.getState().residueFocus).toBeNull();
  });
});

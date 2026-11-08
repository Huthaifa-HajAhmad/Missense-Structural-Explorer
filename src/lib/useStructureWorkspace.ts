import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { useSettings } from "../context/SettingsContext";
import { useApiClient } from "../apiClient";
import { useStructure3dEvidence } from "./useStructure3dEvidence";
import { buildStructureSelection, indexStructureResidues, type StructureSelection } from "../shared/structureSelection";
import { readCaTrace, type ResidueAt } from "../shared/coordinateText";
import type { AlignmentScope, LoadedEntry, ModelFamily, Structure3dEvidence, ViewMode } from "../shared/structure3dEvidence";
import type { MasterView } from "../types/ui";

/** Every set of coordinates a 3D tab can draw. */
export interface CoordinateSources {
  pdbText: string | null;
  mutantPdb: string | null;
  foldxReferencePdb: string | null;
  foldxAlignedPdb: string | null;
  esmFoldWtPdb: string | null;
  esmFoldMutPdb: string | null;
  esmFoldAlignedPdb: string | null;
  customPdbUrl: string | null;
  customPdbEntry: Pick<LoadedEntry, "url" | "text"> | null;
}

/** What the canvas draws: the main coordinates, the superposed variant, and whether it may fetch the AlphaFold DB model itself. */
export interface CanvasCoordinates {
  primary: string | null;
  compare: string | null;
  allowFetch: boolean;
}

/**
 * The coordinates the canvas draws, per tab and mode.
 *
 * The superposed pair is always FoldX's own template with the variant fitted onto it, never the AlphaFold
 * model under the FoldX variant: those are two templates in two frames. The ESMFold variant is drawn from
 * the unaligned file, because the aligner writes Cα displacement into the B column of the aligned one.
 */
export function canvasCoordinates(family: ModelFamily, mode: ViewMode, s: CoordinateSources): CanvasCoordinates {
  const draw = (primary: string | null, compare: string | null = null) => ({ primary: primary || null, compare: compare || null, allowFetch: false });
  if (family === "esmfold") {
    if (mode === "mutant") return draw(s.esmFoldMutPdb);
    if (mode === "superimposed") return draw(s.esmFoldWtPdb, s.esmFoldAlignedPdb);
    return draw(s.esmFoldWtPdb);
  }
  if (mode === "mutant") return draw(s.mutantPdb);
  if (mode === "superimposed") return draw(s.foldxReferencePdb, s.foldxAlignedPdb);
  // A chosen entry is drawn once its text for the URL now selected has arrived; until then the viewer fetches it.
  if (s.customPdbUrl) return draw(s.customPdbEntry?.url === s.customPdbUrl ? s.customPdbEntry.text : null);
  return { ...draw(s.pdbText), allowFetch: true };
}

/** Everything the 3D canvas needs to draw one tab, built from one evidence model. */
export interface StructureCanvasView extends CanvasCoordinates {
  model: Structure3dEvidence;
  /** Cα residues of the primary coordinates, keyed by UniProt position. */
  coordinateIndex: ReadonlyMap<number, ResidueAt>;
  /** The selected residue as it stands on these coordinates. */
  selection: StructureSelection;
  /** The queried variant site read the same way, for its callout on the canvas. */
  siteSelection: StructureSelection;
}

/**
 * The 3D structure workspace: which tab (AlphaFold or ESMFold) is shown, and what its canvas and rail show.
 * The tab is remembered while another workspace is open, so coming back does not reload the canvas.
 */
export function useStructureWorkspace(masterView: MasterView) {
  const { settings } = useSettings();
  const { apiClient } = useApiClient();
  const isActive = masterView === "structure" || masterView === "structure_alphafold" || masterView === "structure_esmfold";

  const [lastFamily, setLastFamily] = useState<ModelFamily | null>(null);
  const activeFamily: ModelFamily = masterView === "structure_esmfold" ? "esmfold" : "alphafold";
  if (isActive && lastFamily !== activeFamily) setLastFamily(activeFamily);
  const family: ModelFamily = lastFamily ?? (settings.defaultStructureModel === "esmfold" ? "esmfold" : "alphafold");

  // The model decides which modes exist and falls back when one is not available. The coordinates follow
  // `model.viewMode`, not the stored mode, so the canvas never draws a mode the model has ruled out.
  const model = useStructure3dEvidence(family);
  const storedViewMode = useVariantAnalysisStore(s => s.viewMode);
  useEffect(() => {
    if (isActive && model.viewMode !== storedViewMode) useVariantAnalysisStore.getState().setViewMode(model.viewMode);
  }, [isActive, model.viewMode, storedViewMode]);

  const sources: CoordinateSources = {
    pdbText: useVariantAnalysisStore(s => s.pdbText),
    mutantPdb: useVariantAnalysisStore(s => s.mutantPdb),
    foldxReferencePdb: useVariantAnalysisStore(s => s.foldxReferencePdb),
    foldxAlignedPdb: useVariantAnalysisStore(s => s.foldxAlignedPdb),
    esmFoldWtPdb: useVariantAnalysisStore(s => s.esmFoldWtPdb),
    esmFoldMutPdb: useVariantAnalysisStore(s => s.esmFoldMutPdb),
    esmFoldAlignedPdb: useVariantAnalysisStore(s => s.esmFoldAlignedPdb),
    customPdbUrl: useVariantAnalysisStore(s => s.customPdbUrl),
    customPdbEntry: useVariantAnalysisStore(s => s.customPdbEntry),
  };
  const { primary, compare, allowFetch } = canvasCoordinates(family, model.viewMode, sources);

  const selectedResidue = useVariantAnalysisStore(s => s.selectedResidueIndex);
  const hoveredResidue = useVariantAnalysisStore(s => s.hoveredResidueIndex);
  const coordinateIndex = useMemo(() => indexStructureResidues(primary), [primary]);
  // What a residue is read against: the drawn model's secondary structure and Cα trace, and UniProt's features.
  const canvasSecondary = useVariantAnalysisStore(s => s.canvasSecondary);
  const features = useVariantAnalysisStore(s => s.analysisState?.result?.uniprotFeatures?.features ?? null);
  const trace = useMemo(() => readCaTrace(primary), [primary]);
  const selectionContext = useMemo(() => ({ secondary: canvasSecondary, features, trace }), [canvasSecondary, features, trace]);
  const selection = useMemo(() => buildStructureSelection(model, coordinateIndex, selectedResidue, selectionContext), [model, coordinateIndex, selectedResidue, selectionContext]);
  const siteSelection = useMemo(() => buildStructureSelection(model, coordinateIndex, model.site.position, selectionContext), [model, coordinateIndex, selectionContext]);
  const view = useMemo<StructureCanvasView>(
    () => ({ primary, compare, allowFetch, model, coordinateIndex, selection, siteSelection }),
    [primary, compare, allowFetch, model, coordinateIndex, selection, siteSelection],
  );
  // The rail previews the residue under the pointer while the 3D view is open.
  const railSelection = useMemo<StructureSelection>(() => isActive && hoveredResidue
    ? { ...buildStructureSelection(model, coordinateIndex, hoveredResidue, selectionContext), preview: true }
    : selection, [isActive, hoveredResidue, model, coordinateIndex, selection, selectionContext]);

  // ESMFold only: FoldX keeps the template backbone, so its pair has no fit scope to choose.
  // A newer request makes an older answer stale, so only the latest one is stored.
  const variantPosition = useVariantAnalysisStore(s => s.analysisState?.result?.metadata?.residueIndex ?? null);
  const alignmentRequestRef = useRef(0);
  const changeAlignmentScope = useCallback(async (scope: AlignmentScope) => {
    const store = useVariantAnalysisStore.getState();
    if (family !== "esmfold" || scope === store.esmAlignmentScope) return;
    store.setEsmAlignmentScope(scope);
    const request = ++alignmentRequestRef.current;
    if (!sources.esmFoldWtPdb || !sources.esmFoldMutPdb || !variantPosition) return;
    try {
      const aligned = await apiClient.structuralAlign({ pdb1: sources.esmFoldWtPdb, pdb2: sources.esmFoldMutPdb, targetIndex: variantPosition, alignmentScope: scope });
      if (request !== alignmentRequestRef.current || !aligned.alignedPdb) return;
      store.setEsmFoldAlignedPdb(aligned.alignedPdb);
      store.setEsmFoldMetrics(aligned.metrics);
    } catch (err) {
      if (request === alignmentRequestRef.current) console.warn("[Alignment Scope Update Error]:", err);
    }
  }, [family, sources.esmFoldWtPdb, sources.esmFoldMutPdb, variantPosition, apiClient]);

  return { isActive, family, view, railSelection, changeAlignmentScope };
}

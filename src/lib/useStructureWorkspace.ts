import { useEffect, useMemo } from "react";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { useStructure3dEvidence } from "./useStructure3dEvidence";
import { buildStructureSelection, indexStructureResidues, type StructureSelection } from "../shared/structureSelection";
import { identifyAlphaFoldHeader, readCaTrace, type ResidueAt } from "../shared/coordinateText";
import { fitContextOntoTemplate, type ContextFit } from "../shared/structureContext";
import type { LoadedEntry, Structure3dEvidence, ViewMode } from "../shared/structure3dEvidence";
import type { MasterView } from "../types/ui";

/** Every set of coordinates a 3D tab can draw. */
export interface CoordinateSources {
  pdbText: string | null;
  mutantPdb: string | null;
  foldxReferencePdb: string | null;
  foldxAlignedPdb: string | null;
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
 * A short experimental template draws only its own stretch. Around it the full-length AlphaFold model is
 * drawn faintly, moved into the template's frame, so the variant is seen in the whole protein. Null when
 * there is nothing to add or the fit is not trustworthy (see `fitContextOntoTemplate`).
 */
export function contextAround(
  mode: ViewMode,
  s: Pick<CoordinateSources, "pdbText" | "mutantPdb" | "foldxReferencePdb">,
  provenance: { source?: string } | null,
): ContextFit | null {
  if ((mode !== "mutant" && mode !== "superimposed") || !s.pdbText) return null;
  const textIsAlphaFold = provenance?.source === "alphafold" || (!provenance && !!identifyAlphaFoldHeader(s.pdbText));
  const template = mode === "mutant" ? s.mutantPdb : s.foldxReferencePdb;
  return textIsAlphaFold && template ? fitContextOntoTemplate(s.pdbText, template) : null;
}

/**
 * The coordinates the canvas draws, per mode.
 *
 * The superposed pair is always FoldX's own template with the variant fitted onto it, never the AlphaFold
 * model under the FoldX variant: those are two templates in two frames.
 */
export function canvasCoordinates(mode: ViewMode, s: CoordinateSources): CanvasCoordinates {
  const draw = (primary: string | null, compare: string | null = null) => ({ primary: primary || null, compare: compare || null, allowFetch: false });
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
  /** The full-length AlphaFold model fitted onto a short template, drawn faintly around it. */
  contextFit: ContextFit | null;
}

/** The 3D structure workspace: what its canvas and rail show. */
export function useStructureWorkspace(masterView: MasterView) {
  const isActive = masterView === "structure" || masterView === "structure_alphafold";

  // The model decides which modes exist and falls back when one is not available. The coordinates follow
  // `model.viewMode`, not the stored mode, so the canvas never draws a mode the model has ruled out.
  const model = useStructure3dEvidence();
  const storedViewMode = useVariantAnalysisStore(s => s.viewMode);
  useEffect(() => {
    if (isActive && model.viewMode !== storedViewMode) useVariantAnalysisStore.getState().setViewMode(model.viewMode);
  }, [isActive, model.viewMode, storedViewMode]);

  const sources: CoordinateSources = {
    pdbText: useVariantAnalysisStore(s => s.pdbText),
    mutantPdb: useVariantAnalysisStore(s => s.mutantPdb),
    foldxReferencePdb: useVariantAnalysisStore(s => s.foldxReferencePdb),
    foldxAlignedPdb: useVariantAnalysisStore(s => s.foldxAlignedPdb),
    customPdbUrl: useVariantAnalysisStore(s => s.customPdbUrl),
    customPdbEntry: useVariantAnalysisStore(s => s.customPdbEntry),
  };
  const { primary, compare, allowFetch } = canvasCoordinates(model.viewMode, sources);

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
  const pdbTextProvenance = useVariantAnalysisStore(s => s.pdbTextProvenance);
  const contextFit = useMemo(
    () => contextAround(model.viewMode, sources, pdbTextProvenance),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.viewMode, sources.pdbText, sources.mutantPdb, sources.foldxReferencePdb, pdbTextProvenance],
  );
  const view = useMemo<StructureCanvasView>(
    () => ({ primary, compare, allowFetch, model, coordinateIndex, selection, siteSelection, contextFit }),
    [primary, compare, allowFetch, model, coordinateIndex, selection, siteSelection, contextFit],
  );
  // The rail previews the residue under the pointer while the 3D view is open.
  const railSelection = useMemo<StructureSelection>(() => isActive && hoveredResidue
    ? { ...buildStructureSelection(model, coordinateIndex, hoveredResidue, selectionContext), preview: true }
    : selection, [isActive, hoveredResidue, model, coordinateIndex, selection, selectionContext]);

  return { isActive, view, railSelection };
}

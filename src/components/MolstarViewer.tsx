import { linkedPickPosition, selectionCalloutFacts } from "../shared/structureSelection";
import type { StructureCanvasView } from "../lib/useStructureWorkspace";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore, useVariantAnalysisActions } from "../context/VariantAnalysisContext";
import { useMolstarPlugin } from "./molstar/useMolstarPlugin";
import { COMPANION_CARBON, MAX_LABEL_ALL_COMPANIONS, MAX_LABELLED_COMPANIONS, POCKET_COLOUR, useMolstarStructure, VIEWER_CONTAINER_ID, type PlddtFilter } from "./molstar/useMolstarStructure";
import { StructureGuideCard, type CanvasGuideItem } from "./molstar/StructureGuideCard";
import { StructureToolbar } from "./molstar/StructureToolbar";
import { StructureLegend } from "./molstar/StructureLegend";
import { StructurePocketPanel } from "./molstar/StructurePocketPanel";
import { StructureStatusOverlay } from "./molstar/StructureStatusOverlay";
import { StructureCallouts, type StructureCallout } from "./molstar/StructureCallouts";
import { readProteinLength } from "../shared/foldingLimits";
import { CONTEXT_COLOUR } from "./molstar/drawContextLayer";
import { derivePocketNarrative } from "../shared/residueShiftEvidence";
import { PAIR_COLOURS, type AlignmentScope, type ColourPlan, type RepresentationId, type ViewMode } from "../shared/structure3dEvidence";

/** Resolves the dual-swatch colours for the superposed variant site from the evidence colour plan. */
export function resolveSuperpositionSwatches(colour: ColourPlan): { primary: number; secondary: number } {
  return {
    primary: colour.primary.theme === "uniform" ? colour.primary.color : PAIR_COLOURS.template,
    secondary: colour.secondary?.theme === "uniform" ? colour.secondary.color : PAIR_COLOURS.variant,
  };
}

/**
 * Narrowest stage, in CSS pixels, that fits the left column, a readable structure and a callout column:
 * 324 (guide) + 240 (card) + ~376 of structure. Below it the guide card lists the residues instead.
 */
const CALLOUT_MIN_STAGE = 940;
/** The guide-and-legend column on the left: 12 px gutter + 312 px card (see `.s3d-overlay-col`). */
const OVERLAY_COLUMN_WIDTH = 324;
/** The pocket panel plus its gutter on the right (see `.s3d-pocket` in structure3d.css). */
const POCKET_INSET = 340;


export interface MolstarViewerProps {
  active?: boolean;
  /** What this tab draws (`useStructureWorkspace`). The canvas only highlights a selection with `state: "available"`. */
  view: StructureCanvasView;
  onResidueClick: (index: number | null) => void;
  /** Selects the queried variant again; the site button calls it when another residue is selected. */
  onReturnToVariant?: () => void;
  onModeChange: (mode: ViewMode) => void;
  onAlignmentScopeChange?: (scope: AlignmentScope) => void;
  onSwitchToAlphaFold?: () => void;
  onOpenPocketTab?: () => void;
  onRetryPocket?: () => void;
  onRetryStructural?: () => void;
  heightClass?: string;
}

/**
 * The 3D structure view: toolbar, canvas, colour key, pocket panel and status, all rendered from one
 * evidence model. The inspector rail renders the same model as a trace.
 *
 * Removed with this rewrite: a draggable "Biophysical Insight Alert" no caller ever fed, a ΔΔG
 * formatter and energy-unit read that nothing displayed, and props (`metrics`, `mutantDdG`,
 * `compareVariant`) the component accepted and ignored.
 */
export default function MolstarViewer({
  active = true,
  view,
  onResidueClick,
  onReturnToVariant,
  onModeChange,
  onAlignmentScopeChange,
  onSwitchToAlphaFold,
  onOpenPocketTab,
  onRetryPocket,
  onRetryStructural,
  heightClass,
}: MolstarViewerProps) {
  const { model, coordinateIndex, selection, siteSelection, primary: primaryPdbData, compare: comparePdbData, contextFit, allowFetch } = view;
  const variantPosition = model.site.position;
  const selectedResidue = selection.position;
  const { isDark, settings, setSettings, showPolarContacts, openSettingsTab } = useSettings();
  const { fetchWithAuth } = useApiClient();
  const actions = useVariantAnalysisActions();

  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const gene = useVariantAnalysisStore(s => s.gene);
  const variant = useVariantAnalysisStore(s => s.variant);
  const customPdbUrl = useVariantAnalysisStore(s => s.customPdbUrl);
  const computedPocket = useVariantAnalysisStore(s => s.computedPocket);
  const isPocketLoading = useVariantAnalysisStore(s => s.isPocketLoading);
  const pocketError = useVariantAnalysisStore(s => s.pocketError);
  const chain = useVariantAnalysisStore(s => (s.analysisState?.result?.metadata as any)?.chain ?? null);
  const esm3Scores = useVariantAnalysisStore(s => {
    const e: any = s.analysisState?.result?.esm3Eval;
    return e && !("error" in e) && Array.isArray(e.perturbationScores) ? (e.perturbationScores as number[]) : null;
  });
  const proteinLength = useVariantAnalysisStore(s => readProteinLength(s.analysisState?.result?.metadata).residues);
  const landscapeLength = useVariantAnalysisStore(s => s.analysisState?.result?.landscapeData?.length ?? null);
  const isEsmFolding = useVariantAnalysisStore(s => s.isEsmFolding);
  const esmFoldingError = useVariantAnalysisStore(s => s.esmFoldingError);
  const esmFoldWtPdb = useVariantAnalysisStore(s => s.esmFoldWtPdb);
  const residueFocus = useVariantAnalysisStore(s => s.residueFocus);
  // Companions are drawn by number, so only where the numbering is verified (the hook gates the same way).
  const focusShown = residueFocus && model.site.canAddressVariantSite && selection.state === "available" ? residueFocus : null;

  const residueColorHex = parseInt((settings.residueColor || "#C46849").replace("#", ""), 16);

  const [plddtFilter, setPlddtFilter] = useState<PlddtFilter>("none");
  const [siteCloseUp, setSiteCloseUp] = useState(false);
  const [pocketOpen, setPocketOpen] = useState(false);
  const [showPocket, setShowPocket] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // The reader's choice for a large highlighted set; reset whenever the set changes.
  const [labelAllCompanions, setLabelAllCompanions] = useState(false);
  const focusKey = focusShown ? `${focusShown.label}:${focusShown.companions.join(",")}` : "";
  useEffect(() => setLabelAllCompanions(false), [focusKey]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Callouts need room beside the structure; below this width the guide card lists the residues instead.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  // Measured in a layout effect, not a passive one: the callouts must exist in the first painted frame,
  // or a static read of the DOM (the WebGL proof harness) can catch a stage that has no cards yet.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const width = stage.getBoundingClientRect().width;
    if (width > 0) setStageWidth(width);
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === cardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const plugin = useMolstarPlugin({
    isDark,
    onResidueHover: (index, pick) => actions.setHoveredResidueIndex(linkedPickPosition(active, model, coordinateIndex, index, pick)),
    onResidueClick: (index, pick) => {
      const linked = linkedPickPosition(active, model, coordinateIndex, index, pick);
      if (linked) onResidueClick(linked);
    },
  });

  useEffect(() => {
    if (!active) actions.setHoveredResidueIndex(null);
  }, [active, actions.setHoveredResidueIndex]);

  const pocket = useMemo(
    () => derivePocketNarrative(computedPocket as any, { isLoading: isPocketLoading, error: pocketError, variantResidueIndex: variantPosition, variantResidueChain: chain }),
    [computedPocket, isPocketLoading, pocketError, variantPosition, chain]
  );
  // Pocket lining comes from the pipeline's AlphaFold wild-type run. It is not transferable to a
  // de novo fold or experimental entry simply because their residue numbers happen to coincide.
  const canDrawPocketOnCanvas = !customPdbUrl && model.canvas.primary?.origin === "afdb" && model.site.canAddressVariantSite;
  const pocketIndices = useMemo(
    () => (canDrawPocketOnCanvas && (pocket.status === "success" || pocket.status === "fallback_engine")
      ? pocket.lining.byDistance.map(r => r.index) : []),
    [canDrawPocketOnCanvas, pocket]
  );

  useEffect(() => {
    if (!canDrawPocketOnCanvas) setShowPocket(false);
  }, [canDrawPocketOnCanvas]);

  // Callouts need room beside the structure; below this width the guide card lists the residues instead.
  const calloutRoom = !plugin.loadError && stageWidth - (pocketOpen ? POCKET_INSET : 0) >= CALLOUT_MIN_STAGE;

  const structure = useMolstarStructure({
    plugin,
    uniprotId,
    gene,
    primaryPdbData,
    customPdbUrl: customPdbUrl || null,
    comparePdbData,
    contextPdbData: contextFit?.pdb ?? null,
    contextCovered: contextFit?.covered ?? null,
    allowFetch,
    reloadNonce,
    colour: model.colour,
    plddtFilter: model.plddtFilter.available ? plddtFilter : "none",
    plddtScale: model.plddtFilter.available ? model.plddtFilter.scale : null,
    esm3Scores: model.representation === "esm3" ? esm3Scores : null,
    variantPosition,
    canAddressVariantSite: model.site.canAddressVariantSite,
    residueNumbering: model.canvas.primary?.numbering ?? "unknown",
    // When the site's card already names it, the canvas must not also draw a 3D text label on it.
    suppressVariantLabel: calloutRoom && Boolean(variantPosition) && model.site.canAddressVariantSite,
    selectedResidue: selection.state === "available" ? selection.position : null,
    companionResidues: focusShown?.companions,
    showPolarContacts,
    show3DLabels: settings.show3DLabels !== false,
    labelAllCompanions,
    siteCloseUp,
    residueColorHex: Number.isFinite(residueColorHex) ? residueColorHex : 0xc46849,
    neonHighContrast: settings.neonHighContrast === true,
    autoZoomOnSelect: settings.autoZoomOnSelect,
    cameraDuration: settings.cameraDuration,
    showPocket,
    pocketResidueIndices: pocketIndices,
    fetchWithAuth,
    onPdbTextLoaded: (text, provenance) => {
      actions.setPdbText(text);
      useVariantAnalysisStore.getState().setPdbTextProvenance(provenance);
    },
    onEntryLoaded: entry => useVariantAnalysisStore.getState().setCustomPdbEntry(entry),
    onSecondaryStructure: (secondary, state) => {
      const store = useVariantAnalysisStore.getState();
      store.setCanvasSecondary(secondary);
      store.setCanvasSecondaryState(state);
    },
  });

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await cardRef.current?.requestFullscreen();
    } catch (err) {
      console.warn("[3D] Full screen is not available:", err);
    }
  };

  const fileStem = [gene, variant, model.canvas.chip.label, model.representation]
    .filter(Boolean)
    .join("_")
    .replace(/[^A-Za-z0-9._-]+/g, "-");

  const warnings = model.notices.filter(n => n.tone === "warning");
  const nameAt = (position: number) => {
    const r = coordinateIndex.get(position);
    return `${r ? r.resName.charAt(0) + r.resName.slice(1).toLowerCase() : "Residue "}${position}`;
  };
  const siteResidue = variantPosition ? coordinateIndex.get(variantPosition) : undefined;
  const siteName = variantPosition ? nameAt(variantPosition) : null;
  const plddtAtSite = model.canvas.primary?.origin === "afdb" && siteResidue?.caBFactor != null ? siteResidue.caBFactor : null;
  const selectedShown = model.site.canAddressVariantSite && selection.state === "available" && selection.position && selection.position !== variantPosition ? selection.position : null;
  const isSuperposed = model.viewMode === "superimposed" && Boolean(comparePdbData && model.colour.secondary) && structure.drawnPair;
  const pairLeadNoun = model.family === "alphafold" ? "Template" : "Wild-type";
  const pairSwatches = resolveSuperpositionSwatches(model.colour);
  const handleFocusSite = () => {
    if (!model.site.canAddressVariantSite || !variantPosition) return;
    if (selectedResidue !== variantPosition) onReturnToVariant?.();
    structure.focusResidue(variantPosition, "residue");
  };
  // Read from what the hook was asked to draw, in the order the eye meets it: the variant, the selection,
  // the companions, the pocket. The colour legend below keys the cartoon itself.
  const guideItems: CanvasGuideItem[] = [
    ...(siteName && model.site.canAddressVariantSite ? [{
      key: "site",
      color: isSuperposed ? pairSwatches.primary : (Number.isFinite(residueColorHex) ? residueColorHex : 0xc46849),
      secondaryColor: isSuperposed ? pairSwatches.secondary : null,
      shape: isSuperposed ? ("pair" as const) : ("sticks" as const),
      text: `Variant residue ${siteName}`,
      badge: model.site.substitution ?? undefined,
      sub: isSuperposed
        ? `${pairLeadNoun} + variant sticks · ${plddtAtSite !== null ? `pLDDT ${plddtAtSite.toFixed(0)} (AlphaFold DB)` : "superposed"}`
        : plddtAtSite !== null
          ? `pLDDT ${plddtAtSite.toFixed(0)} at this residue (AlphaFold DB)`
          : model.site.confidence.kind !== "none"
            ? model.site.confidence.text
            : undefined,
      onClick: handleFocusSite,
      actionLabel: `Frame variant residue ${siteName}`,
    }] : []),
    ...(selectedShown ? [{
      key: "selected",
      color: null,
      shape: "sticks" as const,
      text: `Selected residue ${nameAt(selectedShown)}`,
      badge: selection.measurement ? selection.measurement.value : `pos ${selectedShown}`,
      sub: selection.measurement ? `${selection.measurement.label} · element colours` : "Element colours",
      onClick: () => structure.focusResidue(selectedShown, "residue"),
      actionLabel: `Frame selected residue ${nameAt(selectedShown)}`,
      onClear: onReturnToVariant ? () => onReturnToVariant() : undefined,
      clearLabel: "Return to variant site",
    }] : []),
    ...(focusShown ? [{
      key: "companions",
      color: COMPANION_CARBON,
      shape: "sticks" as const,
      text: focusShown.label,
      badge: `${focusShown.companions.length} aa`,
      sub: `${focusShown.companions.length} residue${focusShown.companions.length === 1 ? "" : "s"}, drawn on this model by number`,
      onClick: () => structure.focusResidues(focusShown.companions, 6),
      actionLabel: `Frame ${focusShown.label}`,
      onClear: () => actions.setSelectedResidueIndex(selection.position),
      clearLabel: "Clear companion highlight",
    }] : []),
    ...(contextFit && structure.contextDrawn ? [{
      key: "context",
      color: CONTEXT_COLOUR,
      shape: "surface" as const,
      text: "AlphaFold context (faint)",
      badge: `${contextFit.contextResidues} aa`,
      sub: `Template covers ${contextFit.covered.start}–${contextFit.covered.end}. Fitted on ${contextFit.matched} Cα, RMSD ${contextFit.rmsd.toFixed(1)} Å.`,
    }] : []),
    ...(showPocket && pocketIndices.length ? [{
      key: "pocket",
      color: POCKET_COLOUR,
      shape: "surface" as const,
      text: "Predicted pocket lining (P2Rank)",
      badge: `${pocketIndices.length} aa`,
      sub: `${pocketIndices.length} residues`,
      onClick: () => {
        setPocketOpen(true);
        structure.focusResidues(pocketIndices, 5);
      },
      actionLabel: "Frame predicted pocket lining",
      onClear: () => setShowPocket(false),
      clearLabel: "Hide pocket on structure",
    }] : []),
    ...(siteCloseUp ? [{
      key: "contacts",
      color: null,
      shape: "dashes" as const,
      text: "Close-up: residues within 5 Å and their contacts",
      badge: "5 Å",
      onClick: variantPosition ? () => structure.focusResidue(variantPosition, "neighbourhood") : undefined,
      actionLabel: "Frame 5 Å neighbourhood",
      onClear: () => setSiteCloseUp(false),
      clearLabel: "Exit site close-up",
    }] : []),
  ];
  const callouts: StructureCallout[] = calloutRoom ? [
    ...(siteName && model.site.canAddressVariantSite && variantPosition ? [{
      key: "site",
      position: variantPosition,
      on: isSuperposed && !model.comparison.rigidBackbone ? "variant" as const : "primary" as const,
      chain: siteSelection?.residue?.chain ?? null,
      kicker: "Variant site",
      title: model.site.substitution ?? siteName,
      color: isSuperposed ? pairSwatches.primary : Number.isFinite(residueColorHex) ? residueColorHex : 0xc46849,
      secondaryColor: isSuperposed ? pairSwatches.secondary : null,
      facts: siteSelection?.state === "available"
        ? selectionCalloutFacts(siteSelection)
        : [{ label: "Confidence", value: model.site.confidence.kind !== "none" ? model.site.confidence.text : model.site.check.text }],
      frameLabel: `Frame variant residue ${siteName}`,
      onFrame: handleFocusSite,
    }] : []),
    ...(selectedShown ? [{
      key: "selected",
      position: selectedShown,
      on: "primary" as const,
      chain: selection.residue?.chain ?? null,
      kicker: selection.preview ? "Preview" : "Selected residue",
      title: nameAt(selectedShown),
      color: null,
      facts: selectionCalloutFacts(selection),
      frameLabel: `Frame selected residue ${nameAt(selectedShown)}`,
      onFrame: () => structure.focusResidue(selectedShown, "residue"),
      onClear: onReturnToVariant,
      clearLabel: "Return to variant site",
    }] : []),
  ] : [];
  const calloutKeys = new Set(callouts.map(c => c.key));
  const guideRows = guideItems.filter(item => !calloutKeys.has(item.key));
  const hasVariant = Boolean(uniprotId || primaryPdbData || customPdbUrl);
  const pocketTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={`w-full ${heightClass === "h-full" ? "h-full min-h-0" : heightClass || "h-[650px]"}`}>
      <div ref={cardRef} className="s3d-viewer" data-testid="structure-viewer">
        <StructureToolbar
          model={model}
          variantPosition={variantPosition}
          selectedResidue={selectedResidue}
          onModeChange={onModeChange}
          onRepresentationChange={(rep: RepresentationId) => useVariantAnalysisStore.getState().setStructureRepresentation(rep)}
          plddtFilter={plddtFilter}
          onPlddtFilterChange={setPlddtFilter}
          onAlignmentScopeChange={onAlignmentScopeChange}
          onFocusSite={handleFocusSite}
          siteCloseUp={siteCloseUp}
          onToggleSiteCloseUp={() => setSiteCloseUp(prev => !prev)}
          onFocusSelection={model.site.canAddressVariantSite && selection.state === "available" && selection.position ? () => structure.focusResidue(selection.position!, "residue") : undefined}
          onResetCamera={structure.resetCamera}
          canResetCamera={Boolean(model.canvas.primary && !plugin.loading && !plugin.loadError)}
          pocketOpen={pocketOpen}
          pocketTriggerRef={pocketTriggerRef}
          onTogglePocket={() => {
            const next = !pocketOpen;
            setPocketOpen(next);
            setShowPocket(next);
          }}
          onDownloadImage={() => plugin.downloadImage(fileStem)}
          onCopyImage={plugin.copyImage}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />

        {warnings.length > 0 && (
          <div className="s3d-banner" role="note">
            <AlertTriangle aria-hidden="true" />
            <div>{warnings.map(warning => <p key={warning.key}><strong>{warning.title}.</strong> {warning.body}</p>)}</div>
          </div>
        )}

        {focusShown && (
          <div className="s3d-banner s3d-banner--note" role="note" data-testid="structure-residue-focus" data-focus-count={focusShown.companions.length}>
            <Info aria-hidden="true" />
            <div><p>{focusShown.label}.</p></div>
            <button type="button" className="s3d-btn s3d-btn--quiet" onClick={() => actions.setSelectedResidueIndex(selection.position)}>Clear highlight</button>
          </div>
        )}

        <div ref={stageRef} className="s3d-stage" data-pocket-open={pocketOpen ? "true" : undefined}>
          <div ref={plugin.containerRef} className="s3d-canvas" id={VIEWER_CONTAINER_ID} />
          {/* One left column, so the canvas guide and the colour key stack instead of overlapping on a short stage. */}
          <div className="s3d-overlay-col">
          <StructureGuideCard
            items={guideRows}
            labels={settings.show3DLabels !== false}
            onToggleLabels={() => setSettings(prev => ({ ...prev, show3DLabels: prev.show3DLabels === false }))}
            labelAll={focusShown && focusShown.companions.length > MAX_LABELLED_COMPANIONS ? { count: focusShown.companions.length, labelled: Math.min(focusShown.companions.length, MAX_LABEL_ALL_COMPANIONS), on: labelAllCompanions } : null}
            onToggleLabelAll={() => setLabelAllCompanions(v => !v)}
            onOpenGuide={() => actions.setIsHowToInspectOpen(true)}
          />
          <StructureLegend legend={model.legend} />
          </div>
          <StructureCallouts
            plugin={plugin.pluginCreated ? plugin.pluginRef.current : null}
            readyVersion={structure.readyVersion}
            anchorOf={structure.anchorOf}
            callouts={callouts}
            rightInset={pocketOpen ? POCKET_INSET : 0}
            leftInset={OVERLAY_COLUMN_WIDTH}
          />
          {pocketOpen && (
            <StructurePocketPanel
              pocket={pocket}
              variantPosition={variantPosition}
              showOnStructure={showPocket}
              canShowOnStructure={canDrawPocketOnCanvas}
              onToggleShow={() => canDrawPocketOnCanvas && setShowPocket(s => !s)}
              onFocusResidue={structure.focusResidue}
              onOpenTab={onOpenPocketTab}
              onRetry={onRetryPocket}
              onClose={() => {
                setPocketOpen(false);
                setShowPocket(false);
                requestAnimationFrame(() => pocketTriggerRef.current?.focus());
              }}
            />
          )}
          <StructureStatusOverlay
            family={model.family}
            hasVariant={hasVariant}
            loading={plugin.loading}
            loadError={plugin.loadError}
            deNovoFolding={isEsmFolding}
            deNovoError={esmFoldingError}
            deNovoLoaded={Boolean(esmFoldWtPdb)}
            proteinLength={proteinLength}
            scanWindowLength={landscapeLength !== null && landscapeLength !== proteinLength ? landscapeLength : null}
            customEntryLoaded={Boolean(customPdbUrl)}
            onSwitchToAlphaFold={onSwitchToAlphaFold}
            onClearEntry={() => actions.setCustomPdbUrl(null)}
            onOpenSettings={() => openSettingsTab("connections")}
            onRetryLoad={() => setReloadNonce(nonce => nonce + 1)}
            onRetryStructural={onRetryStructural}
          />
        </div>
      </div>
    </div>
  );
}

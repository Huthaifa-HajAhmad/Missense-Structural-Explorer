import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore, useVariantAnalysisActions } from "../context/VariantAnalysisContext";
import { useMolstarPlugin } from "./molstar/useMolstarPlugin";
import { useMolstarStructure, type PlddtFilter } from "./molstar/useMolstarStructure";
import { StructureToolbar } from "./molstar/StructureToolbar";
import { StructureLegend } from "./molstar/StructureLegend";
import { StructurePocketPanel } from "./molstar/StructurePocketPanel";
import { StructureStatusOverlay } from "./molstar/StructureStatusOverlay";
import { readProteinLength } from "../shared/foldingLimits";
import { derivePocketNarrative } from "../shared/residueShiftEvidence";
import type { AlignmentScope, RepresentationId, Structure3dEvidence, ViewMode } from "../shared/structure3dEvidence";

export interface MolstarViewerProps {
  /** The 3D evidence model (`useStructure3dEvidence`), built once by the caller. */
  model: Structure3dEvidence;
  /** Coordinates for the primary structure; null lets the viewer load `customPdbUrl` or fetch. */
  primaryPdbData: string | null;
  /** The superposed variant, when the model shows a superposition. */
  comparePdbData: string | null;
  /** Fetch the AlphaFold DB model when no coordinates were supplied (AlphaFold view only). */
  allowFetch: boolean;
  variantPosition: number | null;
  selectedResidue: number | null;
  onResidueClick: (index: number | null) => void;
  onModeChange: (mode: ViewMode) => void;
  onAlignmentScopeChange?: (scope: AlignmentScope) => void;
  onSwitchToAlphaFold?: () => void;
  onSwitchToEsmFold?: () => void;
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
  model,
  primaryPdbData,
  comparePdbData,
  allowFetch,
  variantPosition,
  selectedResidue,
  onResidueClick,
  onModeChange,
  onAlignmentScopeChange,
  onSwitchToAlphaFold,
  onSwitchToEsmFold,
  onOpenPocketTab,
  onRetryPocket,
  onRetryStructural,
  heightClass,
}: MolstarViewerProps) {
  const { theme, settings, showPolarContacts, openSettingsTab } = useSettings();
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

  const isDark = theme !== "light";
  const residueColorHex = parseInt((settings.residueColor || "#C46849").replace("#", ""), 16);

  const [plddtFilter, setPlddtFilter] = useState<PlddtFilter>("none");
  const [pocketOpen, setPocketOpen] = useState(false);
  const [showPocket, setShowPocket] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === cardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (copyState === "idle") return;
    const t = window.setTimeout(() => setCopyState("idle"), 2400);
    return () => window.clearTimeout(t);
  }, [copyState]);

  const plugin = useMolstarPlugin({
    isDark,
    onResidueHover: actions.setHoveredResidueIndex,
    onResidueClick,
  });

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

  const structure = useMolstarStructure({
    pluginRef: plugin.pluginRef,
    pluginCreated: plugin.pluginCreated,
    uniprotId,
    gene,
    primaryPdbData,
    customPdbUrl: customPdbUrl || null,
    comparePdbData,
    allowFetch,
    reloadNonce,
    colour: model.colour,
    plddtFilter: model.plddtFilter.available ? plddtFilter : "none",
    plddtScale: model.plddtFilter.available ? model.plddtFilter.scale : null,
    esm3Scores: model.representation === "esm3" ? esm3Scores : null,
    variantPosition,
    canAddressVariantSite: model.site.canAddressVariantSite,
    selectedResidue,
    showPolarContacts,
    show3DLabels: settings.show3DLabels !== false,
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
    setLoading: plugin.setLoading,
    setLoadError: plugin.setLoadError,
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
          onFocusSite={() => model.site.canAddressVariantSite && variantPosition && structure.focusResidue(variantPosition)}
          onBackToSite={() => onResidueClick(variantPosition)}
          pocketOpen={pocketOpen}
          pocketTriggerRef={pocketTriggerRef}
          onTogglePocket={() => {
            const next = !pocketOpen;
            setPocketOpen(next);
            setShowPocket(next);
          }}
          captureOpen={plugin.captureMenuOpen}
          setCaptureOpen={plugin.setCaptureMenuOpen}
          captureMenuRef={plugin.captureMenuRef}
          onDownload={() => plugin.handleDownloadCapture(fileStem)}
          onCopy={async () => setCopyState((await plugin.handleCopyCapture()) ? "copied" : "failed")}
          copyState={copyState}
          onOpenGuide={() => actions.setIsHowToInspectOpen(true)}
          onSwitchToAlphaFold={onSwitchToAlphaFold}
          onSwitchToEsmFold={onSwitchToEsmFold}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />

        {warnings.length > 0 && (
          <div className="s3d-banner" role="note">
            <AlertTriangle aria-hidden="true" />
            <div>{warnings.map(warning => <p key={warning.key}><strong>{warning.title}.</strong> {warning.body}</p>)}</div>
          </div>
        )}

        <div className="s3d-stage">
          <div ref={plugin.containerRef} className="s3d-canvas" id="molstar-viewer-container" />
          <StructureLegend legend={model.legend} />
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

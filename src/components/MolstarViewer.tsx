import { useState, useRef, useEffect } from "react";
import { useSettings } from "../context/SettingsContext";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore, useVariantAnalysisActions } from "../context/VariantAnalysisContext";
import { MolstarToolbar } from "./molstar/MolstarToolbar";
import { MolstarInfoOverlay } from "./molstar/MolstarInfoOverlay";
import { useMolstarPlugin } from "./molstar/useMolstarPlugin";
import { useMolstarStructure } from "./molstar/useMolstarStructure";
import { useMolstarPocket } from "./molstar/useMolstarPocket";
import { MolstarViewerProps } from "./molstar/molstarThemes";
import { Activity } from "lucide-react";
import { Script } from "molstar/lib/mol-script/script";
import { StructureSelection } from "molstar/lib/mol-model/structure";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";

export type { PocketResidue, PocketResult } from './molstar/molstarThemes';
export {
  CustomPLDDTColorTheme,
  CustomPLDDTColorThemeProvider,
  CustomBFactorColorTheme,
  CustomBFactorColorThemeProvider,
  CustomESM3AllostericColorTheme,
  CustomESM3AllostericColorThemeProvider,
  CustomDisplacementColorTheme,
  CustomDisplacementColorThemeProvider
} from './molstar/molstarThemes';

export default function MolstarViewer({ 
  residueIndex, 
  customPdbData, 
  onResidueClick,
  comparePdbData,
  compareResidueIndex,
  compareVariant,
  disruptionWarning,
  mutantStatus,
  mutantDdG,
  heightClass,
  variant,
  active3dModelTab = "alphafold2",
  onModelTabChange,
  metrics,
  viewMode
}: MolstarViewerProps) {
  const { theme: contextTheme, settings, showPolarContacts: contextShowPolarContacts, setIsSettingsOpen } = useSettings();
  const { fetchWithAuth } = useApiClient();
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const gene = useVariantAnalysisStore(s => s.gene);
  const customPdbUrl = useVariantAnalysisStore(s => s.customPdbUrl);
  const computedPocket = useVariantAnalysisStore(s => s.computedPocket);
  const isPocketLoading = useVariantAnalysisStore(s => s.isPocketLoading);
  const pocketError = useVariantAnalysisStore(s => s.pocketError);
  const pdbId = useVariantAnalysisStore(s => s.analysisState?.result?.metadata?.pdbId);
  const pdbSource = useVariantAnalysisStore(s => s.analysisState?.result?.metadata?.pdbSource);
  const isEsmFolding = useVariantAnalysisStore(s => s.isEsmFolding);
  const esmFoldingError = useVariantAnalysisStore(s => s.esmFoldingError);
  const esmFoldPdb = useVariantAnalysisStore(s => s.esmFoldWtPdb);
  const esm3Eval = useVariantAnalysisStore(s => s.analysisState?.result?.esm3Eval);

  const analysisActions = useVariantAnalysisActions();
  const onResidueHover = analysisActions.setHoveredResidueIndex;
  const onPdbTextLoaded = analysisActions.setPdbText;

  const isDark = contextTheme !== "light";
  const showPolarContacts = contextShowPolarContacts;
  const residueColorHex = parseInt((settings.residueColor || "#F97316").replace("#", ""), 16);
  const cameraDuration = settings.cameraDuration;
  const autoZoomOnSelect = settings.autoZoomOnSelect;
  const show3DLabels = settings.show3DLabels !== undefined ? settings.show3DLabels : true;
  const neonHighContrast = settings.neonHighContrast === true;
  const energyUnit = settings.energyUnit;

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const [isAlertClosed, setIsAlertClosed] = useState<boolean>(false);
  const [alertPosition, setAlertPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const formatDdG = (val: number | null | undefined, unit?: "kcal/mol" | "kJ/mol") => {
    if (val === null || val === undefined) return "";
    if (unit === "kJ/mol") {
      const kj = val * 4.184;
      return `${val.toFixed(2)} kcal/mol [~${kj.toFixed(2)} kJ/mol]`;
    }
    return `${val.toFixed(2)} kcal/mol`;
  };

  // 1. Plugin Lifecycle & Canvas Hook
  const plugin = useMolstarPlugin({
    isDark,
    onResidueHover,
    onResidueClick
  });

  // 2. Pocket Hook
  const pocket = useMolstarPocket();

  // 3. Structure Loading & Representation Hook
  const structure = useMolstarStructure({
    pluginRef: plugin.pluginRef,
    pluginCreated: plugin.pluginCreated,
    uniprotId,
    gene,
    customPdbData,
    customPdbUrl,
    comparePdbData,
    residueIndex: residueIndex ?? null,
    compareResidueIndex: compareResidueIndex ?? null,
    showPolarContacts,
    show3DLabels,
    residueColorHex,
    autoZoomOnSelect,
    cameraDuration,
    neonHighContrast,
    showPocket: pocket.showPocket,
    computedPocket,
    pocketComponentRefRef: pocket.pocketComponentRefRef,
    fetchWithAuth,
    onPdbTextLoaded,
    variant: variant || undefined,
    esmFoldPdb,
    esm3Eval: esm3Eval,
    active3dModelTab,
    viewMode,
    setLoading: plugin.setLoading,
    setLoadError: plugin.setLoadError
  });

  const handleToggleFullscreen = async () => {
    const el = plugin.containerRef.current?.closest('.molstar-viewer-card') as HTMLElement | null
      || plugin.containerRef.current?.parentElement?.parentElement as HTMLElement | null;
    if (!document.fullscreenElement && el) {
      try { await el.requestFullscreen(); setIsFullscreen(true); } catch (e) {}
    } else {
      try { await document.exitFullscreen(); setIsFullscreen(false); } catch (e) {}
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX - alertPosition.x,
      y: e.clientY - alertPosition.y,
    });
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      setAlertPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragStart]);

  const focusOnPocketResidue = (index: number) => {
    const localPlugin = plugin.pluginRef.current;
    const struct = structure.structureRef.current;
    if (!localPlugin || !struct) return;
    try {
      const expression = MS.struct.generator.atomGroups({
        'residue-test': MS.core.rel.eq([
          MS.struct.atomProperty.macromolecular.auth_seq_id(),
          index
        ])
      });
      const selection = Script.getStructureSelection(expression, struct.obj.data);
      const loci = StructureSelection.toLociWithSourceUnits(selection);
      localPlugin.managers.camera.focusLoci(loci, { durationMs: 800 });
    } catch (e) {
      console.warn("Failed to focus pocket residue:", e);
    }
  };

  return (
    <div className={`flex flex-col gap-3 w-full ${heightClass === "h-full" ? "h-full min-h-0" : ""}`}>
      {/* INFO & WARNING OVERLAYS */}
      <MolstarInfoOverlay
        isPocketPanelOpen={pocket.isPocketPanelOpen}
        setIsPocketPanelOpen={pocket.setIsPocketPanelOpen}
        pocketPosition={pocket.pocketPosition}
        handlePocketMouseDown={pocket.handlePocketMouseDown}
        residueIndex={residueIndex ?? null}
        isPocketLoading={isPocketLoading}
        pocketError={pocketError}
        computedPocket={computedPocket}
        showPocket={pocket.showPocket}
        setShowPocket={pocket.setShowPocket}
        disruptionWarning={disruptionWarning || null}
        isAlertClosed={isAlertClosed}
        setIsAlertClosed={setIsAlertClosed}
        alertPosition={alertPosition}
        isDragging={isDragging}
        handleMouseDown={handleMouseDown}
      />

      {/* VIEWER CANVAS CARD */}
      <div className={`molstar-viewer-card relative w-full ${heightClass === "h-full" ? "flex-grow min-h-0" : (heightClass || "h-[650px]")} flex flex-col overflow-hidden transition-all border rounded-xl`} style={{ background: "var(--cs-bg)", borderColor: "var(--cs-border)" }}>

        {/* TOP CONTROL TOOLBAR */}
        <MolstarToolbar
          comparePdbData={comparePdbData || null}
          customPdbData={customPdbData || null}
          mutantStatus={mutantStatus}
          active3dModelTab={active3dModelTab}
          viewMode={viewMode || null}
          activePdbId={structure.activePdbId}
          customPdbUrl={customPdbUrl || null}
          pdbSource={pdbSource || null}
          pdbId={pdbId || null}
          uniprotId={uniprotId || null}
          gene={gene || null}
          residueIndex={residueIndex ?? null}
          focusOnPocketResidue={focusOnPocketResidue}
          viewerStyle={structure.viewerStyle}
          setViewerStyle={structure.setViewerStyle}
          templateSource={structure.templateSource}
          plddtFilter={structure.plddtFilter}
          setPlddtFilter={structure.setPlddtFilter}
          isPocketPanelOpen={pocket.isPocketPanelOpen}
          setIsPocketPanelOpen={pocket.setIsPocketPanelOpen}
          setShowPocket={pocket.setShowPocket}
          captureMenuOpen={plugin.captureMenuOpen}
          setCaptureMenuOpen={plugin.setCaptureMenuOpen}
          captureMenuRef={plugin.captureMenuRef}
          handleDownloadCapture={() => plugin.handleDownloadCapture(gene, uniprotId)}
          handleCopyCapture={plugin.handleCopyCapture}
          isFullscreen={isFullscreen}
          handleToggleFullscreen={handleToggleFullscreen}
        />

        {/* Main Viewport Container */}
        <div className="flex-1 min-h-0 relative w-full h-full">

          {/* ESM3 Unavailable Overlay */}
          {structure.viewerStyle === "esm3-allosteric" && (!esm3Eval || ("error" in esm3Eval)) && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center backdrop-blur-sm" style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)" }}>
              <Activity className="w-10 h-10 mb-3" style={{ color: "var(--cs-text-muted)" }} />
              <p className="font-semibold text-base mb-1" style={{ color: "var(--cs-text-primary)" }}>
                {esm3Eval && "error" in esm3Eval ? "ESM3 Prediction Failed" : "ESM3 Representation Data Unavailable"}
              </p>
              <p className="text-xs max-w-md mb-4 text-center leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
                {esm3Eval && "error" in esm3Eval
                  ? (esm3Eval as any).error
                  : "Allosteric perturbation heatmap requires an active Biohub API token. Configure your Biohub key in Settings to analyze structure-level attention maps."}
              </p>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="px-4 py-1.5 rounded-lg border text-xs font-semibold hover:bg-[var(--cs-surface-2)] cursor-pointer transition-colors shadow-sm"
                style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)", borderColor: "var(--cs-border)" }}
              >
                Configure API Key
              </button>
            </div>
          )}

          {/* ESM3 Active Prediction Loading State */}
          {active3dModelTab === "esm3" && isEsmFolding && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 backdrop-blur-sm" style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)" }}>
              <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin mb-4" style={{ borderColor: "var(--cs-accent)", borderTopColor: "transparent" }}></div>
              <p className="font-mono text-xs font-bold tracking-wider uppercase animate-pulse" style={{ color: "var(--cs-accent)" }}>
                Refining 3D Mutant Structure via ESM3...
              </p>
            </div>
          )}

          {/* Standard Model Loading Overlay */}
          {plugin.loading && !isEsmFolding && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 backdrop-blur-sm" style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)" }}>
              <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin mb-4" style={{ borderColor: "var(--cs-accent)", borderTopColor: "transparent" }}></div>
              <p className="font-mono text-xs font-bold tracking-wider uppercase animate-pulse" style={{ color: "var(--cs-accent)" }}>
                {customPdbData ? "Rendering Mutant Structure..." : "Fetching Structure Coordinates..."}
              </p>
            </div>
          )}

          {/* Structure Load Error Overlay */}
          {(plugin.loadError || (active3dModelTab === "esm3" && !isEsmFolding && !esmFoldPdb && !customPdbData)) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center backdrop-blur-sm" style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)" }}>
              <Activity className="w-10 h-10 mb-3" style={{ color: "var(--cs-text-danger)" }} />
              <p className="font-semibold text-base mb-1" style={{ color: "var(--cs-text-primary)" }}>
                {active3dModelTab === "esm3" ? "ESMFold Structure Unavailable" : "Structure Unavailable"}
              </p>
              <p className="text-xs max-w-md mb-3 leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
                {active3dModelTab === "esm3"
                  ? (esmFoldingError || "The ESMFold de novo structure generation service encountered an error.")
                  : (plugin.loadError || "3D model coordinates generation failed or endpoint is unreachable.")}
              </p>
              {active3dModelTab === "esm3" && (
                <div className="flex flex-col items-center gap-2 mt-2 animate-fade-in">
                  <button
                    type="button"
                    onClick={() => {
                      onModelTabChange?.("alphafold2");
                      analysisActions.setActive3dModelTab("alphafold2");
                    }}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer shadow-sm flex items-center gap-1.5"
                  >
                    <span>Switch to AlphaFold Structure</span>
                  </button>
                  <span className="text-[11px] text-[var(--cs-text-muted)] max-w-xs">
                    AlphaFold DB coordinates and experimental structures remain available for this variant.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Onboarding Welcome Overlay */}
          {!uniprotId && !customPdbData && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-8 text-center" style={{ background: "var(--cs-bg)", color: "var(--cs-text-primary)" }}>
              <h3 className="text-sm font-semibold font-mono uppercase tracking-wider mb-3" style={{ color: "var(--cs-accent)" }}>
                3D Molecular Workspace Ready
              </h3>
              <p className="text-xs max-w-sm mb-6 leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
                Submit a genetic variant search query to load and inspect 3D protein structures.
              </p>
            </div>
          )}

          <div 
            ref={plugin.containerRef} 
            id="molstar-viewer-container" 
            className="w-full h-full text-slate-900 transition-all duration-700 ease-out opacity-100 scale-100 blur-0"
          />
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { MasterView } from "./MasterSidebar";
import VariantSearchPanel from "./VariantSearchPanel";
import EvidenceDashboardCard from "./EvidenceDashboardCard";
import EnergeticsView from "./EnergeticsView";
import SequenceVisualizer from "./SequenceVisualizer";
import ClinicalInsightsCard from "./ClinicalInsightsCard";
import ClinicalReportBar from "./ClinicalReportBar";
import DevConsolePanel from "./DevConsolePanel";
import AboutView from "./AboutView";
import { WorkspaceLayout } from "./ui/WorkspaceLayout";
import { WorkspaceSelection } from "./ui/WorkspaceSelection";
import { WorkspaceTabs } from "./ui/WorkspaceTabs";
import { buildStructureSelection, indexStructureResidues } from "../shared/structureSelection";
import { landscapeKey } from "../shared/landscapeEvidence";
import ViewInspector from "./inspector/ViewInspector";
import { ErrorBoundary } from "./ErrorBoundary";
import LiteratureView from "./LiteratureView";
import type { LiteratureEvidence } from "../shared/literatureEvidence";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { useSettings } from "../context/SettingsContext";
import { useNarrativeResynthesis } from "../hooks/useNarrativeResynthesis";
import { lazyWithRetry } from "../lib/utils";
import { useStructure3dEvidence } from "../lib/useStructure3dEvidence";
import { useReportDraftPersistence } from "./report/useReportDocument";

const MolstarViewerLazy = lazyWithRetry(() => import("./MolstarViewer"), "MolstarViewer");

interface AppViewsProps {
  masterView: MasterView;
  setMasterView: (view: MasterView) => void;
  state?: any;
  actions?: any;
  pushErrorEntry: (entry: any) => void;
  setIsSettingsOpen: (open: boolean) => void;
  activeEvidenceTab: string;
  setActiveEvidenceTab: (tab: string) => void;
  metricMode: "mean" | "max";
  setMetricMode: React.Dispatch<React.SetStateAction<"mean" | "max">>;
  windowSize: number;
  setWindowSize: React.Dispatch<React.SetStateAction<number>>;
  classCardTitle: string;
  classCardHeader: string;
  classInput: string;
  classBorderSec: string;
  classTextBody: string;
  classTextMute: string;
  handleSearchSubmit?: (e: React.FormEvent) => void;
  handleSelectHistoryItem?: (item: any) => void;
  handleCopyReport?: () => Promise<void>;
  formatEnergyString?: (text: string | null | undefined) => string;
  onOpenOnboarding?: () => void;
}

export function AppViews({
  masterView,
  setMasterView,
  state,
  actions,
  pushErrorEntry,
  setIsSettingsOpen,
  onOpenOnboarding,
  activeEvidenceTab,
  setActiveEvidenceTab,
  metricMode,
  setMetricMode,
  windowSize,
  setWindowSize,
  classCardTitle,
  classCardHeader,
  classInput,
  classBorderSec,
  classTextBody,
  classTextMute,
  handleSearchSubmit: propsHandleSearchSubmit,
  handleSelectHistoryItem: propsHandleSelectHistoryItem,
  handleCopyReport: propsHandleCopyReport,
  formatEnergyString: propsFormatEnergyString
}: AppViewsProps) {
  const { isDark: settingsDark, settings: contextSettings } = useSettings();

  // Fine-grained Zustand store subscriptions
  const storeGene = useVariantAnalysisStore(s => s.gene);
  const storeVariant = useVariantAnalysisStore(s => s.variant);
  const storeUniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const storeSelectedResidueIndex = useVariantAnalysisStore(s => s.selectedResidueIndex);
  const storeFoldedResidueIndex = useVariantAnalysisStore(s => s.foldedResidueIndex);
  const storeHoveredResidueIndex = useVariantAnalysisStore(s => s.hoveredResidueIndex);
  const storeViewMode = useVariantAnalysisStore(s => s.viewMode);
  const storeHistory = useVariantAnalysisStore(s => s.history);
  const storeAnalysisState = useVariantAnalysisStore(s => s.analysisState);
  const storeMutantPdb = useVariantAnalysisStore(s => s.mutantPdb);
  const storeFoldingDdG = useVariantAnalysisStore(s => s.foldingDdG);
  const storeFoldingStatus = useVariantAnalysisStore(s => s.foldingStatus);
  const storeFoldingEnergetics = useVariantAnalysisStore(s => s.foldingEnergetics);
  const storeDynamut2Status = useVariantAnalysisStore(s => s.dynamut2Status);
  const storeDdmutStatus = useVariantAnalysisStore(s => s.ddmutStatus);
  const storeThermompnnStatus = useVariantAnalysisStore(s => s.thermompnnStatus);
  const storeThermompnnError = useVariantAnalysisStore(s => s.thermompnnError);
  const storeComputedPocket = useVariantAnalysisStore(s => s.computedPocket);
  const storeIsPocketLoading = useVariantAnalysisStore(s => s.isPocketLoading);
  const storePocketError = useVariantAnalysisStore(s => s.pocketError);
  const storeDisruptionPredictor = useVariantAnalysisStore(s => s.disruptionPredictor);
  const storeIsFolding = useVariantAnalysisStore(s => s.isFolding);
  const storeFoldingProgress = useVariantAnalysisStore(s => s.foldingProgress);
  const storeFoldingError = useVariantAnalysisStore(s => s.foldingError);
  const storeStructuralDiff = useVariantAnalysisStore(s => s.structuralDiff);
  const storeComputedResiduesCache = useVariantAnalysisStore(s => s.computedResiduesCache);
  const storeIsBiophysicalLoading = useVariantAnalysisStore(s => s.isBiophysicalLoading);
  const storeIsClinicalLoading = useVariantAnalysisStore(s => s.isClinicalLoading);
  const storeIsNarrativeLoading = useVariantAnalysisStore(s => s.isNarrativeLoading);
  const storeCopied = useVariantAnalysisStore(s => s.copied);
  const storeLoadingStep = useVariantAnalysisStore(s => s.loadingStep);
  const storeEsmFoldWtPdb = useVariantAnalysisStore(s => s.esmFoldWtPdb);
  const storeEsmFoldMutPdb = useVariantAnalysisStore(s => s.esmFoldMutPdb);
  const storePdbText = useVariantAnalysisStore(s => s.pdbText);
  const storeActive3dModelTab = useVariantAnalysisStore(s => s.active3dModelTab);
  const storeCustomPdbUrl = useVariantAnalysisStore(s => s.customPdbUrl);
  const customPdbEntry = useVariantAnalysisStore(s => s.customPdbEntry);
  const storeFoldxReferencePdb = useVariantAnalysisStore(s => s.foldxReferencePdb);
  const storeFoldxAlignedPdb = useVariantAnalysisStore(s => s.foldxAlignedPdb);
  const storeEsmFoldAlignedPdb = useVariantAnalysisStore(s => s.esmFoldAlignedPdb);
  const storeFoldxMetrics = useVariantAnalysisStore(s => s.foldxMetrics);
  const storeEsmFoldMetrics = useVariantAnalysisStore(s => s.esmFoldMetrics);
  const storeHomologs = useVariantAnalysisStore(s => s.homologs);
  const storeIsHomologsLoading = useVariantAnalysisStore(s => s.isHomologsLoading);

  // Fallbacks for backward compatibility if legacy state object was passed
  const isDark = state?.isDark ?? settingsDark;
  const settings = state?.settings ?? contextSettings;
  const gene = state?.gene ?? storeGene;
  const variant = state?.variant ?? storeVariant;
  const uniprotId = state?.uniprotId ?? storeUniprotId;
  const selectedResidueIndex = state?.selectedResidueIndex ?? storeSelectedResidueIndex;
  // The author's Report draft follows the variant, so papers pinned on the Literature tab are kept.
  useReportDraftPersistence(gene, uniprotId, variant);
  const foldedResidueIndex = state?.foldedResidueIndex ?? storeFoldedResidueIndex;
  const hoveredResidueIndex = state?.hoveredResidueIndex ?? storeHoveredResidueIndex;
  const viewMode = state?.viewMode ?? storeViewMode;
  const history = state?.history ?? storeHistory;
  const analysisState = state?.analysisState ?? storeAnalysisState;
  const mutantPdb = state?.mutantPdb ?? storeMutantPdb;
  const foldingDdG = state?.foldingDdG ?? storeFoldingDdG;
  const foldingStatus = state?.foldingStatus ?? storeFoldingStatus;
  const foldingEnergetics = state?.foldingEnergetics ?? storeFoldingEnergetics;
  const dynamut2Status = state?.dynamut2Status ?? storeDynamut2Status;
  const ddmutStatus = state?.ddmutStatus ?? storeDdmutStatus;
  const thermompnnStatus = state?.thermompnnStatus ?? storeThermompnnStatus;
  const thermompnnError = state?.thermompnnError ?? storeThermompnnError;
  const computedPocket = state?.computedPocket ?? storeComputedPocket;
  const isPocketLoading = state?.isPocketLoading ?? storeIsPocketLoading;
  const pocketError = state?.pocketError ?? storePocketError;
  const disruptionPredictor = state?.disruptionPredictor ?? storeDisruptionPredictor;
  const isFolding = state?.isFolding ?? storeIsFolding;
  const foldingError = state?.foldingError ?? storeFoldingError;
  const structuralDiff = state?.structuralDiff ?? storeStructuralDiff;
  const computedResiduesCache = state?.computedResiduesCache ?? storeComputedResiduesCache;
  const isBiophysicalLoading = state?.isBiophysicalLoading ?? storeIsBiophysicalLoading;
  const isClinicalLoading = state?.isClinicalLoading ?? storeIsClinicalLoading;
  const isNarrativeLoading = state?.isNarrativeLoading ?? storeIsNarrativeLoading;
  const copied = state?.copied ?? storeCopied;
  const loadingStep = state?.loadingStep ?? storeLoadingStep;
  const esmFoldWtPdb = state?.esmFoldWtPdb ?? storeEsmFoldWtPdb;
  const esmFoldMutPdb = state?.esmFoldMutPdb ?? storeEsmFoldMutPdb;
  const pdbText = state?.pdbText ?? storePdbText;
  const active3dModelTab = state?.active3dModelTab ?? storeActive3dModelTab;
  const customPdbUrl = state?.customPdbUrl ?? storeCustomPdbUrl;
  const esmFoldAlignedPdb = storeEsmFoldAlignedPdb ?? state?.esmFoldAlignedPdb;
  const foldxMetrics = storeFoldxMetrics ?? state?.foldxMetrics;
  const esmFoldMetrics = storeEsmFoldMetrics ?? state?.esmFoldMetrics;
  const homologs = state?.homologs ?? storeHomologs;
  const isHomologsLoading = state?.isHomologsLoading ?? storeIsHomologsLoading;

  const setSelectedResidueIndex = actions?.setSelectedResidueIndex ?? useVariantAnalysisStore.getState().setSelectedResidueIndex;
  const setViewMode = actions?.setViewMode ?? useVariantAnalysisStore.getState().setViewMode;
  const clearHistory = actions?.clearHistory ?? useVariantAnalysisStore.getState().clearHistory;
  const setCustomPdbUrl = actions?.setCustomPdbUrl ?? useVariantAnalysisStore.getState().setCustomPdbUrl;

  const handleSelectHistoryItem = propsHandleSelectHistoryItem || actions?.handleSelectHistoryItem;
  const formatEnergyString = propsFormatEnergyString || actions?.formatEnergyString;
  const handleSearchSubmit = propsHandleSearchSubmit || actions?.handleSearchSubmit;
  const handleCopyReport = propsHandleCopyReport || actions?.handleCopyReport;

  const { apiClient } = useApiClient();
  const isStructureActive = masterView === "structure" || masterView === "structure_alphafold" || masterView === "structure_esmfold";

  // Preserve the model family while hidden; navigating to Landscape must not reload the canvas.
  const [lastStructureFamily, setLastStructureFamily] = useState<"alphafold" | "esmfold" | null>(null);
  const activeFamily = masterView === "structure_esmfold" ? "esmfold" : "alphafold";
  if (isStructureActive && lastStructureFamily !== activeFamily) setLastStructureFamily(activeFamily);
  const isEsm = (lastStructureFamily ?? (contextSettings.defaultStructureModel === "esmfold" ? "esmfold" : "alphafold")) === "esmfold";

  /**
   * One 3D model for the canvas and the toolbar. It decides which modes exist and falls back when
   * one is not available; the coordinates below follow `structureModel.viewMode`, not the stored
   * mode, so the canvas can never draw a mode the model has ruled out.
   */
  const structureModel = useStructure3dEvidence(isEsm ? "esmfold" : "alphafold");
  const variantPosition = analysisState.result?.metadata?.residueIndex ?? null;

  useEffect(() => {
    if (isStructureActive && structureModel.viewMode !== viewMode) setViewMode(structureModel.viewMode);
  }, [isStructureActive, structureModel.viewMode, viewMode, setViewMode]);

  /**
   * The coordinates the canvas draws, per family and mode.
   *
   * Replaced a selection that superposed the RAW FoldX variant (`compareMutantPdb || mutantPdb`) on the
   * AlphaFold model — two different templates in two different frames — and drew the ESMFold "mutant"
   * view from the ALIGNED file, whose B column the aligner overwrites with Cα displacement (it was then
   * coloured as pLDDT).
   */
  const canvasData = useMemo(() => {
    const mode = structureModel.viewMode;
    if (isEsm) {
      if (mode === "mutant") return { primary: esmFoldMutPdb || null, compare: null };
      if (mode === "superimposed") return { primary: esmFoldWtPdb || null, compare: esmFoldAlignedPdb || null };
      return { primary: esmFoldWtPdb || null, compare: null };
    }
    if (mode === "mutant") return { primary: mutantPdb || null, compare: null };
    if (mode === "superimposed") return { primary: storeFoldxReferencePdb, compare: storeFoldxAlignedPdb };
    // A loaded entry is drawn once fetched for the URL now selected; until then the viewer fetches it.
    if (customPdbUrl) return { primary: customPdbEntry && customPdbEntry.url === customPdbUrl ? customPdbEntry.text : null, compare: null };
    return { primary: pdbText || null, compare: null };
  }, [isEsm, structureModel.viewMode, esmFoldWtPdb, esmFoldMutPdb, esmFoldAlignedPdb, mutantPdb, storeFoldxReferencePdb, storeFoldxAlignedPdb, customPdbUrl, customPdbEntry, pdbText]);

  const structureResidues = useMemo(() => indexStructureResidues(canvasData.primary), [canvasData.primary]);
  const structureSelection = useMemo(() => buildStructureSelection(structureModel, structureResidues, selectedResidueIndex), [structureModel, structureResidues, selectedResidueIndex]);
  const structureInspectorSelection = useMemo(() => isStructureActive && hoveredResidueIndex
    ? { ...buildStructureSelection(structureModel, structureResidues, hoveredResidueIndex), preview: true }
    : structureSelection, [isStructureActive, hoveredResidueIndex, structureModel, structureResidues, structureSelection]);

  const alignmentRequestIdRef = useRef(0);

  /** ESMFold only: FoldX keeps the template backbone, so its pair has no fit scope to choose. */
  const handleAlignmentScopeChange = useCallback(async (newScope: "local" | "global") => {
    const store = useVariantAnalysisStore.getState();
    if (!isEsm || newScope === store.esmAlignmentScope) return;
    store.setEsmAlignmentScope(newScope);
    const reqId = ++alignmentRequestIdRef.current;
    if (!esmFoldWtPdb || !esmFoldMutPdb || !variantPosition) return;
    try {
      const alignData = await apiClient.structuralAlign({
        pdb1: esmFoldWtPdb,
        pdb2: esmFoldMutPdb,
        targetIndex: variantPosition,
        alignmentScope: newScope
      });
      if (reqId !== alignmentRequestIdRef.current) return;
      if (alignData.alignedPdb) {
        store.setEsmFoldAlignedPdb(alignData.alignedPdb);
        store.setEsmFoldMetrics(alignData.metrics);
      }
    } catch (err) {
      if (reqId === alignmentRequestIdRef.current) {
        console.warn("[Alignment Scope Update Error]:", err);
      }
    }
  }, [isEsm, esmFoldWtPdb, esmFoldMutPdb, variantPosition, apiClient]);

  const [literatureSearchQuery, setLiteratureSearchQuery] = useState("");
  // The Literature view's evidence model — passed to the inspector so its search trace and the
  // citation export describe and serialise exactly what the user sees.
  const [literatureEvidence, setLiteratureEvidence] = useState<LiteratureEvidence | null>(null);
  // Bumped whenever the inspector applies a query: it tells LiteratureView to (re-)execute
  // even when the query text is unchanged, which a plain string prop cannot signal —
  // without this, re-applying after an error was a silent no-op behind a success toast.
  const [literatureSearchVersion, setLiteratureSearchVersion] = useState(0);
  // Stable identity: this is passed through memoised inspector panes, and an inline
  // lambda would defeat their memo on every parent render. The version bump is what
  // lets the inspector re-execute an unchanged query — LiteratureView's effect depends
  // on it, so retry-after-error and repeated applies are never a silent no-op.
  const handleLiteratureSearch = useCallback((q: string) => {
    setLiteratureSearchQuery(q);
    setLiteratureSearchVersion((v) => v + 1);
  }, []);
  const [hasEverMountedStructure, setHasEverMountedStructure] = useState(isStructureActive);

  useEffect(() => {
    if (isStructureActive && !hasEverMountedStructure) {
      setHasEverMountedStructure(true);
    }
  }, [isStructureActive, hasEverMountedStructure]);

  const handleSearchSubmitAndOpen = useCallback((e: React.FormEvent) => {
    handleSearchSubmit(e);
  }, [handleSearchSubmit]);

  const handleSelectHistoryItemMemo = useCallback((item: any) => {
    handleSelectHistoryItem(item);
  }, [handleSelectHistoryItem]);

  const handleOpenSettingsMemo = useCallback(() => {
    setIsSettingsOpen(true);
  }, [setIsSettingsOpen]);

  const createErrorHandler = useCallback((boundaryName: string) => {
    return (error: Error, errorInfo: React.ErrorInfo) => {
      pushErrorEntry({
        level: "error",
        source: "component",
        message: `[ErrorBoundary: ${boundaryName}] ${error.message}`,
        detail: error.stack,
        meta: { componentStack: errorInfo.componentStack },
      });
    };
  }, [pushErrorEntry]);

  const handleEvidenceError = useMemo(() => createErrorHandler("Evidence Dashboard"), [createErrorHandler]);
  const handleEnergeticsError = useMemo(() => createErrorHandler("Energetics View"), [createErrorHandler]);
  const handleStructureError = useMemo(() => createErrorHandler("3D Structure"), [createErrorHandler]);
  const handleInsightsError = useMemo(() => createErrorHandler("Variant Insights"), [createErrorHandler]);
  const handleReportError = useMemo(() => createErrorHandler("Clinical Report"), [createErrorHandler]);
  const handleLiteratureError = useMemo(() => createErrorHandler("Literature View"), [createErrorHandler]);
  const handleConsoleError = useMemo(() => createErrorHandler("Developer Console"), [createErrorHandler]);

  // The queried residue as the pipeline resolved it; the Landscape target never follows the selection.
  const landscapeMetadata = analysisState.result?.metadata;
  const landscapeTarget = useMemo(
    () =>
      landscapeMetadata
        ? { pos: landscapeMetadata.residueIndex ?? null, wt: landscapeMetadata.wildType ?? null, mut: landscapeMetadata.mutant ?? null }
        : null,
    [landscapeMetadata?.residueIndex, landscapeMetadata?.wildType, landscapeMetadata?.mutant]
  );

  /**
   * A click selects a residue; it no longer rewrites `foldedResidueIndex`. That field is the position
   * FoldX mutated, and the superposition reads it: clicking residue 200 in the variant view used to
   * move the "variant site" — and every site measurement — to residue 200.
   */
  const handleResidueClickMemo = useCallback((idx: number | null) => {
    if (!idx) return;
    const store = useVariantAnalysisStore.getState();
    const key = landscapeKey(gene, variant, uniprotId);
    if (store.landscapeSelection?.pos !== idx || store.landscapeSelection.key !== key) {
      store.setLandscapeSelection({ key, kind: "residue", pos: idx });
      store.setSelectedGenomicVariant(null);
    }
    setSelectedResidueIndex(idx);
  }, [setSelectedResidueIndex, gene, variant, uniprotId]);

  /** Returns to the queried substitution: same selection kind the Landscape's own "Query" buttons set. */
  const handleReturnToVariant = useCallback(() => {
    if (!variantPosition) return;
    const store = useVariantAnalysisStore.getState();
    store.setLandscapeSelection({ key: landscapeKey(gene, variant, uniprotId), kind: "substitution", pos: variantPosition, alt: landscapeTarget?.mut || undefined });
    store.setSelectedGenomicVariant(null);
    setSelectedResidueIndex(variantPosition);
  }, [variantPosition, landscapeTarget?.mut, setSelectedResidueIndex, gene, variant, uniprotId]);

  /** The clicked button lives in the pane that is about to be hidden; hand focus to the destination. */
  const navigateWorkspace = (view: MasterView) => {
    useVariantAnalysisStore.getState().setHoveredResidueIndex(null);
    setMasterView(view);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(view === "landscape"
      ? '.landscape-main [role="tab"][aria-selected="true"]' : '[data-workspace-focus="structure"]')?.focus());
  };

  /**
   * Shared by the main Residue Shifts tab and the inspector's pocket narrative:
   * both surfaces offer the same retry, and both must target the same residue,
   * chain and UniProt accession the pipeline already used.
   */
  const handleRetryPocket = useCallback(() => {
    const resIdx = analysisState.result?.metadata?.residueIndex;
    const targetChain = (analysisState.result?.metadata as any)?.chain || "A";
    const targetUniprot = analysisState.result?.metadata?.uniprotId || uniprotId;
    if (resIdx && actions?.fetchPocketInfo) {
      actions.fetchPocketInfo(pdbText, targetChain, resIdx, targetUniprot);
    }
  }, [analysisState.result, uniprotId, actions, pdbText]);

  /**
   * One re-synthesis path for the whole app.
   *
   * The report view used to own the only implementation, so a reader who met a
   * degraded narrative in the Residue Shifts inspector could see that synthesis had
   * failed but had nothing to do about it. Both surfaces now call the same hook.
   */
  const { resynthesize: handleRetryNarrative } = useNarrativeResynthesis();

  return (
    <main className="app-view flex-1 relative overflow-hidden transition-all duration-300">
      <Suspense fallback={
        <div className="flex flex-col items-center justify-center h-full gap-3 bg-slate-950/20">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin border-teal-500" />
          <span className="text-xs font-mono text-slate-400">Loading view...</span>
        </div>
      }>
        <WorkspaceLayout kind={masterView === "landscape" ? "landscape" : isStructureActive ? "structure" : masterView === "report" ? "report" : undefined}>
          <div className="data-screen-primary">
            {/* SEARCH VIEW — high-density structured workspace */}
            {masterView === "search" && (
              <div 
                className="w-full flex flex-col items-center justify-start px-4 sm:px-6 py-6 lg:py-8 overflow-y-auto"
                style={{ background: "var(--cs-bg)", minHeight: "calc(100vh - var(--cs-chrome-height))" }}
              >
                <div className="w-full" style={{ maxWidth: "var(--cs-search-max-width)" }}>
                  <VariantSearchPanel
                    isDark={isDark}
                    classCard="border-0 shadow-none p-0 bg-transparent"
                    classCardHeader="hidden"
                    classCardTitle={classCardTitle}
                    classInput={classInput}
                    classBorderSec={classBorderSec}
                    analysisState={analysisState}
                    handleSearchSubmit={handleSearchSubmitAndOpen}
                    gene={gene}
                    variant={variant}
                    uniprotId={uniprotId}
                    history={history}
                    clearHistory={clearHistory}
                    handleSelectHistoryItem={handleSelectHistoryItemMemo}
                    onViewChange={setMasterView}
                    onOpenOnboarding={onOpenOnboarding}
                  />
                </div>
              </div>
            )}

            {/* EVIDENCE VIEW */}
            {masterView === "evidence" && (
              <ErrorBoundary
                name="Evidence Dashboard"
                onError={handleEvidenceError}
              >
                <EvidenceDashboardCard
                  isDark={isDark}
                  isBiophysicalLoading={isBiophysicalLoading}
                  classCard="h-full flex flex-col border-0 rounded-none shadow-none"
                  classCardHeader={classCardHeader}
                  classCardTitle={classCardTitle}
                  classBorderSec={classBorderSec}
                  classTextBody={classTextBody}
                  classTextMute={classTextMute}
                  analysisState={analysisState}
                  foldingDdG={foldingDdG}
                  foldingStatus={foldingStatus as "failed" | "success" | "unavailable" | null}
                  foldingEnergetics={foldingEnergetics}
                  dynamut2Status={dynamut2Status}
                  ddmutStatus={ddmutStatus}
                  computedPocket={computedPocket}
                  isPocketLoading={isPocketLoading}
                  pocketError={pocketError}
                  disruptionPredictor={disruptionPredictor}
                  isFolding={isFolding}
                  foldingError={foldingError}
                  structuralDiff={structuralDiff}
                  activeTab={activeEvidenceTab}
                  onTabChange={setActiveEvidenceTab}
                  active3dModelTab={active3dModelTab}
                  metrics={active3dModelTab === "esm3" ? esmFoldMetrics : foldxMetrics}
                  onOpenSettings={handleOpenSettingsMemo}
                  onRetryStructural={actions?.retryStructuralAnalysis}
                  onRetryPocket={handleRetryPocket}
                  onSelectResidue={handleResidueClickMemo}
                  onNavigateToView={setMasterView}
                />
              </ErrorBoundary>
            )}

            {/* ENERGETICS VIEW */}
            {masterView === "energetics" && (
              <ErrorBoundary
                name="Energetics View"
                onError={handleEnergeticsError}
              >
                <EnergeticsView
                  isDark={isDark}
                  classCard="h-full flex flex-col border-0 rounded-none shadow-none"
                  classCardHeader={classCardHeader}
                  classCardTitle={classCardTitle}
                  classBorderSec={classBorderSec}
                  classTextBody={classTextBody}
                  classTextMute={classTextMute}
                  analysisState={analysisState}
                  foldingDdG={foldingDdG}
                  foldingStatus={foldingStatus as "failed" | "success" | "unavailable" | null}
                  foldingEnergetics={foldingEnergetics}
                  dynamut2Status={dynamut2Status}
                  ddmutStatus={ddmutStatus}
                  thermompnnStatus={thermompnnStatus}
                  thermompnnError={thermompnnError}
                  disruptionPredictor={disruptionPredictor}
                  isFolding={isFolding}
                  foldingProgress={storeFoldingProgress}
                  foldingError={foldingError}
                />
              </ErrorBoundary>
            )}

            {/* STRUCTURE VIEW — deferred mount on first open, then kept in DOM to preserve Molstar WebGL context */}
            <div
              className="structure-main h-full w-full flex flex-col min-h-0"
              onMouseLeave={() => useVariantAnalysisStore.getState().setHoveredResidueIndex(null)}
              style={{ display: isStructureActive ? "flex" : "none" }}
            >
              <header className="structure-workspace__header">
                <div className="workspace-heading"><h2 tabIndex={-1} data-workspace-focus="structure">3D structure</h2><p>Inspect the selected residue in its structural context.</p></div>
                <WorkspaceSelection position={selectedResidueIndex} variantPosition={variantPosition} destination="Open Landscape"
                  onNavigate={() => navigateWorkspace("landscape")} onReset={handleReturnToVariant} />
                <WorkspaceTabs id="structure-family" label="Structure model" value={isEsm ? "esmfold" : "alphafold"}
                  tabs={[{ id: "alphafold", label: "AlphaFold & FoldX" }, { id: "esmfold", label: "ESMFold" }]}
                  onChange={family => setMasterView(family === "esmfold" ? "structure_esmfold" : "structure_alphafold")} />
              </header>
              <div className="structure-workspace__canvas flex-1 min-h-0 relative" role="tabpanel"
                id={`structure-family-panel-${isEsm ? "esmfold" : "alphafold"}`}
                aria-labelledby={`structure-family-tab-${isEsm ? "esmfold" : "alphafold"}`}>
                {hasEverMountedStructure && (
                  <ErrorBoundary
                    name="3D Structure"
                    onError={handleStructureError}
                  >
                    <Suspense fallback={
                      <div className="flex flex-col items-center justify-center h-full gap-3">
                        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }} />
                        <span className="text-xs font-mono" style={{ color: "var(--cs-text-muted)" }}>Loading 3D Viewer...</span>
                      </div>
                    }>
                      <MolstarViewerLazy
                        model={structureModel}
                        coordinateIndex={structureResidues}
                        selection={structureSelection}
                        active={isStructureActive}
                        primaryPdbData={canvasData.primary}
                        comparePdbData={canvasData.compare}
                        allowFetch={!isEsm && structureModel.viewMode === "wildtype" && !customPdbUrl}
                        variantPosition={variantPosition}
                        selectedResidue={selectedResidueIndex ?? null}
                        onResidueClick={handleResidueClickMemo}
                        onModeChange={setViewMode}
                        onAlignmentScopeChange={handleAlignmentScopeChange}
                        onSwitchToAlphaFold={() => setMasterView("structure_alphafold")}
                        onOpenPocketTab={() => {
                          setActiveEvidenceTab("structure");
                          setMasterView("evidence");
                        }}
                        onRetryPocket={handleRetryPocket}
                        onRetryStructural={actions?.retryStructuralAnalysis}
                        heightClass="h-full"
                      />
                    </Suspense>
                  </ErrorBoundary>
                )}
              </div>
            </div>

            {/* LANDSCAPE VIEW — always mounted to preserve canvas/WebGL state */}
            <div
              className="landscape-main flex flex-col h-full overflow-y-auto w-full"
              style={{ display: masterView === "landscape" ? "flex" : "none" }}
            >
              <div className="landscape-workspace__selection">
                <WorkspaceSelection position={selectedResidueIndex} variantPosition={variantPosition} destination="Inspect in 3D"
                  onNavigate={() => navigateWorkspace(isEsm ? "structure_esmfold" : "structure_alphafold")}
                  onReset={handleReturnToVariant} />
              </div>
              <SequenceVisualizer
                uniprotId={uniprotId}
                gene={gene}
                variant={variant}
                residueIndex={selectedResidueIndex}
                targetResidue={landscapeTarget}
                hoveredResidueIndex={hoveredResidueIndex}
                predictorData={analysisState.result?.predictorData}
                conservationData={analysisState.result?.conservationData}
                landscapeData={analysisState.result?.landscapeData}
                landscapeMeta={analysisState.result?.landscapeMeta}
                uniprotFeatures={analysisState.result?.uniprotFeatures?.features}
                metricMode={metricMode}
                setMetricMode={setMetricMode}
                windowSize={windowSize}
                setWindowSize={setWindowSize}
                onResidueClick={handleResidueClickMemo}
              />
            </div>

            {/*
              INSIGHTS VIEW.

              `onNavigateToView` lets the card's condensed clinical summary send the reader to the
              Report, which owns the full narrative; without it the summary would have to either
              duplicate the narrative or cite a document the reader cannot reach from here.
            */}
            {masterView === "insights" && (
              <ErrorBoundary
                name="Variant Insights"
                onError={handleInsightsError}
              >
                <ClinicalInsightsCard
                  isDark={isDark}
                  classCard="border-0 rounded-none shadow-none"
                  classCardHeader={classCardHeader}
                  classCardTitle={classCardTitle}
                  analysisState={analysisState}
                  handleCopyReport={handleCopyReport}
                  copied={copied}
                  gene={gene}
                  variant={variant}
                  uniprotId={uniprotId}
                  loadingStep={loadingStep}
                  formatEnergyString={formatEnergyString}
                  selectedResidueIndex={selectedResidueIndex}
                  foldingDdG={foldingDdG}
                  settings={settings}
                  classTextBody={classTextBody}
                  classTextMute={classTextMute}
                  classBorderSec={classBorderSec}
                  computedResiduesCache={computedResiduesCache}
                  isBiophysicalLoading={isBiophysicalLoading}
                  isClinicalLoading={isClinicalLoading}
                  isNarrativeLoading={isNarrativeLoading}
                  foldingEnergetics={foldingEnergetics}
                  disruptionPredictor={disruptionPredictor}
                  onNavigateToView={setMasterView}
                  onOpenEvidenceTab={(tab) => {
                    setActiveEvidenceTab(tab);
                    setMasterView("evidence");
                  }}
                />
              </ErrorBoundary>
            )}

            {/* REPORT VIEW */}
            {masterView === "report" && (
              <ErrorBoundary
                name="Clinical Report"
                onError={handleReportError}
              >
                <ClinicalReportBar 
                  analysisState={analysisState} 
                  isDark={isDark} 
                  isNarrativeLoading={isNarrativeLoading}
                  onNavigateToView={setMasterView}
                  onOpenEvidenceTab={(tab) => {
                    setActiveEvidenceTab(tab);
                    setMasterView("evidence");
                  }}
                  fullPage
                />
              </ErrorBoundary>
            )}

            {/* LITERATURE VIEW — always mounted to preserve state and avoid re-fetch on tab switch */}
            <div
              className="h-full w-full flex flex-col min-h-0"
              style={{ display: masterView === "literature" ? "flex" : "none" }}
            >
              <ErrorBoundary
                name="Literature View"
                onError={handleLiteratureError}
              >
                <LiteratureView 
                  gene={gene}
                  variant={variant}
                    uniprotId={uniprotId ?? undefined}
                    verifiedAliases={analysisState.result?.literatureAliases}
                  searchQuery={literatureSearchQuery}
                  onSearchQueryChange={setLiteratureSearchQuery}
                  onEvidenceChange={setLiteratureEvidence}
                  searchVersion={literatureSearchVersion}
                />
              </ErrorBoundary>
            </div>

            {/* DEVELOPER CONSOLE VIEW */}
            {masterView === "console" && (
              <ErrorBoundary
                name="Developer Console"
                onError={handleConsoleError}
              >
                <DevConsolePanel />
              </ErrorBoundary>
            )}

            {/* ABOUT VIEW — static guide page; no inspector rail (like Search & Console) */}
            {masterView === "about" && (
              <ErrorBoundary
                name="About View"
                onError={createErrorHandler("About View")}
              >
                <AboutView onOpenOnboarding={onOpenOnboarding} onNavigateToView={setMasterView} />
              </ErrorBoundary>
            )}
          </div>

          {/* DYNAMIC CONTEXT & PROVENANCE INSPECTOR (HIDDEN ON SEARCH, CONSOLE & ABOUT VIEWS) */}
          {masterView !== "search" && masterView !== "console" && masterView !== "about" && (
            <ViewInspector
              activeView={masterView}
              structureSelection={structureInspectorSelection}
              onViewChange={setMasterView}
              analysisResult={analysisState.result}
              isFolding={isFolding}
              foldingProgress={storeFoldingProgress}
              foldingStatus={foldingStatus as any}
              foldingError={foldingError}
              foldingDdG={foldingDdG}
              foldingEnergetics={foldingEnergetics}
              isBiophysicalLoading={isBiophysicalLoading}
              isClinicalLoading={isClinicalLoading}
              isNarrativeLoading={isNarrativeLoading}
              gene={gene}
              variant={variant}
              uniprotId={uniprotId}
              homologs={homologs}
              isHomologsLoading={isHomologsLoading}
              customPdbUrl={customPdbUrl}
              setCustomPdbUrl={setCustomPdbUrl}
              dynamut2Status={dynamut2Status}
              ddmutStatus={ddmutStatus}
              thermompnnStatus={thermompnnStatus}
              thermompnnError={thermompnnError}
              disruptionPredictor={disruptionPredictor}
              literatureSearchQuery={literatureSearchQuery}
              onLiteratureSearch={handleLiteratureSearch}
              literatureEvidence={literatureEvidence}
              metricMode={metricMode}
              setMetricMode={setMetricMode}
              windowSize={windowSize}
              setWindowSize={setWindowSize}
              viewMode={viewMode}
              setViewMode={setViewMode}
              activeEvidenceTab={activeEvidenceTab}
              onSelectEvidenceTab={setActiveEvidenceTab}
              onSelectResidueIndex={setSelectedResidueIndex}
              metrics={isEsm ? esmFoldMetrics : foldxMetrics}
              active3dModelTab={isEsm ? "esmfold2" : "alphafold2"}
              computedPocket={computedPocket}
              isPocketLoading={isPocketLoading}
              pocketError={pocketError}
              onRetryPocket={handleRetryPocket}
              onRetryNarrative={handleRetryNarrative}
            />
          )}
        </WorkspaceLayout>
      </Suspense>
    </main>
  );
}

export default React.memo(AppViews);

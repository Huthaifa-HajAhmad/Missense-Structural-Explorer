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
import ViewInspector from "./inspector/ViewInspector";
import { ErrorBoundary } from "./ErrorBoundary";
import LiteratureView, { type Citation } from "./LiteratureView";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { useSettings } from "../context/SettingsContext";
import { useNarrativeResynthesis } from "../hooks/useNarrativeResynthesis";
import { lazyWithRetry } from "../lib/utils";

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
  const storeCompareMutantPdb = useVariantAnalysisStore(s => s.compareMutantPdb);
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
  const compareMutantPdb = storeCompareMutantPdb ?? state?.compareMutantPdb;
  const esmFoldAlignedPdb = storeEsmFoldAlignedPdb ?? state?.esmFoldAlignedPdb;
  const foldxMetrics = storeFoldxMetrics ?? state?.foldxMetrics;
  const esmFoldMetrics = storeEsmFoldMetrics ?? state?.esmFoldMetrics;
  const homologs = state?.homologs ?? storeHomologs;
  const isHomologsLoading = state?.isHomologsLoading ?? storeIsHomologsLoading;

  const setSelectedResidueIndex = actions?.setSelectedResidueIndex ?? useVariantAnalysisStore.getState().setSelectedResidueIndex;
  const setFoldedResidueIndex = actions?.setFoldedResidueIndex ?? useVariantAnalysisStore.getState().setFoldedResidueIndex;
  const setViewMode = actions?.setViewMode ?? useVariantAnalysisStore.getState().setViewMode;
  const clearHistory = actions?.clearHistory ?? useVariantAnalysisStore.getState().clearHistory;
  const setCustomPdbUrl = actions?.setCustomPdbUrl ?? useVariantAnalysisStore.getState().setCustomPdbUrl;

  const handleSelectHistoryItem = propsHandleSelectHistoryItem || actions?.handleSelectHistoryItem;
  const formatEnergyString = propsFormatEnergyString || actions?.formatEnergyString;
  const handleSearchSubmit = propsHandleSearchSubmit || actions?.handleSearchSubmit;
  const handleCopyReport = propsHandleCopyReport || actions?.handleCopyReport;

  const { apiClient } = useApiClient();
  const isEsm = masterView === "structure_esmfold";
  const [foldxAlignmentScope, setFoldxAlignmentScope] = useState<"local" | "global">("global");
  const [esmAlignmentScope, setEsmAlignmentScope] = useState<"local" | "global">("local");
  const alignmentScope = isEsm ? esmAlignmentScope : foldxAlignmentScope;

  const alignmentRequestIdRef = useRef(0);

  const resolvedStructureProps = useMemo(() => {
    let customPdbData: string | undefined = undefined;
    let comparePdbData: string | undefined = undefined;
    const metrics = isEsm ? esmFoldMetrics : foldxMetrics;
    const hasMutantModel = isEsm
      ? Boolean(esmFoldMutPdb || esmFoldAlignedPdb)
      : Boolean(mutantPdb || compareMutantPdb);

    if (isEsm) {
      if (viewMode === "wildtype") {
        customPdbData = esmFoldWtPdb || undefined;
        comparePdbData = undefined;
      } else if (viewMode === "mutant") {
        customPdbData = esmFoldAlignedPdb || esmFoldMutPdb || esmFoldWtPdb || undefined;
        comparePdbData = undefined;
      } else if (viewMode === "superimposed") {
        customPdbData = esmFoldWtPdb || undefined;
        comparePdbData = esmFoldAlignedPdb || undefined;
      }
    } else {
      // AlphaFold2 / FoldX
      if (viewMode === "wildtype") {
        customPdbData = customPdbUrl ? undefined : (pdbText || undefined);
        comparePdbData = undefined;
      } else if (viewMode === "mutant") {
        customPdbData = mutantPdb || undefined;
        comparePdbData = undefined;
      } else if (viewMode === "superimposed") {
        customPdbData = customPdbUrl ? undefined : (pdbText || undefined);
        comparePdbData = compareMutantPdb || mutantPdb || undefined;
      }
    }

    const residueIndex = (viewMode === "mutant" || viewMode === "superimposed")
      ? (foldedResidueIndex || selectedResidueIndex)
      : selectedResidueIndex;

    return {
      customPdbData,
      comparePdbData,
      hasMutantModel,
      metrics: (viewMode === "superimposed" || viewMode === "mutant") ? metrics : undefined,
      residueIndex,
      active3dModelTab: isEsm ? ("esmfold2" as const) : ("alphafold2" as const)
    };
  }, [
    isEsm,
    viewMode,
    esmFoldWtPdb,
    esmFoldMutPdb,
    esmFoldAlignedPdb,
    esmFoldMetrics,
    pdbText,
    mutantPdb,
    compareMutantPdb,
    foldxMetrics,
    customPdbUrl,
    selectedResidueIndex,
    foldedResidueIndex
  ]);

  const handleAlignmentScopeChange = useCallback(async (newScope: "local" | "global") => {
    if (newScope === alignmentScope) return;
    if (isEsm) {
      setEsmAlignmentScope(newScope);
    } else {
      setFoldxAlignmentScope(newScope);
    }
    const reqId = ++alignmentRequestIdRef.current;
    if (isEsm && esmFoldWtPdb && esmFoldMutPdb) {
      const mutPdbToAlign = esmFoldMutPdb;
      const posMatch = variant?.match(/\d+/);
      const pos = analysisState.result?.metadata?.residueIndex || foldedResidueIndex || selectedResidueIndex || (posMatch ? parseInt(posMatch[0], 10) : 1);
      try {
        const alignData = await apiClient.structuralAlign({
          pdb1: esmFoldWtPdb,
          pdb2: mutPdbToAlign,
          targetIndex: pos,
          alignmentScope: newScope
        });
        if (reqId !== alignmentRequestIdRef.current) return;
        if (alignData.alignedPdb) {
          useVariantAnalysisStore.getState().setEsmFoldAlignedPdb(alignData.alignedPdb);
          useVariantAnalysisStore.getState().setEsmFoldMetrics(alignData.metrics);
        }
      } catch (err) {
        if (reqId === alignmentRequestIdRef.current) {
          console.warn("[Alignment Scope Update Error]:", err);
        }
      }
    } else if (!isEsm && pdbText && mutantPdb) {
      const posMatch = variant?.match(/\d+/);
      const variantPos = posMatch ? parseInt(posMatch[0], 10) : 1;
      const pos = analysisState.result?.metadata?.residueIndex || foldedResidueIndex || selectedResidueIndex || variantPos;
      try {
        const alignData = await apiClient.structuralAlign({
          pdb1: pdbText,
          pdb2: mutantPdb,
          targetIndex: pos,
          alignmentScope: newScope
        });
        if (reqId !== alignmentRequestIdRef.current) return;
        if (alignData.alignedPdb) {
          useVariantAnalysisStore.getState().setCompareMutantPdb(alignData.alignedPdb);
          useVariantAnalysisStore.getState().setFoldxMetrics(alignData.metrics);
        }
      } catch (err) {
        if (reqId === alignmentRequestIdRef.current) {
          console.warn("[FoldX Alignment Scope Update Error]:", err);
        }
      }
    }
  }, [alignmentScope, isEsm, esmFoldWtPdb, esmFoldMutPdb, pdbText, mutantPdb, foldedResidueIndex, selectedResidueIndex, variant, apiClient]);

  const [literatureSearchQuery, setLiteratureSearchQuery] = useState("");
  // Citations currently shown by the Literature view — passed to the inspector so the
  // citation export serializes exactly what the user sees.
  const [literatureCitations, setLiteratureCitations] = useState<Citation[]>([]);
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
  const isStructureActive = masterView === "structure" || masterView === "structure_alphafold" || masterView === "structure_esmfold";
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

  const handleResidueClickMemo = useCallback((idx: number | null) => {
    if (!idx) return;
    setSelectedResidueIndex(idx);
    if (viewMode === "mutant" || viewMode === "superimposed") {
      setFoldedResidueIndex(idx);
    }
  }, [viewMode, setFoldedResidueIndex, setSelectedResidueIndex]);

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
        <div className="data-screen-layout">
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
              className="h-full w-full flex flex-col min-h-0"
              style={{ display: isStructureActive ? "flex" : "none" }}
            >
              <div className="flex-1 min-h-0 relative">
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
                        residueIndex={resolvedStructureProps.residueIndex}
                        onResidueClick={handleResidueClickMemo}
                        variant={variant}
                        heightClass="h-full"
                        active3dModelTab={resolvedStructureProps.active3dModelTab}
                        onModelTabChange={(tab) => setMasterView(tab === "esm3" || tab === "esmfold2" ? "structure_esmfold" : "structure_alphafold")}
                        viewMode={viewMode}
                        customPdbData={resolvedStructureProps.customPdbData}
                        comparePdbData={resolvedStructureProps.comparePdbData}
                        alignmentScope={alignmentScope}
                        onAlignmentScopeChange={handleAlignmentScopeChange}
                        mutantStatus={viewMode === "mutant" ? (foldingStatus as any) : undefined}
                        mutantDdG={viewMode === "mutant" ? (foldingDdG as any) : undefined}
                        metrics={resolvedStructureProps.metrics}
                      />
                    </Suspense>
                  </ErrorBoundary>
                )}
              </div>
            </div>

            {/* LANDSCAPE VIEW — always mounted to preserve canvas/WebGL state */}
            <div
              className="flex flex-col h-full overflow-y-auto w-full"
              style={{ display: masterView === "landscape" ? "flex" : "none", background: "var(--cs-bg)" }}
            >
              <SequenceVisualizer
                uniprotId={uniprotId}
                gene={gene}
                variant={variant}
                residueIndex={viewMode === "mutant" ? foldedResidueIndex : selectedResidueIndex}
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
                  searchQuery={literatureSearchQuery}
                  onSearchQueryChange={setLiteratureSearchQuery}
                  onDisplayedCitationsChange={setLiteratureCitations}
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
                <AboutView onOpenOnboarding={onOpenOnboarding} />
              </ErrorBoundary>
            )}
          </div>

          {/* DYNAMIC CONTEXT & PROVENANCE INSPECTOR (HIDDEN ON SEARCH, CONSOLE & ABOUT VIEWS) */}
          {masterView !== "search" && masterView !== "console" && masterView !== "about" && (
            <ViewInspector
              activeView={masterView}
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
              literatureCitations={literatureCitations}
              metricMode={metricMode}
              setMetricMode={setMetricMode}
              windowSize={windowSize}
              setWindowSize={setWindowSize}
              viewMode={viewMode}
              setViewMode={setViewMode}
              activeEvidenceTab={activeEvidenceTab}
              onSelectEvidenceTab={setActiveEvidenceTab}
              onSelectResidueIndex={setSelectedResidueIndex}
              metrics={resolvedStructureProps.metrics}
              comparePdbData={resolvedStructureProps.comparePdbData}
              hasMutantModel={resolvedStructureProps.hasMutantModel}
              active3dModelTab={resolvedStructureProps.active3dModelTab}
              computedPocket={computedPocket}
              isPocketLoading={isPocketLoading}
              pocketError={pocketError}
              onRetryPocket={handleRetryPocket}
              onRetryNarrative={handleRetryNarrative}
            />
          )}
        </div>
      </Suspense>
    </main>
  );
}

export default React.memo(AppViews);

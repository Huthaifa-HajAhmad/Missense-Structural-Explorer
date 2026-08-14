import React, { lazy, Suspense } from "react";
import { MasterView } from "./MasterSidebar";
import VariantSearchPanel from "./VariantSearchPanel";
import EvidenceDashboardCard from "./EvidenceDashboardCard";
import EnergeticsView from "./EnergeticsView";
import SequenceVisualizer from "./SequenceVisualizer";
import ClinicalInsightsCard from "./ClinicalInsightsCard";
import ClinicalReportBar from "./ClinicalReportBar";
import DevConsolePanel from "./DevConsolePanel";
import ContextRail from "./ContextRail";
import { ErrorBoundary } from "./ErrorBoundary";
import LiteratureView from "./LiteratureView";

const MolstarViewerLazy = lazy(() => import("./MolstarViewer"));

interface AppViewsProps {
  masterView: MasterView;
  setMasterView: (view: MasterView) => void;
  state: any;
  actions: any;
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
}

export function AppViews({
  masterView,
  setMasterView,
  state,
  actions,
  pushErrorEntry,
  setIsSettingsOpen,
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
  classTextMute
}: AppViewsProps) {
  const {
    isDark,
    gene,
    variant,
    uniprotId,
    selectedResidueIndex,
    foldedResidueIndex,
    viewMode,
    history,
    customGene,
    customVariant,
    customUniprot,
    customGenomic,
    analysisState,
    mutantPdb,
    foldingDdG,
    foldingStatus,
    foldingEnergetics,
    dynamut2Status,
    ddmutStatus,
    thermompnnStatus,
    thermompnnError,
    computedPocket,
    isPocketLoading,
    pocketError,
    disruptionPredictor,
    isFolding,
    foldingError,
    structuralDiff,
    hoveredResidueIndex,
    computedResiduesCache,
    isBiophysicalLoading,
    isClinicalLoading,
    isNarrativeLoading,
    copied,
    loadingStep,
    settings,
    esmFoldWtPdb,
    esmFoldAlignedPdb,
    pdbText,
    esmFoldMetrics,
    foldxMetrics,
    active3dModelTab
  } = state;

  const {
    setSelectedResidueIndex,
    setFoldedResidueIndex,
    setViewMode,
    setCustomGene,
    setCustomVariant,
    setCustomUniprot,
    setCustomGenomic,
    clearHistory,
    handleSelectHistoryItem,
    formatEnergyString,
    handleSearchSubmit,
    handleCopyReport
  } = actions;

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
                    customGene={customGene}
                    setCustomGene={setCustomGene}
                    customVariant={customVariant}
                    setCustomVariant={setCustomVariant}
                    customUniprot={customUniprot}
                    setCustomUniprot={setCustomUniprot}
                    customGenomic={customGenomic}
                    setCustomGenomic={setCustomGenomic}
                    analysisState={analysisState}
                    handleSearchSubmit={(e) => {
                      setMasterView("insights");
                      handleSearchSubmit(e);
                    }}
                    gene={gene}
                    variant={variant}
                    uniprotId={uniprotId}
                    history={history}
                    clearHistory={clearHistory}
                    handleSelectHistoryItem={(item) => {
                      handleSelectHistoryItem(item);
                    }}
                    onViewChange={setMasterView}
                  />
                </div>
              </div>
            )}

            {/* EVIDENCE VIEW */}
            {masterView === "evidence" && (
              <ErrorBoundary
                name="Evidence Dashboard"
                onError={(error, errorInfo) => pushErrorEntry({
                  level: "error",
                  source: "component",
                  message: `[ErrorBoundary: Evidence Dashboard] ${error.message}`,
                  detail: error.stack,
                  meta: { componentStack: errorInfo.componentStack },
                })}
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
                  foldingStatus={foldingStatus as "failed" | "success" | null}
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
                  onOpenSettings={() => setIsSettingsOpen(true)}
                />
              </ErrorBoundary>
            )}

            {/* ENERGETICS VIEW */}
            {masterView === "energetics" && (
              <ErrorBoundary
                name="Energetics View"
                onError={(error, errorInfo) => pushErrorEntry({
                  level: "error",
                  source: "component",
                  message: `[ErrorBoundary: Energetics View] ${error.message}`,
                  detail: error.stack,
                  meta: { componentStack: errorInfo.componentStack },
                })}
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
                  foldingStatus={foldingStatus as "failed" | "success" | null}
                  foldingEnergetics={foldingEnergetics}
                  dynamut2Status={dynamut2Status}
                  ddmutStatus={ddmutStatus}
                  thermompnnStatus={thermompnnStatus}
                  thermompnnError={thermompnnError}
                  disruptionPredictor={disruptionPredictor}
                  isFolding={isFolding}
                  foldingError={foldingError}
                />
              </ErrorBoundary>
            )}

            {/* STRUCTURE VIEW — always mounted to preserve Molstar WebGL context */}
            <div
              className="h-full w-full flex flex-col min-h-0"
              style={{ display: (masterView === "structure" || masterView === "structure_alphafold" || masterView === "structure_esmfold") ? "flex" : "none" }}
            >
              <div className="flex-1 min-h-0 relative">
                <ErrorBoundary
                  name="3D Structure"
                  onError={(error, errorInfo) => pushErrorEntry({
                    level: "error",
                    source: "component",
                    message: `[ErrorBoundary: 3D Structure] ${error.message}`,
                    detail: error.stack,
                    meta: { componentStack: errorInfo.componentStack },
                  })}
                >
                  <Suspense fallback={
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                      <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }} />
                      <span className="text-xs font-mono" style={{ color: "var(--cs-text-muted)" }}>Loading 3D Viewer...</span>
                    </div>
                  }>
                    <MolstarViewerLazy
                      residueIndex={viewMode === "mutant" ? foldedResidueIndex : selectedResidueIndex}
                      variant={variant}
                      heightClass="h-full"
                      active3dModelTab={masterView === "structure_esmfold" ? "esm3" : "alphafold2"}
                      customPdbData={masterView === "structure_esmfold" ? (esmFoldWtPdb || undefined) : (pdbText || undefined)}
                      comparePdbData={masterView === "structure_esmfold" ? (esmFoldAlignedPdb || undefined) : (viewMode === "mutant" ? (mutantPdb || undefined) : undefined)}
                      mutantStatus={viewMode === "mutant" ? (foldingStatus as any) : undefined}
                      mutantDdG={viewMode === "mutant" ? (foldingDdG as any) : undefined}
                      metrics={masterView === "structure_esmfold" ? esmFoldMetrics : (viewMode === "mutant" ? foldxMetrics : undefined)}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </div>

            {/* LANDSCAPE VIEW — always mounted to preserve canvas/WebGL state */}
            <div
              className="flex flex-col h-full overflow-y-auto w-full"
              style={{ display: masterView === "landscape" ? "flex" : "none", background: "var(--cs-bg)" }}
            >
              <SequenceVisualizer
                uniprotId={uniprotId}
                variant={variant}
                residueIndex={viewMode === "mutant" ? foldedResidueIndex : selectedResidueIndex}
                hoveredResidueIndex={hoveredResidueIndex}
                gene={gene}
                predictorData={analysisState.result?.predictorData}
                conservationData={analysisState.result?.conservationData}
                landscapeData={analysisState.result?.landscapeData}
                computedResiduesCache={computedResiduesCache}
                disruptionPredictor={disruptionPredictor}
                uniprotFeatures={analysisState.result?.uniprotFeatures?.features || undefined}
                metricMode={metricMode}
                windowSize={windowSize}
                onResidueClick={(idx) => {
                  if (viewMode === "mutant") setFoldedResidueIndex(idx);
                  else setSelectedResidueIndex(idx);
                }}
              />
            </div>

            {/* INSIGHTS VIEW */}
            {masterView === "insights" && (
              <ErrorBoundary
                name="Variant Insights"
                onError={(error, errorInfo) => pushErrorEntry({
                  level: "error",
                  source: "component",
                  message: `[ErrorBoundary: Variant Insights] ${error.message}`,
                  detail: error.stack,
                  meta: { componentStack: errorInfo.componentStack },
                })}
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
                />
              </ErrorBoundary>
            )}

            {/* REPORT VIEW */}
            {masterView === "report" && (
              <ErrorBoundary
                name="Clinical Report"
                onError={(error, errorInfo) => pushErrorEntry({
                  level: "error",
                  source: "component",
                  message: `[ErrorBoundary: Clinical Report] ${error.message}`,
                  detail: error.stack,
                  meta: { componentStack: errorInfo.componentStack },
                })}
              >
                <ClinicalReportBar analysisState={analysisState} isDark={isDark} fullPage />
              </ErrorBoundary>
            )}

            {/* LITERATURE VIEW — always mounted to preserve state and avoid re-fetch on tab switch */}
            <div
              className="h-full w-full flex flex-col min-h-0"
              style={{ display: masterView === "literature" ? "flex" : "none" }}
            >
              <ErrorBoundary
                name="Literature View"
                onError={(error, errorInfo) => pushErrorEntry({
                  level: "error",
                  source: "component",
                  message: `[ErrorBoundary: Literature View] ${error.message}`,
                  detail: error.stack,
                  meta: { componentStack: errorInfo.componentStack },
                })}
              >
                <LiteratureView gene={gene} variant={variant} uniprotId={uniprotId} />
              </ErrorBoundary>
            </div>

            {/* DEVELOPER CONSOLE VIEW */}
            {masterView === "console" && (
              <ErrorBoundary
                name="Developer Console"
                onError={(error, errorInfo) => pushErrorEntry({
                  level: "error",
                  source: "component",
                  message: `[ErrorBoundary: Developer Console] ${error.message}`,
                  detail: error.stack,
                  meta: { componentStack: errorInfo.componentStack },
                })}
              >
                <DevConsolePanel />
              </ErrorBoundary>
            )}
          </div>

          {/* CONTEXT RAIL FOR MODELING & SYNTHESIS VIEWS (HIDDEN ON SEARCH & CONSOLE VIEWS) */}
          {masterView !== "search" && masterView !== "console" && (
            <ContextRail
              activeView={masterView}
              onViewChange={setMasterView}
              analysisResult={analysisState.result}
              isFolding={isFolding}
              isBiophysicalLoading={isBiophysicalLoading}
              isClinicalLoading={isClinicalLoading}
              isNarrativeLoading={isNarrativeLoading}
              gene={gene}
              variant={variant}
              homologs={state.homologs}
              isHomologsLoading={state.isHomologsLoading}
              customPdbUrl={state.customPdbUrl}
              setCustomPdbUrl={actions.setCustomPdbUrl}
              isLoadingSearch={analysisState.isLoading}
              loadingStep={state.loadingStep}
              isPocketLoading={isPocketLoading}
              dynamut2Status={dynamut2Status}
              ddmutStatus={ddmutStatus}
              metricMode={metricMode}
              setMetricMode={setMetricMode}
              windowSize={windowSize}
              setWindowSize={setWindowSize}
              viewMode={viewMode}
              setViewMode={setViewMode}
              foldingStatus={foldingStatus as any}
              foldingDdG={foldingDdG}
            />
          )}
        </div>
      </Suspense>
    </main>
  );
}

export default React.memo(AppViews);

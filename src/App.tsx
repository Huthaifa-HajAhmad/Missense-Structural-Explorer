import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { 
  Dna, 
  Search, 
  Sparkles, 
  Database, 
  RotateCcw, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  Copy, 
  ExternalLink, 
  ShieldAlert, 
  Lightbulb, 
  Layers, 
  Compass, 
  Activity,
  BookOpen,
  MapPin,
  Atom,
  ChevronDown,
  ChevronUp,
  Settings,
  History,
  Trash2,
  Sun,
  Moon,
  Info,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import useVariantAnalysis from "./useVariantAnalysis";
import { VARIANT_PRESETS } from "./data";
import MasterSidebar, { MasterView } from "./components/MasterSidebar";
import { QueryStrip } from "./components/QueryStrip";
import VariantHeader from "./components/VariantHeader";
import VariantSearchPanel from "./components/VariantSearchPanel";
import EvidenceDashboardCard from "./components/EvidenceDashboardCard";
import EnergeticsView from "./components/EnergeticsView";
import SequenceVisualizer from "./components/SequenceVisualizer";
import ClinicalInsightsCard from "./components/ClinicalInsightsCard";
import ClinicalReportBar from "./components/ClinicalReportBar";
import ContextRail from "./components/ContextRail";
import SettingsModal from "./components/SettingsModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { VariantAnalysisProvider } from "./context/VariantAnalysisContext";

const MolstarViewerLazy = lazy(() => import("./components/MolstarViewer"));

export default function App() {
  const { state, actions } = useVariantAnalysis();
  const [masterView, setMasterView] = useState<MasterView>("search");
  const [activeEvidenceTab, setActiveEvidenceTab] = useState<string>("clinical");
  const [isLowDisruptionWarningCollapsed, setIsLowDisruptionWarningCollapsed] = useState<boolean>(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const val = localStorage.getItem("cs-sidebar-width");
    return val ? parseInt(val, 10) : 220;
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("cs-sidebar-collapsed") === "true";
  });
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);

  // Auto-navigate to Evidence view when analysis completes
  const prevIsLoadingRef = useRef(state.analysisState.isLoading);
  useEffect(() => {
    if (prevIsLoadingRef.current && !state.analysisState.isLoading && state.analysisState.result) {
      if (masterView === "search") {
        setMasterView("evidence");
        setActiveEvidenceTab("clinical");
      }
    }
    prevIsLoadingRef.current = state.analysisState.isLoading;
  }, [state.analysisState.isLoading, state.analysisState.result, masterView]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const [isHowToInspectOpen, setIsHowToInspectOpen] = useState(false);
  const [isLegendOpen, setIsLegendOpen] = useState(false);

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
    analysisState,
    foldingDdG,
    foldingStatus,
    foldingEnergetics,
    dynamut2Status,
    ddmutStatus,
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
    copied,
    loadingStep,
    settings,
    showPolarContacts
  } = state;

  const {
    setSelectedResidueIndex,
    setFoldedResidueIndex,
    setViewMode,
    toggleTheme,
    setIsSettingsOpen,
    setCustomGene,
    setCustomVariant,
    setCustomUniprot,
    setHistory,
    addToHistory,
    clearHistory,
    handleSelectHistoryItem,
    updateSetting,
    resetSettingsToDefault,
    formatEnergyString,
    handleSelectPreset,
    executeAnalysis,
    fetchMutantFold,
    fetchCompareMutantFold,
    handleSearchSubmit,
    handleCopyReport,
    fetchNearestResidues,
    resetViewerState,
    setPdbText,
    setShowPolarContacts
  } = actions;

  // Theme-adaptive typography & card styling tokens
  const classRoot = isDark ? "bg-[#1B1917] text-[#FAF9F6] dark" : "bg-[#F5F2EB] text-[#1A1523]";
  const classCardHeader = isDark ? "border-[#322F2A]" : "border-[#ECEAE4]";
  const classCardTitle = isDark ? "text-[#FAF9F6]" : "text-[#1A1523]";
  const classInput = isDark
    ? "bg-[#201E1B] border-[#3C3934] text-[#FAF9F6] focus:border-[#C46849]"
    : "bg-white border-[#DDD6ED] text-[#1A1523] focus:border-[#C46849]";
  const classBorderSec = isDark ? "border-[#322F2A]" : "border-[#ECEAE4]";
  const classTextBody = isDark ? "text-[#B2ABA0]" : "text-[#666055]";
  const classTextMute = isDark ? "text-[#827B70]" : "text-[#8E82A0]";

  return (
    <VariantAnalysisProvider value={{ state, actions }}>
      <div className={`app-shell font-sans select-none antialiased transition-colors duration-200 ${classRoot}`}>

      {/* ── Resizable and Collapsible Master Sidebar ── */}
      <MasterSidebar
        activeView={masterView}
        onViewChange={setMasterView}
        isDark={isDark}
        toggleTheme={toggleTheme}
        onOpenSettings={() => setIsSettingsOpen(true)}
        sidebarWidth={sidebarWidth}
        setSidebarWidth={setSidebarWidth}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        activeEvidenceTab={activeEvidenceTab}
        onEvidenceTabChange={setActiveEvidenceTab}
        analysisResult={analysisState.result}
        isFolding={isFolding}
        isBiophysicalLoading={isBiophysicalLoading}
        isClinicalLoading={isClinicalLoading}
      />

      {/* ── App Main Viewport ── */}
      <div className="app-main flex flex-col flex-1 relative overflow-hidden">

        {/* ── Slim Header Bar (chrome strip — shared seam with sidebar brand block) ── */}
        <header className="app-header" id="main-header">
          {/* Breadcrumb label — muted, hidden on search (no loaded variant yet) */}
          {masterView !== "search" && (
            <span
              className="text-[11px] font-medium uppercase tracking-widest flex-shrink-0"
              style={{ color: "var(--cs-text-muted)", letterSpacing: "0.08em" }}
            >
              {masterView === "evidence"   ? "Evidence" :
               masterView === "structure"  ? "3D Structure" :
               masterView === "energetics" ? "Energetics" :
               masterView === "landscape"  ? "Landscape" :
               masterView === "insights"   ? "Insights" :
               masterView === "report"     ? "Report" : ""}
            </span>
          )}

          {/* Divider (only when breadcrumb visible) */}
          {masterView !== "search" && (
            <div style={{ width: 1, height: 16, background: "var(--cs-border)", flexShrink: 0 }} />
          )}

          {/* Right-side system status */}
          <div className="ml-auto flex items-center gap-2">
            {isBiophysicalLoading && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1.5"
                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-muted)" }}
              >
                <span className="cs-spinner cs-spinner-sm" />
                Computing…
              </span>
            )}
            {isOffline && (
              <span className="text-[10px] font-mono font-medium shrink-0"
                style={{ color: "var(--cs-warn)" }}
              >
                OFFLINE
              </span>
            )}
          </div>
        </header>

        {/* ── Global Variant Header (content area, below chrome strip) ── */}
        {gene && masterView !== "search" && (
          <VariantHeader
            gene={gene}
            variant={variant}
            uniprotId={uniprotId}
            analysisResult={analysisState.result}
          />
        )}

        {analysisState.error && (
          <div className="mx-4 mt-2 p-3 rounded-xl border flex items-start gap-3 bg-rose-500/10 border-rose-500/20 text-rose-200 flex-shrink-0 z-10">
            <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold text-xs uppercase tracking-wider block mb-0.5">Analysis Warning</span>
              <p className="text-xs leading-relaxed text-rose-300">{analysisState.error}</p>
            </div>
            <button onClick={() => actions.setAnalysisState((prev: any) => ({ ...prev, error: null }))}
              className="text-rose-400 hover:text-rose-200 text-xs font-bold px-1 transition-colors cursor-pointer">✕</button>
          </div>
        )}

        {/* ── Primary viewport (single active view with unified ContextRail) ── */}
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
                        analysisState={analysisState}
                        handleSearchSubmit={(e) => {
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
                  <ErrorBoundary name="Evidence Dashboard">
                    <EvidenceDashboardCard
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
                      computedPocket={computedPocket}
                      isPocketLoading={isPocketLoading}
                      pocketError={pocketError}
                      disruptionPredictor={disruptionPredictor}
                      isFolding={isFolding}
                      foldingError={foldingError}
                      structuralDiff={structuralDiff}
                      activeTab={activeEvidenceTab}
                      onTabChange={setActiveEvidenceTab}
                    />
                  </ErrorBoundary>
                )}

                {/* ENERGETICS VIEW */}
                {masterView === "energetics" && (
                  <ErrorBoundary name="Energetics View">
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
                      disruptionPredictor={disruptionPredictor}
                      isFolding={isFolding}
                      foldingError={foldingError}
                      structuralDiff={structuralDiff}
                    />
                  </ErrorBoundary>
                )}

                {/* STRUCTURE VIEW — always mounted to preserve Molstar WebGL context */}
                <div
                  className="h-full w-full"
                  style={{ display: masterView === "structure" ? "block" : "none" }}
                >
                  <ErrorBoundary name="3D Structure">
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
                      />
                    </Suspense>
                  </ErrorBoundary>
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
                    onResidueClick={(idx) => {
                      if (viewMode === "mutant") setFoldedResidueIndex(idx);
                      else setSelectedResidueIndex(idx);
                    }}
                  />
                </div>

                {/* INSIGHTS VIEW */}
                {masterView === "insights" && (
                  <ErrorBoundary name="Variant Insights">
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
                      foldingEnergetics={foldingEnergetics}
                      disruptionPredictor={disruptionPredictor}
                    />
                  </ErrorBoundary>
                )}

                {/* REPORT VIEW */}
                {masterView === "report" && (
                  <ErrorBoundary name="Clinical Report">
                    <ClinicalReportBar analysisState={analysisState} isDark={isDark} fullPage />
                  </ErrorBoundary>
                )}
              </div>

              {/* CONTEXT RAIL FOR MODELING & SYNTHESIS VIEWS (HIDDEN ON SEARCH VIEW TO AVOID REDUNDANCY) */}
              {masterView !== "search" && (
                <ContextRail
                  activeView={masterView}
                  onViewChange={setMasterView}
                  analysisResult={analysisState.result}
                  isFolding={isFolding}
                  isBiophysicalLoading={isBiophysicalLoading}
                  isClinicalLoading={isClinicalLoading}
                  gene={gene}
                  variant={variant}
                  homologs={state.homologs}
                  isHomologsLoading={state.isHomologsLoading}
                  customPdbUrl={state.customPdbUrl}
                  setCustomPdbUrl={actions.setCustomPdbUrl}
                  isLoadingSearch={analysisState.isLoading}
                  loadingStep={state.loadingStep}
                />
              )}
            </div>
          </Suspense>
        </main>


        {/* Footer info (28px height) */}
        <footer className={`border-t px-5 py-1.5 flex items-center justify-between flex-shrink-0 text-[9px] transition-colors z-20 ${
          isDark ? "bg-[#201E1B] border-[#322F2A] text-[#827B70]" : "bg-white border-[#DDD6ED] text-[#8E82A0]"
        }`}>
          <span>For research only. Not for diagnostic use. No PHI. &copy; 2026</span>
          <span className="font-mono">Powered by Gemini Flash</span>
        </footer>

      {/* Settings Panel Slide-out Modal */}
      <SettingsModal />

      {/* How to Inspect Modal Popup */}
      <AnimatePresence>
        {isHowToInspectOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm"
              onClick={() => setIsHowToInspectOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className={`relative max-w-md w-full rounded-2xl border shadow-xl p-6 transition-colors z-10 ${
                isDark ? "bg-[#261E35] border-[#362B4A] text-slate-100" : "bg-white border-[#DDD6ED] text-slate-900"
              }`}
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#C46849]" />
                  How to inspect missense mutations
                </h3>
                <button
                  type="button"
                  onClick={() => setIsHowToInspectOpen(false)}
                  className="text-slate-500 hover:text-slate-400 focus:outline-none cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-4 space-y-4 text-xs select-none">
                <ul className={`space-y-3.5 pl-4 list-disc marker:text-[#C46849] ${isDark ? "text-[#B2ABA0]" : "text-[#666055]"}`}>
                  <li>
                    Analyze residue <strong className="font-mono text-[#C46849]">#{selectedResidueIndex || "408"}</strong> inside the rendered 3D fold. Use right-click or scroll-wheel to zoom.
                  </li>
                  <li>
                    Determine structural state context: outer alpha-helices, beta-sheet strands, or loops.
                  </li>
                  <li>
                    Check for steric clashes or broken hydrogen bonds resulting from substitution size/charge differentials.
                  </li>
                  <li>
                    Compare structures by toggling between <strong className="font-semibold text-slate-950 dark:text-slate-100">Wild-Type</strong> and simulated <strong className="text-[#D946AA] font-semibold">Mutant</strong> views.
                  </li>
                </ul>
                <div className={`p-3 rounded-lg border ${isDark ? "border-[#322F2A] bg-[#201E1B]/40" : "border-[#ECEAE4] bg-[#FAF9F6]"}`}>
                  <p className="text-[11px] italic text-slate-500">
                    "{VARIANT_PRESETS.find(p => p.gene === gene)?.description || "Inspect chemical/geometric substitutions inside protein chain constructs."}"
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Structural Legend & Controls Modal Popup */}
      <AnimatePresence>
        {isLegendOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm"
              onClick={() => setIsLegendOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className={`relative max-w-lg w-full rounded-2xl border shadow-xl p-6 transition-colors z-10 ${
                isDark ? "bg-[#261E35] border-[#362B4A] text-slate-100" : "bg-white border-[#DDD6ED] text-slate-900"
              }`}
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#C46849]" />
                  Structural Legend & Controls
                </h3>
                <button
                  type="button"
                  onClick={() => setIsLegendOpen(false)}
                  className="text-slate-500 hover:text-slate-400 focus:outline-none cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-4 space-y-4 text-xs select-none">
                
                {/* Interactive analytical toggle */}
                <div className={`p-3 rounded-lg border transition-colors ${
                  isDark ? "bg-[#201E1B] border-[#322F2A]" : "bg-[#FAF9F6] border-[#ECEAE4]"
                }`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showPolarContacts}
                      onChange={(e) => setShowPolarContacts(e.target.checked)}
                      className="w-4 h-4 rounded cursor-pointer accent-[#C46849] focus:ring-[#C46849]/30"
                    />
                    <div className="flex-1">
                      <span className="font-bold block text-[11px] uppercase tracking-wide font-mono">Show Polar Contacts</span>
                      <span className="text-[10px] block mt-0.5 leading-tight text-slate-500">
                        Dynamically calculate and visualize hydrogen bonds formed by target residue {selectedResidueIndex ?? ""}.
                      </span>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Left Sub-legend */}
                  <div className="space-y-4">
                    {/* Highlight Key */}
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-slate-500">
                        Mutation Site Highlight
                      </p>
                      <div className={`space-y-1 p-2 rounded-lg border ${isDark ? "bg-[#201E1B] border-[#322F2A]" : "bg-white border-[#E5E1DC] shadow-sm"}`}>
                        <div className="flex items-start gap-1.5">
                          <span className="w-3 h-3 rounded bg-[#C46849] shrink-0 flex items-center justify-center mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                          </span>
                          <div>
                            <span className="font-semibold block font-mono text-[9px] text-[#C46849]">
                              Clay Sidechain
                            </span>
                            <span className="text-[9px] leading-snug block text-slate-500">
                              Residue #{selectedResidueIndex ?? "N/A"} rendered in sunset clay to reveal orientation.
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Pocket Atoms elements */}
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-slate-500">
                        Atomic Elements (CPK)
                      </p>
                      <div className={`grid grid-cols-2 gap-1.5 p-2 rounded-lg border text-[9px] font-mono ${
                        isDark ? "bg-[#201E1B] border-[#322F2A] text-slate-400" : "bg-[#FAF9F6] border-[#ECEAE4] text-slate-600"
                      }`}>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 rounded-full h-2 bg-neutral-400 shrink-0"></span>
                          <span>Carbon (C)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 rounded-full h-2 bg-rose-500 shrink-0"></span>
                          <span>Oxygen (O)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 rounded-full h-2 bg-blue-500 shrink-0"></span>
                          <span>Nitrogen (N)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 rounded-full h-2 bg-yellow-500 shrink-0"></span>
                          <span>Sulfur (S)</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Sub-legend */}
                  <div className="space-y-4">
                    {/* Contacts Map */}
                    {showPolarContacts && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-slate-500">
                          Interactive Contacts
                        </p>
                        <div className={`space-y-1 p-2 rounded-lg border text-[9px] font-mono ${
                          isDark ? "bg-[#201E1B] border-[#322F2A] text-slate-400" : "bg-white border-[#E5E1DC] text-slate-600 shadow-sm"
                        }`}>
                          <div className="flex items-center gap-1.5">
                            <span className="w-4 h-0.5 border-t border-dashed border-sky-400 shrink-0"></span>
                            <span className={isDark ? "text-sky-300" : "text-sky-600 font-bold"}>H-Bonds / Polar</span>
                          </div>
                          <p className="text-[8px] leading-tight text-slate-500">
                            Cyan dashed vectors computed by Molstar. Identifies pocket residues with broken polarity.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* pLDDT Score heat key */}
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-slate-500">
                        AlphaFold pLDDT Confidence
                      </p>
                      <div className={`p-2 rounded-lg border space-y-1.5 ${
                        isDark ? "bg-[#201E1B] border-[#322F2A]" : "bg-white border-[#E5E1DC] shadow-sm"
                      }`}>
                        <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-orange-500 via-yellow-400 to-indigo-600"></div>
                        <div className="flex items-center justify-between text-[8px] text-slate-500 font-mono">
                          <span>Low (&lt;50)</span>
                          <span>High (&gt;90)</span>
                        </div>
                        {viewMode !== "wildtype" && (
                          <div className={`text-[8.5px] leading-normal pt-1.5 border-t ${
                            isDark ? "border-[#322F2A] text-slate-500" : "border-[#ECEAE4] text-slate-500"
                          }`}>
                            <span className="font-semibold text-amber-500">⚠ Inherited pLDDT:</span> Color confidence is inherited from the wild-type template.
                          </div>
                        )}
                      </div>
                    </div>

                    {viewMode !== "wildtype" && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-slate-500">
                          Scaffold Status
                        </p>
                        <div className={`p-2 rounded-lg border text-[9px] leading-relaxed ${
                          isDark ? "bg-[#201E1B] border-[#322F2A] text-slate-400" : "bg-white border-[#E5E1DC] text-slate-600 shadow-sm"
                        }`}>
                          {foldingStatus === "success"
                            ? "Computed via FoldX biophysical modeling. Geometries represent atomic force-field alignments."
                            : "Structure coordinates represent wild-type backbone."}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {state.notifications?.map((notif: any) => (
          <div
            key={notif.id}
            className={`pointer-events-auto p-3.5 rounded-xl shadow-xl border flex items-start gap-3 transition-all duration-300 transform translate-y-0 scale-100 animate-slide-in backdrop-blur-md ${
              state.isDark
                ? "bg-slate-900/90 border-slate-805 text-white"
                : "bg-white/95 border-slate-200 text-slate-900"
            }`}
          >
            {notif.type === "success" && (
              <span className="text-emerald-500 text-sm mt-0.5 font-bold">✓</span>
            )}
            {notif.type === "error" && (
              <span className="text-rose-500 text-sm mt-0.5">⚠️</span>
            )}
            {notif.type === "info" && (
              <span className="text-blue-500 text-sm mt-0.5">ℹ️</span>
            )}
            <div className="flex-1">
              <p className="text-[9px] leading-none font-extrabold tracking-wider uppercase opacity-45 mb-1 font-mono">
                {notif.type === "success" ? "Analysis Ready" : notif.type === "error" ? "Notification Error" : "System Update"}
              </p>
              <p className="text-[11px] leading-normal font-medium">{notif.message}</p>
            </div>
            <button
              onClick={() => actions.removeNotification(notif.id)}
              className="text-slate-400 hover:text-slate-200 text-xs px-1 mt-0.5 font-bold transition-colors"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      </div>{/* end app-main */}
    </div>{/* end app-shell */}
  </VariantAnalysisProvider>
  );
}
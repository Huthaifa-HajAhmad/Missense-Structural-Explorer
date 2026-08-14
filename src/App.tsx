import React, { useState, useMemo } from "react";
import { ShieldAlert } from "lucide-react";
import useVariantAnalysis from "./useVariantAnalysis";
import { useApiClient } from "./apiClient";
import MasterSidebar, { MasterView } from "./components/MasterSidebar";
import HeaderBar from "./components/HeaderBar";
import VariantHeader from "./components/VariantHeader";
import AppViews from "./components/AppViews";
import { QueryStrip } from "./components/QueryStrip";
import SettingsModal from "./components/SettingsModal";
import HowToInspectModal from "./components/modals/HowToInspectModal";
import StructuralLegendModal from "./components/modals/StructuralLegendModal";
import NotificationToastContainer from "./components/NotificationToastContainer";
import { VariantAnalysisProvider } from "./context/VariantAnalysisContext";
import { useDevConsole } from "./context/DevConsoleContext";
import { useAppEffects } from "./hooks/useAppEffects";

export default function App() {
  const { state, actions } = useVariantAnalysis();
  const { fetchWithAuth } = useApiClient();
  const { state: consoleState, dispatch: consoleDispatch, pushErrorEntry } = useDevConsole();

  const {
    isDark,
    gene,
    variant,
    uniprotId,
    selectedResidueIndex,
    analysisState,
    isBiophysicalLoading,
    isClinicalLoading,
    isPocketLoading,
    isFolding,
    dynamut2Status,
    ddmutStatus,
    foldingStatus,
    showPolarContacts
  } = state;

  const {
    toggleTheme,
    setIsSettingsOpen,
    removeNotification,
    setShowPolarContacts
  } = actions;

  const [masterView, setMasterView] = useState<MasterView>("search");
  const [metricMode, setMetricMode] = useState<"mean" | "max">("max");
  const [windowSize, setWindowSize] = useState<number>(31);
  const [activeEvidenceTab, setActiveEvidenceTab] = useState<string>("clinical");
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const val = localStorage.getItem("cs-sidebar-width");
    return val ? parseInt(val, 10) : 220;
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("cs-sidebar-collapsed") === "true";
  });
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [isHowToInspectOpen, setIsHowToInspectOpen] = useState(false);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Application side-effects hook
  useAppEffects({
    state,
    actions,
    masterView,
    setMasterView,
    setActiveEvidenceTab,
    setIsOffline,
    fetchWithAuth,
    consoleDispatch
  });

  // Theme-adaptive typography & card styling tokens (L-9: use CSS variable-backed Tailwind utility classes instead of hardcoded hex values)
  const classRoot = "bg-cs-bg text-cs-text-primary" + (isDark ? " dark" : "");
  const classCardHeader = "border-cs-border-subtle";
  const classCardTitle = "text-cs-text-primary";
  const classInput = "bg-cs-surface-2 border-cs-border text-cs-text-primary focus:border-cs-accent-clay";
  const classBorderSec = "border-cs-border-subtle";
  const classTextBody = "text-cs-text-secondary";
  const classTextMute = "text-cs-text-muted";

  const handleSearchSubmitAndOpen = (event: React.FormEvent) => {
    setMasterView("insights");
    actions.handleSearchSubmit(event);
  };

  return (
    <VariantAnalysisProvider state={state} actions={actions}>
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
          isPocketLoading={isPocketLoading}
          dynamut2Status={dynamut2Status}
          ddmutStatus={ddmutStatus}
          isLoadingSearch={analysisState.isLoading}
          loadingStep={state.loadingStep}
          unreadConsoleCount={consoleState.errorState.unreadCount}
        />

        {/* ── App Main Viewport ── */}
        <div className="app-main flex flex-col flex-1 relative overflow-hidden">

          {/* ── Slim Header Bar ── */}
          <HeaderBar
            masterView={masterView}
            isBiophysicalLoading={isBiophysicalLoading}
            isOffline={isOffline}
            isSearchOpen={isSearchOpen}
            setIsSearchOpen={setIsSearchOpen}
          />

          {/* ── Quick Search Dropdown ── */}
          <QueryStrip
            isDark={isDark}
            isOpen={isSearchOpen}
            onClose={() => setIsSearchOpen(false)}
            customGene={state.customGene}
            setCustomGene={actions.setCustomGene}
            customVariant={state.customVariant}
            setCustomVariant={actions.setCustomVariant}
            customUniprot={state.customUniprot}
            setCustomUniprot={actions.setCustomUniprot}
            customGenomic={state.customGenomic}
            setCustomGenomic={actions.setCustomGenomic}
            analysisState={state.analysisState}
            handleSearchSubmit={handleSearchSubmitAndOpen}
            gene={state.gene}
            variant={state.variant}
            history={state.history}
            clearHistory={actions.clearHistory}
            handleSelectHistoryItem={actions.handleSelectHistoryItem}
          />

          {/* ── Global Variant Header ── */}
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
              <button
                onClick={() => actions.setAnalysisState((prev: any) => ({ ...prev, error: null }))}
                className="text-rose-400 hover:text-rose-200 text-xs font-bold px-1 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* ── Primary Viewport Screen Router ── */}
          <AppViews
            masterView={masterView}
            setMasterView={setMasterView}
            state={state}
            actions={actions}
            pushErrorEntry={pushErrorEntry}
            setIsSettingsOpen={setIsSettingsOpen}
            activeEvidenceTab={activeEvidenceTab}
            setActiveEvidenceTab={setActiveEvidenceTab}
            metricMode={metricMode}
            setMetricMode={setMetricMode}
            windowSize={windowSize}
            setWindowSize={setWindowSize}
            classCardTitle={classCardTitle}
            classCardHeader={classCardHeader}
            classInput={classInput}
            classBorderSec={classBorderSec}
            classTextBody={classTextBody}
            classTextMute={classTextMute}
          />

          {/* Footer info (28px height) */}
          <footer className="border-t px-5 py-1.5 flex items-center justify-between flex-shrink-0 text-[9px] transition-colors z-20 bg-cs-surface-2 border-cs-border-subtle text-cs-text-muted">
            <span>For research only. Not for diagnostic use. No PHI. &copy; 2026</span>
            <span className="font-mono">Powered by Gemini Flash</span>
          </footer>

          {/* Settings Panel Slide-out Modal */}
          <SettingsModal />

          {/* How to Inspect Modal Popup */}
          <HowToInspectModal
            isOpen={isHowToInspectOpen}
            onClose={() => setIsHowToInspectOpen(false)}
            isDark={isDark}
            selectedResidueIndex={selectedResidueIndex}
            gene={gene}
          />

          {/* Structural Legend & Controls Modal Popup */}
          <StructuralLegendModal
            isOpen={isLegendOpen}
            onClose={() => setIsLegendOpen(false)}
            isDark={isDark}
            showPolarContacts={showPolarContacts}
            setShowPolarContacts={setShowPolarContacts}
            selectedResidueIndex={selectedResidueIndex}
            viewMode={state.viewMode}
            foldingStatus={foldingStatus as string | null}
          />

          {/* Floating Notifications Toast Container */}
          <NotificationToastContainer
            notifications={state.notifications}
            isDark={isDark}
            onRemoveNotification={removeNotification}
          />

        </div>{/* end app-main */}
      </div>{/* end app-shell */}
    </VariantAnalysisProvider>
  );
}
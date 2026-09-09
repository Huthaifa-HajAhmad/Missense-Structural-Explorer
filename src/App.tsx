import React, { useState, useMemo } from "react";
import { MotionConfig } from "motion/react";
import { ShieldAlert } from "lucide-react";
import useVariantAnalysis from "./useVariantAnalysis";
import { useApiClient } from "./apiClient";
import { useSettings } from "./context/SettingsContext";
import MasterSidebar, { MasterView } from "./components/MasterSidebar";
import HeaderBar from "./components/HeaderBar";
import VariantHeader from "./components/VariantHeader";
import AppViews from "./components/AppViews";
import { QueryStrip } from "./components/QueryStrip";
import SettingsDrawer from "./components/settings/SettingsDrawer";
import HowToInspectModal from "./components/modals/HowToInspectModal";
import StructuralLegendModal from "./components/modals/StructuralLegendModal";
import NotificationToastContainer from "./components/NotificationToastContainer";
import { VariantAnalysisProvider, useVariantAnalysisStore } from "./context/VariantAnalysisContext";
import { useDevConsole } from "./context/DevConsoleContext";
import { useAppEffects } from "./hooks/useAppEffects";

export default function App() {
  const { state, actions } = useVariantAnalysis();
  const { fetchWithAuth } = useApiClient();
  const { state: consoleState, dispatch: consoleDispatch, pushErrorEntry } = useDevConsole();
  const {
    settings,
    isDark,
    toggleTheme,
    setIsSettingsOpen,
    showPolarContacts,
    setShowPolarContacts
  } = useSettings();

  // Fine-grained Zustand selectors for the App shell to isolate root tree from rapid sub-state changes
  const gene = useVariantAnalysisStore(s => s.gene);
  const variant = useVariantAnalysisStore(s => s.variant);
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const selectedResidueIndex = useVariantAnalysisStore(s => s.selectedResidueIndex);
  const analysisState = useVariantAnalysisStore(s => s.analysisState);
  const isBiophysicalLoading = useVariantAnalysisStore(s => s.isBiophysicalLoading);
  const isClinicalLoading = useVariantAnalysisStore(s => s.isClinicalLoading);
  const isNarrativeLoading = useVariantAnalysisStore(s => s.isNarrativeLoading);
  const isPocketLoading = useVariantAnalysisStore(s => s.isPocketLoading);
  const isFolding = useVariantAnalysisStore(s => s.isFolding);
  const dynamut2Status = useVariantAnalysisStore(s => s.dynamut2Status);
  const ddmutStatus = useVariantAnalysisStore(s => s.ddmutStatus);
  const foldingStatus = useVariantAnalysisStore(s => s.foldingStatus);
  const loadingStep = useVariantAnalysisStore(s => s.loadingStep);
  const notifications = useVariantAnalysisStore(s => s.notifications);
  const viewMode = useVariantAnalysisStore(s => s.viewMode);

  const { removeNotification } = actions;

  const [masterView, setMasterView] = useState<MasterView>("search");
  const [metricMode, setMetricMode] = useState<"mean" | "max">("mean");
  const [windowSize, setWindowSize] = useState<number>(() => settings.seqScrollStep || 31);
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

  return (
    <MotionConfig reducedMotion={settings.reducedMotion ? "always" : "user"}>
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
          isNarrativeLoading={isNarrativeLoading}
          isPocketLoading={isPocketLoading}
          dynamut2Status={dynamut2Status}
          ddmutStatus={ddmutStatus}
          isLoadingSearch={analysisState.isLoading}
          loadingStep={loadingStep}
          unreadConsoleCount={consoleState.errorState.unreadCount}
        />

        {/* ── App Main Viewport ── */}
        <div className="app-main flex flex-col flex-1 relative overflow-hidden">

          {/* ── Slim Header Bar with integrated alerts ── */}
          <HeaderBar
            masterView={masterView}
            isBiophysicalLoading={isBiophysicalLoading}
            isOffline={isOffline}
            isSearchOpen={isSearchOpen}
            setIsSearchOpen={setIsSearchOpen}
            error={analysisState.error}
            onDismissError={() => actions.setAnalysisState((prev: any) => ({ ...prev, error: null }))}
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
            handleSearchSubmit={actions.handleSearchSubmit}
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
            <span className="font-mono">Missense Structural Explorer · v1.0.0-dev</span>
          </footer>

          {/* Settings Drawer Slide-over */}
          <SettingsDrawer />

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
            viewMode={viewMode}
            foldingStatus={foldingStatus as string | null}
          />

          {/* Floating Notifications Toast Container */}
          <NotificationToastContainer
            notifications={notifications}
            isDark={isDark}
            onRemoveNotification={removeNotification}
          />

        </div>{/* end app-main */}
      </div>{/* end app-shell */}
      </VariantAnalysisProvider>
    </MotionConfig>
  );
}
import { useSidebarShortcut } from "./hooks/useSidebarShortcut";
import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { MotionConfig } from "motion/react";
import { ShieldAlert } from "lucide-react";
import useVariantAnalysis from "./useVariantAnalysis";
import { useApiClient } from "./apiClient";
import { useSettings, type SettingsTabId } from "./context/SettingsContext";
import MasterSidebar, { MasterView, clampSidebarWidth } from "./components/MasterSidebar";
import HeaderBar from "./components/HeaderBar";
import VariantHeader from "./components/VariantHeader";
import AppViews from "./components/AppViews";
import SettingsDrawer from "./components/settings/SettingsDrawer";
import CommandPalette from "./components/CommandPalette";
import { normalizeEvidenceTab } from "./components/evidence/types";
import HowToInspectModal from "./components/modals/HowToInspectModal";
import OnboardingModal, { hasCompletedOnboarding, type OnboardingPreset } from "./components/modals/OnboardingModal";
import NotificationToastContainer from "./components/NotificationToastContainer";
import { VariantAnalysisProvider, useVariantAnalysisStore } from "./context/VariantAnalysisContext";
import { useDevConsole } from "./context/DevConsoleContext";
import { useAppEffects } from "./hooks/useAppEffects";
import { useVariantUrlSync } from "./hooks/useVariantUrlSync";
import { useStaleDataNotice } from "./hooks/useStaleDataNotice";
import { invalidateCachedVariant } from "./services/pipeline/variantCache";

export default function App() {
  const { actions } = useVariantAnalysis();
  const { fetchWithAuth } = useApiClient();
  const { state: consoleState, dispatch: consoleDispatch, pushErrorEntry } = useDevConsole();
  const {
    settings,
    isDark,
    toggleTheme,
    isSettingsOpen,
    setIsSettingsOpen,
    openSettingsTab
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
  const foldingPhase = useVariantAnalysisStore(s => s.foldingProgress?.phase ?? null);
  const dynamut2Status = useVariantAnalysisStore(s => s.dynamut2Status);
  const ddmutStatus = useVariantAnalysisStore(s => s.ddmutStatus);
  const loadingStep = useVariantAnalysisStore(s => s.loadingStep);
  const notifications = useVariantAnalysisStore(s => s.notifications);

  const { removeNotification } = actions;

  /**
   * Re-run requests. Any surface can ask (`requestRerun()` — the Population card, the header's
   * run-state slot); App owns the pipeline, so it answers. The stored bundle is dropped first: the
   * reader is asking because the stored answer is incomplete, and restoring it would be no re-run.
   * The submission is replayed as it was made (`SearchHistoryItem.query`).
   */
  const rerunNonce = useVariantAnalysisStore(s => s.rerunNonce);
  useEffect(() => {
    if (rerunNonce === 0) return;
    const { gene: g, variant: v, uniprotId: u, history, analysisState: st } = useVariantAnalysisStore.getState();
    if (!g || !v) return;
    const prior = history.find(h => h.gene === g && (h.variant === v || h.query === v));
    for (const key of new Set([v, prior?.variant, st.result?.metadata?.variant].filter(Boolean) as string[])) {
      invalidateCachedVariant(g, key);
    }
    actions.handleSelectHistoryItem({
      gene: g,
      variant: prior?.variant ?? v,
      uniprotId: u,
      ...(prior?.query ? { query: prior.query } : {}),
    });
    // Keyed on the request alone: re-running must not be re-triggered by the run it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerunNonce]);

  const [masterView, setMasterView] = useState<MasterView>("search");
  const [metricMode, setMetricMode] = useState<"mean" | "max">("mean");
  const [windowSize, setWindowSize] = useState<number>(() => settings.seqScrollStep || 31);
  const [activeEvidenceTab, setActiveEvidenceTabRaw] = useState<string>("clinical");
  const setActiveEvidenceTab = useCallback((tab: string) => setActiveEvidenceTabRaw(normalizeEvidenceTab(tab)), []);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    /* Corrupt `cs-sidebar-width` entries used to parse to NaN and flow straight
       into the aside's inline style. clampSidebarWidth sends NaN (and any value
       outside the drag range) back to a legal width. */
    try {
      return clampSidebarWidth(parseInt(localStorage.getItem("cs-sidebar-width") ?? "", 10));
    } catch {
      return clampSidebarWidth(NaN);
    }
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("cs-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const isHowToInspectOpen = useVariantAnalysisStore(s => s.isHowToInspectOpen);
  const setIsHowToInspectOpen = useVariantAnalysisStore(s => s.setIsHowToInspectOpen);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  /* The variant chrome — identity in the top bar, context strip under it — appears on every
     analysis view. Not on Search (the page's own form names the variant) or About (app-level chrome,
     where a leftover variant would read as if the guide were about it). */
  const showVariantChrome = Boolean(gene) && masterView !== "search" && masterView !== "about";

  /* First visit: offer the tour once the shell has settled. Only on Search — a shared link that
     opens straight into a result view should show that result, not be pulled away from it. */
  const masterViewRef = useRef(masterView);
  masterViewRef.current = masterView;
  /* Nor over Settings: a reader who arrives with the drawer already open (the first admin lands on
     Team to invite people) is in the middle of a task; the tour stays available from the header. */
  const settingsOpenRef = useRef(isSettingsOpen);
  settingsOpenRef.current = isSettingsOpen;
  useEffect(() => {
    if (hasCompletedOnboarding()) return;
    const timer = window.setTimeout(() => {
      if (masterViewRef.current === "search" && !settingsOpenRef.current) setIsOnboardingOpen(true);
    }, 450);
    return () => window.clearTimeout(timer);
  }, []);

  /* Narrow-viewport drawer mode: below 900px the fixed-width rail + inspector +
     content cannot coexist, so the rail overlays as a drawer (MasterSidebar reads
     isDrawerMode to force the expanded layout and hide the resize handle). */
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState<boolean>(
    () => window.matchMedia("(max-width: 899px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    const onChange = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* Every sidebar-or-app navigation funnels here so the drawer dismisses itself
     after a selection — on desktop the state flip is a harmless no-op. */
  const navigate = useCallback(
    (view: MasterView) => {
      setMasterView(view);
      setIsNavDrawerOpen(false);
    },
    []
  );

  /* The tour's stops all live on the Search page, so every entry point (header, palette, About,
     the Search page itself) lands there first. */
  const openTour = useCallback(() => {
    navigate("search");
    setIsOnboardingOpen(true);
  }, [navigate]);

  const handleSelectOnboardingPreset = useCallback(
    (preset: OnboardingPreset) => {
      actions.setGene(preset.gene);
      actions.setVariant(preset.variant);
      actions.setUniprotId(preset.uniprotId);
      actions.setCustomGene(preset.gene);
      actions.setCustomVariant(preset.variant);
      actions.setCustomUniprot(preset.uniprotId);
      actions.setCustomGenomic("");
      navigate("search");
      actions.handleSearchSubmit({ preventDefault: () => {} } as React.FormEvent);
    },
    [actions, navigate]
  );

  /* One toggle for the sidebar button, the palette action and Ctrl/⌘B. On narrow viewports the
     rail is a drawer, so the same intent opens or closes the drawer instead of flipping the
     desktop preference behind the user's back. */
  const toggleSidebar = useCallback(() => {
    if (isNarrowViewport) {
      setIsNavDrawerOpen((open) => !open);
      return;
    }
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("cs-sidebar-collapsed", String(next));
      } catch {
        /* persistence is best-effort */
      }
      return next;
    });
  }, [isNarrowViewport]);

  useSidebarShortcut(toggleSidebar);

  // Address bar mirrors the active variant, so the URL is always a working share link.
  useVariantUrlSync();

  // A result that used saved data because a provider is limiting requests says so (WP-I2).
  useStaleDataNotice();

  // Keep the Console's session snapshot current so every captured entry says what was on screen.
  useEffect(() => {
    consoleDispatch({
      type: "UPDATE_SESSION_CONTEXT",
      context: { gene, variant, uniprotId, activeView: masterView, online: !isOffline },
    });
  }, [consoleDispatch, gene, variant, uniprotId, masterView, isOffline]);

  // Application side-effects hook
  useAppEffects({
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
      <VariantAnalysisProvider>
        <div className={`app-shell font-sans select-none antialiased transition-colors duration-200 ${classRoot}`}>

        {/* ── Resizable and Collapsible Master Sidebar ── */}
        <MasterSidebar
          activeView={masterView}
          onViewChange={navigate}
          sidebarWidth={sidebarWidth}
          setSidebarWidth={setSidebarWidth}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          isDrawerMode={isNarrowViewport}
          isDrawerOpen={isNavDrawerOpen}
          onCloseDrawer={() => setIsNavDrawerOpen(false)}
          activeEvidenceTab={activeEvidenceTab}
          onEvidenceTabChange={setActiveEvidenceTab}
          analysisResult={analysisState.result}
          isFolding={isFolding}
          foldingPhase={foldingPhase}
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

          {/* ── Slim Header Bar with integrated alerts + global chrome actions ── */}
          <HeaderBar
            masterView={masterView}
            isBiophysicalLoading={isBiophysicalLoading}
            isOffline={isOffline}
            activeEvidenceTab={activeEvidenceTab}
            showNavToggle={isNarrowViewport}
            onToggleNavDrawer={() => setIsNavDrawerOpen((open) => !open)}
            onOpenPalette={() => setIsPaletteOpen(true)}
            error={analysisState.error}
            onDismissError={() => actions.setAnalysisState((prev: any) => ({ ...prev, error: null }))}
            isDark={isDark}
            onToggleTheme={toggleTheme}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenOnboarding={openTour}
            variant={showVariantChrome ? { gene, variant, uniprotId, analysisResult: analysisState.result } : null}
          />

          {/* ── Variant context strip: gene constraint, notes and the run's state ── */}
          {showVariantChrome && (
            <VariantHeader
              gene={gene}
              variant={variant}
              uniprotId={uniprotId}
              analysisResult={analysisState.result}
              onProvideAllele={() => {
                actions.setCustomGene(gene);
                actions.setShowCustomInputs(true);
                navigate("search");
              }}
            />
          )}

          {/* ── Primary Viewport Screen Router ── */}
          <AppViews
            masterView={masterView}
            setMasterView={navigate}
            actions={actions}
            pushErrorEntry={pushErrorEntry}
            setIsSettingsOpen={setIsSettingsOpen}
            onOpenOnboarding={openTour}
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

          {/* Settings Drawer Slide-over */}
          <SettingsDrawer
            onNavigateAbout={() => {
              setIsSettingsOpen(false);
              navigate("about");
            }}
          />

          {/* Command palette (Ctrl+K) — views, tabs, recents, system actions, variant runs */}
          <CommandPalette
            open={isPaletteOpen}
            onOpenChange={setIsPaletteOpen}
            onViewChange={navigate}
            activeView={masterView}
            activeEvidenceTab={activeEvidenceTab}
            onEvidenceTabChange={(tab) => {
              setActiveEvidenceTab(tab);
              navigate("evidence");
            }}
            onSelectHistory={actions.handleSelectHistoryItem}
            onRunQuery={actions.handleSearchSubmit}
            onOpenOnboarding={openTour}
            onToggleSidebar={toggleSidebar}
          />

          {/* Workspace Onboarding & API Keys Guide Modal */}
          <OnboardingModal
            isOpen={isOnboardingOpen}
            onClose={() => setIsOnboardingOpen(false)}
            onSelectPreset={handleSelectOnboardingPreset}
            onOpenSettings={(tab) => openSettingsTab((tab ?? "connections") as SettingsTabId)}
          />

          {/* How to Inspect Modal Popup */}
          <HowToInspectModal
            isOpen={isHowToInspectOpen}
            onClose={() => setIsHowToInspectOpen(false)}
            isDark={isDark}
            selectedResidueIndex={selectedResidueIndex}
            gene={gene}
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

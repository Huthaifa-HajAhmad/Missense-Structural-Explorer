import React from "react";
import { MasterView } from "./MasterSidebar";
import { AlertTriangle, KeyRound, X, ChevronRight, Settings, Sun, Moon, PanelLeft, Compass } from "lucide-react";
import { useSettings, SettingsTabId, LegacySettingsTabId } from "../context/SettingsContext";
import { commandPaletteHint } from "../shared/platform";

interface HeaderBarProps {
  masterView: MasterView;
  isBiophysicalLoading: boolean;
  isOffline: boolean;
  /** Narrow-viewport drawer trigger (App gates it via matchMedia). */
  showNavToggle?: boolean;
  onToggleNavDrawer?: () => void;
  /** Opens the command palette, which owns the query line and every jump. */
  onOpenPalette?: () => void;
  error?: string | null;
  onDismissError?: () => void;
  /** Optional overrides — when omitted the bar reads SettingsContext directly. */
  isDark?: boolean;
  onToggleTheme?: () => void;
  onOpenSettings?: () => void;
  /** Opens the high-level onboarding walkthrough and API keys guide */
  onOpenOnboarding?: () => void;
}

export function HeaderBar({
  masterView,
  isBiophysicalLoading,
  isOffline,
  showNavToggle = false,
  onToggleNavDrawer,
  onOpenPalette,
  error,
  onDismissError,
  isDark: isDarkProp,
  onToggleTheme,
  onOpenSettings,
  onOpenOnboarding
}: HeaderBarProps) {
  let hasConfiguredGeminiKey = true;
  let openSettingsTab = (_tab?: SettingsTabId | LegacySettingsTabId) => {};
  let isDark = isDarkProp ?? false;
  let toggleTheme = onToggleTheme ?? (() => {});

  try {
    const settings = useSettings();
    hasConfiguredGeminiKey = settings.hasConfiguredGeminiKey;
    openSettingsTab = settings.openSettingsTab;
    // Props win when provided (e.g. isolated tests); context is the live source otherwise.
    if (isDarkProp === undefined) isDark = settings.isDark;
    if (onToggleTheme === undefined) toggleTheme = settings.toggleTheme;
    if (onOpenSettings === undefined) onOpenSettings = () => settings.setIsSettingsOpen(true);
  } catch {
    // Gracefully handle rendering when outside of SettingsProvider (e.g. isolated test environments)
  }

  const getBreadcrumbTitle = (view: MasterView): string => {
    switch (view) {
      case "evidence":
        return "Evidence";
      case "structure":
      case "structure_alphafold":
      case "structure_esmfold":
        return "3D Structure";
      case "energetics":
        return "Energetics";
      case "landscape":
        return "Landscape";
      case "insights":
        return "Insights";
      case "report":
        return "Report";
      case "console":
        return "Developer Console";
      case "about":
        return "About";
      default:
        return "";
    }
  };

  const breadcrumbTitle = getBreadcrumbTitle(masterView);

  /* One source for the chord label — the palette footer prints the same string. */
  const paletteHint = commandPaletteHint();

  return (
    <header className="app-header flex items-center px-4 py-2 border-b border-cs-border bg-cs-surface gap-3 min-h-[44px]" id="main-header">
      {/* Drawer toggle — rendered only when App reports a narrow viewport */}
      {showNavToggle && (
        <button
          type="button"
          onClick={onToggleNavDrawer}
          className="p-1.5 rounded-lg border border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition-all cursor-pointer flex items-center justify-center active:scale-[0.96]"
          title="Open navigation"
          aria-label="Open navigation"
          aria-expanded={showNavToggle}
        >
          <PanelLeft className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Breadcrumb label — muted, hidden on search */}
      {masterView !== "search" && breadcrumbTitle && (
        <span
          className="text-[11px] font-medium uppercase tracking-widest flex-shrink-0"
          style={{ color: "var(--cs-text-muted)", letterSpacing: "0.08em" }}
        >
          {breadcrumbTitle}
        </span>
      )}

      {/* Divider (only when breadcrumb visible) */}
      {masterView !== "search" && breadcrumbTitle && (
        <div style={{ width: 1, height: 16, background: "var(--cs-border)", flexShrink: 0 }} />
      )}

      {/* Command palette trigger — the header's way into every quick action, including
          the variant query line. The keyboard chord is the primary path; this chip exists so
          the hotkey is discoverable. */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="ms-kbd-chip"
        title={`Open command palette (${paletteHint})`}
        aria-label={`Open command palette (${paletteHint})`}
      >
        {paletteHint}
      </button>

      {/* Center / Inline Status Notices — Integrated smoothly without overlays */}
      <div className="flex items-center gap-2 min-w-0">
        {!hasConfiguredGeminiKey && (
          <button
            type="button"
            onClick={() => openSettingsTab("api")}
            data-tour="api-key-badge"
            title="API key not configured — Click to configure in Settings"
            className="px-2.5 py-0.5 rounded-full text-[10.5px] font-medium bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 flex items-center gap-1.5 transition-all cursor-pointer select-none shrink-0"
          >
            <KeyRound className="w-3 h-3 text-amber-500 shrink-0" />
            <span>API Key Required</span>
            <ChevronRight className="w-3 h-3 opacity-60 shrink-0" />
          </button>
        )}

        {error && (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-medium bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 max-w-sm sm:max-w-md truncate">
            <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
            <span className="truncate">{error.replace(/^Error:\s*/i, "")}</span>
            {error.toLowerCase().includes("unauthorized") || error.toLowerCase().includes("api key") ? (
              <button
                type="button"
                onClick={() => openSettingsTab("api")}
                className="ml-1 text-[10px] font-bold underline hover:opacity-80 cursor-pointer shrink-0"
              >
                Configure
              </button>
            ) : null}
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                className="ml-1 text-rose-400 hover:text-rose-600 p-0.5 rounded cursor-pointer shrink-0"
                title="Dismiss notice"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right-side system status + global chrome actions.
          Icon buttons mirror the rail icon-button rhythm (`rounded-[var(--cs-radius-input)]`,
          same muted → primary hover, same 0.96 press) so the header reads as one family
          with the workspace rather than a separate chrome language. */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {isBiophysicalLoading && (
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1.5 mr-1"
            style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-muted)" }}
          >
            <span className="cs-spinner cs-spinner-sm" />
            Computing…
          </span>
        )}
        {isOffline && (
          <span
            className="text-[10px] font-mono font-medium shrink-0 mr-1"
            style={{ color: "var(--cs-warn)" }}
          >
            OFFLINE
          </span>
        )}
        {/* Divider before chrome actions */}
        <div style={{ width: 1, height: 16, background: "var(--cs-border)", flexShrink: 0 }} />
        {onOpenOnboarding && (
          <button
            type="button"
            onClick={onOpenOnboarding}
            className="p-1.5 rounded-lg border border-transparent text-[var(--cs-accent-clay)] hover:bg-[var(--cs-bg-subtle)] transition-all cursor-pointer flex items-center justify-center active:scale-[0.96]"
            title="Workspace guide & API keys tour"
            aria-label="Open workspace guide & tour"
          >
            <Compass className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={toggleTheme}
          className="p-1.5 rounded-lg border border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition-all cursor-pointer flex items-center justify-center active:scale-[0.96]"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => onOpenSettings?.()}
          className="p-1.5 rounded-lg border border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition-all cursor-pointer flex items-center justify-center active:scale-[0.96]"
          title="Settings"
          aria-label="Open settings"
          id="header-settings-btn"
          data-tour="settings-trigger"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}

export default React.memo(HeaderBar);


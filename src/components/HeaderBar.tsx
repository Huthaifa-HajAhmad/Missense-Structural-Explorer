import React from "react";
import { MasterView } from "./MasterSidebar";
import { Search, AlertTriangle, KeyRound, X, ChevronRight, Settings } from "lucide-react";
import { useSettings, SettingsTabId, LegacySettingsTabId } from "../context/SettingsContext";

interface HeaderBarProps {
  masterView: MasterView;
  isBiophysicalLoading: boolean;
  isOffline: boolean;
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  error?: string | null;
  onDismissError?: () => void;
}

export function HeaderBar({
  masterView,
  isBiophysicalLoading,
  isOffline,
  isSearchOpen,
  setIsSearchOpen,
  error,
  onDismissError
}: HeaderBarProps) {
  let hasConfiguredGeminiKey = true;
  let openSettingsTab = (_tab?: SettingsTabId | LegacySettingsTabId) => {};

  try {
    const settings = useSettings();
    hasConfiguredGeminiKey = settings.hasConfiguredGeminiKey;
    openSettingsTab = settings.openSettingsTab;
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
      default:
        return "";
    }
  };

  const breadcrumbTitle = getBreadcrumbTitle(masterView);

  return (
    <header className="app-header flex items-center px-4 py-2 border-b border-cs-border bg-cs-surface gap-3 min-h-[44px]" id="main-header">
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

      {/* Quick Search Button in Header */}
      {masterView !== "search" && (
        <button
          id="header-search-trigger"
          type="button"
          onClick={() => setIsSearchOpen(!isSearchOpen)}
          className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center ${
            isSearchOpen
              ? "bg-[var(--cs-accent-mag-soft)] text-[var(--cs-accent-clay)] border-[var(--cs-accent-clay)]"
              : "border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)]"
          }`}
          title="Toggle quick search panel"
          aria-label="Toggle quick search"
        >
          <Search className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Center / Inline Status Notices — Integrated smoothly without overlays */}
      <div className="flex items-center gap-2 min-w-0">
        {!hasConfiguredGeminiKey && (
          <button
            type="button"
            onClick={() => openSettingsTab("api")}
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

      {/* Right-side system status */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {isBiophysicalLoading && (
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1.5"
            style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-muted)" }}
          >
            <span className="cs-spinner cs-spinner-sm" />
            Computing…
          </span>
        )}
        {isOffline && (
          <span
            className="text-[10px] font-mono font-medium shrink-0"
            style={{ color: "var(--cs-warn)" }}
          >
            OFFLINE
          </span>
        )}
      </div>
    </header>
  );
}

export default React.memo(HeaderBar);


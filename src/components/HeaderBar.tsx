import React from "react";
import { MasterView } from "./MasterSidebar";
import { Search } from "lucide-react";

interface HeaderBarProps {
  masterView: MasterView;
  isBiophysicalLoading: boolean;
  isOffline: boolean;
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
}

export function HeaderBar({
  masterView,
  isBiophysicalLoading,
  isOffline,
  isSearchOpen,
  setIsSearchOpen
}: HeaderBarProps) {
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
    <header className="app-header" id="main-header">
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

      {/* Right-side system status */}
      <div className="ml-auto flex items-center gap-2">
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

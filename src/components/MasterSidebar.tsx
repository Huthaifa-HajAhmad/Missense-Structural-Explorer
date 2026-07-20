import React, { useRef, useCallback } from "react";
import {
  Dna, BarChart2, Layers, Activity, Map,
  FlaskConical, FileText, Search,
  Settings, Sun, Moon,
  PanelLeftClose, PanelLeftOpen,
  CheckCircle2, Circle,
} from "lucide-react";
import { AnalysisResult } from "../types";

export type MasterView =
  | "search"
  | "evidence"
  | "structure"
  | "energetics"
  | "landscape"
  | "insights"
  | "report";

interface MasterSidebarProps {
  activeView: MasterView;
  onViewChange: (view: MasterView) => void;
  isDark: boolean;
  toggleTheme: () => void;
  onOpenSettings: () => void;
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  isCollapsed: boolean;
  setIsCollapsed: (c: boolean) => void;
  activeEvidenceTab: string;
  onEvidenceTabChange: (tab: string) => void;
  // Completion state props
  analysisResult?: AnalysisResult | null;
  isFolding?: boolean;
  isBiophysicalLoading?: boolean;
  isClinicalLoading?: boolean;
}

interface NavItem {
  id: MasterView;
  label: string;
  sublabel?: string;
  Icon: React.ComponentType<{ className?: string }>;
}

interface NavZone {
  zoneLabel: string;
  items: NavItem[];
}

const NAV_ZONES: NavZone[] = [
  {
    zoneLabel: "Input",
    items: [
      { id: "search", label: "Search", sublabel: "Variant query & history", Icon: Search },
    ],
  },
  {
    zoneLabel: "Evidence & modeling",
    items: [
      { id: "evidence",   label: "Evidence",     sublabel: "Multi-modal scores",    Icon: BarChart2    },
      { id: "structure",  label: "3D Structure",  sublabel: "Molstar viewer",         Icon: Layers       },
      { id: "energetics", label: "Energetics",   sublabel: "ΔΔG · FoldX · DynaMut", Icon: Activity     },
      { id: "landscape",  label: "Landscape",    sublabel: "REVEL · AM scatter",    Icon: Map          },
    ],
  },
  {
    zoneLabel: "Synthesis",
    items: [
      { id: "insights", label: "Insights", sublabel: "Variant interpretation", Icon: FlaskConical },
      { id: "report",   label: "Report",   sublabel: "Clinical narrative",     Icon: FileText     },
    ],
  },
];

const EVIDENCE_SUB_ITEMS = [
  { id: "clinical",     label: "Population Frequencies" },
  { id: "predictors",   label: "In-Silico Predictors"   },
  { id: "structure",    label: "Residue Shifts"          },
  { id: "function",     label: "Functional Site"         },
  { id: "interactions", label: "PPI Networks"            },
  { id: "guidelines",   label: "Scores Thresholds"       },
];

/** Derives per-tab completion state from analysis data — synchronized across all workflow components */
function getTabStatus(
  view: MasterView,
  result: AnalysisResult | null | undefined,
  isFolding: boolean,
  isBiophysicalLoading: boolean,
  isClinicalLoading: boolean,
  isLoadingSearch?: boolean,
  loadingStep?: string
): "complete" | "progress" | "pending" {
  if (view === "search") return "complete";

  // Check if biophysical calculations (FoldX, DynaMut2, DDMut) are complete
  const hasBiophysics = result?.foldingEnergetics != null || result?.dynamut2 != null || result?.ddmut != null || result?.biophysicalEnergetics != null;

  if (view === "energetics") {
    if (isFolding || isBiophysicalLoading || (result != null && !hasBiophysics)) {
      return "progress";
    }
    if (result != null && hasBiophysics) {
      return "complete";
    }
  }

  // 1. Result landed -> All pipeline steps complete (except active background tasks)
  if (result != null) {
    if (view === "structure" && isFolding) return "progress";
    return "complete";
  }

  // 2. Active search execution
  if (isLoadingSearch) {
    const match = (loadingStep || "").match(/Step (\d+)\/4/);
    const currentStep = match ? parseInt(match[1], 10) : 1;

    switch (view) {
      case "evidence":
        return currentStep === 1 ? "progress" : currentStep > 1 ? "complete" : "pending";
      case "structure":
        return currentStep === 2 ? "progress" : currentStep > 2 ? "complete" : "pending";
      case "landscape":
        return currentStep === 3 ? "progress" : currentStep > 3 ? "complete" : "pending";
      case "energetics":
        return currentStep === 4 ? "progress" : currentStep > 4 ? "complete" : "pending";
      case "insights":
        return currentStep >= 3 ? "progress" : "pending";
      case "report":
        return currentStep >= 4 ? "progress" : "pending";
      default:
        return "pending";
    }
  }

  return "pending";
}

/** Render glowing indicator dot for completed steps, ring spinner for in-progress, and hollow ring for pending */
function StepIcon({ status }: { status: "complete" | "progress" | "pending" }) {
  if (status === "complete") {
    return (
      <span className="relative flex h-2.5 w-2.5 items-center justify-center shrink-0" title="Complete" aria-label="Complete">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-25" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
      </span>
    );
  }
  if (status === "progress") {
    return (
      <span
        className="w-2.5 h-2.5 rounded-full border-2 border-amber-500 border-t-transparent animate-spin shrink-0 inline-block"
        role="status"
        aria-label="In progress"
      />
    );
  }
  return (
    <span
      className="w-2 h-2 rounded-full border border-slate-400 dark:border-slate-600 bg-transparent shrink-0 inline-block opacity-50"
      aria-label="Not started"
    />
  );
}

export default function MasterSidebar({
  activeView,
  onViewChange,
  isDark,
  toggleTheme,
  onOpenSettings,
  sidebarWidth,
  setSidebarWidth,
  isCollapsed,
  setIsCollapsed,
  activeEvidenceTab,
  onEvidenceTabChange,
  analysisResult,
  isFolding = false,
  isBiophysicalLoading = false,
  isClinicalLoading = false,
}: MasterSidebarProps) {
  const resizeRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isCollapsed) return;
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      const handleMouseMove = (me: MouseEvent) => {
        const newWidth = Math.max(180, Math.min(420, startWidth + me.clientX - startX));
        setSidebarWidth(newWidth);
        localStorage.setItem("cs-sidebar-width", String(newWidth));
      };
      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
    },
    [sidebarWidth, isCollapsed, setSidebarWidth]
  );

  const toggleCollapse = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    localStorage.setItem("cs-sidebar-collapsed", String(next));
  };

  const currentWidth = isCollapsed ? 56 : sidebarWidth;

  return (
    <aside
      className="relative flex flex-col h-full flex-shrink-0 overflow-hidden transition-[width] duration-300 select-none"
      style={{
        width: currentWidth,
        minWidth: currentWidth,
        background: "var(--cs-surface)",
        borderRight: "1px solid var(--cs-border)",
      }}
      aria-label="Main navigation"
    >
      {/* ── Brand logo + wordmark + collapse toggle ── */}
      <div
        className="flex items-center gap-2 flex-shrink-0 overflow-hidden"
        style={{
          padding: isCollapsed ? "14px 10px" : "14px 16px",
          borderBottom: "1px solid var(--cs-border)",
          height: "var(--cs-chrome-height)",
          minHeight: "var(--cs-chrome-height)",
          justifyContent: isCollapsed ? "center" : "space-between",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-7.5 h-7.5 rounded-lg flex items-center justify-center flex-shrink-0 cursor-pointer active:scale-95 transition-transform"
            style={{ background: "var(--cs-accent-clay)" }}
            title={isCollapsed ? "Expand sidebar" : "Missense & Fold"}
            onClick={isCollapsed ? toggleCollapse : undefined}
          >
            <Dna className="w-4 h-4 text-white stroke-[2.2]" />
          </div>
          {!isCollapsed && (
            <span
              className="text-[13px] font-semibold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis"
              style={{ color: "var(--cs-text-primary)" }}
            >
              Missense{" "}
              <span style={{ color: "var(--cs-accent-clay)" }}>&amp; Fold</span>
            </span>
          )}
        </div>

        {!isCollapsed && (
          <button
            type="button"
            onClick={toggleCollapse}
            className="p-1 rounded cursor-pointer active:scale-95 transition-all"
            style={{ color: "var(--cs-text-muted)" }}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Primary navigation (zone-grouped) ── */}
      <nav
        className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden"
        style={{ padding: isCollapsed ? "8px 6px" : "4px 6px" }}
        aria-label="Primary navigation"
      >
        {NAV_ZONES.map((zone, zoneIdx) => (
          <div key={zone.zoneLabel}>
            {/* Zone label — 11px uppercase, muted, whitespace-only separation */}
            {!isCollapsed && (
              <span
                className="sidebar-zone-label"
                style={{ marginTop: zoneIdx === 0 ? 8 : 20 }}
              >
                {zone.zoneLabel}
              </span>
            )}

            {zone.items.map(({ id, label, sublabel, Icon }) => {
              const isActive = activeView === id;
              const status = getTabStatus(
                id, analysisResult, isFolding, isBiophysicalLoading, isClinicalLoading
              );

              return (
                <div key={id} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => onViewChange(id)}
                    className="flex items-center gap-2.5 rounded-lg cursor-pointer w-full text-left transition-all duration-150 active:scale-[0.98] group"
                    style={{
                      padding: isCollapsed ? "9px 0" : "8px 10px",
                      justifyContent: isCollapsed ? "center" : "flex-start",
                      background: isActive
                        ? isDark
                          ? "rgba(196,104,73,0.13)"
                          : "rgba(196,104,73,0.08)"
                        : "transparent",
                      border: isActive
                        ? "1px solid rgba(196,104,73,0.22)"
                        : "1px solid transparent",
                      position: "relative",
                    }}
                    aria-label={label}
                    title={isCollapsed ? `${label}${sublabel ? ` — ${sublabel}` : ""}` : undefined}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {/* 2px left accent rail on active */}
                    {isActive && (
                      <span
                        style={{
                          position: "absolute",
                          left: 0,
                          top: "18%",
                          height: "64%",
                          width: 2,
                          borderRadius: "0 2px 2px 0",
                          background: "var(--cs-accent-clay)",
                        }}
                      />
                    )}

                    {/* Nav icon */}
                    <span
                      style={{
                        color: isActive
                          ? "var(--cs-accent-clay)"
                          : "var(--cs-text-secondary)",
                        display: "flex",
                        flexShrink: 0,
                      }}
                    >
                      <Icon className="w-4 h-4" />
                    </span>

                    {/* Primary label + descriptor (expanded only) */}
                    {!isCollapsed && (
                      <span className="flex flex-col min-w-0 flex-1">
                        {/* Primary label: 14px / 500 */}
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            lineHeight: "1.3",
                            color: isActive
                              ? "var(--cs-accent-clay)"
                              : "var(--cs-text-primary)",
                          }}
                        >
                          {label}
                        </span>
                        {/* Descriptor: 12px / 400, muted */}
                        {sublabel && (
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 400,
                              lineHeight: "1.3",
                              color: "var(--cs-text-muted)",
                            }}
                            className="truncate"
                          >
                            {sublabel}
                          </span>
                        )}
                      </span>
                    )}

                    {/* Completion indicator (right edge, expanded only) */}
                    {!isCollapsed && (
                      <span className="ml-auto flex-shrink-0">
                        <StepIcon status={status} />
                      </span>
                    )}
                  </button>

                  {/* ── Evidence sub-items ── */}
                  {id === "evidence" && !isCollapsed && (
                    <div
                      className="flex flex-col"
                      style={{
                        marginLeft: 14,
                        paddingLeft: 12,
                        borderLeft: "1px solid var(--cs-border-subtle)",
                        gap: 2,
                        marginTop: 3,
                        marginBottom: 4,
                      }}
                    >
                      {EVIDENCE_SUB_ITEMS.map((sub) => {
                        const isSubActive =
                          activeView === "evidence" && activeEvidenceTab === sub.id;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => {
                              onViewChange("evidence");
                              onEvidenceTabChange(sub.id);
                            }}
                            className="flex items-center gap-2 py-1.5 px-2 rounded-md w-full text-left transition-all duration-150 cursor-pointer"
                            style={{
                              background: isSubActive
                                ? "rgba(196,104,73,0.07)"
                                : "transparent",
                            }}
                          >
                            <span
                              style={{
                                width: 5,
                                height: 5,
                                borderRadius: "50%",
                                flexShrink: 0,
                                background: isSubActive
                                  ? "var(--cs-accent-clay)"
                                  : "transparent",
                                border: isSubActive
                                  ? "none"
                                  : "1px solid var(--cs-text-muted)",
                                transition: "background 0.12s",
                              }}
                            />
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: isSubActive ? 500 : 400,
                                color: isSubActive
                                  ? "var(--cs-accent-clay)"
                                  : "var(--cs-text-muted)",
                              }}
                              className="truncate"
                            >
                              {sub.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Footer actions ── */}
      <div
        className="flex flex-col flex-shrink-0"
        style={{
          borderTop: "1px solid var(--cs-border)",
          padding: "6px",
          gap: 2,
        }}
      >
        {/* Settings */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-2.5 rounded-lg cursor-pointer w-full transition-all duration-150 active:scale-[0.98]"
          style={{
            padding: isCollapsed ? "8px 0" : "7px 10px",
            justifyContent: isCollapsed ? "center" : "flex-start",
            color: "var(--cs-text-muted)",
            background: "transparent",
            border: "1px solid transparent",
          }}
          title="Settings"
          aria-label="Open settings"
        >
          <Settings className="w-4 h-4 flex-shrink-0" />
          {!isCollapsed && (
            <span style={{ fontSize: 13, fontWeight: 400, color: "var(--cs-text-muted)" }}>
              Settings
            </span>
          )}
        </button>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="flex items-center gap-2.5 rounded-lg cursor-pointer w-full transition-all duration-150 active:scale-[0.98]"
          style={{
            padding: isCollapsed ? "8px 0" : "7px 10px",
            justifyContent: isCollapsed ? "center" : "flex-start",
            color: "var(--cs-text-muted)",
            background: "transparent",
            border: "1px solid transparent",
          }}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? (
            <Sun className="w-4 h-4 flex-shrink-0" />
          ) : (
            <Moon className="w-4 h-4 flex-shrink-0" />
          )}
          {!isCollapsed && (
            <span style={{ fontSize: 13, fontWeight: 400, color: "var(--cs-text-muted)" }}>
              {isDark ? "Light mode" : "Dark mode"}
            </span>
          )}
        </button>
      </div>

      {/* ── Resize drag handle ── */}
      {!isCollapsed && (
        <div
          ref={resizeRef}
          onMouseDown={handleMouseDown}
          className="absolute top-0 right-0 w-1 h-full transition-colors hover:bg-slate-500/10"
          style={{ cursor: "col-resize", zIndex: 10 }}
          title="Drag to resize sidebar"
        />
      )}
    </aside>
  );
}

import React, { useRef, useCallback } from "react";
import {
  Dna, BarChart2, Layers, Activity, Map,
  FlaskConical, FileText, Search, Terminal,
  PanelLeftClose, BookOpen, Info,
} from "lucide-react";
import { AnalysisResult } from "../types";
import { getWorkflowStageStatus, WorkflowStatusType } from "../shared/workflowStatus";
import { useSettings } from "../context/SettingsContext";

export type MasterView =
  | "search"
  | "evidence"
  | "structure"
  | "structure_alphafold"
  | "structure_esmfold"
  | "energetics"
  | "landscape"
  | "insights"
  | "report"
  | "literature"
  | "console"
  | "about";

/**
 * Sidebar geometry, shared by the pointer drag, the keyboard resize path and App's
 * persisted-value guard — one authority for the bounds instead of three copies of
 * `Math.max(180, Math.min(420, …))` drifting apart.
 */
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 420;
export const SIDEBAR_WIDTH_DEFAULT = 220;
export const SIDEBAR_WIDTH_COLLAPSED = 56;

/**
 * Clamps any candidate width into the legal range. Deliberately tolerates NaN —
 * `parseInt` of a corrupt `cs-sidebar-width` localStorage entry produces NaN, and an
 * unguarded read used to flow `width: NaN` straight into the aside's inline style.
 * The ViewInspector clamps its own persisted width the same way.
 */
export function clampSidebarWidth(raw: number): number {
  return Number.isFinite(raw)
    ? Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(raw)))
    : SIDEBAR_WIDTH_DEFAULT;
}

interface MasterSidebarProps {
  activeView: MasterView;
  onViewChange: (view: MasterView) => void;
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
  isPocketLoading?: boolean;
  dynamut2Status?: string | null;
  ddmutStatus?: string | null;
  isNarrativeLoading?: boolean;
  isLoadingSearch?: boolean;
  loadingStep?: string;
  unreadConsoleCount?: number;
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
      { id: "literature", label: "Literature", sublabel: "Citations & PubMed", Icon: BookOpen     },
      { id: "report",   label: "Report",   sublabel: "Clinical narrative",     Icon: FileText     },
    ],
  },
  {
    zoneLabel: "Developer",
    items: [
      { id: "console",  label: "Console",  sublabel: "Errors · Logs · Network", Icon: Terminal     },
    ],
  },
];

const EVIDENCE_SUB_ITEMS = [
  { id: "clinical",     label: "Population Frequencies" },
  { id: "predictors",   label: "In-Silico Predictors"   },
  { id: "alphagenome",  label: "AlphaGenome Atlas"      },
  { id: "splicing",     label: "RNA Splicing"            },
  { id: "structure",    label: "Residue Shifts & Pockets"},
  { id: "perturbation", label: "Structural Perturbation" },
  { id: "multimers",    label: "Multimer Assembly"       },
  { id: "function",     label: "Functional Domains"      },
  { id: "interactions", label: "PPI Networks"            },
  { id: "guidelines",   label: "Scores Thresholds"       },
];

const STRUCTURE_SUB_ITEMS = [
  { id: "structure_alphafold", label: "AlphaFold2" },
  { id: "structure_esmfold",   label: "ESMFold-2 Model"   },
];

/**
 * Which evidence sub-tabs are still waiting on their backing data for the current
 * run. Was a nested-ternary chain inlined per sub-item per render — same logic,
 * but now it reads as the small lookup it is and can be reasoned about once.
 */
function isEvidenceSubStreaming(
  subId: string,
  isBiophysicalLoading: boolean,
  result: AnalysisResult | null | undefined
): boolean {
  if (!isBiophysicalLoading) return false;
  switch (subId) {
    case "alphagenome": return !result?.conservationData?.alphagenome;
    case "splicing":    return !result?.conservationData?.spliceai;
    case "predictors":  return !result?.conservationData?.revel;
    case "structure":    return !result?.insights?.biochemicalShift;
    default:             return false;
  }
}

/** Render glowing indicator dot for completed steps, ring spinner for in-progress, and hollow ring for pending */
function StepIcon({ status }: { status: WorkflowStatusType }) {
  if (status === "complete") {
    return (
      <span className="flex h-2.5 w-2.5 items-center justify-center shrink-0" title="Complete" aria-label="Complete">
        <span className="inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500/90" />
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
  if (status === "degraded") {
    return (
      <span
        className="w-2 h-2 rounded-full bg-amber-500 shrink-0 inline-block"
        title="Service degraded"
        aria-label="Service degraded"
      />
    );
  }
  if (status === "error") {
    return (
      <span
        className="w-2 h-2 rounded-full bg-rose-500 shrink-0 inline-block"
        title="Error"
        aria-label="Error"
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

/**
 * One sub-navigation row, shared by the Evidence tabs and the structure models.
 * The two lists were ~90% copy-pasted blocks that had already drifted (only the
 * evidence copy had a streaming branch); one component keeps them identical.
 */
function SubNavItem({
  label,
  isActive,
  isStreaming = false,
  onClick,
}: {
  label: string;
  isActive: boolean;
  isStreaming?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ms-sub-btn flex items-center gap-2 py-1.5 px-2 rounded-md w-full text-left cursor-pointer"
      data-active={isActive}
      aria-current={isActive ? "page" : undefined}
    >
      <span className="ms-sub-dot" data-active={isActive} aria-hidden="true" />
      <span
        style={{
          fontSize: 12,
          fontWeight: isActive ? 500 : 400,
          color: isActive ? "var(--cs-accent-clay)" : "var(--cs-text-muted)",
        }}
        className="truncate"
      >
        {label}
      </span>
      {isStreaming && (
        <span
          /* Same amber progress ring as StepIcon — this used to be the only indigo
             element in a clay/mag/amber/emerald sidebar. */
          className="ml-auto w-2 h-2 rounded-full border border-amber-500 border-t-transparent animate-spin shrink-0"
          title="Streaming in background"
          aria-label="Streaming in background"
        />
      )}
    </button>
  );
}

function MasterSidebar({
  activeView,
  onViewChange,
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
  isPocketLoading = false,
  dynamut2Status = null,
  ddmutStatus = null,
  isNarrativeLoading = false,
  isLoadingSearch = false,
  loadingStep = "",
  unreadConsoleCount = 0,
}: MasterSidebarProps) {
  const resizeRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const defaultStructureView: MasterView =
    settings.defaultStructureModel === "esmfold" ? "structure_esmfold" : "structure_alphafold";

  /**
   * Set + persist a width in one place. Pointer drags commit once on mouseup (the
   * drag itself only updates state — writing localStorage on every mousemove was
   * hundreds of synchronous writes per gesture); keyboard steps commit per press.
   */
  const commitWidth = useCallback(
    (next: number) => {
      const clamped = clampSidebarWidth(next);
      setSidebarWidth(clamped);
      localStorage.setItem("cs-sidebar-width", String(clamped));
    },
    [setSidebarWidth]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isCollapsed) return;
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      let lastWidth = startWidth;
      const handleMouseMove = (me: MouseEvent) => {
        lastWidth = startWidth + me.clientX - startX;
        setSidebarWidth(clampSidebarWidth(lastWidth));
      };
      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem("cs-sidebar-width", String(clampSidebarWidth(lastWidth)));
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      /* Without this, dragging across the main content selected text mid-gesture —
         `select-none` only covers the sidebar's own subtree. */
      document.body.style.userSelect = "none";
    },
    [sidebarWidth, isCollapsed, setSidebarWidth]
  );

  /**
   * Keyboard resize for the separator: ArrowLeft/Right ±16px, Home/End for the
   * bounds. Before this the handle was a mouse-only div — a keyboard user could
   * collapse, navigate and toggle everything else, but not resize.
   */
  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":  commitWidth(sidebarWidth - 16); break;
        case "ArrowRight": commitWidth(sidebarWidth + 16); break;
        case "Home":       commitWidth(SIDEBAR_WIDTH_MIN); break;
        case "End":        commitWidth(SIDEBAR_WIDTH_MAX); break;
        default: return;
      }
      e.preventDefault();
    },
    [commitWidth, sidebarWidth]
  );

  const toggleCollapse = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    localStorage.setItem("cs-sidebar-collapsed", String(next));
  };

  const currentWidth = isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : sidebarWidth;

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
          {/*
            * When collapsed, this is the ONLY route back out — so it has to be a real button. It was
            * a `<div>` with an `onClick` and a `title`: no role, no tabIndex, no keyboard handler.
            * A keyboard user who collapsed the sidebar had no focusable control left to expand it
            * (the genuine toggle below renders only when `!isCollapsed`), which is a dead end, not a
            * preference.
            */}
          {isCollapsed ? (
            <button
              type="button"
              onClick={toggleCollapse}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="w-7.5 h-7.5 rounded-lg flex items-center justify-center flex-shrink-0 cursor-pointer active:scale-[0.96] transition-transform"
              style={{ background: "var(--cs-accent-clay)" }}
            >
              <Dna className="w-4 h-4 text-white stroke-[2.2]" />
            </button>
          ) : (
            <div
              className="w-7.5 h-7.5 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--cs-accent-clay)" }}
              title="Missense & Fold"
            >
              <Dna className="w-4 h-4 text-white stroke-[2.2]" />
            </div>
          )}
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
            className="p-1 rounded cursor-pointer active:scale-95 transition-all hover:text-[var(--cs-text-primary)]"
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
            {/* Zone label — 11px uppercase, muted. Spacing comes from the inline
                style below: it is the single source of truth for the 8/20 rhythm
                (first zone vs. rest), so no :first-child margin rule is needed. */}
            {!isCollapsed && (
              <span
                className="sidebar-zone-label"
                style={{ marginTop: zoneIdx === 0 ? 8 : 20 }}
              >
                {zone.zoneLabel}
              </span>
            )}

            {zone.items.map(({ id, label, sublabel, Icon }) => {
              const isActive =
                activeView === id ||
                (id === "structure" && (activeView === "structure_alphafold" || activeView === "structure_esmfold"));
              const { status } = getWorkflowStageStatus({
                view: id,
                result: analysisResult,
                isFolding,
                isBiophysicalLoading,
                isClinicalLoading,
                isLoadingSearch,
                loadingStep,
                isPocketLoading,
                dynamut2Status,
                ddmutStatus,
                isNarrativeLoading
              });

              return (
                <div key={id} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => {
                      if (id === "structure") {
                        onViewChange(defaultStructureView);
                      } else {
                        onViewChange(id);
                      }
                    }}
                    className="ms-nav-btn flex items-center gap-2.5 rounded-lg cursor-pointer w-full text-left transition-colors duration-150 active:scale-[0.98] group"
                    data-active={isActive}
                    style={{
                      padding: isCollapsed ? "9px 0" : "8px 10px",
                      justifyContent: isCollapsed ? "center" : "flex-start",
                      position: "relative",
                    }}
                    aria-label={label}
                    title={isCollapsed ? `${label}${sublabel ? ` — ${sublabel}` : ""}` : undefined}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {/* 2px left accent rail on active */}
                    {isActive && <span className="ms-active-rail" aria-hidden="true" />}

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

                    {/* Completion indicator or Console badge (right edge) */}
                    {!isCollapsed && id === "console" && (unreadConsoleCount ?? 0) > 0 && (
                      <span className="ml-auto flex-shrink-0 dev-console-badge">
                        {(unreadConsoleCount ?? 0) > 99 ? "99+" : unreadConsoleCount}
                      </span>
                    )}

                    {!isCollapsed && id !== "console" && (
                      <span className="ml-auto flex-shrink-0">
                        <StepIcon status={status} />
                      </span>
                    )}

                    {isCollapsed && id === "console" && (unreadConsoleCount ?? 0) > 0 && (
                      <span
                        className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500"
                        title={`${unreadConsoleCount} unread console entries`}
                      />
                    )}
                  </button>

                  {/* ── Evidence sub-items ── */}
                  {id === "evidence" && !isCollapsed && (
                    <div className="ms-sub-list">
                      {EVIDENCE_SUB_ITEMS.map((sub) => (
                        <SubNavItem
                          key={sub.id}
                          label={sub.label}
                          isActive={activeView === "evidence" && activeEvidenceTab === sub.id}
                          isStreaming={isEvidenceSubStreaming(sub.id, isBiophysicalLoading, analysisResult)}
                          onClick={() => {
                            onViewChange("evidence");
                            onEvidenceTabChange(sub.id);
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {/* ── 3D Structure sub-items ── */}
                  {id === "structure" && !isCollapsed && (
                    <div className="ms-sub-list">
                      {STRUCTURE_SUB_ITEMS.map((sub) => (
                        <SubNavItem
                          key={sub.id}
                          label={sub.label}
                          isActive={activeView === sub.id}
                          onClick={() => onViewChange(sub.id as MasterView)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Pinned footer: About — outside the scroll area, so it is always
            reachable no matter how far the nav is scrolled ── */}
      <div
        className="flex-shrink-0"
        style={{
          borderTop: "1px solid var(--cs-border)",
          padding: "6px 6px",
        }}
      >
        <button
          type="button"
          onClick={() => onViewChange("about")}
          className="ms-nav-btn flex items-center gap-2.5 rounded-lg cursor-pointer w-full text-left transition-colors duration-150 active:scale-[0.98]"
          data-active={activeView === "about"}
          style={{
            padding: isCollapsed ? "9px 0" : "8px 10px",
            justifyContent: isCollapsed ? "center" : "flex-start",
            position: "relative",
          }}
          aria-label="About"
          aria-current={activeView === "about" ? "page" : undefined}
          title={isCollapsed ? "About — Workspace guide & data sources" : undefined}
        >
          {activeView === "about" && <span className="ms-active-rail" aria-hidden="true" />}
          <span
            style={{
              color: activeView === "about"
                ? "var(--cs-accent-clay)"
                : "var(--cs-text-secondary)",
              display: "flex",
              flexShrink: 0,
            }}
          >
            <Info className="w-4 h-4" />
          </span>
          {!isCollapsed && (
            <span className="flex flex-col min-w-0 flex-1">
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  lineHeight: "1.3",
                  color: activeView === "about"
                    ? "var(--cs-accent-clay)"
                    : "var(--cs-text-primary)",
                }}
              >
                About
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 400,
                  lineHeight: "1.3",
                  color: "var(--cs-text-muted)",
                }}
                className="truncate"
              >
                Workspace guide & data sources
              </span>
            </span>
          )}
        </button>
      </div>

      {/* ── Resize drag handle — pointer + keyboard, 12px hit area with a
            4px visible strip (see .ms-resize-handle) ── */}
      {!isCollapsed && (
        <div
          ref={resizeRef}
          role="separator"
          aria-orientation="vertical"
          aria-label="Sidebar width. Press ArrowLeft or ArrowRight to resize, Home or End for the limits."
          title="Drag to resize · double-click to reset"
          tabIndex={0}
          onMouseDown={handleMouseDown}
          onKeyDown={handleResizeKeyDown}
          onDoubleClick={() => commitWidth(SIDEBAR_WIDTH_DEFAULT)}
          className="ms-resize-handle"
        />
      )}
    </aside>
  );
}

export default React.memo(MasterSidebar);

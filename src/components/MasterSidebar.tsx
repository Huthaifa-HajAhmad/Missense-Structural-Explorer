import React, { useRef, useCallback } from "react";
import {
  Dna, BarChart2, Layers, Activity, Map,
  FlaskConical, FileText, Search, Terminal,
  PanelLeftClose, PanelLeftOpen,
  CheckCircle2, Circle, BookOpen,
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
  | "console";

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
  { id: "structure_esmfold",   label: "ESM3 Model"   },
];

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
                    className="flex items-center gap-2.5 rounded-lg cursor-pointer w-full text-left transition-all duration-150 active:scale-[0.98] group"
                    style={{
                      padding: isCollapsed ? "9px 0" : "8px 10px",
                      justifyContent: isCollapsed ? "center" : "flex-start",
                      background: isActive
                        ? "rgba(196,104,73,0.08)"
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
                            {(() => {
                              const isSubLoading =
                                sub.id === "alphagenome"
                                  ? (isBiophysicalLoading && !analysisResult?.conservationData?.alphagenome)
                                  : sub.id === "splicing"
                                  ? (isBiophysicalLoading && !analysisResult?.conservationData?.spliceai)
                                  : sub.id === "predictors"
                                  ? (isBiophysicalLoading && !analysisResult?.conservationData?.revel)
                                  : sub.id === "structure"
                                  ? (isBiophysicalLoading && !analysisResult?.insights?.biochemicalShift)
                                  : false;

                              if (isSubLoading) {
                                return (
                                  <span
                                    className="ml-auto w-2 h-2 rounded-full border border-indigo-400 border-t-transparent animate-spin shrink-0"
                                    title="Streaming in background"
                                    aria-label="Streaming in background"
                                  />
                                );
                              }
                              return null;
                            })()}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* ── 3D Structure sub-items ── */}
                  {id === "structure" && !isCollapsed && (
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
                      {STRUCTURE_SUB_ITEMS.map((sub) => {
                        const isSubActive = activeView === sub.id;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => {
                              onViewChange(sub.id as MasterView);
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

export default React.memo(MasterSidebar);

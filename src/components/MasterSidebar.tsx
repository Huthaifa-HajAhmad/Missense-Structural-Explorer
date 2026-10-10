import React, { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import {
  BarChart2, Layers, Activity, Map,
  FlaskConical, FileText, Search, Terminal,
  PanelLeftClose, PanelLeftOpen, BookOpen, Info, X,
} from "lucide-react";
import { CHROME_ICON_BUTTON } from "./ui/chrome";
import { BrandMark } from "./ui/BrandMark";
import { AnalysisResult } from "../types";
import { getWorkflowStageStatus, WorkflowStatusType } from "../shared/workflowStatus";
import type { FoldxPhase } from "../shared/foldxPhase";
import { useSettings } from "../context/SettingsContext";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { isApplePlatform } from "../shared/platform";

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
 * persisted-value guard — one authority for the bounds.
 */
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 420;
export const SIDEBAR_WIDTH_DEFAULT = 232;
export const SIDEBAR_WIDTH_COLLAPSED = 56;
const SIDEBAR_WIDTH_STORAGE_KEY = "cs-sidebar-width";

/**
 * Clamps any candidate width into the legal range. Tolerates NaN — `parseInt` of a corrupt
 * `cs-sidebar-width` entry produces NaN, which must never reach the aside's inline style.
 */
export function clampSidebarWidth(raw: number): number {
  return Number.isFinite(raw)
    ? Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(raw)))
    : SIDEBAR_WIDTH_DEFAULT;
}

/** localStorage throws in private windows and when storage is full; persistence is best-effort. */
function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* non-fatal */
  }
}

/** The sidebar-collapse chord, printed next to the collapse button and the palette action. */
export function sidebarToggleHint(userAgent?: string): string {
  return isApplePlatform(userAgent) ? "⌘B" : "Ctrl B";
}

interface MasterSidebarProps {
  activeView: MasterView;
  onViewChange: (view: MasterView) => void;
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  isCollapsed: boolean;
  /** Flips the desktop collapse preference. App owns persistence and the Ctrl/⌘B chord. */
  onToggleCollapse: () => void;
  activeEvidenceTab: string;
  onEvidenceTabChange: (tab: string) => void;
  // Completion state props
  analysisResult?: AnalysisResult | null;
  isFolding?: boolean;
  /** Server-reported FoldX phase; absent means "no report", never "guess a stage". */
  foldingPhase?: FoldxPhase | null;
  isBiophysicalLoading?: boolean;
  isClinicalLoading?: boolean;
  isPocketLoading?: boolean;
  dynamut2Status?: string | null;
  ddmutStatus?: string | null;
  isNarrativeLoading?: boolean;
  isLoadingSearch?: boolean;
  loadingStep?: string;
  unreadConsoleCount?: number;
  /** Narrow-viewport drawer mode: the rail overlays the workspace instead of flex-sharing width. */
  isDrawerMode?: boolean;
  isDrawerOpen?: boolean;
  onCloseDrawer?: () => void;
}

export interface NavItem {
  id: MasterView;
  label: string;
  /** One-line description: the row's tooltip, and the command palette's meta column. */
  sublabel?: string;
  Icon: React.ComponentType<{ className?: string }>;
}

export interface NavZone {
  /** `null` renders no heading — Search is the front door and needs no label above it. */
  zoneLabel: string | null;
  items: NavItem[];
}

/**
 * The scrolling nav. Labels are sentence case to match every other heading in the app, and the
 * descriptors say what the view is FOR rather than listing the tools behind it.
 */
export const NAV_ZONES: NavZone[] = [
  {
    zoneLabel: null,
    items: [
      { id: "search", label: "Search", sublabel: "Variant query & history", Icon: Search },
    ],
  },
  {
    zoneLabel: "Evidence & modelling",
    items: [
      { id: "evidence",   label: "Evidence",     sublabel: "Population, predictors & splicing", Icon: BarChart2 },
      { id: "structure",  label: "3D structure", sublabel: "AlphaFold2 & ESMFold models",       Icon: Layers    },
      { id: "energetics", label: "Energetics",   sublabel: "ΔΔG stability estimates",           Icon: Activity  },
      { id: "landscape",  label: "Landscape",    sublabel: "Residue-level mutation map",        Icon: Map       },
    ],
  },
  {
    zoneLabel: "Synthesis",
    items: [
      { id: "insights",   label: "Insights",   sublabel: "Interpretation & ACMG criteria", Icon: FlaskConical },
      { id: "literature", label: "Literature", sublabel: "PubMed & Europe PMC",            Icon: BookOpen     },
      { id: "report",     label: "Report",     sublabel: "Clinical summary & export",      Icon: FileText     },
    ],
  },
];

/**
 * Utilities pinned below the scroll area. Console used to be a one-item "Developer" zone in the
 * middle of the analysis flow; it is a tool, not a step, so it lives with About.
 */
const FOOTER_ITEMS: NavItem[] = [
  { id: "console", label: "Console", sublabel: "Errors, logs & network", Icon: Terminal },
  { id: "about",   label: "About",   sublabel: "Guide & data sources",   Icon: Info     },
];

/** Flat registry of every primary view — shared with the header and the command palette. */
export const MASTER_VIEW_ITEMS: NavItem[] = [
  ...NAV_ZONES.flatMap((zone) => zone.items),
  ...FOOTER_ITEMS,
];

/**
 * Evidence sub-tabs, in reading order: curated evidence first (population, then the domain context a
 * curator reads before any prediction), then sequence and RNA predictions, then structure from the
 * residue outward (residue → fold → interfaces and partners). Interfaces & PPI merged the former
 * Multimer assembly and Protein interactions tabs, which answered one question twice.
 */
export const EVIDENCE_SUB_ITEMS = [
  { id: "clinical",     label: "Population data"          },
  { id: "gene-disease", label: "Gene–disease"             },
  { id: "expression-models", label: "Expression"          },
  { id: "species-models", label: "Species & models"      },
  { id: "function",     label: "Functional domains"       },
  { id: "predictors",   label: "In-silico predictors"     },
  { id: "alphagenome",  label: "AlphaGenome"              },
  { id: "splicing",     label: "RNA splicing"             },
  { id: "structure",    label: "Residue shifts & pockets" },
  { id: "perturbation", label: "Structural perturbation"  },
  { id: "interfaces",   label: "Interfaces & PPI"         },
];

export const STRUCTURE_SUB_ITEMS: { id: MasterView; label: string }[] = [
  { id: "structure_alphafold", label: "AlphaFold2" },
  { id: "structure_esmfold",   label: "ESMFold"    },
];

/**
 * Whether a registry row stands for the view on screen. The 3D structure row covers both model
 * sub-views — the sidebar, the header and the palette all need that merge, so it is written once.
 */
export function isViewActive(itemId: MasterView | string, activeView: MasterView | undefined): boolean {
  if (itemId === "structure") {
    return activeView === "structure" || activeView === "structure_alphafold" || activeView === "structure_esmfold";
  }
  return itemId === activeView;
}

/** Which evidence sub-tabs are still waiting on their backing data for the current run. */
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
    case "structure":   return !result?.insights?.biochemicalShift;
    default:            return false;
  }
}

const STATUS_TEXT: Record<WorkflowStatusType, string> = {
  complete: "Complete",
  progress: "In progress",
  degraded: "Service degraded",
  error: "Error",
  pending: "Not started",
  unavailable: "Unavailable",
  "on-demand": "On demand",
};

/**
 * Stage marker on the right edge of a row (or the icon corner when collapsed). `role="img"` so
 * the aria-label is actually announced — on a bare span it was ignored.
 */
function StepIcon({ status }: { status: WorkflowStatusType }) {
  return (
    <span
      className="ms-step"
      data-status={status}
      role="img"
      aria-label={STATUS_TEXT[status] ?? STATUS_TEXT.pending}
      title={STATUS_TEXT[status] ?? STATUS_TEXT.pending}
    />
  );
}

/** One sub-navigation row, shared by the Evidence tabs and the structure models. */
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
      className="ms-sub-btn"
      data-active={isActive}
      aria-current={isActive ? "page" : undefined}
    >
      <span className="ms-sub-dot" aria-hidden="true" />
      <span className="ms-sub-label">{label}</span>
      {isStreaming && (
        <span className="ms-step ml-auto" data-status="progress" role="img" aria-label="Loading" title="Loading in background" />
      )}
    </button>
  );
}

interface NavRowProps {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
  /** The live pipeline sentence; replaces the description line while a stage says something. */
  liveText?: string;
  /** Show the one-line description under the label. Off for the compact pinned footer. */
  showDescription?: boolean;
  status?: WorkflowStatusType;
  showStatus?: boolean;
  badgeCount?: number;
  rail: React.ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
}

/**
 * The one nav-row anatomy: icon · label · marker, with a description line under the label that
 * the live pipeline sentence takes over while a stage is running, degraded or failed — one line
 * swapping text, so rows never change height as the pipeline advances. Primary rows and pinned footer rows are the same component — the footer
 * used to be a 60-line hand copy of the row that had already drifted.
 */
function NavRow({
  item,
  isActive,
  collapsed,
  onClick,
  liveText,
  showDescription = true,
  status = "pending",
  showStatus = false,
  badgeCount = 0,
  rail,
  buttonRef,
}: NavRowProps) {
  const { id, label, sublabel, Icon } = item;
  const hasBadge = badgeCount > 0;
  const badgeText = badgeCount > 99 ? "99+" : String(badgeCount);
  const isLive = Boolean(liveText);
  const statusSuffix = showStatus && status !== "pending" ? ` · ${STATUS_TEXT[status]}` : "";
  const tooltip = collapsed
    ? `${label}${sublabel ? ` — ${sublabel}` : ""}${statusSuffix}${hasBadge ? ` · ${badgeText} unread` : ""}`
    : liveText || sublabel;

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className="ms-nav-btn"
      data-active={isActive}
      data-view={id}
      data-collapsed={collapsed}
      aria-current={isActive ? "page" : undefined}
      /* Collapsed rows have no visible text, so they carry the name. Expanded rows are named by
         their content, which is what lets the live status line reach a screen reader. */
      aria-label={collapsed ? `${label}${statusSuffix}${hasBadge ? `, ${badgeText} unread` : ""}` : undefined}
      title={tooltip}
    >
      {isActive && rail}
      <span className="ms-nav-icon">
        <Icon className="w-4 h-4" />
        {collapsed && showStatus && status !== "pending" && (
          <span className="ms-nav-icon-status">
            <StepIcon status={status} />
          </span>
        )}
        {collapsed && hasBadge && <span className="ms-nav-icon-dot" aria-hidden="true" />}
      </span>

      {!collapsed && (
        <span className="ms-nav-text">
          <span className="ms-nav-label">{label}</span>
          {(isLive || (showDescription && sublabel)) && (
            <span key={isLive ? "live" : "desc"} className="ms-nav-desc" data-live={isLive || undefined} data-status={status}>
              {isLive ? liveText : sublabel}
            </span>
          )}
        </span>
      )}

      {!collapsed && hasBadge && <span className="ms-count-badge">{badgeText}</span>}
      {!collapsed && !hasBadge && showStatus && <StepIcon status={status} />}
    </button>
  );
}

/**
 * Scroll-edge fades for the nav: sets data attributes the CSS mask reads, so a clipped row reads
 * as "more below" instead of a rendering bug. (The mask variables used to be declared but never
 * set by anything, so the fade never rendered.)
 */
function useScrollEdges(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.dataset.fadeTop = String(el.scrollTop > 1);
      el.dataset.fadeBottom = String(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [ref]);
}

function MasterSidebar({
  activeView,
  onViewChange,
  sidebarWidth,
  setSidebarWidth,
  isCollapsed,
  onToggleCollapse,
  activeEvidenceTab,
  onEvidenceTabChange,
  analysisResult,
  isFolding = false,
  foldingPhase = null,
  isBiophysicalLoading = false,
  isClinicalLoading = false,
  isPocketLoading = false,
  dynamut2Status = null,
  ddmutStatus = null,
  isNarrativeLoading = false,
  isLoadingSearch = false,
  loadingStep = "",
  unreadConsoleCount = 0,
  isDrawerMode = false,
  isDrawerOpen = false,
  onCloseDrawer,
}: MasterSidebarProps) {
  const { settings } = useSettings();
  const defaultStructureView: MasterView =
    settings.defaultStructureModel === "esmfold" ? "structure_esmfold" : "structure_alphafold";
  const navRef = useRef<HTMLElement>(null);
  const activeRowRef = useRef<HTMLButtonElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  useScrollEdges(navRef);

  /* The drawer always shows the expanded rail. */
  const collapsed = isDrawerMode ? false : isCollapsed;

  /**
   * Has anything run yet? Before the first analysis the stage markers and sub-links point at empty
   * views, so they are withheld. A parent's sub-list still opens while that parent is active.
   */
  const hasRun = Boolean(
    analysisResult || isLoadingSearch || isBiophysicalLoading || isClinicalLoading ||
    isFolding || isPocketLoading || isNarrativeLoading
  );
  const currentWidth = isDrawerMode
    ? Math.min(Math.max(sidebarWidth, 248), 320)
    : collapsed
      ? SIDEBAR_WIDTH_COLLAPSED
      : sidebarWidth;

  /* Drawer: Escape closes it (only while open), and opening moves focus into it — the current
     row if there is one — so a keyboard user lands in the thing they just opened. */
  useEffect(() => {
    if (!isDrawerMode || !isDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseDrawer?.();
    };
    document.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => {
      (activeRowRef.current ?? navRef.current?.querySelector<HTMLButtonElement>("button"))?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
    };
  }, [isDrawerMode, isDrawerOpen, onCloseDrawer]);

  /** Set + persist a width in one place (keyboard steps and double-click reset). */
  const commitWidth = useCallback(
    (next: number) => {
      const clamped = clampSidebarWidth(next);
      setSidebarWidth(clamped);
      persist(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped));
    },
    [setSidebarWidth]
  );

  /* Pointer events (not mouse events) so pen and touch can resize too; pointer capture keeps the
     drag alive when the cursor outruns the 12px handle. Commits to storage once, on release. */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (collapsed || isDrawerMode || e.button !== 0) return;
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture?.(e.pointerId);
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      let lastWidth = startWidth;
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (me: PointerEvent) => {
        lastWidth = clampSidebarWidth(startWidth + me.clientX - startX);
        setSidebarWidth(lastWidth);
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsResizing(false);
        persist(SIDEBAR_WIDTH_STORAGE_KEY, String(lastWidth));
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [sidebarWidth, collapsed, isDrawerMode, setSidebarWidth]
  );

  /** Keyboard resize for the separator: Arrow keys ±16px, Home/End for the bounds. */
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

  /** One exit for every sidebar route, so the narrow-viewport drawer dismisses after a pick. */
  const navigate = useCallback(
    (view: MasterView) => {
      onViewChange(view);
      if (isDrawerMode) onCloseDrawer?.();
    },
    [onViewChange, isDrawerMode, onCloseDrawer]
  );

  const toggleHint = sidebarToggleHint();

  /* The active rail is one shared element: `layoutId` glides it between rows (and between the
     nav and the pinned footer). MotionConfig's reducedMotion neutralises it app-wide. */
  const activeRail = (
    <motion.span
      layoutId="ms-active-rail"
      className="ms-active-rail"
      transition={{ type: "spring", duration: 0.4, bounce: 0.12 }}
      aria-hidden="true"
    />
  );

  const loadedPdb = useVariantAnalysisStore(s => s.pdbText);
  const engineState = useVariantAnalysisStore(s => s.primaryBiophysics);
  const stageOf = (id: MasterView) =>
    getWorkflowStageStatus({
      ...engineState,
      view: id,
      result: analysisResult,
      isFolding,
      foldingPhase: foldingPhase ?? null,
      isBiophysicalLoading,
      isClinicalLoading,
      isLoadingSearch,
      loadingStep,
      isPocketLoading,
      dynamut2Status,
      ddmutStatus,
      isNarrativeLoading,
      hasStructureCoordinates: Boolean(loadedPdb),
    });

  return (
    <>
      {isDrawerMode && isDrawerOpen &&
        createPortal(
          <div className="ms-drawer-backdrop" onClick={onCloseDrawer} aria-hidden="true" />,
          document.body
        )}

      <aside
        className="ms-root"
        data-collapsed={collapsed}
        data-resizing={isResizing || undefined}
        data-drawer={isDrawerMode ? (isDrawerOpen ? "open" : "closed") : undefined}
        inert={isDrawerMode && !isDrawerOpen ? true : undefined}
        style={{ width: currentWidth, minWidth: currentWidth }}
        aria-label="Main navigation"
      >
        {/* ── Brand + collapse / close ── */}
        <div className="ms-brand" data-collapsed={collapsed}>
          {collapsed ? (
            /* Collapsed, the mark is the way back out, so it turns into the expand glyph on
               hover/focus instead of leaving the affordance to be discovered. */
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={`Expand sidebar (${toggleHint})`}
              title={`Expand sidebar (${toggleHint})`}
              className="ms-brand-mark group"
              data-expander="true"
            >
              <BrandMark size={32} className="transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0" />
              <PanelLeftOpen className="absolute w-4 h-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate("search")}
              className="ms-brand-mark"
              title="Go to Search"
              aria-label="Missense & Fold — go to Search"
            >
              <BrandMark size={32} />
            </button>
          )}

          <span className="ms-brand-wordmark" data-collapsed={collapsed} aria-hidden={collapsed || undefined}>
            Missense <span className="text-cs-text-accent">&amp; Fold</span>
          </span>

          {!collapsed && (
            isDrawerMode ? (
              /* In the drawer the old collapse toggle flipped the DESKTOP preference and left the
                 drawer open — the button did nothing visible. Here it closes the drawer. */
              <button
                type="button"
                onClick={onCloseDrawer}
                className={`${CHROME_ICON_BUTTON} ml-auto`}
                title="Close navigation"
                aria-label="Close navigation"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onToggleCollapse}
                className={`${CHROME_ICON_BUTTON} ml-auto`}
                title={`Collapse sidebar (${toggleHint})`}
                aria-label="Collapse sidebar"
                aria-keyshortcuts={toggleHint === "⌘B" ? "Meta+B" : "Control+B"}
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )
          )}
        </div>

        {/* ── Primary navigation ── */}
        <nav
          ref={navRef}
          className="ms-nav"
          aria-label="Primary navigation"
          id="master-sidebar-nav"
          data-tour="navigation-zones"
        >
          <div className="ms-nav-inner">
            {NAV_ZONES.map((zone, zoneIdx) => (
              <div key={zone.zoneLabel ?? `zone-${zoneIdx}`} className="ms-zone" role="group" aria-label={zone.zoneLabel ?? undefined}>
                {zone.zoneLabel && (
                  collapsed
                    ? <span className="ms-zone-divider" aria-hidden="true" />
                    : <span className="ms-zone-label" aria-hidden="true">{zone.zoneLabel}</span>
                )}

                {zone.items.map((item) => {
                  const { id } = item;
                  const isActive = isViewActive(id, activeView);
                  const { status, desc } = stageOf(id);
                  /* While a stage is running, degraded or failed, its own live sentence discloses
                     under the label; otherwise the row stays one line. */
                  const isLive = status === "progress" || status === "degraded" || status === "error";
                  const subOpen = !collapsed && (hasRun || isActive);

                  return (
                    <div key={id} className="ms-row">
                      <NavRow
                        item={item}
                        isActive={isActive}
                        collapsed={collapsed}
                        buttonRef={isActive ? activeRowRef : undefined}
                        onClick={() => navigate(id === "structure" ? defaultStructureView : id)}
                        liveText={isLive && desc ? desc : undefined}
                        status={status}
                        showStatus={hasRun && id !== "search"}
                        rail={activeRail}
                      />

                      {/* Sub-lists stay mounted; the grid disclosure morphs them with the width
                          animation instead of popping. */}
                      {id === "evidence" && (
                        <div className="ms-sub-list" data-open={subOpen}>
                          <div className="ms-sub-list-inner">
                            <div className="ms-sub-list-items">
                              {EVIDENCE_SUB_ITEMS.map((sub) => (
                                <SubNavItem
                                  key={sub.id}
                                  label={sub.label}
                                  isActive={activeView === "evidence" && activeEvidenceTab === sub.id}
                                  isStreaming={isEvidenceSubStreaming(sub.id, isBiophysicalLoading, analysisResult)}
                                  onClick={() => {
                                    navigate("evidence");
                                    onEvidenceTabChange(sub.id);
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {id === "structure" && (
                        <div className="ms-sub-list" data-open={subOpen}>
                          <div className="ms-sub-list-inner">
                            <div className="ms-sub-list-items">
                              {STRUCTURE_SUB_ITEMS.map((sub) => (
                                <SubNavItem
                                  key={sub.id}
                                  label={sub.label}
                                  isActive={activeView === sub.id}
                                  onClick={() => navigate(sub.id)}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        {/* ── Pinned utilities: outside the scroll area, always reachable ── */}
        <div className="ms-footer">
          {FOOTER_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <NavRow
                key={item.id}
                item={item}
                isActive={isActive}
                collapsed={collapsed}
                buttonRef={isActive ? activeRowRef : undefined}
                onClick={() => navigate(item.id)}
                badgeCount={item.id === "console" ? unreadConsoleCount ?? 0 : 0}
                showDescription={false}
                rail={activeRail}
              />
            );
          })}
        </div>

        {/* ── Resize handle — pointer + keyboard; 12px hit area, 2px visible line ── */}
        {!collapsed && !isDrawerMode && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-controls="master-sidebar-nav"
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_WIDTH_MIN}
            aria-valuemax={SIDEBAR_WIDTH_MAX}
            title="Drag to resize · double-click to reset"
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onKeyDown={handleResizeKeyDown}
            onDoubleClick={() => commitWidth(SIDEBAR_WIDTH_DEFAULT)}
            className="ms-resize-handle"
          />
        )}
      </aside>
    </>
  );
}

export default React.memo(MasterSidebar);

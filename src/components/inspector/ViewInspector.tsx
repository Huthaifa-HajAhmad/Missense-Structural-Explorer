import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  PanelRightClose,
  PanelRightOpen,
  Layers,
  BarChart2,
  Activity,
  Map,
  FlaskConical,
  FileText,
  BookOpen,
  SlidersHorizontal,
  Info
} from "lucide-react";
import { AnalysisResult, PdbHomolog, EnergeticsData, PocketResult } from "../../types";
import { MasterView } from "../MasterSidebar";
import { revealInspectorSection, useInspectorFocus } from "../../lib/inspectorFocus";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { useSettings } from "../../context/SettingsContext";
import type { FoldxProgress } from "../../shared/foldxPhase";

import StructureInspector from "./StructureInspector";
import EvidenceInspector from "./EvidenceInspector";
import PerturbationRail from "./PerturbationRail";
import ResidueShiftInspector from "./ResidueShiftInspector";
import SplicingRail from "./SplicingRail";
import EnergeticsInspector from "./EnergeticsInspector";
import LandscapeInspector from "./LandscapeInspector";
import InsightsInspector from "./InsightsInspector";
import LiteratureInspector from "./LiteratureInspector";
import type { LiteratureEvidence } from "../../shared/literatureEvidence";
import ReportInspector from "./ReportInspector";

export interface ViewInspectorProps {
  activeView: MasterView;
  onViewChange: (view: MasterView) => void;
  analysisResult: AnalysisResult | null;
  isFolding: boolean;
  /** Server-reported FoldX phase; `null`/absent must render as "not reported", never as a guess. */
  foldingProgress?: FoldxProgress | null;
  foldingStatus?: "failed" | "success" | "unavailable" | null;
  foldingError?: string | null;
  foldingDdG?: number | null;
  foldingEnergetics?: EnergeticsData | null;
  isBiophysicalLoading: boolean;
  isClinicalLoading: boolean;
  isNarrativeLoading?: boolean;
  gene: string;
  variant: string;
  uniprotId?: string;
  homologs?: PdbHomolog[];
  isHomologsLoading?: boolean;
  customPdbUrl?: string | null;
  setCustomPdbUrl?: (url: string | null) => void;
  dynamut2Status?: "pending" | "unavailable" | "done" | null;
  ddmutStatus?: "pending" | "unavailable" | "done" | null;
  thermompnnStatus?: "pending" | "unavailable" | "done" | "error" | null;
  thermompnnError?: string | null;
  disruptionPredictor?: { plddt?: number } | null;
  literatureSearchQuery?: string;
  onLiteratureSearch?: (query: string) => void;
  /** The Literature view's evidence model (filters applied): the rail traces and exports from it. */
  literatureEvidence?: LiteratureEvidence | null;
  metricMode?: "mean" | "max";
  setMetricMode?: (mode: "mean" | "max") => void;
  windowSize?: number;
  setWindowSize?: (size: number) => void;
  viewMode?: "wildtype" | "mutant" | "superimposed";
  setViewMode?: (mode: "wildtype" | "mutant" | "superimposed") => void;
  activeEvidenceTab?: string;
  onSelectEvidenceTab?: (tab: string) => void;
  onSelectResidueIndex?: (idx: number) => void;
  metrics?: any;
  active3dModelTab?: "alphafold2" | "esmfold2" | "esm3";
  /** P2Rank output backing the Residue Shifts inspector's cavity narrative. */
  computedPocket?: PocketResult | null;
  isPocketLoading?: boolean;
  pocketError?: string | null;
  onRetryPocket?: () => void | Promise<void>;
  /** Re-runs AI narrative synthesis for the current variant. */
  onRetryNarrative?: () => void | Promise<void>;
}

const VIEW_TITLES: Record<MasterView, { title: string; subtitle: string; Icon: React.ComponentType<{ className?: string }> }> = {
  search: { title: "Variant Workspace", subtitle: "Query & History", Icon: SlidersHorizontal },
  evidence: { title: "Evidence Lineage", subtitle: "Genomic & Database Provenance", Icon: BarChart2 },
  /*
   * Named for the view, not for a model: "AlphaFold Inspector · Full-Length 3D Model" stayed on screen
   * over a FoldX variant built on a crystal template, and "ESMFold-2 Inspector" over structures the
   * ESM Atlas's ESMFold v1 had folded. The rail itself names what is on the canvas.
   */
  structure: { title: "3D structure", subtitle: "Coordinates, comparison & provenance", Icon: Layers },
  structure_alphafold: { title: "3D structure · AlphaFold2 view", subtitle: "AlphaFold model, FoldX variant", Icon: Layers },
  structure_esmfold: { title: "3D structure · ESMFold view", subtitle: "De novo wild type and variant", Icon: Layers },
  /* Main renamed `energetics` and `landscape`; the 3D branch renamed the three structure entries.
     Each side's renames are kept. */
  energetics: { title: "Evidence Lineage", subtitle: "How the ΔΔG reading was reached", Icon: Activity },
  landscape: { title: "Landscape", subtitle: "Selection, display and sources", Icon: Map },
  insights: { title: "Synthesis Provenance", subtitle: "AI Telemetry & ACMG Rules Trace", Icon: FlaskConical },
  report: { title: "Report Generator", subtitle: "Section Filters & Report Fingerprint", Icon: FileText },
  literature: { title: "Evidence Lineage", subtitle: "How this list was obtained", Icon: BookOpen },
  console: { title: "Developer Console", subtitle: "Telemetry & Logs", Icon: SlidersHorizontal },
  /* The inspector rail is hidden on the About view, but the record is exhaustive
     by type — a programmatic navigation must not render an undefined title. */
  about: { title: "Workspace Guide", subtitle: "Version & Data Sources", Icon: Info },
};

/**
 * Per-subtab inspector subtitles for the Evidence view. The static
 * "Genomic & Database Provenance" line gave no orientation as the reader moved
 * between the ten evidence tabs; naming the active surface does.
 */
const EVIDENCE_TAB_SUBTITLES: Record<string, string> = {
  clinical: "Population Data & Clinical DBs",
  predictors: "In-Silico Ensemble Calibration",
  alphagenome: "AlphaGenome variant impact (AVI)",
  splicing: "Splice rule & junction geometry",
  structure: "Residue Shifts & Pocket Provenance",
  perturbation: "Structural perturbation trace",
  function: "Functional Domains & Features",
  interfaces: "Interfaces & partner provenance"
};

/** Panel width bounds. Previously duplicated as literals in the initializer and the drag. */
const INSPECTOR_MIN_WIDTH = 280;
const INSPECTOR_MAX_WIDTH = 540;

/** Reveal retries: short enough to feel instant, long enough to survive a commit. */
const MAX_REVEAL_ATTEMPTS = 6;
const REVEAL_RETRY_MS = 16;

export const ViewInspector: React.FC<ViewInspectorProps> = ({
  activeView,
  onViewChange,
  analysisResult,
  isFolding,
  foldingProgress = null,
  foldingStatus = null,
  foldingError = null,
  foldingDdG = null,
  foldingEnergetics = null,
  isBiophysicalLoading,
  isClinicalLoading,
  isNarrativeLoading = false,
  gene,
  variant,
  homologs = [],
  isHomologsLoading = false,
  customPdbUrl = null,
  setCustomPdbUrl,
  dynamut2Status = null,
  ddmutStatus = null,
  thermompnnStatus = null,
  thermompnnError = null,
  disruptionPredictor = null,
  literatureSearchQuery = "",
  onLiteratureSearch,
  literatureEvidence = null,
  metricMode = "mean",
  setMetricMode,
  windowSize = 31,
  setWindowSize,
  viewMode = "wildtype",
  setViewMode,
  activeEvidenceTab,
  onSelectEvidenceTab,
  onSelectResidueIndex,
  metrics,
  active3dModelTab = "alphafold2",
  computedPocket = null,
  isPocketLoading = false,
  pocketError = null,
  onRetryPocket,
  onRetryNarrative
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("cs-inspector-collapsed") === "true";
  });

  /**
   * Read directly from the shared stores rather than threading two more props through
   * every intermediate view: the perturbation selection is produced by the model cards in
   * the main column and consumed here, the same way ReportInspector reads reportSections.
   */
  const activePerturbationModel = useVariantAnalysisStore(s => s.activePerturbationModel);
  const saprotEngine = useSettings().settings.saprotEngine;
  /**
   * The tab reads its geometry from the biophysics slice, while this panel receives
   * `foldingEnergetics` as a prop but no `structuralDiff`. Reading the slice here keeps
   * the inspector's score decomposition in step with the verdict in the main column.
   */
  const primaryStructuralDiff = useVariantAnalysisStore(s => s.structuralDiff);

  const [inspectorWidth, setInspectorWidth] = useState<number>(() => {
    const saved = localStorage.getItem("cs-inspector-width");
    const parsed = saved ? parseInt(saved, 10) : 320;
    return isNaN(parsed) ? 320 : Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, parsed));
  });

  /** Clamped width setter shared by the mouse drag and the keyboard resize paths. */
  const applyWidth = useCallback((next: number) => {
    const clamped = Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, next));
    setInspectorWidth(clamped);
    localStorage.setItem("cs-inspector-width", String(clamped));
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isCollapsed) return;
      const startX = e.clientX;
      const startWidth = inspectorWidth;
      const handleMouseMove = (me: MouseEvent) => {
        // Dragging left (negative dx) increases inspector width on right panel
        applyWidth(startWidth - (me.clientX - startX));
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
    [inspectorWidth, isCollapsed, applyWidth]
  );

  /**
   * Keyboard equivalent of the drag handle. The panel's narrow end degrades content
   * legibility, so resizing must not be mouse-only.
   */
  const handleSeparatorKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isCollapsed) return;
      const step = e.shiftKey ? 40 : 10;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        applyWidth(inspectorWidth + step); // left edge moves left => wider
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        applyWidth(inspectorWidth - step);
      } else if (e.key === "Home") {
        e.preventDefault();
        applyWidth(INSPECTOR_MIN_WIDTH);
      } else if (e.key === "End") {
        e.preventDefault();
        applyWidth(INSPECTOR_MAX_WIDTH);
      }
    },
    [inspectorWidth, isCollapsed, applyWidth]
  );

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("cs-inspector-collapsed", String(next));
      return next;
    });
  };

  /** Scroll container for the inspector body, used to reveal focused sections. */
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Pending reveal retry, so it can be cancelled on unmount. */
  const revealTimerRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, []);

  /**
   * Reveal a section on request from a main-column surface.
   *
   * A collapsed inspector mounts its body only after the state update commits, so
   * the first lookup can legitimately miss and the reveal is retried on a short
   * timer. Three properties this needs and previously lacked:
   *
   *   - **Cancellable.** The pending retry is held in a ref and cleared on
   *     unmount, so it cannot move focus on behalf of a component that is gone.
   *   - **Reported.** Exhausting the attempts used to be silent: the button
   *     visibly did nothing and nothing was logged, so the failure was
   *     undiagnosable. It now warns in development.
   *   - **Frame-independent.** The first attempt runs synchronously, which is
   *     already sufficient on the click path (React flushes a discrete event
   *     before returning), so a reveal never depends on a frame callback.
   */
  const handleSectionFocusRequest = useCallback((sectionId: string) => {
    setIsCollapsed(prev => {
      if (!prev) return prev;
      localStorage.setItem("cs-inspector-collapsed", "false");
      return false;
    });

    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }

    let attempts = 0;
    const attemptReveal = () => {
      if (!isMountedRef.current) return;
      if (revealInspectorSection(sectionId, bodyRef.current)) return;
      attempts += 1;
      if (attempts >= MAX_REVEAL_ATTEMPTS) {
        if (import.meta.env.DEV) {
          console.warn(
            `[Inspector] Section "${sectionId}" was requested but never appeared after ${attempts} attempts. ` +
              `Check that the active inspector pane renders that id.`
          );
        }
        return;
      }
      revealTimerRef.current = window.setTimeout(attemptReveal, REVEAL_RETRY_MS);
    };
    attemptReveal();
  }, []);

  useInspectorFocus(handleSectionFocusRequest);

  const headerInfo = VIEW_TITLES[activeView] || {
    title: "Inspector Panel",
    subtitle: "Context & Controls",
    Icon: SlidersHorizontal
  };

  /** Evidence tabs override the static subtitle with the active surface. */
  const evidenceSubtitle =
    activeView === "evidence"
      ? EVIDENCE_TAB_SUBTITLES[(activeEvidenceTab || "").toLowerCase()]
      : undefined;
  const headerSubtitle = evidenceSubtitle ?? headerInfo.subtitle;

  const Icon = headerInfo.Icon;

  if (isCollapsed) {
    return (
      <aside 
        className="w-10 flex-shrink-0 border-l border-cs-border bg-cs-surface flex flex-col items-center py-4 justify-between transition-all duration-200"
        aria-label="Collapsed Context Inspector"
      >
        <button
          type="button"
          onClick={toggleCollapse}
          className="p-2 rounded-lg hover:bg-cs-surface-2 text-cs-text-secondary hover:text-cs-accent-clay cursor-pointer transition-colors"
          title="Expand Context Inspector"
          aria-label="Expand Context Inspector"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center gap-2 py-4">
          <Icon className="w-4 h-4 text-cs-text-muted" />
          <span 
            className="text-[10px] font-mono uppercase tracking-widest text-cs-text-muted select-none"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {headerInfo.title}
          </span>
        </div>

        <div className="w-2 h-2 rounded-full bg-cs-border" />
      </aside>
    );
  }

  return (
    <aside 
      className="relative flex-shrink-0 border-l border-cs-border bg-cs-surface flex flex-col h-full overflow-hidden transition-[width] duration-75"
      style={{
        width: inspectorWidth,
        minWidth: inspectorWidth,
      }}
      aria-label="Context & Provenance Inspector"
    >
      {/* ── Left-edge resize handle (mouse + keyboard) ── */}
      <div
        onMouseDown={handleMouseDown}
        onKeyDown={handleSeparatorKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector panel"
        aria-valuenow={inspectorWidth}
        aria-valuemin={INSPECTOR_MIN_WIDTH}
        aria-valuemax={INSPECTOR_MAX_WIDTH}
        tabIndex={0}
        className="absolute top-0 left-0 w-1.5 h-full transition-colors hover:bg-slate-500/20 active:bg-cs-accent-clay/30 focus:bg-cs-accent-clay/40 focus:outline-none cursor-col-resize select-none"
        style={{ zIndex: 20 }}
        title="Drag to resize inspector panel (or focus and use arrow keys)"
      />

      {/* ── Inspector Header ── */}
      <div className="px-4 py-3.5 border-b border-cs-border-subtle flex items-center justify-between bg-cs-surface-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-cs-accent-clay/10 text-cs-accent-clay shrink-0">
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-xs text-cs-text-primary truncate">
              {headerInfo.title}
            </span>
            <span className="text-[10px] text-cs-text-muted truncate font-sans">
              {headerSubtitle}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleCollapse}
          className="p-1.5 rounded-lg hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-accent-clay cursor-pointer transition-colors shrink-0"
          title="Collapse Inspector Panel"
          aria-label="Collapse Inspector Panel"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* ── Dynamic Inspector Sub-view ── */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-20 space-y-4">
        {(activeView === "structure" || activeView === "structure_alphafold" || activeView === "structure_esmfold") && (
          <StructureInspector
            family={activeView === "structure_esmfold" ? "esmfold" : "alphafold"}
            setCustomPdbUrl={setCustomPdbUrl}
          />
        )}

        {activeView === "evidence" && (activeEvidenceTab || "").toLowerCase() === "splicing" && (
          analysisResult ? (
            <SplicingRail
              analysisResult={analysisResult}
              isBiophysicalLoading={isBiophysicalLoading}
            />
          ) : null
        )}

        {activeView === "evidence" && (activeEvidenceTab || "").toLowerCase() === "structure" && (
          <ResidueShiftInspector
            analysisResult={analysisResult}
            computedPocket={computedPocket}
            isPocketLoading={isPocketLoading}
            pocketError={pocketError}
            isBiophysicalLoading={isBiophysicalLoading}
            isNarrativeLoading={isNarrativeLoading}
            onRetryPocket={onRetryPocket}
            onRetryNarrative={onRetryNarrative}
          />
        )}

        {activeView === "evidence" && (activeEvidenceTab || "").toLowerCase() === "perturbation" && (
          <PerturbationRail
            analysisResult={analysisResult}
            activePerturbationModel={activePerturbationModel}
            saprotEngine={saprotEngine}
            foldingEnergetics={foldingEnergetics}
            structuralDiff={primaryStructuralDiff}
            metrics={metrics}
            isFolding={isFolding}
            foldingStatus={foldingStatus}
            foldingError={foldingError}
          />
        )}

        {activeView === "evidence" &&
          (activeEvidenceTab || "").toLowerCase() !== "splicing" &&
          (activeEvidenceTab || "").toLowerCase() !== "structure" &&
          (activeEvidenceTab || "").toLowerCase() !== "perturbation" && (
          <EvidenceInspector
            analysisResult={analysisResult}
            activeEvidenceTab={activeEvidenceTab}
            onSelectEvidenceTab={onSelectEvidenceTab}
            foldingDdG={foldingDdG}
            foldingEnergetics={foldingEnergetics}
          />
        )}

        {activeView === "energetics" && (
          <EnergeticsInspector
            analysisResult={analysisResult}
            foldingEnergetics={foldingEnergetics}
            foldingStatus={foldingStatus}
            foldingError={foldingError}
            dynamut2Status={dynamut2Status}
            ddmutStatus={ddmutStatus}
            thermompnnStatus={thermompnnStatus}
            thermompnnError={thermompnnError}
            disruptionPredictor={disruptionPredictor}
            isFolding={isFolding}
            foldingDdG={foldingDdG}
          />
        )}

        {activeView === "landscape" && (
          <LandscapeInspector
            analysisResult={analysisResult}
            metricMode={metricMode}
            setMetricMode={setMetricMode}
            windowSize={windowSize}
            setWindowSize={setWindowSize}
            onSelectResidueIndex={onSelectResidueIndex}
          />
        )}

        {activeView === "insights" && (
          <InsightsInspector
            analysisResult={analysisResult}
            isNarrativeLoading={isNarrativeLoading}
          />
        )}

        {activeView === "literature" && (
          <LiteratureInspector
            gene={gene}
            variant={variant}
            searchQuery={literatureSearchQuery}
            onSearch={onLiteratureSearch}
            evidence={literatureEvidence}
          />
        )}

        {activeView === "report" && (
          <ReportInspector
            analysisResult={analysisResult}
            gene={gene}
            variant={variant}
            onRetryNarrative={onRetryNarrative}
            isNarrativeLoading={isNarrativeLoading}
            onNavigateToView={onViewChange}
          />
        )}
      </div>
    </aside>
  );
};

export default React.memo(ViewInspector);

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
  SlidersHorizontal 
} from "lucide-react";
import { AnalysisResult, PdbHomolog, EnergeticsData } from "../../types";
import { MasterView } from "../MasterSidebar";

import StructureInspector from "./StructureInspector";
import EvidenceInspector from "./EvidenceInspector";
import EnergeticsInspector from "./EnergeticsInspector";
import LandscapeInspector from "./LandscapeInspector";
import InsightsInspector from "./InsightsInspector";
import LiteratureInspector from "./LiteratureInspector";
import ReportInspector from "./ReportInspector";

export interface ViewInspectorProps {
  activeView: MasterView;
  onViewChange: (view: MasterView) => void;
  analysisResult: AnalysisResult | null;
  isFolding: boolean;
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
  comparePdbData?: string | null;
  hasMutantModel?: boolean;
  active3dModelTab?: "alphafold2" | "esm3";
  bFactorMetadata?: { source: string; details?: string } | null;
}

const VIEW_TITLES: Record<MasterView, { title: string; subtitle: string; Icon: React.ComponentType<{ className?: string }> }> = {
  search: { title: "Variant Workspace", subtitle: "Query & History", Icon: SlidersHorizontal },
  evidence: { title: "Evidence Lineage", subtitle: "Genomic & Database Provenance", Icon: BarChart2 },
  structure: { title: "Structure Inspector", subtitle: "Models, Homologs & Probes", Icon: Layers },
  structure_alphafold: { title: "AlphaFold Inspector", subtitle: "Full-Length 3D Model", Icon: Layers },
  structure_esmfold: { title: "ESM3 / ESMFold Inspector", subtitle: "Transformer De Novo 3D Model", Icon: Layers },
  energetics: { title: "Stability Telemetry", subtitle: "Engines & Thermodynamic Baseline", Icon: Activity },
  landscape: { title: "Landscape Controls", subtitle: "Intolerance & Domain Minimap", Icon: Map },
  insights: { title: "Synthesis Provenance", subtitle: "AI Telemetry & ACMG Rules Trace", Icon: FlaskConical },
  report: { title: "Report Generator", subtitle: "Section Filters & Audit Hash", Icon: FileText },
  literature: { title: "Literature Tools", subtitle: "Query Provenance & Citation Export", Icon: BookOpen },
  console: { title: "Developer Console", subtitle: "Telemetry & Logs", Icon: SlidersHorizontal },
};

export const ViewInspector: React.FC<ViewInspectorProps> = ({
  activeView,
  onViewChange,
  analysisResult,
  isFolding,
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
  comparePdbData,
  hasMutantModel,
  active3dModelTab = "alphafold2",
  bFactorMetadata
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("cs-inspector-collapsed") === "true";
  });

  const [inspectorWidth, setInspectorWidth] = useState<number>(() => {
    const saved = localStorage.getItem("cs-inspector-width");
    const parsed = saved ? parseInt(saved, 10) : 320;
    return isNaN(parsed) ? 320 : Math.max(280, Math.min(540, parsed));
  });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isCollapsed) return;
      const startX = e.clientX;
      const startWidth = inspectorWidth;
      const handleMouseMove = (me: MouseEvent) => {
        // Dragging left (negative dx) increases inspector width on right panel
        const newWidth = Math.max(280, Math.min(540, startWidth - (me.clientX - startX)));
        setInspectorWidth(newWidth);
        localStorage.setItem("cs-inspector-width", String(newWidth));
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
    [inspectorWidth, isCollapsed]
  );

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("cs-inspector-collapsed", String(next));
      return next;
    });
  };

  const headerInfo = VIEW_TITLES[activeView] || {
    title: "Inspector Panel",
    subtitle: "Context & Controls",
    Icon: SlidersHorizontal
  };

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
      className="relative flex-shrink-0 border-l border-cs-border bg-cs-surface flex flex-col h-full overflow-hidden transition-[width] duration-75 select-none"
      style={{
        width: inspectorWidth,
        minWidth: inspectorWidth,
      }}
      aria-label="Context & Provenance Inspector"
    >
      {/* ── Left-edge resize drag handle ── */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 left-0 w-1.5 h-full transition-colors hover:bg-slate-500/20 active:bg-cs-accent-clay/30 cursor-col-resize select-none"
        style={{ zIndex: 20 }}
        title="Drag to resize inspector panel"
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
              {headerInfo.subtitle}
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
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-20 space-y-4">
        {(activeView === "structure" || activeView === "structure_alphafold" || activeView === "structure_esmfold") && (
          <StructureInspector
            analysisResult={analysisResult}
            viewMode={viewMode}
            setViewMode={setViewMode}
            isFolding={isFolding}
            foldingStatus={foldingStatus}
            foldingDdG={foldingDdG}
            homologs={homologs}
            isHomologsLoading={isHomologsLoading}
            customPdbUrl={customPdbUrl}
            setCustomPdbUrl={setCustomPdbUrl}
            active3dModelTab={active3dModelTab}
            metrics={metrics}
            comparePdbData={comparePdbData}
            hasMutantModel={hasMutantModel}
            bFactorMetadata={bFactorMetadata}
          />
        )}

        {activeView === "evidence" && (
          <EvidenceInspector
            analysisResult={analysisResult}
            activeEvidenceTab={activeEvidenceTab}
            onSelectEvidenceTab={onSelectEvidenceTab}
            foldingDdG={foldingDdG}
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
            analysisResult={analysisResult}
            searchQuery={literatureSearchQuery}
            onSearch={onLiteratureSearch}
          />
        )}

        {activeView === "report" && (
          <ReportInspector
            analysisResult={analysisResult}
            gene={gene}
            variant={variant}
          />
        )}
      </div>
    </aside>
  );
};

export default React.memo(ViewInspector);

import React from "react";
import {
  Search, BarChart2, Layers, Activity, Map, FlaskConical, FileText,
  CheckCircle2, Circle, ArrowRight
} from "lucide-react";
import { AnalysisResult, PdbHomolog } from "../types";
import { MasterView } from "./MasterSidebar";
import { getWorkflowStageStatus } from "../shared/workflowStatus";
import LandscapeMinimap from "./LandscapeMinimap";

interface ContextRailProps {
  activeView: MasterView;
  onViewChange: (view: MasterView) => void;
  analysisResult: AnalysisResult | null;
  isFolding: boolean;
  isBiophysicalLoading: boolean;
  isClinicalLoading: boolean;
  isNarrativeLoading?: boolean;
  gene: string;
  variant: string;
  homologs?: PdbHomolog[];
  isHomologsLoading?: boolean;
  customPdbUrl?: string | null;
  setCustomPdbUrl?: (url: string | null) => void;
  isLoadingSearch?: boolean;
  loadingStep?: string;
  isPocketLoading?: boolean;
  dynamut2Status?: string | null;
  ddmutStatus?: string | null;
  metricMode?: "mean" | "max";
  setMetricMode?: (mode: "mean" | "max") => void;
  windowSize?: number;
  setWindowSize?: (size: number) => void;
  viewMode?: "wildtype" | "mutant";
  setViewMode?: (mode: "wildtype" | "mutant") => void;
  foldingStatus?: "failed" | "success" | null;
  foldingDdG?: number | null;
}

const WORKFLOW_STEPS: { view: MasterView; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { view: "evidence",   label: "Evidence",     Icon: BarChart2    },
  { view: "structure",  label: "3D Structure", Icon: Layers       },
  { view: "energetics", label: "Energetics",   Icon: Activity     },
  { view: "landscape",  label: "Landscape",    Icon: Map          },
  { view: "insights",   label: "Insights",     Icon: FlaskConical },
  { view: "report",     label: "Report",       Icon: FileText     },
];

/** Quick-link shortcuts rendered in the context rail, context-sensitive per active view */
function getQuickLinks(
  activeView: MasterView
): { label: string; target: MasterView }[] {
  switch (activeView) {
    case "evidence":
      return [
        { label: "View in 3D Structure", target: "structure" },
        { label: "Stability Energetics", target: "energetics" },
      ];
    case "structure":
      return [
        { label: "Stability Energetics", target: "energetics" },
        { label: "Evidence Dashboard",   target: "evidence"   },
      ];
    case "energetics":
      return [
        { label: "View in 3D Structure", target: "structure" },
        { label: "Pathogenicity Landscape", target: "landscape" },
      ];
    case "landscape":
      return [
        { label: "Evidence Dashboard", target: "evidence"   },
        { label: "AI Insights",        target: "insights"   },
      ];
    case "insights":
      return [
        { label: "Clinical Report", target: "report"   },
        { label: "Evidence Dashboard", target: "evidence" },
      ];
    case "report":
      return [
        { label: "AI Insights",       target: "insights"  },
        { label: "Evidence Dashboard", target: "evidence" },
      ];
    default:
      return [];
  }
}

/** Step icon: identical color mapping across sidebar, context rail, and tables */
function StepIcon({ status }: { status: "complete" | "progress" | "pending" }) {
  if (status === "complete") {
    return (
      <CheckCircle2
        className="cs-step-icon-complete flex-shrink-0"
        style={{ width: 14, height: 14 }}
        aria-label="Complete"
      />
    );
  }
  if (status === "progress") {
    return (
      <span
        className="cs-spinner cs-spinner-sm cs-step-icon-in-progress flex-shrink-0"
        role="status"
        aria-label="In progress"
      />
    );
  }
  return (
    <Circle
      className="cs-step-icon-not-started flex-shrink-0"
      style={{ width: 14, height: 14 }}
      aria-label="Not started"
    />
  );
}

const STEP_PROGRESS_SUBTEXT: Record<MasterView, string> = {
  evidence: "Fetching ClinVar, gnomAD & predictor thresholds…",
  structure: "Resolving AlphaFold, ESMFold & PDB structural models…",
  structure_alphafold: "Resolving AlphaFold, ESMFold & PDB structural models…",
  structure_esmfold: "Resolving ESMFold 3D structural models…",
  energetics: "Calculating FoldX, DynaMut2, DDMut & ThermoMPNN stability changes…",
  landscape: "Mapping sequence positioning & domain boundaries…",
  insights: "Synthesizing pathogenicity & ACMG/AMP criteria…",
  report: "Compiling clinical summary & evidence export…",
  console: "Surfacing real-time system logs and diagnostic events…",
  search: "",
  literature: "Displaying PubMed and ClinVar literature summaries…",
};

function ContextRail({
  activeView,
  onViewChange,
  analysisResult,
  isFolding,
  isBiophysicalLoading,
  isClinicalLoading,
  isNarrativeLoading = false,
  gene,
  variant,
  homologs = [],
  isHomologsLoading = false,
  customPdbUrl = null,
  setCustomPdbUrl,
  isLoadingSearch = false,
  loadingStep = "",
  isPocketLoading = false,
  dynamut2Status = null,
  ddmutStatus = null,
  metricMode = "max",
  setMetricMode,
  windowSize = 31,
  setWindowSize,
  viewMode = "wildtype",
  setViewMode,
  foldingStatus = null,
  foldingDdG = null,
}: ContextRailProps) {
  const quickLinks = getQuickLinks(activeView);

  return (
    <aside className="context-rail" aria-label="Workflow progress and navigation">

      {/* ── Workflow progress list ── */}
      <div className="context-rail-section">
        <span className="context-rail-section-label">Workflow</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {WORKFLOW_STEPS.map(({ view, label, Icon }) => {
            const { status, desc } = getWorkflowStageStatus(
              view,
              analysisResult,
              isFolding,
              isBiophysicalLoading,
              isClinicalLoading,
              isLoadingSearch,
              loadingStep,
              isPocketLoading,
              dynamut2Status,
              ddmutStatus,
              isNarrativeLoading
            );
            const isCurrent =
              activeView === view ||
              (view === "structure" && (activeView === "structure_alphafold" || activeView === "structure_esmfold"));
            return (
              <div key={view} className="flex flex-col">
                <button
                  type="button"
                  className={`context-rail-step${isCurrent ? " current" : ""}`}
                  onClick={() => {
                    if (view === "structure") {
                      onViewChange("structure_alphafold");
                    } else {
                      onViewChange(view);
                    }
                  }}
                  aria-current={isCurrent ? "step" : undefined}
                  title={label}
                >
                  <StepIcon status={status} />
                  <span
                    style={{
                      color: isCurrent ? "var(--cs-accent-clay)" : "var(--cs-text-muted)",
                      display: "flex",
                      flexShrink: 0,
                    }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="context-rail-step-label">{label}</span>
                </button>
                {status === "progress" && (
                  <div className="flex items-center gap-1.5 pl-7 pb-1.5 pt-0.5 text-[10.5px] font-sans leading-tight" style={{ color: "var(--cs-accent-clay)" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--cs-accent-clay)] animate-pulse shrink-0" />
                    <span className="font-medium break-words leading-tight">{desc || STEP_PROGRESS_SUBTEXT[view] || "Running stage calculations…"}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Structure Variant (WT vs Mutant) ── */}
      {(activeView === "structure" || activeView === "structure_alphafold") && setViewMode && (
        <div className="context-rail-section border-t pt-3 mt-1" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <span className="context-rail-section-label">
            Structure Variant
          </span>
          <div className="grid grid-cols-2 gap-2 mt-1.5">
            <button
              type="button"
              onClick={() => setViewMode("wildtype")}
              className={`p-2 rounded-lg border text-[11px] font-semibold text-center transition-all cursor-pointer ${
                viewMode === "wildtype"
                  ? "border-[var(--cs-border)] shadow-none"
                  : "border-transparent hover:bg-[var(--cs-bg-subtle)]"
              }`}
              style={{
                background: viewMode === "wildtype" ? "var(--cs-surface-2)" : "transparent",
                color: viewMode === "wildtype" ? "var(--cs-text-primary)" : "var(--cs-text-secondary)"
              }}
            >
              Wild-Type (AF2)
            </button>
            <button
              type="button"
              disabled={isFolding || foldingStatus !== "success"}
              onClick={() => setViewMode("mutant")}
              className={`p-2 rounded-lg border text-[11px] font-semibold text-center transition-all cursor-pointer ${
                viewMode === "mutant"
                  ? "border-[var(--cs-border)] shadow-none"
                  : "border-transparent hover:bg-[var(--cs-bg-subtle)]"
              } ${isFolding || foldingStatus !== "success" ? "opacity-40 cursor-not-allowed" : ""}`}
              style={{
                background: viewMode === "mutant" ? "var(--cs-surface-2)" : "transparent",
                color: viewMode === "mutant" ? "var(--cs-text-primary)" : "var(--cs-text-secondary)"
              }}
              title={
                isFolding 
                  ? "Folding mutant structure..." 
                  : foldingStatus !== "success" 
                    ? "FoldX Mutant structure simulation not computed. Run biophysical evaluation first." 
                    : "Show FoldX biophysical mutant structure"
              }
            >
              {isFolding ? "Folding..." : "Mutant (FoldX)"}
            </button>
          </div>
          {foldingStatus === "success" && foldingDdG !== null && (
            <div className="mt-2 text-[10px] leading-normal p-2 rounded border font-mono" style={{ background: "rgba(16, 185, 129, 0.05)", borderColor: "rgba(16, 185, 129, 0.15)", color: "var(--cs-text-success)" }}>
              <span>FoldX ΔΔG: <strong>{foldingDdG.toFixed(2)}</strong> kcal/mol</span>
            </div>
          )}
        </div>
      )}

      {/* ── Alternative PDB Models (Homologs) ── */}
      {(activeView === "structure" || activeView === "structure_alphafold") && setCustomPdbUrl && (
        <div className="context-rail-section border-t pt-3 mt-1" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <span className="context-rail-section-label">
            PDB Models
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {/* Default AlphaFold option */}
            <button
              type="button"
              onClick={() => setCustomPdbUrl(null)}
              className={`p-2 px-2.5 rounded-lg border text-[11px] transition-all flex items-center gap-2.5 w-full text-left cursor-pointer ${
                customPdbUrl === null 
                  ? "border-[var(--cs-border)] shadow-none" 
                  : "border-transparent hover:bg-[var(--cs-bg-subtle)]"
              }`}
              style={{
                background: customPdbUrl === null ? "var(--cs-surface-2)" : "transparent",
              }}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${customPdbUrl === null ? "bg-emerald-500 animate-pulse" : "bg-[var(--cs-text-muted)]"}`} />
              <div className="flex flex-col text-left truncate w-full">
                <span className="font-mono font-semibold text-[12px]" style={{ color: "var(--cs-text-primary)" }}>AlphaFold Model</span>
                <span className="text-[10px] truncate font-sans" style={{ color: "var(--cs-text-secondary)" }}>Default full-length</span>
              </div>
            </button>

            {/* Loading homologs */}
            {isHomologsLoading && (
              <div className="flex items-center gap-1.5 p-2 text-[11px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
                <span className="cs-spinner cs-spinner-sm shrink-0" />
                <span>Searching PDB...</span>
              </div>
            )}

            {/* Homolog hits */}
            {!isHomologsLoading && homologs.map((hom) => {
              const homUrl = `https://files.rcsb.org/download/${hom.pdbId}.pdb`;
              const isSelected = customPdbUrl === homUrl;
              const identityVal = typeof hom.identity === "number" ? hom.identity : Math.round((hom.score || 0) * 100);
              const coverageVal = typeof hom.coverage === "number" ? hom.coverage : 80;

              return (
                <button
                  key={hom.pdbId}
                  type="button"
                  onClick={() => setCustomPdbUrl(homUrl)}
                  title={`${hom.title}\n• Sequence Identity: ${identityVal}% ID\n• Query Alignment Coverage: ${coverageVal}% Cov\n• Organism: ${hom.organism}\n• Method: ${hom.method}${hom.resolution ? ` (${hom.resolution} Å)` : ''}`}
                  className={`p-2 px-2.5 rounded-lg border text-[11px] transition-all flex items-center gap-2.5 w-full text-left cursor-pointer ${
                    isSelected 
                      ? "shadow-none" 
                      : "hover:bg-[var(--cs-bg-subtle)]"
                  }`}
                  style={{
                    background: isSelected ? "var(--cs-surface-2)" : "transparent",
                    borderColor: isSelected ? "var(--cs-accent)" : "var(--cs-border-subtle)"
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: isSelected ? "var(--cs-accent)" : "var(--cs-text-muted)"
                    }}
                  />
                  <div className="flex flex-col text-left truncate w-full gap-0.5">
                    <div className="flex items-center justify-between gap-1 w-full">
                      <span className="font-mono font-semibold text-[11.5px]" style={{ color: "var(--cs-text-primary)" }}>
                        {hom.pdbId}
                      </span>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold border shrink-0"
                        style={{
                          background: "var(--cs-surface-2)",
                          borderColor: "var(--cs-border)",
                          color: "var(--cs-text-secondary)"
                        }}
                      >
                        {identityVal}% ID · {coverageVal}% Cov
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] truncate font-sans" style={{ color: "var(--cs-text-secondary)" }}>
                      <span className="truncate italic">{hom.organism}</span>
                      {hom.resolution && (
                        <span className="font-mono text-[9px] shrink-0 ml-1" style={{ color: "var(--cs-text-muted)" }}>
                          {hom.resolution}Å
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {!isHomologsLoading && homologs.length === 0 && (
              <span className="text-[10px] p-2 italic font-mono" style={{ color: "var(--cs-text-muted)" }}>
                No homologs found (≥35% ID)
              </span>
            )}
          </div>

          {/* ESM3 warnings */}
          {analysisResult && (
            <div className="mt-2.5 text-[10px] leading-relaxed font-sans">
              {analysisResult.metadata?.mutatedSequence && (
                <>
                  {analysisResult.metadata.mutatedSequence.length > 768 ? (
                    <div className="text-amber-600 dark:text-amber-400 p-2.5 rounded-lg border bg-cs-surface-2 border-cs-border-subtle">
                      ⚠️ <strong>ESM3 Limit Exceeded:</strong> Protein exceeds Biohub's 768 aa limit. Switch 3D Structure tab to <strong>AlphaFold2</strong> to view modeling coordinates.
                    </div>
                  ) : analysisResult.metadata.mutatedSequence.length > 400 ? (
                    <div className="text-amber-600 dark:text-amber-400 p-2.5 rounded-lg border bg-cs-surface-2 border-cs-border-subtle">
                      ⚠️ <strong>ESM3 Token Required:</strong> Protein exceeds public 400 aa limit. An active Biohub API token is required in Settings to fold.
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Quick navigation links ── */}
      {quickLinks.length > 0 && (
        <div className="context-rail-section">
          <span className="context-rail-section-label">Go to</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {quickLinks.map(({ label, target }) => (
              <button
                key={target}
                type="button"
                onClick={() => onViewChange(target)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  color: "var(--cs-accent-clay)",
                  background: "transparent",
                  border: "none",
                  padding: "4px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                  transition: "background 0.12s",
                  fontFamily: "var(--cs-font-sans)",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "var(--cs-bg-subtle)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "transparent")
                }
              >
                <ArrowRight style={{ width: 12, height: 12, flexShrink: 0 }} />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Visualizer Controls ── */}
      {analysisResult && activeView === "landscape" && (
        <div className="context-rail-section border-t pt-3 mt-1" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <span className="context-rail-section-label">
            Visual Controls
          </span>
          <div className="flex flex-col gap-3 p-2.5 rounded-lg border text-[11px] font-sans bg-cs-surface-2 border-cs-border-subtle animate-fade-in">
            {/* Toggle */}
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase font-mono font-bold tracking-wider text-cs-text-muted">Metric Mode</span>
              <div className="flex rounded-lg border border-cs-border p-0.5 font-sans font-semibold text-[11px] bg-cs-surface">
                <button
                  type="button"
                  onClick={() => setMetricMode && setMetricMode("mean")}
                  className={`flex-1 py-1 rounded-md transition-all cursor-pointer text-center ${
                    metricMode === "mean"
                      ? "bg-cs-accent-clay text-white shadow-sm font-bold"
                      : "text-cs-text-muted hover:text-cs-text-primary"
                  }`}
                >
                  Mean
                </button>
                <button
                  type="button"
                  onClick={() => setMetricMode && setMetricMode("max")}
                  className={`flex-1 py-1 rounded-md transition-all cursor-pointer text-center ${
                    metricMode === "max"
                      ? "bg-cs-accent-clay text-white shadow-sm font-bold"
                      : "text-cs-text-muted hover:text-cs-text-primary"
                  }`}
                >
                  Peak
                </button>
              </div>
            </div>
            {/* Window Dropdown */}
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase font-mono font-bold tracking-wider text-cs-text-muted">Window Size</span>
              <div className="relative">
                <select
                  value={windowSize}
                  onChange={(e) => setWindowSize && setWindowSize(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-cs-border text-[11px] font-sans font-semibold bg-cs-surface text-cs-text-secondary cursor-pointer focus:outline-none focus:ring-1 focus:ring-cs-accent-clay"
                >
                  {[15, 21, 31, 41].map((size) => (
                    <option key={size} value={size}>
                      {size} residues
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Landscape Minimap Scatter ── */}
      {analysisResult && activeView === "landscape" && (
        <div className="context-rail-section border-t pt-3 mt-1" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <span className="context-rail-section-label">
            Landscape Minimap
          </span>
          <LandscapeMinimap
            landscapeData={analysisResult.landscapeData}
            currentAM={analysisResult.predictorData?.amPathogenicity}
            currentREVEL={analysisResult.conservationData?.revel}
            metricMode={metricMode}
          />
        </div>
      )}

    </aside>
  );
}

export default React.memo(ContextRail);



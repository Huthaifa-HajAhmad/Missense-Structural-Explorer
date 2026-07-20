import React from "react";
import {
  Search, BarChart2, Layers, Activity, Map, FlaskConical, FileText,
  CheckCircle2, Circle, ArrowRight
} from "lucide-react";
import { AnalysisResult, PdbHomolog } from "../types";
import { MasterView } from "./MasterSidebar";

interface ContextRailProps {
  activeView: MasterView;
  onViewChange: (view: MasterView) => void;
  analysisResult: AnalysisResult | null;
  isFolding: boolean;
  isBiophysicalLoading: boolean;
  isClinicalLoading: boolean;
  gene: string;
  variant: string;
  homologs?: PdbHomolog[];
  isHomologsLoading?: boolean;
  customPdbUrl?: string | null;
  setCustomPdbUrl?: (url: string | null) => void;
  isLoadingSearch?: boolean;
  loadingStep?: string;
}

/** Derives three-state status for each view tab from existing analysis data.
 *  complete → data is present | progress → actively computing | pending → not started */
function getTabStatus(
  view: MasterView,
  result: AnalysisResult | null,
  isFolding: boolean,
  isBiophysicalLoading: boolean,
  isClinicalLoading: boolean,
  isLoadingSearch?: boolean,
  loadingStep?: string
): "complete" | "progress" | "pending" {
  if (view === "search") return "complete";

  // 1. Landed state -> All 4 pipeline stages return complete!
  if (result != null) {
    return "complete";
  }

  // 2. Running state (Active search pipeline execution)
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
  structure: "Loading 3D structure & mapping PDB models…",
  energetics: "Calculating biophysical stability & ΔΔG impact…",
  landscape: "Mapping sequence positioning & domain boundaries…",
  insights: "Synthesizing pathogenicity & ACMG/AMP criteria…",
  report: "Compiling clinical summary & evidence export…",
  search: "",
};

export default function ContextRail({
  activeView,
  onViewChange,
  analysisResult,
  isFolding,
  isBiophysicalLoading,
  isClinicalLoading,
  gene,
  variant,
  homologs = [],
  isHomologsLoading = false,
  customPdbUrl = null,
  setCustomPdbUrl,
  isLoadingSearch = false,
  loadingStep = "",
}: ContextRailProps) {
  const quickLinks = getQuickLinks(activeView);

  return (
    <aside className="context-rail" aria-label="Workflow progress and navigation">

      {/* ── Workflow progress list ── */}
      <div className="context-rail-section">
        <span className="context-rail-section-label">Workflow</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {WORKFLOW_STEPS.map(({ view, label, Icon }) => {
            const status = getTabStatus(
              view, analysisResult, isFolding, isBiophysicalLoading, isClinicalLoading, isLoadingSearch, loadingStep
            );
            const isCurrent = activeView === view;
            return (
              <div key={view} className="flex flex-col">
                <button
                  type="button"
                  className={`context-rail-step${isCurrent ? " current" : ""}`}
                  onClick={() => onViewChange(view)}
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
                    <span className="font-medium break-words leading-tight">{STEP_PROGRESS_SUBTEXT[view] || "Running stage calculations…"}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Alternative PDB Models (Homologs) ── */}
      {activeView === "structure" && setCustomPdbUrl && (
        <div className="context-rail-section border-t pt-3 mt-1" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <span className="text-[11px] font-medium uppercase tracking-wider font-sans mb-2 block" style={{ color: "var(--cs-text-secondary)" }}>
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
              return (
                <button
                  key={hom.pdbId}
                  type="button"
                  onClick={() => setCustomPdbUrl(homUrl)}
                  title={`${hom.title}\nOrganism: ${hom.organism}\nMethod: ${hom.method}\nResolution: ${hom.resolution ? `${hom.resolution} Å` : "N/A"}`}
                  className={`p-2 px-2.5 rounded-lg border text-[11px] transition-all flex items-center gap-2.5 w-full text-left cursor-pointer ${
                    isSelected 
                      ? "border-[var(--cs-border)] shadow-none" 
                      : "border-transparent hover:bg-[var(--cs-bg-subtle)]"
                  }`}
                  style={{
                    background: isSelected ? "var(--cs-surface-2)" : "transparent",
                  }}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? "bg-emerald-500 animate-pulse" : "bg-[var(--cs-text-muted)]"}`} />
                  <div className="flex flex-col text-left truncate w-full">
                    <div className="flex items-center justify-between gap-1 w-full">
                      <span className="font-mono font-semibold text-[12px]" style={{ color: "var(--cs-text-primary)" }}>{hom.pdbId}</span>
                      <span className="text-[9px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded font-mono font-semibold">
                        {(hom.score * 100).toFixed(0)}% ID
                      </span>
                    </div>
                    <span className="text-[10px] truncate font-sans italic" style={{ color: "var(--cs-text-secondary)" }}>
                      {hom.organism}
                    </span>
                  </div>
                </button>
              );
            })}

            {!isHomologsLoading && homologs.length === 0 && (
              <span className="text-[10px] p-2 italic font-mono" style={{ color: "var(--cs-text-muted)" }}>
                No homologs found
              </span>
            )}
          </div>
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

    </aside>
  );
}



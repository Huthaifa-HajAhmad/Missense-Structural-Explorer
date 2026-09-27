import React from "react";
import { 
  Layers, 
  Activity, 
  Sparkles, 
  Target, 
  Info, 
  ShieldAlert, 
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Scale,
  AlertCircle
} from "lucide-react";
import { AnalysisResult, PdbHomolog } from "../../types";
import { PDB_SOURCE_RCSB } from "../../shared/contracts";
import { describeFoldxPhase, type FoldxProgress } from "../../shared/foldxPhase";

import type { StructuralMetrics } from "../../types";

interface StructureInspectorProps {
  analysisResult: AnalysisResult | null;
  viewMode: "wildtype" | "mutant" | "superimposed";
  setViewMode?: (mode: "wildtype" | "mutant" | "superimposed") => void;
  isFolding: boolean;
  /**
   * The FoldX worker's reported phase.
   *
   * Drives the model-switcher label: "Repacking…" was shown for the WHOLE leg, including the
   * minutes a job spends queued and the phase that is actually a template repair, so a reader could
   * not tell a waiting job from a working one.
   */
  foldingProgress?: FoldxProgress | null;
  foldingStatus: "failed" | "success" | "unavailable" | null;
  foldingDdG: number | null;
  homologs?: PdbHomolog[];
  isHomologsLoading?: boolean;
  customPdbUrl?: string | null;
  setCustomPdbUrl?: (url: string | null) => void;
  active3dModelTab?: "alphafold2" | "esmfold2" | "esm3";
  metrics?: StructuralMetrics | null;
  comparePdbData?: string | null;
  hasMutantModel?: boolean;
  bFactorMetadata?: { source: string; details?: string } | null;
  esmFoldingError?: string | null;
  isEsmFolding?: boolean;
  onSwitchToAlphaFold?: () => void;
}

export const StructureInspector: React.FC<StructureInspectorProps> = ({
  analysisResult,
  viewMode,
  setViewMode,
  isFolding,
  foldingProgress = null,
  foldingStatus,
  foldingDdG,
  homologs = [],
  isHomologsLoading = false,
  customPdbUrl = null,
  setCustomPdbUrl,
  active3dModelTab = "alphafold2",
  metrics,
  comparePdbData,
  hasMutantModel = false,
  bFactorMetadata,
  esmFoldingError = null,
  isEsmFolding = false,
  onSwitchToAlphaFold
}) => {
  const metadata = analysisResult?.metadata;
  const wtRes = metadata?.wildType || "WT";
  const mutRes = metadata?.mutant || "MUT";
  const residueIdx = metadata?.residueIndex || 0;

  const isEsmMode = active3dModelTab === "esmfold2" || active3dModelTab === "esm3";
  const hasCompareData = Boolean(comparePdbData || viewMode === "mutant");
  /** Named once: both the label and its tooltip must describe the same stage or neither is trustworthy. */
  const foldxPhaseView = describeFoldxPhase(foldingProgress?.phase);
  const [isPhysicsExpanded, setIsPhysicsExpanded] = React.useState(false);

  const bestExperimental = React.useMemo(() => {
    if (!homologs || homologs.length === 0) return null;
    const candidates = homologs.filter(h => {
      return h.coversPosition ?? (
        residueIdx > 0 && h.querySeqFrom !== undefined && h.querySeqTo !== undefined
          ? (residueIdx >= h.querySeqFrom && residueIdx <= h.querySeqTo)
          : true
      );
    });
    const pool = candidates.length > 0 ? candidates : homologs;
    return [...pool].sort((a, b) => {
      const idA = typeof a.identity === "number" ? a.identity : 0;
      const idB = typeof b.identity === "number" ? b.identity : 0;
      if (idB !== idA) return idB - idA;
      const resA = a.resolution ?? 99;
      const resB = b.resolution ?? 99;
      return resA - resB;
    })[0] || null;
  }, [homologs, residueIdx]);

  const handleTabKeyDown = (e: React.KeyboardEvent, currentTab: "wildtype" | "mutant" | "superimposed") => {
    const tabs: Array<"wildtype" | "mutant" | "superimposed"> = ["wildtype", "mutant", "superimposed"];
    const isMutantAvailable = isEsmMode ? hasMutantModel : (!isFolding && foldingStatus === "success");
    const availableTabs = tabs.filter(t => t === "wildtype" || isMutantAvailable);
    const currentIndex = availableTabs.indexOf(currentTab);
    if (currentIndex === -1) return;

    let targetTab: "wildtype" | "mutant" | "superimposed" | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      targetTab = availableTabs[(currentIndex + 1) % availableTabs.length];
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      targetTab = availableTabs[(currentIndex - 1 + availableTabs.length) % availableTabs.length];
    }

    if (targetTab) {
      setViewMode?.(targetTab);
      const parent = e.currentTarget.parentElement;
      const targetBtn = parent?.querySelector<HTMLButtonElement>(`[data-tab-id="${targetTab}"]`);
      targetBtn?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Active Coordinate Model Switcher (Segmented Control) ── */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted">
          Active Coordinate Model
        </span>

        <div 
          className="p-1 rounded-xl border border-cs-border-subtle bg-cs-surface-2 grid grid-cols-3 gap-1"
          role="tablist"
          aria-label="Coordinate Model Selection"
        >
          {/* Wild-Type */}
          <button
            type="button"
            role="tab"
            data-tab-id="wildtype"
            aria-selected={viewMode === "wildtype"}
            tabIndex={viewMode === "wildtype" ? 0 : -1}
            onKeyDown={(e) => handleTabKeyDown(e, "wildtype")}
            onClick={() => setViewMode?.("wildtype")}
            className={`py-2 px-1.5 rounded-lg border text-[11px] font-semibold text-center transition-all cursor-pointer active:scale-[0.96] ${
              viewMode === "wildtype"
                ? "border-cs-border bg-cs-surface text-cs-text-primary shadow-xs"
                : "border-transparent text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-surface/50"
            }`}
            title="View baseline reference wild-type coordinates"
          >
            <div className="flex flex-col items-center justify-center gap-1.5">
              <span 
                className={`w-2 h-2 rounded-full transition-all ${
                  viewMode === "wildtype" ? "bg-emerald-500 shadow-[0_0_6px_#10b981]" : "bg-cs-text-muted"
                }`} 
              />
              <span className="truncate">{isEsmMode ? "WT (ESMFold-2)" : "WT (AF2)"}</span>
            </div>
          </button>

          {/* Mutant */}
          <button
            type="button"
            role="tab"
            data-tab-id="mutant"
            aria-selected={viewMode === "mutant"}
            tabIndex={viewMode === "mutant" ? 0 : -1}
            onKeyDown={(e) => handleTabKeyDown(e, "mutant")}
            disabled={isEsmMode ? !hasMutantModel : (isFolding || foldingStatus !== "success")}
            onClick={() => setViewMode?.("mutant")}
            className={`py-2 px-1.5 rounded-lg border text-[11px] font-semibold text-center transition-all cursor-pointer active:scale-[0.96] ${
              viewMode === "mutant"
                ? "border-cs-border bg-cs-surface text-cs-text-primary shadow-xs"
                : "border-transparent text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-surface/50"
            } ${(isEsmMode ? !hasMutantModel : (isFolding || foldingStatus !== "success")) ? "opacity-60 cursor-not-allowed" : ""}`}
            title={
              isEsmMode 
                ? "View de novo predicted mutant coordinates" 
                : isFolding 
                  ? foldxPhaseView?.detail ?? "FoldX force-field run in progress — stage not reported by the compute server yet." 
                  : foldingStatus !== "success" 
                    ? "FoldX simulation in flight or not computed." 
                    : "View FoldX repacked mutant coordinates"
            }
          >
            <div className="flex flex-col items-center justify-center gap-1.5">
              <span 
                className={`w-2 h-2 rounded-full transition-all ${
                  viewMode === "mutant" ? "bg-amber-500 shadow-[0_0_6px_#f59e0b]" : "bg-cs-text-muted"
                }`} 
              />
              {/*
                * The server's own word for the stage, or the neutral "Running" from the engine-status
                * vocabulary. "Repacking..." used to cover the entire leg — queue wait, template
                * repair and the five-run build — so the label could not distinguish waiting from
                * working, and "Modelling..." would have replaced one invented step with another.
                */}
              <span className="truncate">
                {isFolding ? (foldxPhaseView?.label ?? "Running") + "..." : (isEsmMode ? "Mutant (ESMFold-2)" : "Mutant (FoldX)")}
              </span>
            </div>
          </button>

          {/* Superposition */}
          <button
            type="button"
            role="tab"
            data-tab-id="superimposed"
            aria-selected={viewMode === "superimposed"}
            tabIndex={viewMode === "superimposed" ? 0 : -1}
            onKeyDown={(e) => handleTabKeyDown(e, "superimposed")}
            disabled={isEsmMode ? !hasMutantModel : (isFolding || foldingStatus !== "success")}
            onClick={() => setViewMode?.("superimposed")}
            className={`py-2 px-1.5 rounded-lg border text-[11px] font-semibold text-center transition-all cursor-pointer active:scale-[0.96] ${
              viewMode === "superimposed"
                ? "border-cs-border bg-cs-surface text-cs-text-primary shadow-xs"
                : "border-transparent text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-surface/50"
            } ${(isEsmMode ? !hasMutantModel : (isFolding || foldingStatus !== "success")) ? "opacity-60 cursor-not-allowed" : ""}`}
            title="Superimpose mutant on reference wild-type coordinates with dual side-chain stick visualization"
          >
            <div className="flex flex-col items-center justify-center gap-1.5">
              <span 
                className={`w-2 h-2 rounded-full transition-all ${
                  viewMode === "superimposed" ? "bg-cyan-500 shadow-[0_0_6px_#06b6d4]" : "bg-cs-text-muted"
                }`} 
              />
              <span className="truncate">Superposition</span>
            </div>
          </button>
        </div>

        {/* ESMFold-2 Standby / Error Fallback Notice (Task 4.7) */}
        {isEsmMode && (esmFoldingError || foldingStatus === "failed") && (
          <div className="p-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 flex flex-col gap-1.5 text-[11px] animate-slide-in">
            <div className="flex items-center gap-1.5 font-bold text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>ESMFold-2 Generation Failed</span>
            </div>
            <p className="text-[10px] text-cs-text-secondary leading-snug">
              {esmFoldingError && /timed?\s*out|45000/i.test(esmFoldingError)
                ? "De novo prediction timed out due to high GPU cluster load. Mutant and superposition coordinates are disabled."
                : (esmFoldingError || "De novo structure generation could not complete.")}
            </p>
            {onSwitchToAlphaFold && (
              <button
                type="button"
                onClick={onSwitchToAlphaFold}
                className="mt-0.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold font-mono bg-cs-surface border border-cs-border hover:bg-cs-surface-2 transition-all cursor-pointer active:scale-[0.96] flex items-center justify-center gap-1 text-cs-text-primary self-start"
              >
                <span>Switch to AlphaFold2 Model</span>
              </button>
            )}
          </div>
        )}

        {/* FoldX Repacking Details Card (Replacing floating FoldX banner dropdown) */}
        {!isEsmMode && foldingStatus === "success" && (
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-cs-text-primary flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                FoldX Model Energetics
              </span>
              {foldingDdG !== null && (
                <span className="text-[10.5px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  ΔΔG: {foldingDdG > 0 ? `+${foldingDdG.toFixed(2)}` : foldingDdG.toFixed(2)} kcal/mol
                </span>
              )}
            </div>
            <p className="text-[10px] text-cs-text-secondary font-sans leading-snug">
              Biophysically repacked coordinates reflecting local FoldX empirical force-field energy minimization.
            </p>
          </div>
        )}
      </div>

      {/* ── 2. WT vs MT Overlay Metrics ── */}
      {metrics && hasCompareData && (
        <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-pink-600 dark:text-pink-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              WT vs MT Overlay Metrics
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-600 border border-pink-500/20 font-semibold">
              Superposition
            </span>
          </div>

          <div className="p-3 rounded-xl border border-cs-border bg-cs-surface-2 font-mono text-[11px] space-y-2.5">
            {/* Hero Metric: Local Window RMSD */}
            <div className="p-2.5 rounded-lg border border-pink-500/30 bg-pink-500/5 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-pink-600 dark:text-pink-400 block font-mono">
                  Local Window RMSD (Cα)
                </span>
                <span className="text-[9px] text-cs-text-muted font-sans block">
                  ±15 residue active-site backbone shift
                </span>
              </div>
              <span className="font-bold text-sm text-pink-600 dark:text-pink-400 tabular-nums">
                {metrics.localWindowRmsd !== undefined && metrics.localWindowRmsd !== null ? `${metrics.localWindowRmsd.toFixed(3)} Å` : "N/A"}
              </span>
            </div>

            {/* Key-Value Metrics Grid */}
            <div className="grid grid-cols-1 gap-1 text-[10.5px]">
              <div className="flex items-center justify-between p-1.5 rounded bg-cs-surface/60 border border-cs-border-subtle/50">
                <span className="text-cs-text-secondary">Global Cα RMSD:</span>
                <span className="font-bold text-cs-text-primary tabular-nums">
                  {metrics.globalRmsd !== undefined && metrics.globalRmsd !== null ? `${metrics.globalRmsd.toFixed(3)} Å` : "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-cs-surface/60 border border-cs-border-subtle/50">
                <span className="text-cs-text-secondary">Dihedral χ1 Deviation:</span>
                <span className="font-bold text-cs-text-primary tabular-nums">
                  {metrics.chi1Deviation !== undefined && metrics.chi1Deviation !== null ? `${metrics.chi1Deviation.toFixed(1)}°` : "0.0°"}
                </span>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-cs-surface/60 border border-cs-border-subtle/50">
                <span className="text-cs-text-secondary">SASA Net Delta (WT → MT):</span>
                <span className="font-bold text-cs-text-primary tabular-nums">
                  {metrics.sasaDiff?.delta !== undefined && metrics.sasaDiff?.delta !== null ? `${metrics.sasaDiff.delta.toFixed(1)} Å²` : "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-cs-surface/60 border border-cs-border-subtle/50">
                <span className="text-cs-text-secondary">Hydrogen-Bond Delta:</span>
                <span className="font-bold text-rose-500 tabular-nums">
                  {metrics.hBondsDiff ? `-${metrics.hBondsDiff.lostCount} / +${metrics.hBondsDiff.gainedCount}` : "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-cs-surface/60 border border-cs-border-subtle/50">
                <span className="text-cs-text-secondary">Contact-Map Delta:</span>
                <span className="font-bold text-rose-500 tabular-nums">
                  {metrics.contactsDiff ? `-${metrics.contactsDiff.lostCount} / +${metrics.contactsDiff.gainedCount}` : "N/A"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. Model Interpretation & Provenance Notices (Collapsible Disclosure - Task 3.9) ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-cs-accent-clay" />
            Model Provenance & Physics
          </span>
          <button
            type="button"
            onClick={() => setIsPhysicsExpanded(p => !p)}
            className="flex items-center gap-1 text-[9.5px] font-mono text-cs-accent-clay hover:underline cursor-pointer active:scale-[0.96]"
          >
            <span>{isPhysicsExpanded ? "Hide Details" : "Details"}</span>
            {isPhysicsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* 1-Line Summary Badge */}
        <div className="p-2 rounded-lg border border-cs-border-subtle bg-cs-surface-2 flex items-center justify-between gap-2 text-[10.5px]">
          <div className="flex items-center gap-1.5 truncate">
            {isEsmMode ? (
              <>
                <Sparkles className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                <span className="font-semibold text-cs-text-primary truncate">ESMFold-2 De Novo Dynamics</span>
              </>
            ) : (
              <>
                <Target className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="font-semibold text-cs-text-primary truncate">FoldX Local Rigid Perturbation</span>
              </>
            )}
          </div>
          <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-cs-surface border border-cs-border-subtle text-cs-text-muted shrink-0">
            {isEsmMode ? "pLDDT in B-Factor" : (bFactorMetadata?.source === "alphafold" ? "AF2 Confidence" : "PDB B-Factor")}
          </span>
        </div>

        {/* Expanded Details */}
        {isPhysicsExpanded && (
          <div className="flex flex-col gap-2 animate-slide-in">
            {isEsmMode ? (
              <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 text-cs-text-primary space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold font-mono uppercase text-[10px] text-cs-text-primary">
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                  <span>ESMFold-2 De Novo Structural Dynamics (Lin et al. 2023)</span>
                </div>
                <p className="text-[10px] text-cs-text-secondary leading-snug font-sans">
                  Single-sequence de novo models. For large multi-domain proteins (&gt;400 aa), elevated global Cα RMSD often reflects stochastic conformational sampling of flexible linkers rather than whole-domain denaturation.
                </p>
                <p className="text-[9.5px] text-cs-text-muted leading-snug font-sans">
                  Tip: Local pocket alignment snaps structured domains (&lt;1.0 Å RMSD) to isolate active-site perturbations.
                </p>
              </div>
            ) : (
              <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 text-cs-text-primary space-y-1">
                <div className="flex items-center gap-1.5 font-bold font-mono uppercase text-[10px] text-cs-text-primary">
                  <Target className="w-3.5 h-3.5 text-emerald-500" />
                  <span>FoldX Local Perturbation</span>
                </div>
                <p className="text-[10px] text-cs-text-secondary leading-snug font-sans">
                  Rigid-backbone local comparison; displacement values are physically interpretable.
                </p>
              </div>
            )}

            {bFactorMetadata && (
              <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 text-cs-text-primary space-y-1">
                <div className="flex items-center gap-1.5 font-bold font-mono uppercase text-[10px] text-amber-600 dark:text-amber-400">
                  <Info className="w-3.5 h-3.5" />
                  <span>B-Factor / pLDDT Notice</span>
                </div>
                <p className="text-[10px] text-cs-text-secondary leading-snug font-sans">
                  {bFactorMetadata.source === "alphafold"
                    ? "B-factors represent wild-type confidence (pLDDT) from AlphaFold DB, not physical temperature factors."
                    : "B-factors represent wild-type experimental temperature factors from PDB."}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 4. Experimental PDB Templates (Homologs) ── */}
      {setCustomPdbUrl && (
        <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted">
              PDB Experimental Templates
            </span>
            <span className="text-[9px] font-mono text-cs-text-muted">
              {homologs.length} structures
            </span>
          </div>

          {/* Option A 1-Click Fast Switcher */}
          {bestExperimental && (
            customPdbUrl === null ? (
              <button
                type="button"
                onClick={() => setCustomPdbUrl(`/api/v1/pdb/entry/${bestExperimental.pdbId}`)}
                className="p-2 rounded-xl border border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300 flex items-center justify-between gap-2 text-[10.5px] font-semibold hover:bg-blue-500/15 transition-all cursor-pointer active:scale-[0.96]"
                title={`1-Click Switch: Switch to best experimental structure (PDB ${bestExperimental.pdbId}, ${bestExperimental.resolution ? `${bestExperimental.resolution}Å` : bestExperimental.method})`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_6px_#3b82f6] shrink-0" />
                  <span className="truncate">Switch to Best Experimental PDB ({bestExperimental.pdbId})</span>
                </div>
                <span className="text-[9px] font-mono shrink-0 font-bold bg-blue-500/20 px-1.5 py-0.5 rounded">
                  {bestExperimental.resolution ? `${bestExperimental.resolution}Å` : "1-Click"}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCustomPdbUrl(null)}
                className="p-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2 text-[10.5px] font-semibold hover:bg-emerald-500/15 transition-all cursor-pointer active:scale-[0.96]"
                title="1-Click Switch: Revert to authentic Full-Length AlphaFold DB model"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981] shrink-0" />
                  <span className="truncate">Switch to Full-Length AlphaFold2</span>
                </div>
                <span className="text-[9px] font-mono shrink-0 font-bold bg-emerald-500/20 px-1.5 py-0.5 rounded">
                  1-Click AF2
                </span>
              </button>
            )
          )}

          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-0.5 cs-scrollbar">
            {/* Default AlphaFold DB option */}
            <button
              type="button"
              onClick={() => setCustomPdbUrl(null)}
              className={`p-2 rounded-lg border text-[11px] transition-all flex items-center gap-2.5 w-full text-left cursor-pointer active:scale-[0.96] ${
                customPdbUrl === null 
                  ? "border-cs-border bg-cs-surface-2" 
                  : "border-transparent hover:bg-cs-bg-subtle"
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${customPdbUrl === null ? "bg-emerald-500 shadow-[0_0_6px_#10b981]" : "bg-cs-text-muted"}`} />
              <div className="flex flex-col text-left truncate w-full">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-[11px] text-cs-text-primary">AlphaFold2 Model</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-cs-surface border border-cs-border text-cs-text-muted">
                    Full-Length
                  </span>
                </div>
                <span className="text-[10px] text-cs-text-secondary truncate">
                  UniProt: {analysisResult?.metadata?.uniprotId || "Default"}
                </span>
              </div>
            </button>

            {/* Loading homologs */}
            {isHomologsLoading && (
              <div className="flex items-center gap-2 p-2 text-[10.5px] font-mono text-cs-text-muted">
                <span className="cs-spinner cs-spinner-sm shrink-0" />
                <span>Searching RCSB PDB for homologs...</span>
              </div>
            )}

            {/* Homolog hits */}
            {!isHomologsLoading && homologs.map((hom) => {
              const homUrl = `/api/v1/pdb/entry/${hom.pdbId}`;
              const isSelected = customPdbUrl === homUrl || customPdbUrl === `https://files.rcsb.org/download/${hom.pdbId}.pdb`;
              const identityVal = typeof hom.identity === "number" ? hom.identity : Math.round((hom.score || 0) * 100);
              const coverageVal = typeof hom.coverage === "number" ? hom.coverage : 80;
              const isCovered = hom.coversPosition ?? (
                residueIdx > 0 && hom.querySeqFrom !== undefined && hom.querySeqTo !== undefined
                  ? (residueIdx >= hom.querySeqFrom && residueIdx <= hom.querySeqTo)
                  : true
              );

              return (
                <button
                  key={hom.pdbId}
                  type="button"
                  onClick={() => setCustomPdbUrl(homUrl)}
                  title={`${hom.title}\n• Sequence Identity: ${identityVal}%\n• Alignment Coverage: ${coverageVal}%\n• Organism: ${hom.organism}\n• Aligned Region: ${hom.querySeqFrom ?? '?'}-${hom.querySeqTo ?? '?'}\n• Mutation Site Status: ${isCovered ? `In Range (covers pos ${residueIdx})` : `Out of Bounds (pos ${residueIdx} is outside ${hom.querySeqFrom}-${hom.querySeqTo})`}\n• Method: ${hom.method}${hom.resolution ? ` (${hom.resolution} Å)` : ''}`}
                  className={`p-2 rounded-lg border text-[11px] transition-all flex items-center gap-2 w-full text-left cursor-pointer active:scale-[0.96] ${
                    isSelected 
                      ? "border-cs-accent-clay bg-cs-surface-2 shadow-xs" 
                      : "border-cs-border-subtle hover:bg-cs-bg-subtle"
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: isSelected ? "var(--cs-accent-clay)" : (isCovered ? "#10b981" : "#f59e0b")
                    }}
                  />
                  <div className="flex flex-col text-left truncate w-full gap-0.5">
                    <div className="flex items-center justify-between gap-1 w-full">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-mono font-bold text-[11px] text-cs-text-primary">
                          {hom.pdbId}
                        </span>
                        {hom.querySeqFrom && hom.querySeqTo && (
                          <span className="text-[9px] font-mono text-cs-text-muted">
                            ({hom.querySeqFrom}–{hom.querySeqTo})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {residueIdx > 0 && (
                          isCovered ? (
                            <span className="text-[8.5px] px-1 py-0.5 rounded font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              In Range
                            </span>
                          ) : (
                            <span className="text-[8.5px] px-1 py-0.5 rounded font-mono font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              Out of Bounds
                            </span>
                          )
                        )}
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold bg-cs-surface border border-cs-border text-cs-text-secondary">
                          {identityVal}% ID
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[9.5px] truncate text-cs-text-secondary">
                      <span className="truncate italic">{hom.organism}</span>
                      {hom.resolution && (
                        <span className="font-mono text-[9px] shrink-0 ml-1 text-cs-text-muted">
                          {hom.resolution}Å
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {!isHomologsLoading && homologs.length === 0 && (
              <span className="text-[10px] p-2 italic font-mono text-cs-text-muted">
                No PDB homologs found (≥22% sequence identity)
              </span>
            )}
          </div>

          {/* Out of bounds active selection notice */}
          {customPdbUrl && (() => {
            const selectedHom = homologs.find(h => `/api/v1/pdb/entry/${h.pdbId}` === customPdbUrl || `https://files.rcsb.org/download/${h.pdbId}.pdb` === customPdbUrl);
            if (!selectedHom) return null;
            const isCovered = selectedHom.coversPosition ?? (
              residueIdx > 0 && selectedHom.querySeqFrom !== undefined && selectedHom.querySeqTo !== undefined
                ? (residueIdx >= selectedHom.querySeqFrom && residueIdx <= selectedHom.querySeqTo)
                : true
            );
            if (!isCovered && residueIdx > 0) {
              return (
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-700 dark:text-amber-300 leading-snug">
                  <span className="font-semibold">Out of bounds template:</span> PDB {selectedHom.pdbId} covers residues {selectedHom.querySeqFrom ?? '?' }–{selectedHom.querySeqTo ?? '?'}. Mutation site (position {residueIdx}) is outside the aligned coordinates. Switch back to AlphaFold2 Model for full-length structural context.
                </div>
              );
            }
            if (selectedHom.coverage && selectedHom.coverage < 90) {
              return (
                <div className="p-2 rounded-lg bg-cs-surface-2 border border-cs-border-subtle text-[10px] text-cs-text-secondary leading-snug">
                  <span className="font-semibold text-cs-text-primary">Domain Construct:</span> PDB {selectedHom.pdbId} ({selectedHom.method}{selectedHom.resolution ? ` • ${selectedHom.resolution}Å` : ''}) covers {selectedHom.coverage}% of sequence{selectedHom.querySeqFrom && selectedHom.querySeqTo ? ` (${selectedHom.querySeqFrom}–${selectedHom.querySeqTo})` : ''}. Unmodelled domains are not present in this crystal construct.
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}

      {/* ── 5. Mutated Residue Structural Neighborhood (Task 3.8 Enriched) ── */}
      {residueIdx > 0 && (() => {
        const disruption = analysisResult?.disruptionPredictor;
        const plddtVal = disruption?.plddt;
        const plddtBadge = plddtVal == null ? null : (
          plddtVal >= 90 ? { label: `${plddtVal.toFixed(1)} (Very High)`, cls: "text-blue-500 bg-blue-500/10 border-blue-500/20" } :
          plddtVal >= 70 ? { label: `${plddtVal.toFixed(1)} (Confident)`, cls: "text-cyan-500 bg-cyan-500/10 border-cyan-500/20" } :
          plddtVal >= 50 ? { label: `${plddtVal.toFixed(1)} (Low)`, cls: "text-amber-500 bg-amber-500/10 border-amber-500/20" } :
          { label: `${plddtVal.toFixed(1)} (Very Low)`, cls: "text-orange-500 bg-orange-500/10 border-orange-500/20" }
        );
        const burial = disruption?.burialStatus;
        const rsaPercent = disruption?.rsa != null ? `${Math.round(disruption.rsa * 100)}%` : null;
        const feature = analysisResult?.uniprotFeatures?.features?.find(
          (f: any) => residueIdx >= f.start && residueIdx <= f.end && (f.type === "DOMAIN" || f.type === "REGION" || f.type === "BINDING" || f.type === "ACT_SITE")
        );

        return (
          <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted">
              Target Residue Context
            </span>

            <div className="p-2.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-1.5">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-cs-text-secondary">Position:</span>
                <span className="font-mono font-bold text-cs-text-primary">Residue #{residueIdx}</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-cs-text-secondary">Mutation:</span>
                <span className="font-mono font-bold text-cs-accent-clay">{wtRes} → {mutRes}</span>
              </div>
              {plddtBadge && (
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-cs-text-secondary">pLDDT Confidence:</span>
                  <span className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border tabular-nums ${plddtBadge.cls}`}>
                    {plddtBadge.label}
                  </span>
                </div>
              )}
              {(burial || rsaPercent) && (
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-cs-text-secondary">Solvent Exposure:</span>
                  <span className="font-mono text-[10.5px] text-cs-text-primary capitalize">
                    {burial || "Calculated"} {rsaPercent ? `(${rsaPercent} RSA)` : ""}
                  </span>
                </div>
              )}
              {feature && (
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-cs-text-secondary">Functional Region:</span>
                  <span className="font-mono text-[10px] text-cs-accent-clay truncate max-w-[140px]" title={feature.description}>
                    {feature.description || feature.type}
                  </span>
                </div>
              )}
              {analysisResult?.metadata?.pdbId && (
                <div className="flex justify-between items-center text-[11px]">
                  {/* The source is not always AlphaFold: an RCSB entry is an experimental
                      structure, and labelling its accession a model id is a false identity. */}
                  <span className="text-cs-text-secondary">
                    {analysisResult.metadata.pdbSource === PDB_SOURCE_RCSB ? "PDB Entry:" : "Model ID:"}
                  </span>
                  <span className="font-mono text-[10px] text-cs-text-muted truncate max-w-[130px]">
                    {analysisResult.metadata.pdbId}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── 6. ESMFold-2 Constraints Warning (Task 2.6) ── */}
      {analysisResult?.metadata?.mutatedSequence && (
        <>
          {analysisResult.metadata.mutatedSequence.length > 768 ? (
            <div className="text-amber-600 dark:text-amber-400 p-2.5 rounded-lg border bg-cs-surface-2 border-cs-border-subtle text-[10.5px] leading-relaxed">
              ⚠️ <strong>ESMFold-2 Size Limit:</strong> Protein sequence ({analysisResult.metadata.mutatedSequence.length} aa) exceeds JapanFold / ESM Atlas 768 aa limit. Using AlphaFold2 coordinates.
            </div>
          ) : analysisResult.metadata.mutatedSequence.length > 400 ? (
            <div className="text-amber-600 dark:text-amber-400 p-2.5 rounded-lg border bg-cs-surface-2 border-cs-border-subtle text-[10.5px] leading-relaxed">
              ℹ️ <strong>ESMFold-2 Token Notice:</strong> Protein exceeds public 400 aa threshold. Sovereign JapanFold inference engine configured in Settings is used for de novo folding.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

export default React.memo(StructureInspector);

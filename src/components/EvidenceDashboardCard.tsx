import React, { useState, useMemo, useCallback } from "react";
import { Database } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { EvidenceDashboardCardProps, TabType } from "./evidence/types";
import { ClinicalTab } from "./evidence/ClinicalTab";
import { SplicingTab } from "./evidence/SplicingTab";
import { PredictorsTab } from "./evidence/PredictorsTab";
import { StructureTab } from "./evidence/StructureTab";
import { PerturbationTab } from "./evidence/PerturbationTab";
import { MultimersTab } from "./evidence/MultimersTab";
import { FunctionTab, InteractionsTab } from "./evidence/FunctionInteractionsTabs";
import { GuidelinesTab } from "./evidence/GuidelinesTab";
import { AlphaGenomeTab } from "./evidence/AlphaGenomeTab";
import { MetricExplanationModal } from "./evidence/MetricExplanationModal";

function formatDdGValue(val: number | null | undefined, unit: "kcal/mol" | "kJ/mol"): string {
  if (val === null || val === undefined) return "N/A";
  if (unit === "kJ/mol") {
    return `${(val * 4.184).toFixed(2)} kJ/mol`;
  }
  return `${val.toFixed(2)} kcal/mol`;
}

function EvidenceDashboardCard(props: EvidenceDashboardCardProps) {
  const {
    isDark,
    classCard,
    classCardHeader,
    classCardTitle,
    classBorderSec,
    classTextBody,
    classTextMute,
    analysisState,
    activeTab: activeTabProp,
    onTabChange
  } = props;

  const [localActiveTab, setLocalActiveTab] = useState<TabType>("clinical");
  const activeTab = (activeTabProp as TabType) || localActiveTab;
  const setActiveTab = useCallback((tab: string) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setLocalActiveTab(tab as TabType);
    }
  }, [onTabChange]);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const { settings } = useSettings();
  const energyUnit = settings.energyUnit;

  const result = analysisState.result;

  /**
   * MUST be called before any conditional return.
   *
   * This was previously declared after the `if (!result)` guard, so the component ran
   * 4 hooks when there was no result and 5 once one arrived. React rejects that with
   * "Rendered more hooks than during the previous render", which the surrounding
   * ErrorBoundary surfaced as a generic "Component Render Failed" card — reachable
   * simply by submitting a query while the evidence view showed its empty state.
   */
  const tabProps = useMemo(() => ({
    ...props,
    onTabChange: setActiveTab,
    energyUnit,
    formatDdGValue,
    setSelectedMetric
  }), [props, setActiveTab, energyUnit, setSelectedMetric]);

  if (!result) {
    if (analysisState.isLoading) {
      return (
        <div className={`${classCard} overflow-hidden flex flex-col transition-all`} id="evidence-dashboard-card">
          <div className="p-6 flex-1 flex flex-col gap-5 overflow-y-auto">
            {/* Live Module Readiness Status Bar */}
            <div className="p-4 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(196,104,73,0.12)" }}>
                  <Database className="w-4 h-4 animate-pulse" style={{ color: "var(--cs-accent-clay)" }} />
                </div>
                <div>
                  <h4 className="text-xs font-bold tracking-tight" style={{ color: "var(--cs-text-primary)" }}>Loading Evidence Modules</h4>
                  <p className="text-[10px]" style={{ color: "var(--cs-text-muted)" }}>Populating multi-modal dataset groups sequentially based on API readiness...</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono flex-wrap justify-end">
                <span className="px-2 py-1 rounded border bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-bold">
                  ✓ Coordinates
                </span>
                <span className="px-2 py-1 rounded border bg-amber-500/10 text-amber-500 border-amber-500/20 font-bold animate-pulse">
                  ⚡ Clinical &amp; Frequencies
                </span>
                <span className="px-2 py-1 rounded border bg-indigo-500/10 text-indigo-400 border-indigo-500/20 font-bold">
                  ⏳ Biophysics (Background)
                </span>
              </div>
            </div>

            {/* Skeleton cards row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-4 rounded-xl border" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                  <div className="h-2 w-24 rounded animate-pulse mb-4" style={{ background: "var(--cs-surface-2)" }} />
                  <div className="space-y-2">
                    <div className="h-7 rounded animate-pulse" style={{ background: "var(--cs-surface-2)" }} />
                    <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: "var(--cs-surface-2)" }} />
                    <div className="h-3 w-1/2 rounded animate-pulse" style={{ background: "var(--cs-surface-2)" }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Skeleton second row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[1, 2].map(i => (
                <div key={i} className="p-4 rounded-xl border" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                  <div className="h-2 w-20 rounded animate-pulse mb-3" style={{ background: "var(--cs-surface-2)" }} />
                  <div className="space-y-1.5">
                    {[1,2,3,4].map(j => (
                      <div key={j} className="h-2.5 rounded animate-pulse" style={{ background: "var(--cs-surface-2)", width: `${60 + j * 8}%` }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] font-mono text-center animate-pulse" style={{ color: "var(--cs-text-muted)" }}>
              Fetching clinical annotations, ClinVar, gnomAD &amp; All of Us frequencies…
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className={`${classCard} overflow-hidden flex flex-col transition-all`} id="evidence-dashboard-card">
        <div className="p-5 flex-1 flex flex-col justify-center text-center py-12 text-slate-500">
          <Database className="w-10 h-10 mx-auto text-indigo-500 stroke-[1.5] mb-2 animate-pulse" />
          <p className="text-sm font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>Evidence Dashboard Ready</p>
          <div className="w-16 h-[1px] bg-slate-800/10 dark:bg-slate-800/60 mx-auto my-3"></div>
          <p className="text-xs max-w-sm mx-auto mt-1 leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
            Submit a variant query to load multi-modal predictors, conservation, energetics and structural pocket evidence.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${classCard} overflow-hidden flex flex-col transition-all`} id="evidence-dashboard-card">
      {result.isDemoData && (
        <div className={`mx-5 mt-4 p-2.5 rounded-xl border text-[11px] font-medium leading-relaxed transition-all flex items-center gap-2 ${
          isDark 
            ? "bg-amber-500/10 border-amber-500/20 text-amber-300" 
            : "bg-amber-50 border-amber-200 text-amber-700"
        }`}>
          <span>⚠ Demo data — example preset; not a live backend analysis</span>
        </div>
      )}



      <div className="p-5 flex-1 font-mono text-xs overflow-y-auto">
        {activeTab === "clinical" && <ClinicalTab {...tabProps} />}
        {activeTab === "predictors" && <PredictorsTab {...tabProps} />}
        {activeTab === "alphagenome" && <AlphaGenomeTab {...tabProps} />}
        {activeTab === "structure" && <StructureTab {...tabProps} />}
        {activeTab === "perturbation" && <PerturbationTab {...tabProps} />}
        {activeTab === "multimers" && <MultimersTab {...tabProps} />}
        {activeTab === "function" && <FunctionTab {...tabProps} />}
        {activeTab === "interactions" && <InteractionsTab {...tabProps} />}
        {activeTab === "splicing" && <SplicingTab {...tabProps} />}
        {(activeTab === "guidelines" || (activeTab as string) === "thresholds") && <GuidelinesTab {...tabProps} />}

        <MetricExplanationModal 
          selectedMetric={selectedMetric} 
          setSelectedMetric={setSelectedMetric} 
          isDark={isDark} 
        />
      </div>
    </div>
  );
}

export default React.memo(EvidenceDashboardCard);

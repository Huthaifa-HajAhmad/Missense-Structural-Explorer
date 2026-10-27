import React, { useState, useMemo, useCallback } from "react";
import { AlertTriangle, Database } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { EvidenceDashboardCardProps, TabType, normalizeEvidenceTab } from "./evidence/types";
import { formatDdg } from "../shared/engineStatus";
import { ClinicalTab } from "./evidence/ClinicalTab";
import { GeneDiseaseTab } from './evidence/GeneDiseaseTab';
import { SpeciesModelsTab } from './evidence/SpeciesModelsTab';
import { ExpressionModelsTab } from './evidence/ExpressionModelsTab';
import { SplicingTab } from "./evidence/SplicingTab";
import { PredictorsTab } from "./evidence/PredictorsTab";
import { StructureTab } from "./evidence/StructureTab";
import { PerturbationTab } from "./evidence/PerturbationTab";
import { InterfacesTab } from "./evidence/InterfacesTab";
import { FunctionTab } from "./evidence/FunctionInteractionsTabs";
import { AlphaGenomeTab } from "./evidence/AlphaGenomeTab";
import { MetricExplanationModal } from "./evidence/MetricExplanationModal";
import { ResearchGuideButton } from './knowledge/ResearchGuideButton';
import { EVIDENCE_GUIDES, RESEARCH_GUIDES } from '../shared/researchGuides';

/**
 * Delegates to the canonical ΔΔG formatter.
 *
 * This was a second implementation, and it differed from the canonical one in ways a reader could
 * see: it printed `"N/A"` where the canonical formatter prints `"—"` for an absent value, and it
 * hard-coded `4.184` rather than using the shared constant. So the module's claim that there is ONE
 * ΔΔG formatter was false repo-wide, and the same missing value could render two ways on two
 * surfaces. Wrapping instead of reimplementing is what makes that claim true.
 */
export function formatDdGValue(val: number | null | undefined, unit: "kcal/mol" | "kJ/mol"): string {
  return formatDdg(val ?? null, unit);
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
    onTabChange,
    isBiophysicalLoading,
    foldingDdG,
    foldingStatus,
    foldingEnergetics,
    dynamut2Status,
    ddmutStatus,
    computedPocket,
    isPocketLoading,
    pocketError,
    disruptionPredictor,
    isFolding,
    foldingError,
    structuralDiff,
    active3dModelTab,
    metrics,
    onOpenSettings,
    onRetryStructural,
    onRetryPocket,
    onSelectResidue,
    onNavigateToView
  } = props;

  const [localActiveTab, setLocalActiveTab] = useState<TabType>("clinical");
  const requestedTab = activeTabProp ? normalizeEvidenceTab(activeTabProp) : localActiveTab;
  const activeTab = (Object.hasOwn(EVIDENCE_GUIDES, requestedTab) ? requestedTab : 'clinical') as TabType;
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
    isDark,
    classCard,
    classCardHeader,
    classCardTitle,
    classBorderSec,
    classTextBody,
    classTextMute,
    analysisState,
    activeTab,
    onTabChange: setActiveTab,
    isBiophysicalLoading,
    foldingDdG,
    foldingStatus,
    foldingEnergetics,
    dynamut2Status,
    ddmutStatus,
    computedPocket,
    isPocketLoading,
    pocketError,
    disruptionPredictor,
    isFolding,
    foldingError,
    structuralDiff,
    active3dModelTab,
    metrics,
    onOpenSettings,
    onRetryStructural,
    onRetryPocket,
    onSelectResidue,
    onNavigateToView,
    energyUnit,
    formatDdGValue,
    setSelectedMetric
  }), [
    isDark,
    classCard,
    classCardHeader,
    classCardTitle,
    classBorderSec,
    classTextBody,
    classTextMute,
    analysisState,
    activeTab,
    setActiveTab,
    isBiophysicalLoading,
    foldingDdG,
    foldingStatus,
    foldingEnergetics,
    dynamut2Status,
    ddmutStatus,
    computedPocket,
    isPocketLoading,
    pocketError,
    disruptionPredictor,
    isFolding,
    foldingError,
    structuralDiff,
    active3dModelTab,
    metrics,
    onOpenSettings,
    onRetryStructural,
    onRetryPocket,
    onSelectResidue,
    onNavigateToView,
    energyUnit,
    setSelectedMetric
  ]);

  /*
   * The loading and no-result states. They used to print hard-coded progress chips ("Coordinates",
   * "Clinical & Frequencies", "Biophysics") that were never read from the pipeline, in Tailwind
   * palette colours with emoji and pulse loaders, and the no-result state said "Evidence Dashboard
   * Ready · Submit a variant query" even when it was reached because the last query FAILED (the idle
   * empty state in AppViews handles the never-queried case). Both now state only what is known.
   */
  if (!result) {
    if (analysisState.isLoading) {
      return (
        <div className={`${classCard} overflow-hidden flex flex-col`} id="evidence-dashboard-card" aria-busy="true">
          <div className="p-6 flex-1 flex flex-col gap-5 overflow-y-auto">
            <div role="status" className="pop-callout" data-tone="neutral">
              <Database className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                Loading evidence. Each tab fills in as its own sources answer; the sidebar marks the tabs still loading.
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4" aria-hidden="true">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-4 rounded-xl border border-cs-border bg-cs-surface">
                  <div className="h-2 w-24 rounded mb-4 bg-cs-surface-2" />
                  <div className="space-y-2">
                    <div className="h-7 rounded bg-cs-surface-2" />
                    <div className="h-3 w-3/4 rounded bg-cs-surface-2" />
                    <div className="h-3 w-1/2 rounded bg-cs-surface-2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`${classCard} overflow-hidden flex flex-col`} id="evidence-dashboard-card">
        <div className="p-5 flex-1 flex flex-col justify-center text-center py-12">
          <Database className="w-10 h-10 mx-auto stroke-[1.5] mb-2 text-cs-text-muted" aria-hidden="true" />
          <p className="card-title">No evidence to show</p>
          <p className="text-xs max-w-sm mx-auto mt-2 leading-relaxed text-cs-text-secondary">
            {analysisState.error
              ? "The last query did not return an analysis. Run it again, or start a new one from Variant query."
              : "Run a variant query to load the evidence."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${classCard} overflow-hidden flex flex-col`} id="evidence-dashboard-card">
      {result.isDemoData && (
        <p role="note" className="pop-callout mx-5 mt-4" data-tone="warning">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Demo data: an example preset, not a live analysis.</span>
        </p>
      )}

      <div className="p-5 flex-1 font-mono text-xs overflow-y-auto">
        <div className="rgd-context-action"><ResearchGuideButton topic={EVIDENCE_GUIDES[activeTab]} label={`About ${RESEARCH_GUIDES[EVIDENCE_GUIDES[activeTab]].title}`} /></div>
        {activeTab === "clinical" && <ClinicalTab {...tabProps} />}
        {activeTab === 'gene-disease' && <GeneDiseaseTab {...tabProps} />}
        {activeTab === 'expression-models' && <ExpressionModelsTab {...tabProps} />}
        {activeTab === 'species-models' && <SpeciesModelsTab {...tabProps} />}
        {activeTab === "predictors" && <PredictorsTab {...tabProps} />}
        {activeTab === "alphagenome" && <AlphaGenomeTab {...tabProps} />}
        {activeTab === "structure" && <StructureTab {...tabProps} />}
        {activeTab === "perturbation" && <PerturbationTab {...tabProps} />}
        {activeTab === "function" && <FunctionTab {...tabProps} />}
        {activeTab === "interfaces" && <InterfacesTab {...tabProps} />}
        {activeTab === "splicing" && <SplicingTab {...tabProps} />}

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

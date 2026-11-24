import { ResearchGuideButton } from "./knowledge/ResearchGuideButton";
import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { deriveConsensus } from "../lib/insightsConsensus";
export { buildExportVerdictContext, deriveConsensus } from "../lib/insightsConsensus";
// One frequency formatter for the whole app — this card used `toExponential(3)` while the
// Population Frequencies screen used the shared one, so the same value rendered two ways.
// One ACMG criteria list and one provenance vocabulary for every surface that renders criteria.
// The condensed clinical summary this view shows in place of the full narrative, plus the shared
// "is this narrative AI-authored or rule-based" verdict — the payload carries both kinds of text.
import { summariseNarrative } from "../shared/narrativeSummary";
import { narrativeAuthorshipOfResult, narrativeDeepEvidenceStatus, narrativeFreshness } from "../shared/narrativeEvidence";
import { useNarrativeEvidenceContext } from "../hooks/useNarrativeEvidenceContext";
import { isFallbackNarrative } from "../services/pipeline/variantCache";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { useFoldxRunState } from "../hooks/useFoldxRunState";
import {
  Lightbulb,
  AlertTriangle
} from "lucide-react";
import { InsightsScreen } from "./insights/InsightsScreen";
import { InsightsExportMenu } from "./insights/InsightsExportMenu";
import { buildInsightsEvidence } from "../shared/insightsEvidence";
import { functionEvidenceInputFrom } from "./evidence/function/functionInput";
import type { EvidenceTabId } from "../shared/insightsEvidence";
import { VARIANT_PRESETS } from "../data";
import { AnalysisState, UserSettings, NearestResidue } from "../types";
import type { MasterView } from "./MasterSidebar";

interface ClinicalInsightsCardProps {
  isDark: boolean;
  classCard: string;
  classCardHeader: string;
  classCardTitle: string;
  analysisState: AnalysisState;
  handleCopyReport: () => void | Promise<void>;
  copied: boolean;
  gene: string;
  variant: string;
  uniprotId: string;
  loadingStep: string;
  formatEnergyString: (val: string | null | undefined) => string;
  selectedResidueIndex: number | null;
  settings: UserSettings;
  classTextBody: string;
  classTextMute: string;
  classBorderSec: string;
  computedResiduesCache?: Record<string, NearestResidue[]>;
  isBiophysicalLoading?: boolean;
  isClinicalLoading?: boolean;
  isNarrativeLoading?: boolean;
  foldingEnergetics?: any;
  /** The FoldX single-value fallback the Energetics badge applies; needed to match its verdict. */
  foldingDdG?: number | null;
  disruptionPredictor?: any;
  /**
   * Switch the workspace to another view.
   *
   * Used by the condensed clinical summary to send the reader to the Report, which owns the full
   * narrative. Passing it is what makes "condensed here, complete there" a real affordance rather
   * than a dead end — without it the summary would have to either duplicate the narrative or cite a
   * document the reader cannot reach.
   *
   * Typed as `MasterView`, not `any`. The view keys are a shared vocabulary (`HeaderBar`'s breadcrumb
   * and `VariantSearchPanel`'s preset targets both name them), so `any` here would let a renamed key
   * compile and send the reader to a blank pane — the one failure a navigation prop must not have.
   */
  onNavigateToView?: (view: MasterView) => void;
  /** Open one Evidence sub-tab, so a lane on the board can send the reader to the tab that owns it. */
  onOpenEvidenceTab?: (tab: EvidenceTabId) => void;
}

const ClinicalInsightsCard = memo(function ClinicalInsightsCard({
  isDark,
  classCard,
  classCardHeader,
  classCardTitle,
  analysisState,
  handleCopyReport,
  copied,
  gene,
  variant,
  uniprotId,
  loadingStep,
  formatEnergyString,
  selectedResidueIndex,
  settings,
  classTextBody,
  classTextMute,
  classBorderSec,
  computedResiduesCache,
  isBiophysicalLoading: propIsBiophysicalLoading,
  isClinicalLoading: propIsClinicalLoading,
  isNarrativeLoading: propIsNarrativeLoading,
  foldingEnergetics,
  foldingDdG,
  disruptionPredictor,
  onNavigateToView,
  onOpenEvidenceTab
}: ClinicalInsightsCardProps) {
  const isPresetData = VARIANT_PRESETS.some(
    (p) => p.gene.toUpperCase() === gene.toUpperCase() && p.variant.toLowerCase() === variant.toLowerCase()
  );
  const { isFolding, foldingStatus } = useFoldxRunState();
  const isBiophysicalLoading = propIsBiophysicalLoading !== undefined
    ? propIsBiophysicalLoading
    : Boolean(analysisState.isLoading && analysisState.result && (!analysisState.result.insights || (!analysisState.result.insights.biochemicalShift && !analysisState.result.insights.structuralImpact)));
  const isClinicalLoading = propIsClinicalLoading !== undefined
    ? propIsClinicalLoading
    : Boolean(analysisState.isLoading && analysisState.result && !analysisState.result.analysis);
  const isNarrativeLoading = propIsNarrativeLoading !== undefined
    ? propIsNarrativeLoading
    : isClinicalLoading;

  /**
   * Whether a run that would produce `insights` is still in flight.
   *
   * Needed because `insights` is absent for the WHOLE of a synthesis, so "no insights" cannot
   * distinguish "the model has not answered yet" from "the model answered without a structured
   * payload". Both stages count: the narrative stage itself, and a run that is still streaming
   * evidence before that stage begins. Observed on a fresh variant (CNOT1 p.Phe876Leu), where the
   * unavailable banner sat directly under a moving "ANALYZING BIOPHYSICAL PROPERTIES" bar.
   */
  const structuredAnalysisPending = isNarrativeLoading || Boolean(analysisState.isLoading);

  /**
   * The condensed clinical summary this view shows in place of the narrative.
   *
   * `summariseNarrative` selects the narrative's own clinical section and trims on a sentence
   * boundary; it authors nothing. See `shared/narrativeSummary.ts` for why the Insights view shows a
   * summary at all — briefly, the Report is the narrative's home and duplicating the full text here
   * created two copies of one AI artefact, only one of which was covered by the print pass, the EHR
   * export and the report fingerprint.
   */
  const narrativeSummary = useMemo(
    // 700 characters: at the default 420 a long second sentence left a one-sentence excerpt.
    () => summariseNarrative(analysisState.result?.analysis, { maxChars: 700 }),
    [analysisState.result?.analysis]
  );

  /**
   * Whether that narrative is AI-authored — from the shared predicate, so this card, the inspector rail
   * and the report's synthesis chip cannot disagree. A degraded run also has an `analysis` string (the
   * route assembles a rule-based report), so testing for text alone would label rule-based prose as a
   * model's.
   */
  const narrativeAuthorship = narrativeAuthorshipOfResult(
    analysisState.result,
    isFallbackNarrative(
      analysisState.result?.analysis,
      analysisState.result?.isFallback,
      analysisState.result?.fallbackReason
    )
  );
  const narrativeIsAi = narrativeAuthorship === "ai";
  // The same context the synthesis was planned with, so a current narrative never reads as outdated.
  const narrativeContext = useNarrativeEvidenceContext();
  const narrativeOutdated = narrativeFreshness(analysisState.result, narrativeContext) === "outdated";
  const narrativeModel = (analysisState.result?.insights as { model?: string } | undefined)?.model;

  const narrativeScrollTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (narrativeScrollTimer.current !== null) window.clearTimeout(narrativeScrollTimer.current);
  }, []);

  /**
   * Take the reader to the complete text.
   *
   * The Report's summary section is user-toggleable, and a section switched off does not mount — so
   * navigating to `#report-summary` while it was disabled would land on a report that does not
   * contain the narrative. Re-enable it through the same store action the Report inspector's toggle
   * uses, then scroll once the view has mounted. The scroll is a progressive enhancement: if the
   * element is not there yet the reader is still on the Report view, which is the point.
   */
  const handleOpenFullNarrative = useCallback(() => {
    const store = useVariantAnalysisStore.getState();
    if (store.reportSections && store.reportSections.summary === false) {
      store.toggleReportSection("summary");
    }
    onNavigateToView?.("report");
    // One pending scroll at a time, and none after unmount: a timer that outlives the card reads
    // `document` in a torn-down environment (the failure CI reported as "document is not defined").
    if (narrativeScrollTimer.current !== null) window.clearTimeout(narrativeScrollTimer.current);
    narrativeScrollTimer.current = window.setTimeout(() => {
      narrativeScrollTimer.current = null;
      if (typeof document === "undefined") return;
      document.getElementById("report-summary")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [onNavigateToView]);

  const insightsEvidence = useMemo(() => {
    const result = analysisState.result;
    if (!result) return null;
    const consensus = deriveConsensus({ result, foldingEnergetics, foldingDdG, plddt: disruptionPredictor?.plddt, isFolding, foldingStatus });
    return buildInsightsEvidence({
      result,
      functionInput: functionEvidenceInputFrom(result),
      stability: consensus
        ? { verdict: consensus.consensusVerdict, enginesCounted: consensus.enginesCounted, enginesDestabilizing: consensus.enginesDestabilizing }
        : null,
      isLoading: Boolean(analysisState.isLoading || isBiophysicalLoading),
      narrativeDegraded: isFallbackNarrative(result.analysis, result.isFallback, result.fallbackReason),
      deepEnginesNamed: narrativeDeepEvidenceStatus(result, narrativeContext).informative,
    });
  }, [analysisState.result, analysisState.isLoading, isBiophysicalLoading, foldingEnergetics, foldingDdG, disruptionPredictor?.plddt, isFolding, foldingStatus, narrativeContext]);

  return (
    <div className={`${classCard} ins-shell`} id="clinical-insights-report-card">
      {/* Card Header */}
      <div className={`ins-shell__header ${classCardHeader}`}>
        <div className="ins-shell__heading">
          <div className="ins-shell__title-row">
            <h3 className={`ins-shell__title screen-title ${classCardTitle}`}>
              Insights
            </h3>
            {analysisState.result && analysisState.result.isDemoData && isPresetData && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border cs-badge cs-badge-clay">
                Preset Profile
              </span>
            )}
            <ResearchGuideButton topic="insights" label="How this interpretation is assembled" className="rgd-trigger ins-shell__guide" />
            {analysisState.result && (
              <InsightsExportMenu
                analysisState={analysisState} gene={gene} variant={variant} uniprotId={uniprotId} settings={settings}
                foldingEnergetics={foldingEnergetics} foldingDdG={foldingDdG} disruptionPredictor={disruptionPredictor}
                handleCopyReport={handleCopyReport} copied={copied}
              />
            )}
          </div>
          <span className="ins-shell__notice">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            The classification is computed by rules; the written summary may be AI-generated or rule-based. Neither is a clinical determination. Professional evaluation required.
          </span>
        </div>
        
      </div>

      {analysisState.result?.isDemoData && (
        <div className="mx-4 mt-3 mb-1 p-2.5 rounded-xl border text-[11px] font-medium leading-relaxed transition-all flex items-center gap-2"
          style={{ background: "color-mix(in srgb, var(--cs-accent-clay) 5%, transparent)", borderColor: "var(--cs-border)", color: "var(--cs-text-accent)" }}>
          <span>⚠ Demo data — example preset; not a live backend analysis</span>
        </div>
      )}


      {/* Card Body */}
      <div className="ins-shell__body">
        {analysisState.isLoading && !analysisState.result ? (
          /* Multi step loader inside insights card */
          <div className="ins-loading" role="status" aria-busy="true">
            <h4>Analyzing variant evidence…</h4><p>{loadingStep}</p>
            <div className="ins-loading__rows" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <span key={i} />)}</div>
          </div>
        ) : analysisState.error && !analysisState.result ? (
          /* Clean, modern empty/notice state inside insights card */
          <div className="flex flex-col items-center justify-center p-6 rounded-xl my-4 max-w-lg mx-auto text-center border border-cs-border bg-cs-surface-2">
            <div className="p-3 rounded-full border mb-3" style={{ background: "var(--cs-warn-soft)", borderColor: "color-mix(in srgb, var(--cs-warn) 25%, transparent)", color: "var(--cs-warn)" }}>
              <AlertTriangle className="w-6 h-6" aria-hidden="true" />
            </div>
            <h4 className="font-semibold text-sm text-cs-text-primary mb-1">
              Variant analysis failed
            </h4>
            <p className="text-xs text-cs-text-secondary leading-relaxed max-w-sm mb-4">
              {analysisState.error}
            </p>
            {onNavigateToView && <button
              type="button"
              onClick={() => onNavigateToView("search")}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 cursor-pointer"
              style={{ background: "var(--cs-text-accent)", color: "var(--cs-bg)" }}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Return to variant query
            </button>}
          </div>
        ) : analysisState.result ? (
          <div className="flex flex-col gap-5 w-full">
            {analysisState.isLoading && <p className="ins-callout" role="status">Evidence is still arriving. These readings may change as the analysis completes.</p>}
            {analysisState.error && <p className="ins-callout" data-tone="warning" role="alert">{analysisState.error}</p>}
            {insightsEvidence && (
              <InsightsScreen
                evidence={insightsEvidence}
                narrative={narrativeSummary.text ? {
                  paragraphs: narrativeSummary.text.split("\n\n"),
                  sourceSection: narrativeSummary.sourceSection ?? null,
                  truncated: narrativeSummary.truncated,
                  isAi: narrativeIsAi,
                  model: narrativeModel,
                  outdated: narrativeOutdated,
                } : null}
                onOpenTab={onOpenEvidenceTab}
                onOpenReport={handleOpenFullNarrative}
              />
            )}
            {!analysisState.result.insights && (settings?.narrativeMode === "off" || settings?.narrativeMode === "on-demand") && (
              <p className="ins-callout m-0" data-tone="muted">Rule-based interpretation is available independently. {settings.narrativeMode === "off" ? "AI synthesis is off." : "Generate an optional AI summary from Report when needed."}</p>
            )}
            {/* Only a FINISHED run may say the structured report is missing: `insights` is also absent
                while the model is still working, so this must not fire beside a live progress state. */}
            {!analysisState.result.insights && !structuredAnalysisPending && settings?.narrativeMode !== "off" && settings?.narrativeMode !== "on-demand" && (
              <p className="ins-callout m-0" data-tone="warning">
                <span>
                  <strong>No structured interpretation came back.</strong>{" "}
                  {analysisState.result.analysis
                    ? "The run returned the clinical narrative only. The board above is built from the rule engine, which does not depend on it."
                    : "The run returned neither a structured interpretation nor a narrative. Re-run the analysis to try again."}
                </span>
              </p>
            )}
          </div>
        ) : (
          /* Startup or placeholder state */
          <div className="text-center py-12" style={{ color: "var(--cs-text-muted)" }}>
            <Lightbulb className="w-10 h-10 mx-auto stroke-[1.5] mb-2 animate-pulse" style={{ color: "var(--cs-text-accent)" }} />
            <p className="text-sm font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--cs-text-accent)" }}>Insights ready</p>
            <div className="w-16 h-[1px] mx-auto my-3" style={{ background: "var(--cs-border)" }} />
            <p className="text-xs max-w-sm mx-auto mt-1 leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
              Submit a variant search query to generate an automated clinical insights narrative, ACMG criteria classifications, biochemical property comparisons, and structural plausibility reasoning.
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

export default ClinicalInsightsCard;

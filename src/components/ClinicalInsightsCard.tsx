import { ResearchGuideButton } from "./knowledge/ResearchGuideButton";
import React, { memo, useCallback, useMemo } from "react";
import { generateProvenanceManifest } from "../shared/provenance";
import { deriveConsensus } from "../lib/insightsConsensus";
export { deriveConsensus } from "../lib/insightsConsensus";
import { toCanonicalDdg } from "../shared/engineStatus";
// One frequency formatter for the whole app — this card used `toExponential(3)` while the
// Population Frequencies screen used the shared one, so the same value rendered two ways.
// One ACMG criteria list and one provenance vocabulary for every surface that renders criteria.
// The condensed clinical summary this view shows in place of the full narrative, plus the shared
// "is this narrative AI-authored or rule-based" verdict — the payload carries both kinds of text.
import { summariseNarrative } from "../shared/narrativeSummary";
import { deriveNarrativeAuthorship } from "../shared/narrativeAuthorship";
import { isFallbackNarrative } from "../services/pipeline/variantCache";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import {
  FileText,
  CheckCircle2,
  Copy,
  Lightbulb,
  Download,
  AlertTriangle
} from "lucide-react";
import { InsightsScreen } from "./insights/InsightsScreen";
import { buildInsightsEvidence } from "../shared/insightsEvidence";
import { functionEvidenceInputFrom } from "./evidence/function/functionInput";
import type { EvidenceTabId } from "../shared/insightsEvidence";
import { VARIANT_PRESETS } from "../data";
import { AnalysisState, UserSettings, NearestResidue } from "../types";
import type { MasterView } from "./MasterSidebar";

/**
 * The `verdictContext` the export paths pass to the manifest — one function, so the call site has
 * nothing left to get wrong.
 *
 * A review showed the gap this closes: the tests pinned the manifest's precedence rules, but the
 * component that calls it was untested, so a regression passing `foldingEnergetics?.consensusVerdict`
 * (the frozen snapshot — exactly the `109fa35` defect) as the derived verdict passed every test. The
 * caller could supply an *answer* where an input belonged.
 *
 * This takes inputs and returns the context, so the component's call site is a single call whose
 * argument is data. Substituting the stored verdict is no longer something a caller can express, and
 * the accompanying test fails if this ever returns the snapshot.
 */
export function buildExportVerdictContext(args: {
  result: AnalysisState["result"] | null;
  foldingEnergetics?: any;
  foldingDdG?: number | null;
  plddt?: number | null;
}) {
  const derived = deriveConsensus(args);
  /**
   * The caveat comes from the STORED field — a derivation from `pendingTools` was REVERTED.
   *
   * It looked like the same staleness fix as the verdict, and it was not. A review traced every
   * producer and reader: both server producers compute `evidenceComplete` and `pendingTools` from one
   * snapshot with `evidenceComplete === (pendingTools.length === 0)`, and no client code writes
   * `foldingEnergetics` into the cache — so the stored pair could never disagree, and deriving it
   * changed nothing for stored data.
   *
   * What it did change is that it made the value WRONG in a new way. `pendingTools` is pruned only by
   * the pollers; `settleUnreachableRemoteEngines` clears STATUSES without removing the name. So after a
   * terminal commit an engine reads `no-result` on screen, leaves `coverage.running`, and still sits in
   * `pendingTools` — and the derived caveat then says the run is incomplete for a run the screen shows
   * as complete. A value that cannot disagree was replaced by one that can.
   */
  const pendingTools = args.foldingEnergetics?.pendingTools ?? [];
  return {
    derivedVerdict: derived?.consensusVerdict ?? null,
    evidenceComplete: args.foldingEnergetics?.evidenceComplete ?? null,
    pendingTools
  };
}

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
    () => summariseNarrative(analysisState.result?.analysis),
    [analysisState.result?.analysis]
  );

  /**
   * Whether that narrative is AI-authored — from the shared predicate, so this card, the inspector rail
   * and the report's synthesis chip cannot disagree. A degraded run also has an `analysis` string (the
   * route assembles a rule-based report), so testing for text alone would label rule-based prose as a
   * model's.
   */
  const narrativeAuthorship = deriveNarrativeAuthorship({
    analysis: analysisState.result?.analysis,
    isDegraded: isFallbackNarrative(
      analysisState.result?.analysis,
      analysisState.result?.isFallback,
      analysisState.result?.fallbackReason
    ),
    declaredSource: (analysisState.result?.insights as { source?: string } | undefined)?.source,
  });
  const narrativeIsAi = narrativeAuthorship === "ai";
  const narrativeModel = (analysisState.result?.insights as { model?: string } | undefined)?.model;

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
    window.setTimeout(() => {
      document.getElementById("report-summary")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [onNavigateToView]);

  const insightsEvidence = useMemo(() => {
    const result = analysisState.result;
    if (!result) return null;
    const consensus = deriveConsensus({ result, foldingEnergetics, foldingDdG, plddt: disruptionPredictor?.plddt });
    return buildInsightsEvidence({
      result,
      functionInput: functionEvidenceInputFrom(result),
      stability: consensus
        ? { verdict: consensus.consensusVerdict, enginesCounted: consensus.enginesCounted, enginesDestabilizing: consensus.enginesDestabilizing }
        : null,
      isLoading: Boolean(analysisState.isLoading || isBiophysicalLoading),
      narrativeDegraded: isFallbackNarrative(result.analysis, result.isFallback, result.fallbackReason),
    });
  }, [analysisState.result, analysisState.isLoading, isBiophysicalLoading, foldingEnergetics, foldingDdG, disruptionPredictor?.plddt]);

  const handleExportJSON = () => {
    if (!analysisState.result) return;

    /**
     * ONE derived consensus for the whole export.
     *
     * The three consensus fields used to come from three separate calls, and the interval bounds were
     * not derived at all — they were read from the stored snapshot. The result was a report whose
     * interval did not contain its own point estimate: measured on screen as 80.6% with 68.1-89.1,
     * exported as 80.6% with 2.1-11.3, because the stored snapshot came from an earlier two-engine
     * commit. A derived value beside a stored one is the same defect class this export already fixed for
     * the verdict itself.
     */
    const derivedConsensus = deriveConsensus({
      result: analysisState.result,
      foldingEnergetics,
      foldingDdG,
      plddt: disruptionPredictor?.plddt
    });

    const exportData = {
      metadata: {
        gene: gene,
        variant: variant,
        uniprotId: uniprotId || analysisState.result.metadata?.uniprotId || "",
        timestamp: new Date().toISOString(),
        // Model and version strings were literals here ("DynaMut2 Consensus", "RaSP Precomputed",
        // appVersion "1.0.0") that named engines whether or not they served the run. Only what the
        // payload records is exported.
        narrativeModel: (analysisState.result.insights as { model?: string } | undefined)?.model ?? null
      },
      inputParameters: {
        gene,
        variant,
        uniprotId,
        acmgWeighting: settings.acmgWeighting
      },
      databaseResults: {
        clinvar: analysisState.result.clinvar || null,
        gnomad: {
          frequency: analysisState.result.gnomadFrequency || null,
          constraint: analysisState.result.gnomadConstraint || null
        },
        predictors: analysisState.result.predictorData || null,
        conservation: analysisState.result.conservationData || null,
        uniprotFeatures: analysisState.result.uniprotFeatures || null
      },
      biophysicalEnergetics: {
        foldx: {
          ddG: foldingEnergetics?.foldx ?? analysisState.result.foldingEnergetics?.foldx ?? null,
          mean: foldingEnergetics?.foldxMean ?? null,
          sd: foldingEnergetics?.foldxSd ?? null,
          vdwClashDelta: foldingEnergetics?.vdw ?? null,
          electrostatics: foldingEnergetics?.electrostatics ?? null,
          stericClashWarning: foldingEnergetics?.stericClashWarning ?? false,
          sidechainRmsd: foldingEnergetics?.localSidechainRmsd ?? null
        },
        dynamut2: foldingEnergetics?.dynamut2 ?? analysisState.result.dynamut2 ?? null,
        ddmut: foldingEnergetics?.ddmut ?? analysisState.result.ddmut ?? null,
        rasp: foldingEnergetics?.rasp ?? analysisState.result.rasp ?? null,
        thermompnn: foldingEnergetics?.thermompnn ?? analysisState.result.thermompnn ?? null,
        stabilityoracle: foldingEnergetics?.stabilityoracle ?? analysisState.result.foldingEnergetics?.stabilityoracle ?? null,
        // Derived, not read from the snapshot: see `deriveConsensus`.
        consensusStabilityVerdict:
          derivedConsensus?.consensusVerdict ?? foldingEnergetics?.consensusVerdict ?? null,
        // The JSON export carries the caveat too, so a downstream reader of the report knows the
        // verdict can still move. This replaced the " (Preliminary - pending: …)" suffix.
        // From the stored field, as the manifest does — the derivation was reverted, see
        // `buildExportVerdictContext`.
        consensusEvidenceComplete: foldingEnergetics?.evidenceComplete ?? null,
        consensusPendingTools: foldingEnergetics?.pendingTools ?? [],
        /**
         * The agreement behind the verdict, derived with it. This replaced `consensusProbability` and
         * `consensusConfMin/Max`, which came from hand-typed curves (`thresholds/consensus.ts`).
         */
        consensusEnginesCounted: derivedConsensus?.enginesCounted ?? null,
        consensusEnginesDestabilizing: derivedConsensus?.enginesDestabilizing ?? null,
        consensusMedianDdg: derivedConsensus?.medianDdg ?? null,
        /**
         * Every engine in ONE sign convention. The per-engine keys above are the providers' raw values
         * (kept as they were for existing readers); DynaMut2 and DDMut report negative = destabilizing,
         * so a reader comparing engines must use these.
         */
        signConvention: "canonicalDdg: kcal/mol, positive = destabilizing for every engine",
        canonicalDdg: {
          foldx: toCanonicalDdg("foldx", foldingEnergetics?.foldxMean ?? foldingEnergetics?.foldx ?? null),
          dynamut2: toCanonicalDdg("dynamut2", foldingEnergetics?.dynamut2 ?? analysisState.result.dynamut2 ?? null),
          ddmut: toCanonicalDdg("ddmut", foldingEnergetics?.ddmut ?? analysisState.result.ddmut ?? null),
          rasp: toCanonicalDdg("rasp", foldingEnergetics?.rasp ?? analysisState.result.rasp ?? null),
          thermompnn: toCanonicalDdg("thermompnn", foldingEnergetics?.thermompnn ?? analysisState.result.thermompnn ?? null),
          stabilityoracle: toCanonicalDdg("stabilityoracle", foldingEnergetics?.stabilityoracle ?? null)
        }
      },
      acmgCriteriaSuggestions: {
        ruleBased: analysisState.result.ruleBasedInsights || null,
        aiGenerated: analysisState.result.insights || null
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${gene}_${variant}_analysis_export.json`.replace(/\s+/g, "_");
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportProvenanceJSON = () => {
    if (!analysisState.result) return;
    const manifest = generateProvenanceManifest(
      gene,
      variant,
      uniprotId || analysisState.result.metadata?.uniprotId || "",
      analysisState.result,
      settings,
      foldingEnergetics,
      // One call, inputs only — see `buildExportVerdictContext`.
      buildExportVerdictContext({
        result: analysisState.result,
        foldingEnergetics,
        foldingDdG,
        plddt: disruptionPredictor?.plddt
      })
    );
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${gene}_${variant}_provenance_manifest.json`.replace(/\s+/g, "_");
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`${classCard} ins-shell`} id="clinical-insights-report-card">
      {/* Card Header */}
      <div className={`ins-shell__header ${classCardHeader}`}>
        <div className="flex flex-col">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4" style={{ color: "var(--cs-text-accent)" }} />
            <h3 className={`ins-shell__title ${classCardTitle}`}>
              Insights
            </h3>
            <ResearchGuideButton topic="insights" label="How this interpretation is assembled" />
            {analysisState.result && analysisState.result.isDemoData && isPresetData && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border cs-badge cs-badge-clay">
                Preset Profile
              </span>
            )}
          </div>
          <span className="ins-shell__notice">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            The classification is computed by rules; the written summary may be AI-generated or rule-based. Neither is a clinical determination. Professional evaluation required.
          </span>
        </div>
        
        {analysisState.result && (
          <div className="ins-shell__exports">
            {/* Export Provenance Manifest Button */}
            <button
              onClick={handleExportProvenanceJSON}
              disabled={analysisState.isLoading}
              className="cs-btn-ghost cs-btn-ghost-accent !text-[11px] !px-2.5 !py-1 select-none"
              title="Export verifiable scientific provenance manifest (model hashes, data versions, and structure metadata)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Provenance Manifest</span>
            </button>

            {/* Export JSON Button */}
            <button
              onClick={handleExportJSON}
              disabled={analysisState.isLoading}
              className="cs-btn-ghost !text-[11px] !px-2.5 !py-1 select-none"
              title="Export structured analysis payload as JSON file"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>

            {/* Copy Report Button */}
            <button
              onClick={handleCopyReport}
              disabled={analysisState.isLoading}
              className="cs-btn-ghost !text-[11px] !px-2.5 !py-1 select-none"
              title="Copy markdown report to clipboard"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--cs-text-accent)" }} />
                  <span className="font-semibold" style={{ color: "var(--cs-text-accent)" }}>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Report</span>
                </>
              )}
            </button>
          </div>
        )}
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

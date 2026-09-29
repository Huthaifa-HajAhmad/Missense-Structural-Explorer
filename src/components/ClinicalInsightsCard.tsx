import React, { memo, useCallback, useMemo, useRef, useState, useLayoutEffect } from "react";
import { getResidueContext, getCalibration } from "../shared/uncertainty";
import { generateProvenanceManifest } from "../shared/provenance";
import { computeCalibratedConsensus, THRESHOLDS } from "../shared/thresholds";
// One frequency formatter for the whole app — this card used `toExponential(3)` while the
// Population Frequencies screen used the shared one, so the same value rendered two ways.
import { formatAlleleFrequency } from "../shared/frequencyEvidence";
// One ACMG criteria list and one provenance vocabulary for every surface that renders criteria.
import { ACMG_SOURCE_LABEL, acmgCriteriaView } from "../shared/acmgCriteriaView";
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
  ShieldAlert, 
  Activity, 
  Layers, 
  Atom, 
  ExternalLink, 
  Database,
  Lightbulb,
  Download,
  KeyRound,
  Settings,
  AlertTriangle,
  ChevronRight
} from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { 
  Radar, 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis, 
  ResponsiveContainer, 
  Tooltip 
} from "recharts";

/**
 * Shown when no criterion carries `ai_suggested`.
 *
 * Deliberately covers both causes rather than asserting one. The server drops a model-suggested code
 * when the rule engine already computed the same code (`uniqueAiCriteria` in
 * `server/routes/shared.ts`), so an empty group means either that the model proposed nothing or that
 * everything it proposed was already evidenced — and this card cannot tell which from the payload.
 * "The model suggested no additional criteria" would be a claim it cannot support.
 */
const NO_AI_CRITERIA_NOTE =
  "No additional criteria were proposed by the model — either it proposed none, or every code it proposed was already computed by the rule engine and is listed above.";

function SafeResponsiveContainer({ children }: { children: React.ReactElement }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const checkSize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setDimensions(prev => {
            if (prev && prev.width === clientWidth && prev.height === clientHeight) {
              return prev;
            }
            return { width: clientWidth, height: clientHeight };
          });
        }
      }
    };
    checkSize();
    const observer = new ResizeObserver(checkSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[155px]" style={{ minWidth: 0, minHeight: 155 }}>
      {dimensions ? (
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={0}
          initialDimension={dimensions}
        >
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
import { VARIANT_PRESETS } from "../data";
import { AnalysisState, UserSettings, NearestResidue } from "../types";
import type { MasterView } from "./MasterSidebar";
import { resolveResidueShiftModel } from "../lib/residueShiftModel";
import { deriveBiochemicalNarrative, getPropertyScaleDefinition } from "../shared/residueShiftEvidence";

/**
 * The consensus verdict DERIVED from the current run state, built from EXACTLY the expressions
 * `EnergeticsView` uses, so an export cannot state a verdict the screen contradicts.
 *
 * `foldingEnergetics.consensusVerdict` is a snapshot taken when the server committed the FoldX job.
 * Remote engines keep resolving for up to ten minutes after that and the badge recomputes as they do,
 * so a report built from the stored field could print "Low Misfolding Risk (Neutral Stability)" for a
 * run the screen calls "High Misfolding Risk (Destabilizing Consensus)". A stored verdict is a fact
 * about the past; an exported report is a claim about this variant.
 *
 * The first version of this function claimed to be equivalent and was not, in two ways that a review
 * reproduced:
 *
 *   • it passed `result.uniprotFeatures` — an object `{ features: [...] }` — where the consensus
 *     expects the ARRAY. `getResidueContext` iterates the argument, so this threw
 *     "features is not iterable" inside both export click handlers: no download, no error UI, both
 *     export buttons dead. The badge passes `result.uniprotFeatures?.features`.
 *   • it sourced the residue index from the live UI selection rather than the variant's own metadata.
 *     A grid sweep showed that alone flips the verdict for ~1000 bundles.
 *
 * `result: any` is what let both mistakes past `tsc`. The parameter is typed now — that is the real
 * fix, because this function's whole job is to agree with a caller elsewhere in the codebase.
 */
export function deriveConsensus(args: {
  result: AnalysisState["result"] | null;
  foldingEnergetics?: any;
  /** The FoldX single-value fallback, which the badge applies and the first version omitted. */
  foldingDdG?: number | null;
  plddt?: number | null;
}) {
  const { result, foldingEnergetics: fe, foldingDdG, plddt } = args;
  if (!result) return null;
  return computeCalibratedConsensus(
    {
      // Mirrors `EnergeticsView`'s `energetics` memo key for key. The five remote engines read from
      // `foldingEnergetics` only — an extra `?? result.dynamut2` fallback here would be a divergence,
      // not a safety net.
      foldx: fe?.foldx ?? foldingDdG ?? null,
      foldxMean: fe?.foldxMean ?? foldingDdG ?? null,
      dynamut2: fe?.dynamut2 ?? null,
      ddmut: fe?.ddmut ?? null,
      rasp: fe?.rasp ?? null,
      thermompnn: fe?.thermompnn ?? null,
      stabilityoracle: fe?.stabilityoracle ?? null,
      foldxRepairFailed: fe?.foldxRepairFailed ?? false,
      foldxBinaryMissing: fe?.foldxBinaryMissing ?? false
    },
    // The ARRAY. Passing the wrapper object threw inside the export handlers.
    result.uniprotFeatures?.features,
    // The variant's own residue, as the badge uses — not the live viewer selection.
    result.metadata?.residueIndex ?? 0,
    plddt ?? null
  );
}

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
  onNavigateToView
}: ClinicalInsightsCardProps) {
  const { openSettingsTab } = useSettings();
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

  /**
   * Shared with the Residue Shifts inspector: one classification of "is there a
   * usable narrative", so the two views cannot disagree and neither prints the
   * pipeline's fallback markdown as prose.
   */
  const biochemicalNarrative = useMemo(
    () =>
      deriveBiochemicalNarrative(analysisState.result?.insights?.biochemicalShift, {
        isLoading: isNarrativeLoading
      }),
    [analysisState.result?.insights?.biochemicalShift, isNarrativeLoading]
  );

  const renderResiduePropertyRadar = useCallback(() => {
    /*
     * Resolved through the shared model rather than by re-parsing `variant` here.
     *
     * Two defects this closes:
     *   1. Axis names were local to this chart ("Charge", "Molecular Size") and had
     *      already drifted from the Residue Shifts tab ("Isoelectric Charge Index",
     *      "Residue Volume / Size"). Both now read PROPERTY_SCALE_DEFINITIONS.
     *   2. An unresolved residue fell back to a flat all-50 profile, which drew a
     *      plausible-looking radar out of a parse failure. Missing data now reads as
     *      missing data.
     */
    const model = resolveResidueShiftModel({
      wildType: analysisState.result?.metadata?.wildType,
      mutant: analysisState.result?.metadata?.mutant,
      /*
       * `metadata.variant`, not the `variant` prop. The prop is the live search
       * box (`searchSlice.setVariant`), so an unsubmitted edit would make this
       * chart describe a different substitution than the tab and the inspector,
       * which both read metadata. The pipeline stores `wildType/mutant: ""` for
       * placeholder, error and demo states, so the fallback is reachable.
       */
      variant: analysisState.result?.metadata?.variant
    });

    if (!model.contrast) {
      return (
        <div
          className="p-3 rounded-lg border text-[11px] leading-relaxed font-sans"
          style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-muted)" }}
        >
          Residue property comparison is unavailable: the wild-type or variant residue could not be resolved to the
          normalised amino-acid scales. No profile is plotted, because a defaulted one would misrepresent the substitution.
        </div>
      );
    }

    const radarData = model.contrast.rows.map(row => ({
      subject: getPropertyScaleDefinition(row.key).shortLabel,
      WT: row.wildTypeValue,
      MUT: row.mutantValue
    }));

    const wtColor = "var(--cs-good)";
    const mutColor = "var(--cs-danger)";

    return (
      <div className="flex flex-col sm:flex-row items-center gap-4 justify-between p-3 rounded-lg border cs-surface-card transition-colors">
        <div className="w-full sm:w-[50%] h-[155px]">
          <SafeResponsiveContainer>
            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
              <PolarGrid stroke={isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.08)"} />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "var(--cs-text-secondary)" }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--cs-text-muted)" }} />
              <Radar name="Wild-Type" dataKey="WT" stroke={wtColor} fill={wtColor} fillOpacity={0.12} />
              <Radar name="Mutant" dataKey="MUT" stroke={mutColor} fill={mutColor} fillOpacity={0.12} />
              <Tooltip contentStyle={{ fontSize: 10, background: "var(--cs-surface)", borderColor: "var(--cs-border)", color: "var(--cs-text-primary)" }} />
            </RadarChart>
          </SafeResponsiveContainer>
        </div>
        <div className="w-full sm:w-[45%] flex flex-col gap-1.5 text-[10.5px]">
          <div className="flex items-center gap-2 pb-1 border-b cs-border-card-sep border-dashed">
            <span className="w-2.5 h-2.5 rounded" style={{ background: wtColor }}></span>
            <span style={{ color: "var(--cs-text-primary)" }}>Wild-Type ({model.wildTypeLabel})</span>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <span className="w-2.5 h-2.5 rounded" style={{ background: mutColor }}></span>
            <span style={{ color: "var(--cs-text-primary)" }}>Mutant ({model.mutantLabel})</span>
          </div>
          <p className="leading-relaxed font-sans" style={{ color: "var(--cs-text-muted)" }}>
            Plots the same normalised 0&ndash;100 descriptors as the Residue Shifts &amp; Pockets tab. Overlapping
            profiles indicate conservative substitutions; deviations show which chemical axis moved.
          </p>
          {/*
            The signed-axis note is load-bearing, not decoration: charge is 0 for
            Asp/Glu, 50 for neutral and 100 for Lys/Arg, and on a radar radius 0 is
            the origin. Without this sentence those two residues plot at the centre
            and read as "no charge" when they are the most strongly charged.
          */}
          <p className="leading-relaxed font-sans" style={{ color: "var(--cs-text-muted)" }}>
            On the charge axis, 0 = negative, 50 = neutral and 100 = positive, so a charge profile near the
            centre means a neutral residue rather than an uncharged one. The other three axes are magnitudes,
            where further from the centre is simply more of that property. The axes are fixed descriptors of the
            residue pair, not predictions of effect.
          </p>
          <div className="mt-1.5 pt-1.5 border-t cs-border-card-sep border-dashed text-[10px] leading-normal" style={{ color: "var(--cs-text-muted)" }}>
            <strong>Primary Literature Scales:</strong>
            <ul className="list-disc pl-3 mt-0.5 space-y-0.5">
              {model.contrast.rows.map(row => {
                const definition = getPropertyScaleDefinition(row.key);
                return (
                  <li key={row.key}>
                    {definition.shortLabel}: {definition.source}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    );
  }, [
    isDark,
    analysisState.result?.metadata?.wildType,
    analysisState.result?.metadata?.mutant,
    analysisState.result?.metadata?.variant
  ]);

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
        appVersion: "1.0.0",
        models: {
          foldx: "FoldX BuildModel 5.0",
          dynamut2: "DynaMut2 Consensus",
          ddmut: "DDMut Deep Learning",
          rasp: "RaSP Precomputed",
          thermompnn: "ThermoMPNN Neural Stability",
          alphamissense: "AlphaMissense (via EVE/REVEL/AM)"
        }
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
        consensusProbability:
          derivedConsensus?.consensusProbability ??
          (foldingEnergetics as any)?.consensusProbability ??
          null,
        // Derived with it, NOT read from the snapshot — otherwise the interval can contradict the
        // probability it is supposed to bound, which is what the export did before this.
        consensusConfMin:
          derivedConsensus?.consensusConfMin ??
          (foldingEnergetics as any)?.consensusConfMin ??
          null,
        consensusConfMax:
          derivedConsensus?.consensusConfMax ??
          (foldingEnergetics as any)?.consensusConfMax ??
          null
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
    <div className={`${classCard} overflow-visible flex flex-col transition-all`} id="clinical-insights-report-card">
      {/* Card Header */}
      <div className={`px-5 py-4 border-b flex items-center justify-between transition-colors ${classCardHeader}`}>
        <div className="flex flex-col">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4" style={{ color: "var(--cs-text-accent)" }} />
            <h3 className={`text-sm font-bold uppercase tracking-wider font-mono ${classCardTitle}`}>
              Variant Insights Report
            </h3>
            {analysisState.result && analysisState.result.isDemoData && isPresetData && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border cs-badge cs-badge-clay">
                Preset Profile
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium tracking-wide mt-0.5 flex items-center gap-1" style={{ color: "var(--cs-warn)" }}>
            <AlertTriangle className="w-3 h-3 shrink-0" />
            AI narrative suggestions only; not a clinical determination. Professional evaluation required.
          </span>
        </div>
        
        {analysisState.result && (
          <div className="flex items-center gap-2">
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
                  <span className="font-semibold" style={{ color: "var(--cs-text-accent)" }}>Copied!</span>
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
      <div className="p-5 flex-1 flex flex-col justify-center">
        {analysisState.isLoading ? (
          /* Multi step loader inside insights card */
          <div className="flex flex-col items-center justify-center py-12 text-center" style={{ color: "var(--cs-text-muted)" }}>
            <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin mb-4" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }}></div>
            <p className="text-sm font-semibold font-mono mb-2" style={{ color: "var(--cs-text-primary)" }}>Analyzing variant evidence...</p>
            <p className="text-xs max-w-xs font-mono h-5 animate-pulse" style={{ color: "var(--cs-text-accent)" }}>{loadingStep}</p>
          </div>
        ) : analysisState.error ? (
          /* Clean, modern empty/notice state inside insights card */
          <div className="flex flex-col items-center justify-center p-6 rounded-xl my-4 max-w-lg mx-auto text-center border border-cs-border bg-cs-surface-2">
            <div className="p-3 rounded-full border mb-3" style={{ background: "var(--cs-warn-soft)", borderColor: "color-mix(in srgb, var(--cs-warn) 25%, transparent)", color: "var(--cs-warn)" }}>
              <KeyRound className="w-6 h-6" />
            </div>
            <h4 className="font-semibold text-sm text-cs-text-primary mb-1">
              Variant Interpretation Awaiting Configuration
            </h4>
            <p className="text-xs text-cs-text-secondary leading-relaxed max-w-sm mb-4">
              Real-time biophysical modeling and clinical narrative synthesis require a configured API key.
            </p>
            <button
              type="button"
              onClick={() => openSettingsTab("api")}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 cursor-pointer"
              style={{ background: "var(--cs-text-accent)", color: "var(--cs-bg)" }}
            >
              <Settings className="w-3.5 h-3.5" />
              Configure API Key in Settings
            </button>
          </div>
        ) : analysisState.result ? (
          /* Analysis result presenting structured key metrics and narrative report */
          <div className="flex flex-col gap-5 w-full text-cs-text-secondary">
            {/*
              * CONCISE clinical summary, not the narrative.
              *
              * The full AI narrative used to render here verbatim, in a collapsible panel — the same
              * ~2,500 characters the Report view's "Executive Summary & Clinical Narrative" section
              * prints, in a second pane of one viewport. Two copies of one AI text is a provenance
              * problem before it is a layout problem: only the Report copy is covered by the section
              * toggles, the print pass, the EHR export and the SHA-256 fingerprint, so the two could
              * be read as different artefacts while being byte-identical.
              *
              * The Report keeps the narrative in full and unchanged; this surface shows the
              * conclusion and points at the source of truth. `summariseNarrative` selects the
              * narrative's own clinical section and trims on a sentence boundary — it writes no
              * prose, so nothing here can be attributed to the model that the model did not say.
              */}
            {narrativeSummary.text && (
              <div
                className="rounded-xl border overflow-hidden"
                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
              >
                <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--cs-border-subtle)" }}>
                  <span className="flex items-center gap-1.5 font-bold font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--cs-text-accent)" }}>
                    <FileText className="w-3.5 h-3.5" />
                    <span>Clinical summary</span>
                  </span>
                  {narrativeSummary.truncated && (
                    /*
                     * Named, not just chipped. The summary keeps whole sentences, so a claim can
                     * survive the cut while the sentence qualifying or reversing it does not — which
                     * is why the disclosure has to say the text continues rather than merely hint at
                     * it with a one-word tag.
                     */
                    <span className="text-[10px] font-mono uppercase tracking-wider shrink-0" style={{ color: "var(--cs-text-muted)" }}>
                      Excerpt — continues
                    </span>
                  )}
                </div>

                <div className="px-4 py-3 flex flex-col gap-2">
                  {narrativeSummary.sourceSection && (
                    <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--cs-text-muted)" }}>
                      {narrativeSummary.sourceSection}
                    </span>
                  )}
                  {/*
                    * One <p> per paragraph. `summariseNarrative` preserves blank-line paragraph breaks
                    * as `\n\n`, and a single <p> paints those as an ordinary space — so a summary that
                    * reported two paragraphs rendered as one run-on block.
                    */}
                  {narrativeSummary.text.split("\n\n").map((paragraph, index) => (
                    <p
                      key={index}
                      className="text-[12.5px] leading-relaxed font-sans m-0"
                      style={{ color: "var(--cs-text-primary)" }}
                    >
                      {paragraph}
                    </p>
                  ))}

                  <button
                    type="button"
                    onClick={handleOpenFullNarrative}
                    /*
                     * The house focus idiom, not `outline-2`. This is the only `outline-2` in `src/`
                     * and `scripts/check-focus-indicators.mjs` does not recognise it as a replacement
                     * for a suppressed outline — so a keyboard user could have had no indicator at all
                     * on the one control that navigates away. `focus-visible:ring-*` is what the rest of
                     * the app uses and what that script audits.
                     */
                    className="self-start flex items-center gap-1 text-[11px] font-semibold cursor-pointer transition-colors hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
                    style={{ color: "var(--cs-text-accent)" }}
                  >
                    <span>{narrativeSummary.truncated ? "Read the full narrative in the Report" : "Open the full report"}</span>
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  </button>

                  {/*
                    * Says who wrote the prose and whether it is complete. Derived from the payload,
                    * so a degraded run cannot be presented here as an AI synthesis.
                    */}
                  <span className="text-[10px] leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
                    {narrativeIsAi
                      ? `AI-synthesised${narrativeModel ? ` by ${narrativeModel}` : ""} — condensed for this view; the Report holds the complete text.`
                      : "Rule-based synthesis — assembled from retrieved database evidence, not from a language model."}
                  </span>
                </div>
              </div>
            )}

            {/* Splicing Warning Alert */}
            {(() => {
              const spliceai = analysisState.result.conservationData?.spliceai;
              const spliceProximity = analysisState.result.conservationData?.spliceProximity;
              const isSpliceLoading = !spliceai && isBiophysicalLoading;
              const isNearJunction = spliceProximity?.isNearSpliceSite;
              /**
               * The splicing rule's PP3 band (Walker 2023), from the shared constant. This read a
               * hand-written `>= 0.10` — half the published cut — and called it "high probability of
               * splicing disruption", then claimed the engine's PP3 vote "includes this splice
               * disruption signal". The engine has never read splicing; the RNA splicing tab says so.
               */
              const hasSpliceDisruption = spliceai && spliceai.max_ds !== null && spliceai.max_ds >= THRESHOLDS.spliceai.splicingPp3;

              if (isSpliceLoading && isNearJunction) {
                return (
                  <div className="rounded-xl border p-4 flex flex-col gap-2" style={{ borderColor: "color-mix(in srgb, var(--cs-accent-clay) 25%, transparent)", background: "color-mix(in srgb, var(--cs-accent-clay) 6%, transparent)" }}>
                    <div className="flex items-center gap-2 font-semibold text-[11px] uppercase tracking-wider" style={{ color: "var(--cs-text-accent)" }}>
                      <span>Splice junction proximity</span>
                    </div>
                    <p className="text-[12px] leading-relaxed font-sans" style={{ color: "var(--cs-text-secondary)" }}>
                      Variant is <strong>{spliceProximity.distance} bp</strong> from a splice junction. SpliceAI is still running.
                    </p>
                  </div>
                );
              }

              if (hasSpliceDisruption) {
                return (
                  <div className="rounded-xl border p-4 flex flex-col gap-2 animate-fade-in" style={{ borderColor: "color-mix(in srgb, var(--cs-danger) 25%, transparent)", background: "var(--cs-danger-soft)" }}>
                    <div className="flex items-center gap-2 font-semibold text-[11px] uppercase tracking-wider" style={{ color: "var(--cs-text-danger-on-soft)" }}>
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>Predicted splicing change</span>
                    </div>
                    <p className="text-[12px] leading-relaxed font-sans" style={{ color: "var(--cs-text-danger-on-soft)" }}>
                      SpliceAI max Δ <strong>{spliceai!.max_ds!.toFixed(2)}</strong> is at or above {THRESHOLDS.spliceai.splicingPp3.toFixed(1)},
                      which the ClinGen splicing rule reads as support for PP3. The engine&apos;s PP3/BP4 comes from the
                      missense vote and does not include it — see the RNA splicing tab.
                    </p>
                  </div>
                );
              }

              if (isNearJunction && !spliceai) {
                return (
                  <div className="rounded-xl border p-4 flex flex-col gap-2" style={{ borderColor: "color-mix(in srgb, var(--cs-warn) 25%, transparent)", background: "var(--cs-warn-soft)" }}>
                    <div className="flex items-center gap-2 font-semibold text-[11px] uppercase tracking-wider" style={{ color: "var(--cs-text-warning-on-soft)" }}>
                      <span>Near a splice junction, no SpliceAI score</span>
                    </div>
                    <p className="text-[12px] leading-relaxed font-sans" style={{ color: "var(--cs-text-warning-on-soft)" }}>
                      Variant is <strong>{spliceProximity.distance} bp</strong> from a splice junction and no SpliceAI score reached
                      it. Distance is not evidence either way; check the splicing prediction directly.
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            {/* Multimer Warning Alert */}
            {analysisState.result.uniprotFeatures?.isMultimer && (
              <div className="rounded-xl border p-4 flex flex-col gap-2" style={{ borderColor: "color-mix(in srgb, var(--cs-warn) 25%, transparent)", background: "var(--cs-warn-soft)" }}>
                <div className="flex items-center gap-2 font-bold font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--cs-text-warning-on-soft)" }}>
                  <Activity className="w-3.5 h-3.5" />
                  <span>Forms a complex</span>
                </div>
                <p className="text-[12px] leading-relaxed pl-5 font-sans" style={{ color: "var(--cs-text-warning-on-soft)" }}>
                  UniProt&apos;s SUBUNIT record: <strong>{analysisState.result.uniprotFeatures.subunitComment}</strong>{" "}
                  The stability estimates here are for the single chain and do not see subunit interfaces; the
                  Multimer assembly tab shows the complex and whether this residue sits at an interface.
                </p>
              </div>
            )}

            {/* Structured Dynamic Insights Panel */}
            {isNarrativeLoading ? (
              <div className="rounded-xl border p-4 space-y-4 transition-all" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                <div className="flex items-center gap-2 font-bold font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--cs-text-accent)" }}>
                  <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }}></div>
                  <span className="animate-pulse">Analyzing biophysical properties with Gemini AI...</span>
                </div>
                <div className="space-y-2 pl-5 pt-1">
                  <div className="h-3 rounded animate-pulse w-3/4" style={{ background: "var(--cs-bg-subtle)" }}></div>
                  <div className="h-3 rounded animate-pulse w-5/6" style={{ background: "var(--cs-bg-subtle)" }}></div>
                  <div className="h-3 rounded animate-pulse w-1/2" style={{ background: "var(--cs-bg-subtle)" }}></div>
                </div>
              </div>
            ) : analysisState.result.insights ? (
              <div className="rounded-xl border p-4 space-y-4 transition-all" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                {/* Biochemical Shift & Structural Impact (Biophysical Report) */}
                {isBiophysicalLoading ? (
                  <div className="flex items-center gap-2 font-bold font-mono text-[10px] uppercase tracking-wider py-4 pl-5" style={{ color: "var(--cs-text-accent)" }}>
                    <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }}></div>
                    <span className="animate-pulse">Predicting biophysical shifts...</span>
                  </div>
                ) : (
                  <>
                    {/* Biochemical Shift Section */}
                    <div>
                      <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--cs-text-accent)" }}>
                        <Activity className="w-3.5 h-3.5" />
                        <span>Biochemical Shift</span>
                      </div>
                      {/* Rendered through the shared derivation so the degraded case
                          ("Warning: Biochemical Shift Unavailable") reads as a status
                          instead of printing its markdown markers, and so this view
                          and the Residue Shifts inspector cannot disagree about
                          whether a narrative exists. */}
                      <p className={`text-[12px] leading-relaxed font-sans pl-5 transition-colors ${classTextBody}`}>
                        {biochemicalNarrative.prose || biochemicalNarrative.detail || "Rule-based amino acid property shifts computed. Detailed AI synthesis unavailable."}
                      </p>
                      {biochemicalNarrative.state === "unavailable" && (
                        <p className="text-[10px] font-mono pl-5 pt-0.5" style={{ color: "var(--cs-text-muted)" }}>
                          State: {biochemicalNarrative.badge}
                        </p>
                      )}
                    </div>

                    {/* Structural Impact Section */}
                    <div className={`pt-3 border-t ${classBorderSec}`}>
                      <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--cs-text-accent)" }}>
                        <Layers className="w-3.5 h-3.5" />
                        <span>Structural Impact (ΔΔG Implications)</span>
                      </div>
                      <p className={`text-[12px] leading-relaxed font-sans pl-5 transition-colors ${classTextBody}`}>
                        {formatEnergyString(analysisState.result.insights?.structuralImpact) || "Structural energetics and delta-delta-G implications evaluated."}
                      </p>
                    </div>
                  </>
                )}

                {/* Predictor Uncertainty & Local Calibration Dashboard */}
                <div className={`pt-3 border-t ${classBorderSec}`}>
                  <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-2.5" style={{ color: "var(--cs-text-accent)" }}>
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Predictor Local Calibration & Uncertainty</span>
                  </div>
                  <div className="pl-5 space-y-3.5">
                    {(() => {
                      const uniprotFeatures = analysisState.result?.uniprotFeatures?.features;
                      const residueIndex = analysisState.result?.metadata?.residueIndex ?? 0;
                      const context = getResidueContext(uniprotFeatures, residueIndex);

                      const contextLabels: Record<string, string> = {
                        globular: "Structured / Globular Domain",
                        transmembrane: "Transmembrane / Hydrophobic Helix",
                        disordered: "Intrinsically Disordered Region (IDR) / Loop",
                        unknown: "Unannotated / Unknown Context"
                      };

                      const predictors = [
                        { name: "revel", label: "REVEL", score: analysisState.result?.conservationData?.revel },
                        { name: "alphaMissense", label: "AlphaMissense", score: analysisState.result?.predictorData?.amPathogenicity },
                        { name: "cadd", label: "CADD PHRED", score: analysisState.result?.predictorData?.caddPhred },
                        { name: "popEVE", label: "PopEVE", score: analysisState.result?.conservationData?.popeve },
                        { name: "foldx", label: "FoldX ddG", score: foldingEnergetics?.foldxMean ?? foldingEnergetics?.foldx ?? null },
                        { name: "thermompnn", label: "ThermoMPNN ddG", score: foldingEnergetics?.thermompnn ?? null },
                        { name: "stabilityoracle", label: "StabilityOracle ddG", score: foldingEnergetics?.stabilityoracle ?? analysisState.result?.foldingEnergetics?.stabilityoracle ?? null },
                        { name: "dynamut2", label: "DynaMut2 ddG", score: foldingEnergetics?.dynamut2 ?? analysisState.result?.dynamut2 ?? null },
                        { name: "ddmut", label: "DDMut ddG", score: foldingEnergetics?.ddmut ?? analysisState.result?.ddmut ?? null },
                        { name: "rasp", label: "RaSP ddG", score: foldingEnergetics?.rasp ?? analysisState.result?.rasp ?? null }
                      ].filter(pred => pred.score !== undefined && pred.score !== null);

                      return (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="text-cs-text-muted font-medium">Mapped Residue Context:</span>
                            <span className="font-bold px-2 py-0.5 rounded text-[10px] bg-cs-accent-clay/10 text-cs-text-accent border border-cs-accent-clay/20" style={{ color: "var(--cs-text-accent)" }}>
                              {contextLabels[context] || "Standard Context"}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            {predictors.map(pred => {
                              const cal = getCalibration(pred.name, context);
                              const isHigh = cal.auc >= 0.85;
                              const isLow = cal.auc < 0.65;
                              const calibrationBadgeStyle = isHigh
                                ? "text-cs-text-good-on-soft border-cs-good/30"
                                : isLow
                                ? "text-cs-danger border-cs-danger/30"
                                : "text-cs-warn border-cs-warn/30";
                              const calibrationBadgeBg = isHigh
                                ? "var(--cs-good-soft)"
                                : isLow
                                ? "var(--cs-danger-soft)"
                                : "var(--cs-warn-soft)";
                              
                              return (
                                <div key={pred.name} className="p-3 rounded-lg border flex flex-col justify-between" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                                  <div className="flex items-center justify-between flex-wrap gap-1">
                                    <span className="text-[11px] font-bold" style={{ color: "var(--cs-text-primary)" }}>{pred.label}</span>
                                    <span className={`text-[10px] font-mono px-1.5 py-0.5 border rounded font-semibold ${calibrationBadgeStyle}`} style={{ background: calibrationBadgeBg }}>
                                      AUC {cal.auc.toFixed(2)}
                                    </span>
                                  </div>
                                  <p className="text-[10px] leading-relaxed mt-1" style={{ color: "var(--cs-text-muted)" }}>
                                    {cal.comment || `Standard performance mapping for this structural context.`}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Chemical Property Similarity Radar Chart */}
                <div className={`pt-3 border-t ${classBorderSec}`}>
                  <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--cs-text-accent)" }}>
                    <Activity className="w-3.5 h-3.5" />
                    <span>Residue Property Comparison (Radar Profile)</span>
                  </div>
                  <div className="pl-5 pt-1">
                    {renderResiduePropertyRadar()}
                  </div>
                </div>



                {/* ACMG Criteria Badge list */}
                {/* Plausibility Statements and ACMG Evidence Suggester */}
                {((analysisState.result.insights && (analysisState.result.insights.acmgCriteria.length > 0 || analysisState.result.insights.plausibility)) ||
                  (analysisState.result.ruleBasedInsights && (analysisState.result.ruleBasedInsights.acmgCriteria.length > 0 || analysisState.result.ruleBasedInsights.plausibility))) && (
                  <div className={`pt-3 border-t ${classBorderSec} space-y-4`}>
                    <div className="flex items-center flex-wrap gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--cs-text-accent)" }}>
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>ACMG / AMP Pathogenicity Evidence Suggester</span>
                    </div>
                    <div className="space-y-4 pl-5">
                      {/* Unified ACMG Consensus Verdict Badge */}
                      {(() => {
                        const verdict = analysisState.result.insights?.acmgVerdict || analysisState.result.ruleBasedInsights?.acmgVerdict || "Variant of Uncertain Significance (VUS)";
                        const criteria = analysisState.result.insights?.acmgCriteria || analysisState.result.ruleBasedInsights?.acmgCriteria || [];
                        const codesMet = criteria.map(c => c.code).join(", ");
                        
                        const isPath = verdict.includes("Pathogenic");
                        const isBenign = verdict.includes("Benign");
                        const badgeStyle = "font-bold border";
                        const badgeBg = isPath
                          ? "var(--cs-danger-soft)"
                          : isBenign
                          ? "var(--cs-good-soft)"
                          : "var(--cs-warn-soft)";
                        const badgeFg = isPath
                          ? "var(--cs-text-danger-on-soft)"
                          : isBenign
                          ? "var(--cs-text-good-on-soft)"
                          : "var(--cs-text-warning-on-soft)";
                        const badgeBorder = isPath
                          ? "color-mix(in srgb, var(--cs-danger) 25%, transparent)"
                          : isBenign
                          ? "color-mix(in srgb, var(--cs-good) 25%, transparent)"
                          : "color-mix(in srgb, var(--cs-warn) 25%, transparent)";
                        
                        return (
                          /*
                           * NO `shadow-*` UTILITY HERE. This card carried `shadow-sm` while every
                           * sibling panel in the same column — the two plausibility blocks, the
                           * criteria list, the radar card — carried none, so the verdict read as a
                           * floating widget inside a flat card. Elevation in this design is not a
                           * shadow: `--cs-shadow-card` and `--cs-shadow-sm` are both `none`, and
                           * depth is carried by the fill ramp plus a hairline border (see the
                           * "LIGHT NEUTRAL RAMP" note in `styles/variables.css`). A raw Tailwind
                           * shadow bypasses the token and reintroduces the elevation this design
                           * deliberately removed. `src/components/__tests__/clinicalElevation.test.ts`
                           * fails if one comes back.
                           */
                          <div className="p-3.5 rounded-lg border flex flex-col md:flex-row md:items-center justify-between gap-3"
                            style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                            <div>
                              <span className="block text-[10px] font-mono font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--cs-text-muted)" }}>
                                ACMG Pathogenicity Verdict (Consensus)
                              </span>
                              <span className={`inline-block text-[11px] px-2.5 py-1 rounded-lg uppercase mt-1 ${badgeStyle}`} style={{ background: badgeBg, color: badgeFg, borderColor: badgeBorder }}>
                                {verdict}
                              </span>
                            </div>
                            <div className="text-right md:text-left">
                              <span className="block text-[10px] font-mono font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--cs-text-muted)" }}>
                                Combinatorial Rule
                              </span>
                              <span className="text-xs font-mono leading-relaxed font-bold" style={{ color: "var(--cs-text-primary)" }}>
                                {codesMet ? `Criteria met: ${codesMet}` : "No evidence codes met"}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Plausibility Panels */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {analysisState.result.ruleBasedInsights?.plausibility && (
                          <div className="rounded-lg p-3 border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                            <span className="block text-[10px] font-mono font-bold uppercase tracking-wider mb-1" style={{ color: "var(--cs-text-accent)" }}>
                              Rule-Based Suggester Plausibility
                            </span>
                            <p className="text-[11px] leading-relaxed font-sans" style={{ color: "var(--cs-text-primary)" }}>
                              {analysisState.result.ruleBasedInsights.plausibility}
                            </p>
                          </div>
                        )}
                        
                        {isNarrativeLoading ? (
                          <div className="rounded-lg p-3 border flex items-center justify-center min-h-[60px]" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                            <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }}></div>
                          </div>
                        ) : analysisState.result.insights?.plausibility ? (
                          <div className="rounded-lg p-3 border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                            <span className="block text-[10px] font-mono font-bold uppercase tracking-wider mb-1" style={{ color: "var(--cs-warn)" }}>
                              AI-Generated Plausibility Reasoning
                            </span>
                            <p className="text-[11px] leading-relaxed font-sans" style={{ color: "var(--cs-text-primary)" }}>
                              {analysisState.result.insights.plausibility}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {/* Unified Suggested Criteria list
                        *
                        * Both provenances render, from the ONE source-tagged list the server returns.
                        * Two defects lived in the twelve lines this replaces:
                        *
                        *   1. The section is headed "…Evidence Suggester", and when the AI returned
                        *      any criteria of its own this block filtered them straight out
                        *      (`dbVerified = mergedList.filter(source === "database_verified")`) and
                        *      printed only "No database-verified criteria met." — the AI's
                        *      suggestions, the one thing the section exists to show, were never
                        *      displayed. When the AI returned none, the same block re-tagged the rule
                        *      engine's codes as `database_verified` locally, so this card and the
                        *      Insights rail asserted opposite provenance for PP3/PP2/PM2.
                        *   2. A single header over a single list could not say which codes were
                        *      computed from retrieved database values and which a model proposed.
                        *
                        * `acmgCriteriaView` resolves the merge once for every surface; the grouping
                        * and the labels below are shared vocabulary (`ACMG_SOURCE_LABEL`).
                        */}
                      {(() => {
                        const criteria = acmgCriteriaView(
                          analysisState.result.insights?.acmgCriteria,
                          analysisState.result.ruleBasedInsights?.acmgCriteria
                        );
                        const database = criteria.filter(c => c.source === "database_verified");
                        const inferred = criteria.filter(c => c.source === "ai_suggested");

                        const group = (
                          key: "database_verified" | "ai_suggested",
                          heading: string,
                          items: typeof criteria,
                          emptyNote: string
                        ) => {
                          const isDatabase = key === "database_verified";
                          const badgeBg = isDatabase ? "var(--cs-accent-clay)" : "var(--cs-warn)";
                          const containerBg = isDatabase
                            ? "color-mix(in srgb, var(--cs-accent-clay) 4%, transparent)"
                            : "color-mix(in srgb, var(--cs-warn) 4%, transparent)";
                          const borderColor = isDatabase
                            ? "color-mix(in srgb, var(--cs-accent-clay) 15%, transparent)"
                            : "color-mix(in srgb, var(--cs-warn) 25%, transparent)";

                          return (
                            <div className="flex flex-col gap-2 pt-1">
                              <span className="flex items-baseline justify-between gap-2 text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: "var(--cs-text-muted)" }}>
                                <span>{heading}</span>
                                <span className="tabular-nums">{items.length}</span>
                              </span>
                              {items.length > 0 ? (
                                <div className="space-y-2">
                                  {items.map(item => (
                                    <div
                                      key={`${key}-${item.code}`}
                                      className="rounded-lg p-2.5 transition flex flex-col gap-1 border"
                                      style={{ background: containerBg, borderColor }}
                                    >
                                      <div className="flex items-center justify-between flex-wrap gap-2 w-full">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded text-white shrink-0" style={{ background: badgeBg }}>
                                            {item.code}
                                          </span>
                                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: "var(--cs-text-primary)" }}>
                                            Suggested criteria evidence
                                          </span>
                                        </div>
                                        <span
                                          className="text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 border"
                                          style={{
                                            background: isDatabase ? "var(--cs-good-soft)" : "var(--cs-warn-soft)",
                                            color: isDatabase ? "var(--cs-text-good-on-soft)" : "var(--cs-text-warning-on-soft)",
                                            borderColor: isDatabase ? "color-mix(in srgb, var(--cs-good) 30%, transparent)" : "color-mix(in srgb, var(--cs-warn) 30%, transparent)",
                                          }}
                                        >
                                          {ACMG_SOURCE_LABEL[key]}
                                        </span>
                                      </div>
                                      <p className="text-[10px] leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
                                        {item.reason}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[10px] italic" style={{ color: "var(--cs-text-muted)" }}>
                                  {emptyNote}
                                </span>
                              )}
                            </div>
                          );
                        };

                        return (
                          <div className="space-y-4">
                            {group(
                              "database_verified",
                              "Criteria met, from the rule engine",
                              database,
                              "No criteria were computed from retrieved database values."
                            )}
                            {group(
                              "ai_suggested",
                              "Criteria proposed by the model (not computed)",
                              inferred,
                              NO_AI_CRITERIA_NOTE
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* ClinVar & gnomAD Database Grounding (S-1) */}
                {analysisState.result.clinvar && (
                  <div className={`pt-3 border-t ${classBorderSec}`}>
                    <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--cs-text-accent)" }}>
                      <Database className="w-3.5 h-3.5" />
                      <span>ClinVar & gnomAD Evidence Database Grounding</span>
                    </div>
                    <div className="pl-5 space-y-3">
                      {analysisState.result.clinvar.uid ? (
                        <div className="rounded-xl p-4 border transition-all duration-300"
                          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                          {/* Grid of ClinVar metrics */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs mb-3">
                            <div>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>ClinVar Significance</span>
                              {(() => {
                                const c = analysisState.result.clinvar.classification.toLowerCase();
                                const isPath = c.includes("pathogenic");
                                const isBenign = c.includes("benign");
                                return (
                                  <span
                                    className="inline-block mt-1 px-2.5 py-0.5 rounded text-[11px] font-bold border"
                                    style={{
                                      background: isPath ? "var(--cs-danger-soft)" : isBenign ? "var(--cs-good-soft)" : "var(--cs-warn-soft)",
                                      color: isPath ? "var(--cs-text-danger-on-soft)" : isBenign ? "var(--cs-text-good-on-soft)" : "var(--cs-text-warning-on-soft)",
                                      borderColor: isPath
                                        ? "color-mix(in srgb, var(--cs-danger) 25%, transparent)"
                                        : isBenign
                                        ? "color-mix(in srgb, var(--cs-good) 25%, transparent)"
                                        : "color-mix(in srgb, var(--cs-warn) 25%, transparent)"
                                    }}
                                  >
                                    {analysisState.result.clinvar.classification}
                                  </span>
                                );
                              })()}
                            </div>
                            <div>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Review Status</span>
                              <span className="block mt-1 text-xs font-semibold" style={{ color: "var(--cs-text-primary)" }}>
                                {analysisState.result.clinvar.reviewStatus || "Not specified"}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Associated Trait</span>
                              <span className="block mt-1 text-xs font-semibold truncate max-w-[240px]" style={{ color: "var(--cs-text-primary)" }} title={analysisState.result.clinvar.trait}>
                                {analysisState.result.clinvar.trait || "None listed"}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Last Evaluated</span>
                              <span className="block mt-1 text-xs" style={{ color: "var(--cs-text-secondary)" }}>
                                {analysisState.result.clinvar.lastEvaluated && !isNaN(new Date(analysisState.result.clinvar.lastEvaluated).getTime()) ? new Date(analysisState.result.clinvar.lastEvaluated).toLocaleDateString() : "Not specified"}
                              </span>
                            </div>
                          </div>
                          
                          {/* ClinVar-submitted population frequencies.
                              The heading read "gnomAD / Population Allele Frequencies" over data
                              that is by definition ClinVar's own submitted frequencies — the same
                              misattribution the Population Frequencies screen corrected. The value
                              also used `toExponential(3)` ("5.500e-6") where every other surface
                              reports "5.50e-6", so the same frequency rendered two ways. */}
                          {analysisState.result.clinvar.alleleFrequencies && analysisState.result.clinvar.alleleFrequencies.length > 0 && (
                            <div className="mt-3 pt-3 border-t text-xs" style={{ borderColor: "var(--cs-border-subtle)" }}>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider mb-2" style={{ color: "var(--cs-text-muted)" }}>ClinVar-submitted population frequencies</span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {analysisState.result.clinvar.alleleFrequencies.map((freq: any, fIdx: number) => (
                                  <div key={fIdx} className="flex justify-between items-center pr-4 text-xs">
                                    <span className="font-semibold" style={{ color: "var(--cs-text-muted)" }}>{freq.source}:</span>
                                    <span className="font-bold font-mono tabular-nums" style={{ color: "var(--cs-text-accent)" }}>
                                      {formatAlleleFrequency(
                                        typeof freq.value === "string" ? parseFloat(freq.value) : freq.value,
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* ClinVar Portal Link */}
                          <div className="mt-3 pt-2.5 border-t flex justify-end text-[10px]" style={{ borderColor: "var(--cs-border-subtle)" }}>
                            <a 
                              href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${analysisState.result.clinvar.uid}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:opacity-85 font-bold flex items-center gap-1 text-[var(--cs-text-accent)]"
                            >
                              NCBI ClinVar Link #{analysisState.result.clinvar.uid} <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg p-3 border text-center text-xs font-mono" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-muted)" }}>
                          No matching variant found in NCBI ClinVar database.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/**
              * Only a FINISHED run may announce this. The condition used to be `!insights` alone,
              * which is also true while the model is still working — so every fresh synthesis
              * declared "could not be parsed or generated" beside its own progress bar, a failure
              * claim the reader has no way to tell apart from a real one.
              */}
            {!analysisState.result.insights && !structuredAnalysisPending && (
              <div className="p-3 rounded-lg border text-xs leading-relaxed" style={{ background: "var(--cs-accent-mag-soft)", borderColor: "var(--cs-accent-mag)", color: "var(--cs-text-primary)" }}>
                <span className="font-bold block uppercase text-[10px] mb-1 tracking-wider" style={{ color: "var(--cs-warn)" }}>Structured Report Unavailable</span>
                {analysisState.result.analysis
                  ? "This run returned the clinical narrative but no structured interpretation (biochemical shifts, structural impacts, ACMG criteria), so those sections are omitted. Re-running AI synthesis may return them."
                  : "This run returned neither a structured interpretation nor a clinical narrative. Re-run the analysis to try again."}
              </div>
            )}


          </div>
        ) : (
          /* Startup or placeholder state */
          <div className="text-center py-12" style={{ color: "var(--cs-text-muted)" }}>
            <Lightbulb className="w-10 h-10 mx-auto stroke-[1.5] mb-2 animate-pulse" style={{ color: "var(--cs-text-accent)" }} />
            <p className="text-sm font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--cs-text-accent)" }}>Variant Insights Report Ready</p>
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

import React, { memo, useCallback, useMemo, useRef, useState, useLayoutEffect } from "react";
import { getResidueContext, getCalibration } from "../shared/uncertainty";
import { generateProvenanceManifest } from "../shared/provenance";
import { computeCalibratedConsensus } from "../shared/thresholds";
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
  Settings
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
import Markdown from "react-markdown";
import { VARIANT_PRESETS, getNearestResidues } from "../data";
import { AnalysisState, UserSettings, NearestResidue } from "../types";
import { resolveResidueShiftModel } from "../lib/residueShiftModel";
import { deriveBiochemicalNarrative, getPropertyScaleDefinition } from "../shared/residueShiftEvidence";

/**
 * The consensus verdict DERIVED from the current run state — the same computation the Energetics
 * badge performs, so an export cannot state a verdict the screen contradicts.
 *
 * `foldingEnergetics.consensusVerdict` is a snapshot taken when the server committed the FoldX job.
 * Remote engines keep resolving for up to ten minutes after that and the badge recomputes as they
 * do, so a report built from the stored field could print "Low Misfolding Risk (Neutral Stability)"
 * for a run the screen calls "High Misfolding Risk (Destabilizing Consensus)" — measured: foldx +0.5
 * and rasp +0.6 at commit time, ThermoMPNN +2.0 arriving later. A stored verdict is a fact about the
 * past; an exported report is a claim about this variant.
 *
 * The inputs are the caller's resolved values, which is why this is not a method on the contract: the
 * context (residue features, pLDDT) only exists client-side.
 */
function deriveConsensus(args: {
  result: any;
  foldingEnergetics: any;
  residueIndex: number | null;
  plddt?: number | null;
}) {
  const { result, foldingEnergetics: fe, residueIndex, plddt } = args;
  if (!result) return null;
  return computeCalibratedConsensus(
    {
      foldx: fe?.foldx ?? result.foldingEnergetics?.foldx ?? null,
      foldxMean: fe?.foldxMean ?? null,
      dynamut2: fe?.dynamut2 ?? result.dynamut2 ?? null,
      ddmut: fe?.ddmut ?? result.ddmut ?? null,
      rasp: fe?.rasp ?? result.rasp ?? null,
      thermompnn: fe?.thermompnn ?? result.thermompnn ?? null,
      stabilityoracle: fe?.stabilityoracle ?? result.foldingEnergetics?.stabilityoracle ?? null,
      foldxRepairFailed: fe?.foldxRepairFailed ?? false,
      foldxBinaryMissing: fe?.foldxBinaryMissing ?? false
    },
    result.uniprotFeatures || null,
    residueIndex ?? undefined,
    plddt ?? null
  );
}

interface ClinicalInsightsCardProps {
  isDark: boolean;
  classCard: string;
  classCardHeader: string;
  classCardTitle: string;
  analysisState: AnalysisState;
  handleCopyReport: () => void;
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
  disruptionPredictor?: any;
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
  disruptionPredictor
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
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: "var(--cs-text-secondary)" }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8, fill: "var(--cs-text-muted)" }} />
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
          <div className="mt-1.5 pt-1.5 border-t cs-border-card-sep border-dashed text-[8.5px] leading-normal" style={{ color: "var(--cs-text-muted)" }}>
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
          deriveConsensus({
            result: analysisState.result,
            foldingEnergetics,
            residueIndex: selectedResidueIndex,
            plddt: disruptionPredictor?.plddt
          })?.consensusVerdict ?? foldingEnergetics?.consensusVerdict ?? null,
        // The JSON export carries the caveat too, so a downstream reader of the report knows the
        // verdict can still move. This replaced the " (Preliminary - pending: …)" suffix.
        consensusEvidenceComplete: foldingEnergetics?.evidenceComplete ?? null,
        consensusPendingTools: foldingEnergetics?.pendingTools ?? [],
        consensusProbability:
          deriveConsensus({
            result: analysisState.result,
            foldingEnergetics,
            residueIndex: selectedResidueIndex,
            plddt: disruptionPredictor?.plddt
          })?.consensusProbability ?? (foldingEnergetics as any)?.consensusProbability ?? null,
        consensusConfMin: (foldingEnergetics as any)?.consensusConfMin ?? null,
        consensusConfMax: (foldingEnergetics as any)?.consensusConfMax ?? null
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
      {
        // The live value, so the manifest cannot contradict the screen...
        derivedVerdict:
          deriveConsensus({
            result: analysisState.result,
            foldingEnergetics,
            residueIndex: selectedResidueIndex,
            plddt: disruptionPredictor?.plddt
          })?.consensusVerdict ?? null,
        // ...and the caveat that used to travel inside the verdict string as a " (Preliminary -
        // pending: …)" suffix. Removing that suffix was right; leaving nothing in its place meant an
        // export could state an incomplete run's verdict with no indication it was partial.
        evidenceComplete: foldingEnergetics?.evidenceComplete ?? null,
        pendingTools: foldingEnergetics?.pendingTools ?? []
      }
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
            <FileText className="w-4 h-4" style={{ color: "var(--cs-accent-clay)" }} />
            <h3 className={`text-sm font-bold uppercase tracking-wider font-mono ${classCardTitle}`}>
              Variant Insights Report
            </h3>
            {analysisState.result && analysisState.result.isDemoData && isPresetData && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border cs-badge cs-badge-clay">
                Preset Profile
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium tracking-wide mt-0.5" style={{ color: "var(--cs-warn)" }}>
            ⚠️ AI narrative suggestions only; not a clinical determination. Professional evaluation required.
          </span>
        </div>
        
        {analysisState.result && (
          <div className="flex items-center gap-2">
            {/* Export Provenance Manifest Button */}
            <button
              onClick={handleExportProvenanceJSON}
              className="transition flex items-center gap-1 text-[10px] border rounded px-2.5 py-1 select-none cursor-pointer shadow-sm"
              style={{
                borderColor: "var(--cs-accent-clay)",
                background: "rgba(196, 104, 73, 0.08)",
                color: "var(--cs-accent-clay)"
              }}
              title="Export verifiable scientific provenance manifest (model hashes, data versions, and structure metadata)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Provenance Manifest</span>
            </button>

            {/* Export JSON Button */}
            <button
              onClick={handleExportJSON}
              className="transition flex items-center gap-1 text-[10px] border rounded px-2.5 py-1 select-none cursor-pointer shadow-sm"
              style={{
                borderColor: "var(--cs-border)",
                background: "var(--cs-surface-2)",
                color: "var(--cs-text-secondary)"
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "var(--cs-bg-subtle)";
                (e.currentTarget as HTMLElement).style.color = "var(--cs-accent-clay)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "var(--cs-surface-2)";
                (e.currentTarget as HTMLElement).style.color = "var(--cs-text-secondary)";
              }}
              title="Export structured analysis payload as JSON file"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>

            {/* Copy Report Button */}
            <button
              onClick={handleCopyReport}
              className="transition flex items-center gap-1 text-[10px] border rounded px-2.5 py-1 select-none cursor-pointer shadow-sm"
              style={{
                borderColor: "var(--cs-border)",
                background: "var(--cs-surface-2)",
                color: "var(--cs-text-secondary)"
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "var(--cs-bg-subtle)";
                (e.currentTarget as HTMLElement).style.color = "var(--cs-accent-clay)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "var(--cs-surface-2)";
                (e.currentTarget as HTMLElement).style.color = "var(--cs-text-secondary)";
              }}
              title="Copy markdown report to clipboard"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--cs-accent-clay)" }} />
                  <span className="font-semibold" style={{ color: "var(--cs-accent-clay)" }}>Copied!</span>
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
          style={{ background: "rgba(196,104,73,0.05)", borderColor: "var(--cs-border)", color: "var(--cs-accent-clay)" }}>
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
            <p className="text-xs max-w-xs font-mono h-5 animate-pulse" style={{ color: "var(--cs-accent-clay)" }}>{loadingStep}</p>
          </div>
        ) : analysisState.error ? (
          /* Clean, modern empty/notice state inside insights card */
          <div className="flex flex-col items-center justify-center p-6 rounded-xl my-4 max-w-lg mx-auto text-center border border-cs-border bg-cs-surface-2 shadow-xs">
            <div className="p-3 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 mb-3">
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
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              Configure API Key in Settings
            </button>
          </div>
        ) : analysisState.result ? (
          /* Analysis result presenting structured key metrics and narrative report */
          <div className="flex flex-col gap-5 w-full text-slate-300">
            {/* Raw Gemini narrative — keep the primary report visible in the Insights view. */}
            {typeof analysisState.result.analysis === "string" && analysisState.result.analysis.trim() && (
              <div className="rounded-xl border p-4 space-y-3" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>
                  <FileText className="w-3.5 h-3.5" />
                  <span>Clinical Narrative</span>
                </div>
                <div className="pl-5 text-[12px] leading-relaxed font-sans" style={{ color: "var(--cs-text-primary)" }}>
                  <Markdown
                    components={{
                      h1: ({ children }) => <h1 className="text-sm font-bold mt-2 mb-1">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-xs font-bold mt-2 mb-1">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-xs font-semibold mt-2 mb-1 text-indigo-300">{children}</h3>,
                      p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--cs-text-primary)" }}>{children}</strong>
                    }}
                  >
                    {analysisState.result.analysis}
                  </Markdown>
                </div>
              </div>
            )}

            {/* Splicing Warning Alert */}
            {(() => {
              const spliceai = analysisState.result.conservationData?.spliceai;
              const spliceProximity = analysisState.result.conservationData?.spliceProximity;
              const isSpliceLoading = !spliceai && isBiophysicalLoading;
              const isNearJunction = spliceProximity?.isNearSpliceSite;
              const hasSpliceDisruption = spliceai && spliceai.max_ds !== null && spliceai.max_ds >= 0.10;

              if (isSpliceLoading && isNearJunction) {
                return (
                  <div className="rounded-xl border p-4 flex flex-col gap-2 border-indigo-500/20 bg-indigo-500/5 text-indigo-200 animate-pulse">
                    <div className="flex items-center gap-2 font-bold font-mono text-[10px] uppercase tracking-wider text-indigo-400">
                      <span className="w-2 h-2 rounded-full border border-indigo-400 border-t-transparent animate-spin" />
                      <span>Splice Junction Proximity Assessment</span>
                    </div>
                    <p className="text-[12px] leading-relaxed pl-5 font-sans text-indigo-300">
                      Variant is located <strong>{spliceProximity.distance} bp</strong> from a splice junction. Evaluating 32-layer SpliceAI deep learning models for cryptic donor/acceptor activation...
                    </p>
                  </div>
                );
              }

              if (isNearJunction || hasSpliceDisruption) {
                return (
                  <div className="rounded-xl border p-4 flex flex-col gap-2 border-rose-500/20 bg-rose-500/5 text-rose-200 animate-fade-in">
                    <div className="flex items-center gap-2 font-bold font-mono text-[10px] uppercase tracking-wider text-rose-400">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>Splicing Disruption Warning</span>
                    </div>
                    <p className="text-[12px] leading-relaxed pl-5 font-sans">
                      {isNearJunction && (
                        <>Variant is located <strong>{spliceProximity.distance} bp</strong> from a splice junction. </>
                      )}
                      {hasSpliceDisruption && spliceai?.max_ds !== null && spliceai?.max_ds !== undefined && (
                        <>SpliceAI predicts high probability of splicing disruption (Max Delta Score: <strong>{spliceai.max_ds.toFixed(2)}</strong>). </>
                      )}
                      ACMG PP3 in-silico predictor concordance voting includes this splice disruption signal.
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            {/* Multimer Warning Alert */}
            {analysisState.result.uniprotFeatures?.isMultimer && (
              <div className="rounded-xl border p-4 flex flex-col gap-2 border-amber-500/20 bg-amber-500/5 text-amber-200">
                <div className="flex items-center gap-2 font-bold font-mono text-[10px] uppercase tracking-wider text-amber-400">
                  <Activity className="w-3.5 h-3.5" />
                  <span>Quaternary Assembly Detected</span>
                </div>
                <p className="text-[12px] leading-relaxed pl-5 font-sans">
                  This protein forms a <strong>{analysisState.result.uniprotFeatures.subunitComment}</strong>.
                  Monomeric stability analysis misses quaternary tetramerization/oligomerization defects.
                  It is strongly recommended to run advanced quaternary whole-complex modeling (Boltz-1/Chai-1) to evaluate interface disruption.
                </p>
              </div>
            )}

            {/* Structured Dynamic Insights Panel */}
            {isNarrativeLoading ? (
              <div className="rounded-xl border p-4 space-y-4 transition-all" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                <div className="flex items-center gap-2 font-bold font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>
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
                  <div className="flex items-center gap-2 font-bold font-mono text-[10px] uppercase tracking-wider py-4 pl-5" style={{ color: "var(--cs-accent-clay)" }}>
                    <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }}></div>
                    <span className="animate-pulse">Predicting biophysical shifts...</span>
                  </div>
                ) : (
                  <>
                    {/* Biochemical Shift Section */}
                    <div>
                      <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--cs-accent-clay)" }}>
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
                      <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--cs-accent-clay)" }}>
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
                  <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-2.5" style={{ color: "var(--cs-accent-clay)" }}>
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
                            <span className="font-bold px-2 py-0.5 rounded text-[10px] bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/20" style={{ color: "var(--cs-accent-clay)" }}>
                              {contextLabels[context] || "Standard Context"}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            {predictors.map(pred => {
                              const cal = getCalibration(pred.name, context);
                              const isHigh = cal.auc >= 0.85;
                              const isLow = cal.auc < 0.65;
                              const calibrationBadgeStyle = isHigh
                                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                : isLow
                                ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                                : "bg-amber-500/10 text-amber-500 border-amber-500/20";
                              
                              return (
                                <div key={pred.name} className="p-3 rounded-lg border bg-[var(--cs-surface-2)] flex flex-col justify-between" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                                  <div className="flex items-center justify-between flex-wrap gap-1">
                                    <span className="text-[11px] font-bold" style={{ color: "var(--cs-text-primary)" }}>{pred.label}</span>
                                    <span className={`text-[9px] font-mono px-1.5 py-0.5 border rounded font-semibold ${calibrationBadgeStyle}`}>
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
                  <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--cs-accent-clay)" }}>
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
                    <div className="flex items-center flex-wrap gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--cs-accent-clay)" }}>
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>ACMG / AMP Pathogenicity Evidence Suggester</span>
                    </div>
                    <div className="space-y-4 pl-5">
                      {/* Unified ACMG Consensus Verdict Badge */}
                      {(() => {
                        const verdict = analysisState.result.insights?.acmgVerdict || analysisState.result.ruleBasedInsights?.acmgVerdict || "Variant of Uncertain Significance (VUS)";
                        const criteria = analysisState.result.insights?.acmgCriteria || analysisState.result.ruleBasedInsights?.acmgCriteria || [];
                        const codesMet = criteria.map(c => c.code).join(", ");
                        
                        let badgeStyle = "bg-slate-500/10 text-slate-400 border border-slate-500/20";
                        if (verdict.includes("Likely Pathogenic")) {
                          badgeStyle = "bg-orange-500/15 text-orange-500 border border-orange-500/20 font-bold";
                        } else if (verdict.includes("Pathogenic")) {
                          badgeStyle = "bg-rose-500/15 text-rose-500 border border-rose-500/25 font-bold";
                        } else if (verdict.includes("Likely Benign")) {
                          badgeStyle = "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-bold";
                        } else if (verdict.includes("Benign")) {
                          badgeStyle = "bg-emerald-500/15 text-emerald-500 border border-emerald-500/25 font-bold";
                        }
                        
                        return (
                          <div className="p-3.5 rounded-lg border flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm"
                            style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                            <div>
                              <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                                ACMG Pathogenicity Verdict (Consensus)
                              </span>
                              <span className={`inline-block text-[10px] px-2.5 py-1 rounded-lg border uppercase mt-1 ${badgeStyle}`}>
                                {verdict}
                              </span>
                            </div>
                            <div className="text-right md:text-left">
                              <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500 mb-0.5">
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
                            <span className="block text-[9px] font-mono font-bold uppercase tracking-wider mb-1" style={{ color: "var(--cs-accent-clay)" }}>
                              Rule-Based Suggester Plausibility
                            </span>
                            <p className="text-[10.5px] leading-relaxed font-sans" style={{ color: "var(--cs-text-primary)" }}>
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
                            <span className="block text-[9px] font-mono font-bold uppercase tracking-wider mb-1" style={{ color: "var(--cs-warn)" }}>
                              AI-Generated Plausibility Reasoning
                            </span>
                            <p className="text-[10.5px] leading-relaxed font-sans" style={{ color: "var(--cs-text-primary)" }}>
                              {analysisState.result.insights.plausibility}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {/* Unified Suggested Criteria list */}
                      {(() => {
                        const mergedList = analysisState.result.insights?.acmgCriteria || 
                          analysisState.result.ruleBasedInsights?.acmgCriteria?.map(c => ({ ...c, source: "database_verified" as const })) || [];

                        const dbVerified = mergedList.filter(item => item.source === "database_verified");

                        return (
                          <div className="space-y-4">
                            {/* 1. Database Verified Section */}
                            <div className="flex flex-col gap-2 pt-1">
                              <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500 mb-1">
                                Database-Verified Criteria Codes (Rule Engine)
                              </span>
                              {dbVerified.length > 0 ? (
                                <div className="space-y-2">
                                  {dbVerified.map((item, idx) => {
                                    const containerStyle = "rgba(196,104,73,0.04)";
                                    const borderStyle = "rgba(196,104,73,0.15)";
                                    const badgeBg = "var(--cs-accent-clay)";
                                    const textStyle = "var(--cs-text-primary)";
                                    const sourceBadge = "bg-amber-500/10 text-amber-500 border border-amber-500/20";

                                    return (
                                      <div 
                                        key={`db-${idx}`} 
                                        className="rounded-lg p-2.5 transition flex flex-col gap-1 border"
                                        style={{ background: containerStyle, borderColor: borderStyle }}
                                      >
                                        <div className="flex items-center justify-between gap-2 w-full">
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono font-bold text-[9px] px-1.5 py-0.5 rounded text-white shadow-sm shrink-0" style={{ background: badgeBg }}>
                                              {item.code}
                                            </span>
                                            <span className="text-[9px] font-mono font-bold uppercase tracking-wider" style={{ color: textStyle }}>
                                              Suggested Criteria Evidence
                                            </span>
                                          </div>
                                          <span className={`text-[7px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${sourceBadge}`}>
                                            Database-Verified
                                          </span>
                                        </div>
                                        <p className="text-[10px] leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
                                          {item.reason}
                                        </p>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="text-[10px] italic" style={{ color: "var(--cs-text-muted)" }}>
                                  No database-verified criteria met.
                                </span>
                              )}
                            </div>

                            </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* ClinVar & gnomAD Database Grounding (S-1) */}
                {analysisState.result.clinvar && (
                  <div className={`pt-3 border-t ${classBorderSec}`}>
                    <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--cs-accent-clay)" }}>
                      <Database className="w-3.5 h-3.5" />
                      <span>ClinVar & gnomAD Evidence Database Grounding</span>
                    </div>
                    <div className="pl-5 space-y-3">
                      {analysisState.result.clinvar.uid ? (
                        <div className="rounded-xl p-4 border transition-all duration-300 shadow-sm"
                          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                          {/* Grid of ClinVar metrics */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs mb-3">
                            <div>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>ClinVar Significance</span>
                              <span className={`inline-block mt-1 px-2.5 py-0.5 rounded text-[11px] font-bold ${
                                (() => {
                                  const c = analysisState.result.clinvar.classification.toLowerCase();
                                  if (c.includes("likely pathogenic")) return "bg-orange-500/15 text-orange-500 border border-orange-500/20";
                                  if (c.includes("pathogenic")) return "bg-rose-500/15 text-rose-500 border border-rose-500/25";
                                  if (c.includes("likely benign")) return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
                                  if (c.includes("benign")) return "bg-emerald-500/15 text-emerald-500 border border-emerald-500/25";
                                  return "bg-amber-500/15 text-amber-500 border border-amber-500/20";
                                })()
                              }`}>
                                {analysisState.result.clinvar.classification}
                              </span>
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
                          
                          {/* gnomAD frequencies */}
                          {analysisState.result.clinvar.alleleFrequencies && analysisState.result.clinvar.alleleFrequencies.length > 0 && (
                            <div className="mt-3 pt-3 border-t text-xs" style={{ borderColor: "var(--cs-border-subtle)" }}>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider mb-2" style={{ color: "var(--cs-text-muted)" }}>gnomAD / Population Allele Frequencies</span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {analysisState.result.clinvar.alleleFrequencies.map((freq: any, fIdx: number) => (
                                  <div key={fIdx} className="flex justify-between items-center pr-4 text-xs">
                                    <span className="opacity-75 font-semibold text-slate-500 dark:text-slate-500">{/gnomad/i.test(freq.source) ? "gnomAD" : freq.source}:</span>
                                    <span className="font-bold font-mono" style={{ color: "var(--cs-accent-clay)" }}>
                                      {(() => {
                                        const num = parseFloat(freq.value);
                                        return isNaN(num) ? "N/A" : num.toExponential(3);
                                      })()}
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
                              className="hover:opacity-85 font-bold flex items-center gap-1 text-[var(--cs-accent-clay)]"
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

            {!analysisState.result.insights && (
              <div className="p-3 rounded-lg border text-xs leading-relaxed" style={{ background: "var(--cs-accent-mag-soft)", borderColor: "var(--cs-accent-mag)", color: "var(--cs-text-primary)" }}>
                <span className="font-bold block uppercase text-[10px] mb-1 tracking-wider text-amber-500">Structured Report Unavailable</span>
                The AI-generated structured analysis (biochemical shifts, structural impacts, and ACMG criteria classification) could not be parsed or generated. Only the raw clinical narrative is available.
              </div>
            )}


          </div>
        ) : (
          /* Startup or placeholder state */
          <div className="text-center py-12 text-slate-500">
            <Lightbulb className="w-10 h-10 mx-auto text-indigo-500 stroke-[1.5] mb-2 animate-pulse" />
            <p className="text-sm font-semibold font-mono uppercase tracking-wider text-indigo-500" style={{ color: "var(--cs-accent-clay)" }}>Variant Insights Report Ready</p>
            <div className="w-16 h-[1px] bg-slate-800/10 dark:bg-slate-800/60 mx-auto my-3"></div>
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

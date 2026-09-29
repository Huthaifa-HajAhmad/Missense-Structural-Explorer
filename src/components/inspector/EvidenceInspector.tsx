import React from "react";
import {
  ShieldAlert,
  Zap,
  Box,
  Layers,
  Info,
  Cpu,
  Sparkles,
  ArrowRight,
  Gauge
} from "lucide-react";
import { AnalysisResult, EnergeticsData } from "../../types";
import {
  THRESHOLDS,
  STRING_CONFIDENCE_BANDS,
} from "../../shared/thresholds";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";
import { humaniseAnyRefusal } from "../../shared/evidenceAvailability";
import { FeaturePaletteLegend } from "./FeaturePaletteLegend";
import { PopulationRail } from "./PopulationRail";
import { MultimerRail } from "./MultimerRail";
import { PredictorsRail } from "./PredictorsRail";
import { AlphaGenomeRail } from "./AlphaGenomeRail";
import { GuidelinesRail } from "./GuidelinesRail";

interface EvidenceInspectorProps {
  analysisResult: AnalysisResult | null;
  activeEvidenceTab?: string;
  onSelectEvidenceTab?: (tab: string) => void;
  foldingDdG?: number | null;
  /** ΔΔG engine results backing the Thresholds pane's live match roll-up. */
  foldingEnergetics?: EnergeticsData | null;
}

export const EvidenceInspector: React.FC<EvidenceInspectorProps> = ({
  analysisResult,
  activeEvidenceTab = "clinical",
  onSelectEvidenceTab,
  foldingDdG = null,
  foldingEnergetics = null
}) => {
  if (!analysisResult) {
    return (
      <div className="text-xs text-cs-text-muted italic p-2">
        Awaiting variant analysis data...
      </div>
    );
  }

  /** Per-source build-gate refusals recorded server-side (unmapping defect F-13). */
  const assemblyRefusals = analysisResult.conservationData?.assemblyRefusals ?? null;
  const conservationData = analysisResult.conservationData;

  // Active subtab category normalization
  const tab = activeEvidenceTab?.toLowerCase() || "clinical";

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Dynamic Tab-Aware Contextual Intelligence ── */}
      {tab === "interactions" && (
        <div className="flex flex-col gap-3">
          <span className="eyebrow">
            <Zap className="w-3.5 h-3.5 text-cs-accent-clay" />
            PPI &amp; Interface Methodology
          </span>

          {/* Functional vs Physical Networks */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-cs-text-primary text-[11px]">
              <Info className="w-3.5 h-3.5 text-cs-accent-clay shrink-0" />
              <span>Functional vs. Physical Networks</span>
            </div>
            <p className="text-[11px] text-cs-text-secondary leading-relaxed font-sans">
              <strong>STRING-db</strong> quantifies proteome-wide functional associations inferred from co-expression, shared pathways, and literature citations.
            </p>
            <p className="text-[11px] text-cs-text-secondary leading-relaxed font-sans">
              In contrast, <strong>OpenBind-0</strong> directly calculates atomistic steric clashes, electrostatic shifts, and binding free energy changes (&Delta;&Delta;G_bind) across the physical 3D subunit interface.
            </p>
          </div>

          {/* Confidence Score Thresholds */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
            <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
              STRING Score Confidence Tiers
            </span>
            {/* Rendered from the shared band table rather than re-written here: this
                card and the PPI table's row badges describe the same classifier, and
                as a hand-written copy this legend listed three bands while the table
                could report a fourth. */}
            <div className="space-y-1 text-[11px] font-mono">
              {STRING_CONFIDENCE_BANDS.map((band, idx) => {
                const upper = idx === 0 ? null : STRING_CONFIDENCE_BANDS[idx - 1].min;
                return (
                  <div key={band.id} className="flex justify-between items-center">
                    <span className="text-cs-text-secondary">
                      {upper === null
                        ? `≥ ${band.min.toFixed(3)}`
                        : `${band.min.toFixed(3)} – ${(upper - 0.001).toFixed(3)}`}
                    </span>
                    <span className="ev-tier" data-tone={band.id}>{band.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quaternary Complex Quick Link */}
          {onSelectEvidenceTab && (
            <button
              type="button"
              onClick={() => onSelectEvidenceTab("multimers")}
              className="p-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-between text-[11px] font-medium transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-indigo-400" />
                <span>Open Quaternary Assembly (Multimers)</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Provenance */}
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[11px]">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">STRING-db</span>
              <span className="font-mono text-[10px] text-cs-text-muted">v12.0 · Homo sapiens (9606)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">OpenBind-0</span>
              <span className="font-mono text-[10px] text-cs-text-muted">Tier 1 · JapanFold</span>
            </div>
          </div>
        </div>
      )}

      {tab === "multimers" && <MultimerRail analysisResult={analysisResult} />}

      {tab === "function" && (
        <div className="flex flex-col gap-3">
          <span className="eyebrow">
            <Layers className="w-3.5 h-3.5 text-cs-accent-clay" />
            Domain &amp; Feature Architecture
          </span>

          {/* Feature Legend — rendered from the palette the track paints with, instead of a second
              hand-written list. That list had four of five swatches wrong (indigo domains, amber
              binding sites, emerald PTMs, cyan disulfides) and no entry at all for transmembrane
              regions or the other curated sites, so reading it to interpret the track misled. */}
          <FeaturePaletteLegend />

          {/* Interactive Navigation Guide */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <span className="text-[11px] font-bold text-cs-text-primary block">
              Inspection &amp; Zoom Controls
            </span>
            <p className="text-[11px] text-cs-text-secondary leading-relaxed font-sans">
              Use the zoom slider or zoom buttons to focus on specific sequence windows. Clicking domain cards dynamically highlights and scrolls to corresponding SVG pins.
            </p>
          </div>

          {/* Provenance */}
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[11px]">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">UniProtKB Feature Table</span>
              <span className="font-mono text-[10px] text-cs-text-muted">Swiss-Prot Verified</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">InterPro / Pfam</span>
              <span className="font-mono text-[10px] text-cs-text-muted">v2024</span>
            </div>
          </div>
        </div>
      )}

      {tab === "clinical" && <PopulationRail analysisResult={analysisResult} />}

      {tab === "predictors" && <PredictorsRail analysisResult={analysisResult} />}

      {(tab === "thresholds" || tab === "guidelines") && (
        <GuidelinesRail
          analysisResult={analysisResult}
          foldingDdG={foldingDdG}
          foldingEnergetics={foldingEnergetics}
          onSelectEvidenceTab={onSelectEvidenceTab}
        />
      )}

      {tab === "alphagenome" && <AlphaGenomeRail analysisResult={analysisResult} />}

      {/* Baseline fallback for tabs under subsequent evaluation */}
      {tab !== "interactions" && tab !== "multimers" && tab !== "function" && tab !== "clinical" && tab !== "predictors" && tab !== "alphagenome" && tab !== "thresholds" && tab !== "guidelines" && (
        <div className="flex flex-col gap-3">
          <span className="eyebrow">
            <Sparkles className="w-3.5 h-3.5 text-cs-accent-clay" />
            Evidence Subtab Telemetry
          </span>
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[11px] text-cs-text-secondary">
            {/*
              * This box previously claimed "Deep-dive domain calibrations and metrics are populated
              * dynamically from live backend microservices" while rendering a static sentence with
              * one interpolated tab id — a placeholder asserting that it was a feature, on the very
              * tab where the pipeline had refused to compute anything. It now says what it is, and
              * reports the refusals the server actually recorded.
              */}
            <p>This panel carries no per-tab telemetry yet — what you see here is a placeholder, not a measurement.</p>
            {assemblyRefusals && assemblyRefusals.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-[10px] font-mono uppercase tracking-wider text-cs-text-muted">
                  Sources that declined this coordinate
                </p>
                {assemblyRefusals.map((refusal) => (
                  <p key={refusal.source} className="text-[11px] text-cs-text-muted leading-snug">
                    {humaniseAnyRefusal(refusal.reason)}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default React.memo(EvidenceInspector);



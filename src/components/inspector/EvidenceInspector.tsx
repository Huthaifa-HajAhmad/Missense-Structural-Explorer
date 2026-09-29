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
import { InteractionsRail } from "./InteractionsRail";
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
      {tab === "interactions" && <InteractionsRail analysisResult={analysisResult} />}

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



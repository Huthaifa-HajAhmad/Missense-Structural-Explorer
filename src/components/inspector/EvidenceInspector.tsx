import React from "react";
import {
  ShieldAlert,
  Zap,
  Box,
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
import { FunctionRail } from "./FunctionRail";
import { PopulationRail } from "./PopulationRail";
import { InterfacesRail } from "./InterfacesRail";
import { PredictorsRail } from "./PredictorsRail";
import { normalizeEvidenceTab } from "../evidence/types";
import { AlphaGenomeRail } from "./AlphaGenomeRail";

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
  const tab = normalizeEvidenceTab(activeEvidenceTab?.toLowerCase() || "clinical");

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Dynamic Tab-Aware Contextual Intelligence ── */}
      {tab === "interfaces" && <InterfacesRail analysisResult={analysisResult} />}

      {tab === "function" && <FunctionRail analysisResult={analysisResult} />}

      {tab === "clinical" && <PopulationRail analysisResult={analysisResult} />}

      {tab === "predictors" && <PredictorsRail analysisResult={analysisResult} />}

      {tab === "alphagenome" && <AlphaGenomeRail analysisResult={analysisResult} />}

      {/* Baseline fallback for tabs under subsequent evaluation */}
      {tab !== "interfaces" && tab !== "function" && tab !== "clinical" && tab !== "predictors" && tab !== "alphagenome" && (
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



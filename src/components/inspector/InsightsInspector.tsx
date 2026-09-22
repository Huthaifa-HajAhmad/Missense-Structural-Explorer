import React from "react";
import { Sparkles, Bot, ShieldAlert, CheckCircle2, XCircle, RotateCcw, FileText } from "lucide-react";
import { AnalysisResult, ACMGCriteriaItem } from "../../types";
import { useVariantAnalysisStore, useVariantAnalysisActions } from "../../context/VariantAnalysisContext";

interface InsightsInspectorProps {
  analysisResult: AnalysisResult | null;
  isNarrativeLoading?: boolean;
}

export const InsightsInspector: React.FC<InsightsInspectorProps> = ({
  analysisResult,
  isNarrativeLoading = false
}) => {
  const userDirections = useVariantAnalysisStore(s => s.userDirections ?? "");
  const { setUserDirections } = useVariantAnalysisActions();

  const criteria: ACMGCriteriaItem[] = [
    ...(analysisResult?.insights?.acmgCriteria || []),
    ...(analysisResult?.ruleBasedInsights?.acmgCriteria || [])
  ];

  // Remove duplicate codes
  const uniqueCriteria = Array.from(new Map(criteria.map(c => [c.code, c])).values());

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. AI Inference Provenance ── */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-cs-accent-clay" />
          AI Synthesis Telemetry
        </span>

        <div className="p-3 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-2">
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-cs-text-secondary">Inference Model:</span>
            <span className="font-mono font-bold text-cs-text-primary">Clinical LLM Engine</span>
          </div>
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-cs-text-secondary">Generation Mode:</span>
            <span className="font-mono text-cs-text-good-on-soft font-semibold">Structured Clinical Schema</span>
          </div>
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-cs-text-secondary">Sampling Temperature:</span>
            <span className="font-mono text-cs-text-primary">0.2 (Deterministic)</span>
          </div>
          <div className="flex justify-between items-center text-[11px] pt-1 border-t border-cs-border-subtle">
            <span className="text-cs-text-secondary">Status:</span>
            <span className="font-mono font-bold text-cs-text-accent">
              {isNarrativeLoading ? "Synthesizing..." : "Inference Ready"}
            </span>
          </div>
        </div>
      </div>

      {/* ── 2. ACMG / AMP Rule Verification Trace ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-cs-accent-clay" />
            ACMG Criteria Audit Trace
          </span>
          <span className="text-[10px] font-mono font-bold text-cs-text-accent">
            {uniqueCriteria.length} Met
          </span>
        </div>

        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
          {uniqueCriteria.length > 0 ? (
            uniqueCriteria.map((crit) => (
              <div
                key={crit.code}
                className="p-2 rounded-lg border border-cs-border-subtle bg-cs-surface-2 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-[11px] text-cs-text-accent">
                    {crit.code}
                  </span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold border ${
                    crit.source === "database_verified"
                      ? "text-cs-text-good-on-soft border-cs-good/30"
                      : "text-cs-text-accent border-cs-accent-clay/30"
                  }`} style={{ background: crit.source === "database_verified" ? "var(--cs-good-soft)" : "color-mix(in srgb, var(--cs-accent-clay) 10%, transparent)" }}>
                    {crit.source === "database_verified" ? "Rule Engine" : "AI Inferred"}
                  </span>
                </div>
                <p className="text-[11px] leading-snug text-cs-text-secondary">
                  {crit.reason}
                </p>
              </div>
            ))
          ) : (
            <div className="p-3 rounded-lg border border-dashed border-cs-border-subtle bg-cs-surface-2 text-center italic text-cs-text-muted text-[11px]">
              No individual ACMG pathogenic criteria codes triggered.
            </div>
          )}
        </div>
      </div>

      {/* ── 3. Prompt Focus Directions ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-cs-accent-clay" />
          Active Synthesis Directions
        </span>

        <div className="p-2.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 text-[11px] text-cs-text-secondary leading-relaxed">
          {userDirections ? (
            <span className="italic">"{userDirections}"</span>
          ) : (
            <span className="text-cs-text-muted italic">Default biophysical & clinical interpretation mode.</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(InsightsInspector);

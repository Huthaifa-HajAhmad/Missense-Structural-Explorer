import React from "react";
import { Sparkles, Bot, ShieldAlert, CheckCircle2, XCircle, RotateCcw, FileText } from "lucide-react";
import { AnalysisResult } from "../../types";
import { useVariantAnalysisStore, useVariantAnalysisActions } from "../../context/VariantAnalysisContext";
import { ACMG_SOURCE_LABEL, acmgCriteriaView, partitionCriteria } from "../../shared/acmgCriteriaView";
import { NarrativeProvenanceRow } from "./NarrativeProvenanceRow";

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

  /**
   * The server's merged, source-tagged list — see `shared/acmgCriteriaView.ts` for why this is not
   * re-derived here. Deriving it produced a rail that labelled the rule engine's own PP3/PP2/PM2 as
   * "AI Inferred" while the card in the main column labelled the same codes "DATABASE-VERIFIED".
   */
  const uniqueCriteria = acmgCriteriaView(
    analysisResult?.insights?.acmgCriteria,
    analysisResult?.ruleBasedInsights?.acmgCriteria
  );

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. AI Inference Provenance ──
        *
        * Every value below is read from the payload or from a shared constant. This card previously
        * hardcoded all four — model, generation mode, sampling temperature and status — and three of
        * the four were wrong (see `shared/narrativeSynthesis.ts`). In a clinical rail, a hardcoded
        * parameter is a provenance claim nothing checks.
        */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-cs-accent-clay" />
          AI Synthesis Telemetry
        </span>

        <NarrativeProvenanceRow
          analysisResult={analysisResult}
          isNarrativeLoading={isNarrativeLoading}
        />
      </div>

      {/* ── 2. ACMG / AMP Rule Verification Trace ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-cs-accent-clay" />
            ACMG Criteria Audit Trace
          </span>
          <span className="text-[10px] font-mono font-bold text-cs-text-accent">
            {partitionCriteria(uniqueCriteria).engine.length} Met
          </span>
        </div>

        {/*
          * A nested scroll region inside an already-scrolling rail puts a second scrollbar in a
          * 320px column, and it hid the third of three criteria behind it — the header said "3 Met"
          * while two cards were visible. The list is short by construction (the ACMG whitelist is
          * 25 codes and a run records a handful), so it renders in full.
          */}
        <div className="space-y-1.5 pr-0.5">
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
                  {/*
                    * The label comes from the shared vocabulary, and the tone from the provenance
                    * itself rather than from a substring of it. This chip read "Rule Engine" before,
                    * while the card beside it printed "DATABASE-VERIFIED" for the same code.
                    */}
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold border uppercase ${
                    crit.source === "database_verified"
                      ? "text-cs-text-good-on-soft border-cs-good/30"
                      : "text-cs-text-accent border-cs-accent-clay/30"
                  }`} style={{ background: crit.source === "database_verified" ? "var(--cs-good-soft)" : "color-mix(in srgb, var(--cs-accent-clay) 10%, transparent)" }}>
                    {ACMG_SOURCE_LABEL[crit.source]}
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

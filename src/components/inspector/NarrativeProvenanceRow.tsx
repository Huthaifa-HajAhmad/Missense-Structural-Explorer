import React, { useMemo } from "react";
import { AlertTriangle, Bot, CheckCircle2, KeyRound, RefreshCw } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import { isFallbackNarrative } from "../../services/pipeline/variantCache";
import { deriveAiStatus } from "../report/reportStatus";
import { NARRATIVE_SYNTHESIS, describeSampling } from "../../shared/narrativeSynthesis";
import { deriveNarrativeAuthorship } from "../../shared/narrativeAuthorship";

interface NarrativeProvenanceRowProps {
  analysisResult: AnalysisResult | null;
  isNarrativeLoading?: boolean;
}

/**
 * What actually produced the narrative on screen.
 *
 * Every row is read from the payload or from a shared constant — nothing here is a literal about the
 * inference call. The four values the previous version hardcoded (model, generation mode,
 * temperature, status) are each covered, and the status is the SAME decision
 * `ReportInspector` renders, taken from `deriveAiStatus`, so the Insights rail and the Report rail
 * cannot tell a reader two different things about whether the prose is AI-synthesised:
 *
 *   model       `insights.model`, set by `handleNarrativeResponse` from the configured ladder
 *   format      `NARRATIVE_SYNTHESIS.responseFormat`
 *   sampling    `NARRATIVE_SYNTHESIS.temperature`
 *   status      `deriveAiStatus` — AI, rule-based, unconfigured or not yet run
 *
 * `insights.model` is absent on a couple of real paths (a cached pre-narrative payload, or a run
 * whose narrative stage never executed), and the row says "Not recorded" for them rather than
 * substituting the ladder's first entry, which is a model that may not have answered.
 */
export const NarrativeProvenanceRow: React.FC<NarrativeProvenanceRowProps> = ({
  analysisResult,
  isNarrativeLoading = false,
}) => {
  const { hasConfiguredGeminiKey, serverGeminiReady } = useSettings();
  const isKeyActive = hasConfiguredGeminiKey || serverGeminiReady;

  const narrative = analysisResult?.analysis ?? "";

  const isDegraded = isFallbackNarrative(
    analysisResult?.analysis,
    analysisResult?.isFallback,
    analysisResult?.fallbackReason
  );

  const status = useMemo(
    () =>
      deriveAiStatus({
        isFallback: isDegraded,
        fallbackReason: analysisResult?.fallbackReason,
        fallbackMessage: analysisResult?.fallbackMessage,
        fallbackRetryable: analysisResult?.fallbackRetryable,
        providerDetail: analysisResult?.providerDetail,
        attemptedModels: analysisResult?.attemptedModels,
        isKeyActive,
        hasNarrative: Boolean(narrative),
        isNarrativeLoading,
      }),
    [
      isDegraded,
      analysisResult?.fallbackReason,
      analysisResult?.fallbackMessage,
      analysisResult?.fallbackRetryable,
      analysisResult?.providerDetail,
      analysisResult?.attemptedModels,
      isKeyActive,
      narrative,
      isNarrativeLoading,
    ]
  );

  const model = (analysisResult?.insights as { model?: string } | undefined)?.model;
  const attempted = analysisResult?.attemptedModels ?? [];

  /**
   * Who wrote the prose, from the shared predicate rather than from `source` alone.
   *
   * `deriveAiStatus`'s label answers a DIFFERENT question — what happened to the AI service — and for
   * an overloaded provider it reads "AI service busy", which says nothing about whether the text on
   * screen came from a model. Authorship is its own answer, and it is the same one the Insights card
   * and the report's synthesis chip render (see `shared/narrativeAuthorship.ts` for why a degraded run
   * can never be AI-authored whatever the payload field says).
   */
  const declaredSource = (analysisResult?.insights as { source?: string } | undefined)?.source;
  const authorship = deriveNarrativeAuthorship({ analysis: narrative, isDegraded, declaredSource });
  const proseIsAi = authorship === "ai";

  const StatusIcon = isNarrativeLoading
    ? RefreshCw
    : status.tone === "good"
      ? CheckCircle2
      : status.tone === "warn"
        ? AlertTriangle
        : status.state === "unconfigured"
          ? KeyRound
          : Bot;

  const rows: ReadonlyArray<{ label: string; value: string; muted?: boolean }> = proseIsAi
    ? [
        { label: "Prose source", value: "AI synthesis" },
        { label: "Inference model", value: model || "Not recorded", muted: !model },
        { label: "Response format", value: NARRATIVE_SYNTHESIS.responseFormat },
        { label: "Sampling", value: describeSampling(NARRATIVE_SYNTHESIS.temperature) },
      ]
    : [{ label: "Prose source", value: narrative ? "Rule-based" : "No narrative" }];

  return (
    <div className="p-3 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-2">
      {rows.map(row => (
        <div key={row.label} className="flex justify-between items-baseline gap-3 text-[11px]">
          <span className="text-cs-text-secondary shrink-0">{row.label}</span>
          <span
            className={`font-mono text-right truncate ${row.muted ? "italic text-cs-text-muted" : "font-semibold text-cs-text-primary"}`}
            title={row.value}
          >
            {row.value}
          </span>
        </div>
      ))}

      {!proseIsAi && narrative && (
        <p className="text-[10.5px] leading-relaxed text-cs-text-muted m-0">
          No model produced this text. It was assembled from retrieved database evidence and the
          deterministic ACMG rules, so every statement in it traces to a source.
        </p>
      )}

      <div className="flex justify-between items-start gap-3 text-[11px] pt-1.5 border-t border-cs-border-subtle">
        <span className="text-cs-text-secondary shrink-0">Narrative</span>
        <span
          className="font-mono font-semibold text-right flex items-center gap-1"
          style={{
            color:
              status.tone === "good" ? "var(--cs-good)"
              : status.tone === "warn" ? "var(--cs-warn)"
              : "var(--cs-text-muted)",
          }}
        >
          <StatusIcon
            className={`w-3 h-3 shrink-0 ${isNarrativeLoading ? "animate-spin" : ""}`}
            strokeWidth={2}
          />
          {status.label}
        </span>
      </div>

      {/*
        * The status detail and the attempted-model list are the two things a reader needs when the
        * prose is not AI-authored. `deriveAiStatus` already composes the first; the second is on the
        * payload and used to be shown only in the Report rail, so a failure diagnosed in one pane
        * was invisible in the other.
        */}
      <p className="text-[10.5px] leading-relaxed text-cs-text-muted m-0">{status.detail}</p>

      {attempted.length > 0 && (
        <div
          className="text-[10px] font-mono text-cs-text-muted pt-1.5 border-t border-cs-border-subtle truncate"
          title={attempted.join(" → ")}
        >
          Attempted: <span className="text-cs-text-secondary">{attempted.join(" → ")}</span>
        </div>
      )}
    </div>
  );
};

export default React.memo(NarrativeProvenanceRow);

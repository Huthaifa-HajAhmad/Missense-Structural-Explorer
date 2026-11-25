import React, { useMemo } from "react";
import { KeyRound, RefreshCw, Settings2, Sparkles } from "lucide-react";
import type { AnalysisResult } from "../../../types";
import { useSettings } from "../../../context/SettingsContext";
import { isFallbackNarrative } from "../../../services/pipeline/variantCache";
import { hasStampedNarrative } from "../../../shared/narrativeEvidence";
import { deriveAiStatus } from "../reportStatus";

const TONE_CHIP = { good: "good", warn: "warning", bad: "danger", neutral: "muted" } as const;

/**
 * The written summary's state and its one next step, both from `deriveAiStatus`. Whether the summary
 * is outdated comes from the document (`summary` block's review reason), so the rail and the block
 * cannot disagree about it.
 */
export function ReportSummaryStatus({ result, outdated, busy, onWrite }: {
  result: AnalysisResult;
  outdated: boolean;
  busy: boolean;
  onWrite?: () => void | Promise<void>;
}) {
  const { openSettingsTab, hasConfiguredGeminiKey, serverGeminiReady, settings } = useSettings();
  const status = useMemo(() => {
    const narrative = result.analysis ?? "";
    return deriveAiStatus({
      isFallback: isFallbackNarrative(result.analysis, result.isFallback, result.fallbackReason),
      fallbackReason: result.fallbackReason,
      fallbackMessage: result.fallbackMessage,
      fallbackRetryable: result.fallbackRetryable,
      isKeyActive: hasConfiguredGeminiKey || serverGeminiReady,
      hasNarrative: Boolean(narrative && hasStampedNarrative(result)),
      isNarrativeLoading: busy,
      narrativeMode: settings?.narrativeMode,
      narrativeOutdated: outdated,
    });
  }, [result, hasConfiguredGeminiKey, serverGeminiReady, busy, settings?.narrativeMode, outdated]);
  const { action } = status;

  return (
    <section className="rpt-rail-section" aria-labelledby="rpt-rail-summary">
      <h3 className="rpt-rail-title" id="rpt-rail-summary"><Sparkles size={14} aria-hidden="true" />Written summary</h3>
      <span className="ev-tier rpt-summary-chip" data-tone={TONE_CHIP[status.tone]}>{status.label}</span>
      <p className="rpt-p">{status.detail}</p>
      <div className="rpt-draft-actions">
        {action.kind === "open-settings" ? (
          <button type="button" className="rpt-btn" onClick={() => openSettingsTab(action.tab)}>
            {action.tab === "connections" ? <KeyRound size={14} aria-hidden="true" /> : <Settings2 size={14} aria-hidden="true" />}{action.label}
          </button>
        ) : (
          <button type="button" className="rpt-btn" onClick={() => void onWrite?.()} disabled={action.disabled || !onWrite}>
            <RefreshCw size={14} aria-hidden="true" />{action.label}
          </button>
        )}
      </div>
    </section>
  );
}

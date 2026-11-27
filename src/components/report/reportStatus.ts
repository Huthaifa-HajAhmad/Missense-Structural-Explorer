/**
 * reportStatus.ts — Pure derivation of the written summary's status, and the one action it offers.
 *
 * Kept free of React and of any fetch so it can be unit-tested directly. The Report rail and the
 * Insights rail render this model; neither re-derives the state or the button from prose or flags.
 */
import { describeFallbackReason } from "../../shared/narrativeFallback";

export type AiStatusState = "live" | "degraded" | "unconfigured" | "idle";

/** What the reader can do next: open a settings tab, or (re)write the summary. */
export type SummaryAction =
  | { kind: "open-settings"; tab: "analysis" | "connections"; label: string }
  | { kind: "write"; label: string; disabled: boolean };

export interface AiStatusModel {
  state: AiStatusState;
  /** Short status label for the badge. */
  label: string;
  /** One sentence explaining the state in clinician-facing language. */
  detail: string;
  tone: "good" | "warn" | "neutral" | "bad";
  action: SummaryAction;
}

export interface DeriveAiStatusInput {
  isFallback: boolean;
  fallbackReason?: string | null;
  fallbackMessage?: string | null;
  fallbackRetryable?: boolean | null;
  /** Whether a Gemini credential is configured at all (BYOK or server-side). */
  isKeyActive: boolean;
  /** Whether any narrative text is present. */
  hasNarrative: boolean;
  isNarrativeLoading: boolean;
  narrativeMode?: "automatic" | "on-demand" | "off";
  narrativeOutdated?: boolean;
  /** The summary request was sent and stopped before any answer came back (the stage ended "skipped"). */
  requestStopped?: boolean;
}

const CONFIGURE: SummaryAction = { kind: "open-settings", tab: "connections", label: "Configure Gemini" };
const write = (rewrite: boolean, disabled = false): SummaryAction => ({ kind: "write", label: rewrite ? "Rewrite summary" : "Write summary", disabled });

/**
 * Produce the single source of truth for "what is the AI's state right now, and what can I do".
 *
 * The defect this replaces: the old banner branched on `isKeyActive` alone, so a report that had
 * just failed showed "AI SESSION TOKEN READY — Synthesize Live Report" directly above
 * "AI Explanation Service Offline (Fallback Report Loaded)". Two contradictory claims at once.
 * Here a degraded report can never render a "ready" status.
 */
export function deriveAiStatus(input: DeriveAiStatusInput): AiStatusModel {
  const { isFallback, fallbackReason, fallbackMessage, fallbackRetryable, isKeyActive, hasNarrative, isNarrativeLoading } = input;
  if (input.narrativeMode === "off") return {
    state: "idle", label: "AI summary off", tone: "neutral",
    action: { kind: "open-settings", tab: "analysis", label: "Turn on AI summaries" },
    detail: "The evidence report works without Gemini. Turn on AI synthesis in Analysis settings to write a summary.",
  };
  if (input.narrativeOutdated && !isNarrativeLoading) return {
    state: "idle", label: "Summary describes earlier evidence", tone: "warn",
    action: isKeyActive ? write(true) : CONFIGURE,
    detail: "The evidence changed after this summary was written. Rewrite it to describe the current evidence.",
  };

  if (isNarrativeLoading) {
    return {
      state: "idle",
      label: "Writing summary…",
      detail: "Sending the curated variant evidence to the language model.",
      tone: "neutral",
      action: { kind: "write", label: "Writing summary…", disabled: true },
    };
  }

  // A request that was sent and stopped is not the same as a missing key, so it gets its own label.
  if (input.requestStopped && !hasNarrative && !isFallback) {
    return {
      state: "degraded",
      label: "AI request stopped",
      detail: "The summary request stopped before it finished, so no model wrote one. Write it again to retry.",
      tone: "warn",
      action: isKeyActive ? write(false) : CONFIGURE,
    };
  }

  if (isFallback) {
    const presentation = describeFallbackReason(fallbackReason);
    // "No key configured" is a setup state, not a failure — but it still must not read as ready.
    const isUnconfigured = fallbackReason === "API_KEY_MISSING" && !isKeyActive;
    // Server-declared retryability wins; otherwise fall back to the reason's default. A cached
    // "no key" fallback is the exception: the reader has since connected a key, so the cause is gone.
    const keyArrived = fallbackReason === "API_KEY_MISSING" && isKeyActive;
    const retryable = keyArrived || (typeof fallbackRetryable === "boolean" ? fallbackRetryable : presentation.retryable);
    return {
      state: isUnconfigured ? "unconfigured" : "degraded",
      label: presentation.label,
      detail: fallbackMessage?.trim() || presentation.detail,
      tone: isUnconfigured ? "neutral" : presentation.tone,
      action: isKeyActive ? write(false, !retryable) : CONFIGURE,
    };
  }

  if (hasNarrative) {
    return {
      state: "live",
      label: "Summary written by AI",
      detail: "The language model wrote this summary. Its criteria list is merged with the rule engine's; the text itself is not checked against them.",
      tone: "good",
      action: isKeyActive ? write(true) : CONFIGURE,
    };
  }

  if (!isKeyActive) {
    return {
      state: "unconfigured",
      label: "AI not configured",
      detail: "Connect a Gemini API key in Settings to write a summary of this variant.",
      tone: "neutral",
      action: CONFIGURE,
    };
  }

  return {
    state: "idle",
    label: "No summary yet",
    detail: "The evidence is loaded. Write a summary to get an integrated reading of it.",
    tone: "neutral",
    action: write(false),
  };
}

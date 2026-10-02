/**
 * reportStatus.ts — Pure derivation of the written summary's status (live, degraded, unconfigured).
 *
 * Kept free of React and of any fetch so it can be unit-tested directly. The Report UI renders
 * this model; it must never re-derive degradation state from prose.
 */
import {
  describeFallbackReason,
  isNarrativeFallbackReason,
  type NarrativeFallbackReason,
} from "../../shared/narrativeFallback";

export type AiStatusState = "live" | "degraded" | "unconfigured" | "idle";

export interface AiStatusModel {
  state: AiStatusState;
  /** Short status label for the badge. */
  label: string;
  /** One sentence explaining the state in clinician-facing language. */
  detail: string;
  tone: "good" | "warn" | "neutral" | "bad";
  /** Whether re-running synthesis is worth offering. */
  retryable: boolean;
  /** Whether the Synthesize action should be enabled at all. */
  canSynthesize: boolean;
  /** Present only when degraded and the server supplied diagnostics. */
  diagnostics?: {
    providerDetail?: string;
    attemptedModels?: string[];
    reason?: NarrativeFallbackReason;
  };
}

export interface DeriveAiStatusInput {
  isFallback: boolean;
  fallbackReason?: string | null;
  fallbackMessage?: string | null;
  fallbackRetryable?: boolean | null;
  providerDetail?: string | null;
  attemptedModels?: string[] | null;
  /** Whether a Gemini credential is configured at all (BYOK or server-side). */
  isKeyActive: boolean;
  /** Whether any narrative text is present. */
  hasNarrative: boolean;
  isNarrativeLoading: boolean;
  narrativeMode?: "automatic" | "on-demand" | "off";
  narrativeOutdated?: boolean;
  deepEvidenceIncluded?: boolean;
}

/**
 * Produce the single source of truth for "what is the AI's state right now".
 *
 * The defect this replaces: the old banner branched on `isKeyActive` alone, so a report that had
 * just failed showed "AI SESSION TOKEN READY — Synthesize Live Report" directly above
 * "AI Explanation Service Offline (Fallback Report Loaded)". Two contradictory claims at once.
 * Here a degraded report can never render a "ready" status.
 */
export function deriveAiStatus(input: DeriveAiStatusInput): AiStatusModel {
  if (input.narrativeMode === "off") return {
    state: "idle", label: "AI synthesis off", tone: "neutral", retryable: false, canSynthesize: false,
    detail: "The evidence report is available without Gemini. Enable AI synthesis in Analysis settings to generate a narrative."
  };
  if (input.narrativeOutdated && !input.isNarrativeLoading) return {
    state: "idle", label: "Narrative describes earlier evidence", tone: "warn", retryable: true, canSynthesize: input.isKeyActive,
    detail: "Evidence changed after this narrative was generated. Re-synthesize to describe the current evidence snapshot."
  };
  const {
    isFallback,
    fallbackReason,
    fallbackMessage,
    fallbackRetryable,
    providerDetail,
    attemptedModels,
    isKeyActive,
    hasNarrative,
    isNarrativeLoading,
  } = input;

  if (isNarrativeLoading) {
    return {
      state: "idle",
      label: "Synthesizing…",
      detail: "Sending curated variant evidence to the language model for integrated interpretation.",
      tone: "neutral",
      retryable: false,
      canSynthesize: false,
    };
  }

  if (isFallback) {
    const presentation = describeFallbackReason(fallbackReason);

    // "No key configured" is a setup state, not a failure — but it still must not read as ready.
    const isUnconfigured = fallbackReason === "API_KEY_MISSING" && !isKeyActive;

    return {
      state: isUnconfigured ? "unconfigured" : "degraded",
      label: presentation.label,
      detail: fallbackMessage?.trim() || presentation.detail,
      tone: isUnconfigured ? "neutral" : presentation.tone,
      // Server-declared retryability wins; otherwise fall back to the reason's default.
      retryable: typeof fallbackRetryable === "boolean" ? fallbackRetryable : presentation.retryable,
      canSynthesize: isKeyActive,
      diagnostics: providerDetail || attemptedModels?.length
        ? {
            providerDetail: providerDetail || undefined,
            attemptedModels: attemptedModels?.length ? attemptedModels : undefined,
            reason: isNarrativeFallbackReason(fallbackReason) ? fallbackReason : undefined,
          }
        : undefined,
    };
  }

  if (hasNarrative) {
    return {
      state: "live",
      label: "AI synthesis complete",
      detail: "This narrative was written by the language model. Its criteria list is merged with the rule engine's; the prose itself is not checked against them.",
      tone: "good",
      retryable: false,
      canSynthesize: isKeyActive,
    };
  }

  if (!isKeyActive) {
    return {
      state: "unconfigured",
      label: "AI not configured",
      detail: "Connect a Gemini API key in Settings to generate a narrative interpretation of this variant.",
      tone: "neutral",
      retryable: false,
      canSynthesize: false,
    };
  }

  return {
    state: "idle",
    label: "Narrative not generated",
    detail: "Evidence is loaded and ready. Run AI synthesis to generate the integrated clinical narrative.",
    tone: "neutral",
    retryable: true,
    canSynthesize: true,
  };
}

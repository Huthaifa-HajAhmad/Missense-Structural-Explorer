/**
 * narrativeFallback.ts — Single source of truth for AI-narrative degradation state,
 * shared by the server (which classifies the failure) and the client (which presents it).
 *
 * Why this module exists
 * ----------------------
 * The narrative pipeline originally decided "is this a fallback report?" by substring
 * matching the report prose (see the legacy markers below). That is fragile: any copy
 * change, localisation, or model-written heading silently disables fallback detection,
 * which in turn disables cache purging and the retry affordance.
 *
 * The server now returns a stable `fallbackReason` code. The client must branch on that
 * structured signal first and only fall back to prose sniffing for payloads that were
 * cached before this contract existed.
 */

export const NARRATIVE_FALLBACK_REASONS = [
  /** No usable credential (missing, placeholder, or BYOK session not supplied). */
  "API_KEY_MISSING",
  /** Credential was rejected by the provider (401/403). */
  "API_KEY_INVALID",
  /** Provider quota/rate limit exhausted (429). */
  "QUOTA_EXHAUSTED",
  /** Provider reported the model is overloaded (503 / "high demand"). */
  "PROVIDER_OVERLOADED",
  /** Our own wall-clock budget expired before any model produced a result. */
  "DEADLINE_EXCEEDED",
  /** Every candidate model failed for a non-transient reason (e.g. 404 model retired). */
  "MODEL_UNAVAILABLE",
  /** Provider unreachable (DNS, connection refused/reset). */
  "NETWORK_ERROR",
  /**
   * The caller aborted the request — in practice a client disconnect. The engine cannot tell
   * that apart from the route's own deadline (it receives one combined signal), so it names
   * what it observed: the caller aborted. No client is left to read this response; it exists
   * so the audit trail does not record a cancellation as a provider deadline.
   */
  "REQUEST_CANCELLED",
  /** Unclassified failure. */
  "SERVICE_UNAVAILABLE",
] as const;

export type NarrativeFallbackReason = (typeof NARRATIVE_FALLBACK_REASONS)[number];

const REASON_SET: ReadonlySet<string> = new Set(NARRATIVE_FALLBACK_REASONS);

export function isNarrativeFallbackReason(value: unknown): value is NarrativeFallbackReason {
  return typeof value === "string" && REASON_SET.has(value);
}

export interface NarrativeFallbackPresentation {
  /** Short status label for a badge. */
  label: string;
  /** One sentence explaining what happened, in clinician-facing language. */
  detail: string;
  /** Whether re-running the same request has a realistic chance of succeeding. */
  retryable: boolean;
  /** Presentation tone the UI maps to colour tokens. */
  tone: "warn" | "neutral" | "bad";
}

const FALLBACK_PRESENTATION: Record<NarrativeFallbackReason, NarrativeFallbackPresentation> = {
  API_KEY_MISSING: {
    label: "AI not configured",
    detail: "No Gemini API key is available, so this report was assembled from database metrics and rule-based ACMG criteria only.",
    retryable: false,
    tone: "neutral",
  },
  API_KEY_INVALID: {
    label: "API key rejected",
    detail: "The provider rejected the configured Gemini API key. Update it in Settings to restore AI synthesis.",
    retryable: false,
    tone: "bad",
  },
  QUOTA_EXHAUSTED: {
    label: "Quota exhausted",
    detail: "The Gemini quota for this key is exhausted. The report below was assembled from database metrics until quota resets.",
    retryable: true,
    tone: "warn",
  },
  PROVIDER_OVERLOADED: {
    label: "AI service busy",
    detail: "Gemini reported that the requested models are overloaded. This is usually transient — retrying shortly often succeeds.",
    retryable: true,
    tone: "warn",
  },
  DEADLINE_EXCEEDED: {
    label: "AI synthesis timed out",
    detail: "No model responded within the synthesis time budget. The report below was assembled from database metrics and rule-based ACMG criteria.",
    retryable: true,
    tone: "warn",
  },
  MODEL_UNAVAILABLE: {
    label: "Model unavailable",
    detail: "None of the configured Gemini models accepted the request. Check the model configuration in Settings.",
    retryable: false,
    tone: "bad",
  },
  NETWORK_ERROR: {
    label: "AI unreachable",
    detail: "The Gemini endpoint could not be reached from the server. Verify outbound network access, then retry.",
    retryable: true,
    tone: "warn",
  },
  REQUEST_CANCELLED: {
    label: "Synthesis cancelled",
    detail: "The request was cancelled before synthesis finished, so this report was assembled from database metrics and rule-based ACMG criteria.",
    // Nothing was learned about the provider, so a fresh request is a fresh attempt.
    retryable: true,
    tone: "neutral",
  },
  SERVICE_UNAVAILABLE: {
    label: "AI synthesis failed",
    detail: "AI synthesis failed for an unclassified reason. The report below was assembled from database metrics and rule-based ACMG criteria.",
    retryable: true,
    tone: "warn",
  },
};

export function describeFallbackReason(
  reason: NarrativeFallbackReason | string | undefined | null
): NarrativeFallbackPresentation {
  if (isNarrativeFallbackReason(reason)) return FALLBACK_PRESENTATION[reason];
  return FALLBACK_PRESENTATION.SERVICE_UNAVAILABLE;
}

/**
 * Markers emitted by releases that predate the structured `fallbackReason` contract.
 * Kept only so previously cached payloads are still recognised as degraded.
 */
const LEGACY_FALLBACK_MARKERS = [
  "Gemini API Key Not Configured",
  "AI Explanation Service Offline",
  "AI Service Offline",
  "Fallback Report Loaded",
  "Key Config Required",
  "Narrative Generation Failed",
];

/**
 * Decide whether a narrative payload is a degraded (non-AI) report.
 *
 * Structured signal wins. Prose sniffing is a compatibility shim for cached legacy
 * payloads and for the client-side error path in `narrativeService`.
 */
export function isFallbackNarrative(
  analysis?: string | null,
  isFallback?: boolean,
  fallbackReason?: string | null
): boolean {
  if (isFallback === true) return true;
  if (isNarrativeFallbackReason(fallbackReason)) return true;
  if (!analysis || typeof analysis !== "string") return false;
  return LEGACY_FALLBACK_MARKERS.some((marker) => analysis.includes(marker));
}

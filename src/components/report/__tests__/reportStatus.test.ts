import { describe, it, expect } from "vitest";
import { deriveAiStatus } from "../reportStatus";

const BASE_INPUT = {
  isFallback: false,
  fallbackReason: undefined,
  fallbackMessage: undefined,
  fallbackRetryable: undefined,
  providerDetail: undefined,
  attemptedModels: undefined,
  isKeyActive: true,
  hasNarrative: false,
  isNarrativeLoading: false,
};

describe("deriveAiStatus", () => {
  it("never reports a ready state while the report is a fallback", () => {
    const status = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "PROVIDER_OVERLOADED",
      hasNarrative: true,
    });

    // Regression: the old banner announced "AI Session Token Ready" above an offline report
    // because it branched on key presence rather than on the report's actual state.
    expect(status.state).toBe("degraded");
    expect(status.label).not.toMatch(/ready/i);
    expect(status.tone).toBe("warn");
    expect(status.retryable).toBe(true);
  });

  it("treats a missing key as an unconfigured setup state, not a failure", () => {
    const status = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "API_KEY_MISSING",
      isKeyActive: false,
    });

    expect(status.state).toBe("unconfigured");
    expect(status.canSynthesize).toBe(false);
    expect(status.tone).toBe("neutral");
  });

  it("honours the server's retryability flag over the reason default", () => {
    const notRetryable = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "PROVIDER_OVERLOADED",
      fallbackRetryable: false,
    });
    expect(notRetryable.retryable).toBe(false);

    const retryable = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "MODEL_UNAVAILABLE",
      fallbackRetryable: true,
    });
    expect(retryable.retryable).toBe(true);
  });

  it("prefers the server's sanitised message over generic copy", () => {
    const status = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "DEADLINE_EXCEEDED",
      fallbackMessage: "No model responded within the synthesis time budget.",
    });
    expect(status.detail).toBe("No model responded within the synthesis time budget.");
  });

  it("exposes diagnostics for the console without putting them in the prose", () => {
    const status = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "PROVIDER_OVERLOADED",
      providerDetail: "This model is currently experiencing high demand.",
      attemptedModels: ["gemini-3.5-flash", "gemini-2.5-flash"],
    });

    expect(status.diagnostics?.providerDetail).toContain("high demand");
    expect(status.diagnostics?.attemptedModels).toEqual(["gemini-3.5-flash", "gemini-2.5-flash"]);
    expect(status.diagnostics?.reason).toBe("PROVIDER_OVERLOADED");
  });

  it("reports live synthesis when a narrative exists without a fallback flag", () => {
    const status = deriveAiStatus({ ...BASE_INPUT, hasNarrative: true });
    expect(status.state).toBe("live");
    expect(status.tone).toBe("good");
    expect(status.retryable).toBe(false);
  });

  it("reports loading ahead of every other state", () => {
    const status = deriveAiStatus({
      ...BASE_INPUT,
      isNarrativeLoading: true,
      hasNarrative: true,
      isFallback: true,
      fallbackReason: "PROVIDER_OVERLOADED",
    });
    expect(status.state).toBe("idle");
    expect(status.canSynthesize).toBe(false);
  });

  it("distinguishes idle-with-key from unconfigured-without-key", () => {
    expect(deriveAiStatus({ ...BASE_INPUT, isKeyActive: true }).canSynthesize).toBe(true);
    expect(deriveAiStatus({ ...BASE_INPUT, isKeyActive: false }).state).toBe("unconfigured");
  });
});

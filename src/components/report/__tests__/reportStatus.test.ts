import { describe, it, expect } from "vitest";
import { deriveAiStatus } from "../reportStatus";

const BASE_INPUT = {
  isFallback: false,
  fallbackReason: undefined,
  fallbackMessage: undefined,
  fallbackRetryable: undefined,
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
    expect(status.action).toEqual({ kind: "write", label: "Write summary", disabled: false });
  });

  it("treats a missing key as an unconfigured setup state, not a failure", () => {
    const status = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "API_KEY_MISSING",
      isKeyActive: false,
    });

    expect(status.state).toBe("unconfigured");
    expect(status.action).toEqual({ kind: "open-settings", tab: "connections", label: "Configure Gemini" });
    expect(status.tone).toBe("neutral");
  });

  it("honours the server's retryability flag over the reason default", () => {
    const notRetryable = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "PROVIDER_OVERLOADED",
      fallbackRetryable: false,
    });
    expect(notRetryable.action).toMatchObject({ kind: "write", disabled: true });

    const retryable = deriveAiStatus({
      ...BASE_INPUT,
      isFallback: true,
      fallbackReason: "MODEL_UNAVAILABLE",
      fallbackRetryable: true,
    });
    expect(retryable.action).toMatchObject({ kind: "write", disabled: false });
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

  it("offers a working retry when a key arrived after a missing-key fallback was cached", () => {
    // The cached run says "no key"; the reader has since connected one, so the cause is gone.
    const status = deriveAiStatus({ ...BASE_INPUT, isFallback: true, fallbackReason: "API_KEY_MISSING", isKeyActive: true });
    expect(status.action).toEqual({ kind: "write", label: "Write summary", disabled: false });
    expect(deriveAiStatus({ ...BASE_INPUT, isFallback: true, fallbackReason: "API_KEY_MISSING", isKeyActive: true, fallbackRetryable: false }).action)
      .toMatchObject({ kind: "write", disabled: false });
  });

  it("reports live synthesis when a narrative exists without a fallback flag", () => {
    const status = deriveAiStatus({ ...BASE_INPUT, hasNarrative: true });
    expect(status.state).toBe("live");
    expect(status.tone).toBe("good");
    expect(status.label).toBe("Summary written by AI");
    expect(status.action).toEqual({ kind: "write", label: "Rewrite summary", disabled: false });
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
    expect(status.action).toEqual({ kind: "write", label: "Writing summary…", disabled: true });
  });

  it("distinguishes idle-with-key from unconfigured-without-key", () => {
    expect(deriveAiStatus({ ...BASE_INPUT, isKeyActive: true }).action).toEqual({ kind: "write", label: "Write summary", disabled: false });
    expect(deriveAiStatus({ ...BASE_INPUT, isKeyActive: false }).state).toBe("unconfigured");
  });

  it("sends the reader to settings when summaries are off, and names an outdated summary", () => {
    expect(deriveAiStatus({ ...BASE_INPUT, narrativeMode: "off" }).action).toEqual({ kind: "open-settings", tab: "analysis", label: "Turn on AI summaries" });
    const outdated = deriveAiStatus({ ...BASE_INPUT, hasNarrative: true, narrativeOutdated: true });
    expect(outdated.label).toBe("Summary describes earlier evidence");
    expect(outdated.action).toEqual({ kind: "write", label: "Rewrite summary", disabled: false });
  });
});

describe("deriveAiStatus when a summary request was stopped (release audit FB1)", () => {
  it("says the request was stopped, not that AI is not configured, when a key is set", () => {
    const status = deriveAiStatus({ ...BASE_INPUT, isKeyActive: true, requestStopped: true });
    expect(status.label).toBe("AI request stopped");
    expect(status.label).not.toMatch(/not configured/i);
    expect(status.action).toEqual({ kind: "write", label: "Write summary", disabled: false });
  });

  it("still sends a reader without a key to settings after a stopped request", () => {
    const status = deriveAiStatus({ ...BASE_INPUT, isKeyActive: false, requestStopped: true });
    expect(status.action).toEqual({ kind: "open-settings", tab: "connections", label: "Configure Gemini" });
  });
});

import { describe, it, expect } from "vitest";
import {
  buildEvidenceInventory,
  deriveAiStatus,
  formatDeltaG,
  summarizeEvidence,
} from "../reportStatus";

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

describe("buildEvidenceInventory", () => {
  it("reports every source as absent for an empty result", () => {
    const sources = buildEvidenceInventory(null);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source.status === "absent")).toBe(true);
    expect(summarizeEvidence(sources)).toEqual({ present: 0, total: sources.length });
  });

  it("distinguishes 'absent from ClinVar' from 'ClinVar not queried'", () => {
    // `classification` explicitly saying "Not found" means ClinVar WAS queried and had no entry.
    const queried = buildEvidenceInventory({ clinvar: { classification: "Not found in ClinVar" } });
    const clinvarQueried = queried.find((s) => s.id === "clinvar");
    expect(clinvarQueried?.status).toBe("absent");
    expect(clinvarQueried?.detail).toMatch(/no submission/i);

    const notQueried = buildEvidenceInventory({});
    expect(notQueried.find((s) => s.id === "clinvar")?.detail).toMatch(/no submission/i);
  });

  it("records a ClinVar classification when one exists", () => {
    const sources = buildEvidenceInventory({ clinvar: { classification: "Pathogenic" } });
    const clinvar = sources.find((s) => s.id === "clinvar");
    expect(clinvar?.status).toBe("present");
    expect(clinvar?.detail).toBe("Pathogenic");
  });

  it("summarises which predictors contributed", () => {
    const sources = buildEvidenceInventory({
      predictorData: { amPathogenicity: 0.9, caddPhred: 32 },
      conservationData: { revel: 0.527 },
    });
    const inSilico = sources.find((s) => s.id === "in-silico");

    expect(inSilico?.status).toBe("present");
    expect(inSilico?.detail).toContain("AlphaMissense");
    expect(inSilico?.detail).toContain("CADD");
    expect(inSilico?.detail).toContain("REVEL");
  });

  it("lists which stability tools produced a value", () => {
    const sources = buildEvidenceInventory({ foldingDdG: 1.42, dynamut2: -0.3 });
    const energetics = sources.find((s) => s.id === "energetics");

    expect(energetics?.status).toBe("present");
    expect(energetics?.detail).toContain("FoldX");
    expect(energetics?.detail).toContain("DynaMut2");
    expect(energetics?.detail).not.toContain("DDMut");
  });

  it("counts present sources and their total", () => {
    const sources = buildEvidenceInventory({
      clinvar: { classification: "Benign" },
      metadata: { pdbId: "1ABC", pdbSource: "AlphaFold" },
      foldingDdG: 0.5,
    });
    const summary = summarizeEvidence(sources);

    expect(summary.total).toBe(sources.length);
    expect(summary.present).toBe(3);
  });
});

describe("formatDeltaG", () => {
  it("preserves the sign so destabilisation is explicit", () => {
    expect(formatDeltaG(1.5)).toBe("+1.50 kcal/mol");
    expect(formatDeltaG(-1.5)).toBe("-1.50 kcal/mol");
    expect(formatDeltaG(0)).toBe("0.00 kcal/mol");
  });

  it("renders an em dash for missing or non-finite values", () => {
    expect(formatDeltaG(null)).toBe("—");
    expect(formatDeltaG(undefined)).toBe("—");
    expect(formatDeltaG(Number.NaN)).toBe("—");
    expect(formatDeltaG(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

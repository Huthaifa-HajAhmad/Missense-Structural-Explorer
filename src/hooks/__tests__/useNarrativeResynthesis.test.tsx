// @vitest-environment jsdom
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The hook extracted from the report view.
 *
 * Three of these pin defects the extraction had to fix rather than inherit: a response
 * written after the user switched variants, a degraded response retaining the previous
 * pass's AI plausibility, and two surfaces retrying at once.
 */
const mockGetNarrative = vi.fn();
const mockSetCachedVariant = vi.fn();
const mockAddNotification = vi.fn();

vi.mock("../../apiClient", () => ({
  useApiClient: () => ({ apiClient: { getNarrative: mockGetNarrative } }),
}));

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ settings: { acmgWeighting: "standard" } }),
}));

vi.mock("../../services/pipeline/variantCache", () => ({
  setCachedVariant: (...args: unknown[]) => mockSetCachedVariant(...args),
}));

import { useNarrativeResynthesis } from "../useNarrativeResynthesis";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";

const RESULT = {
  metadata: { gene: "GZF1", variant: "p.Arg591Trp", uniprotId: "Q9H116", residueIndex: 591 },
  clinvar: null,
  insights: { biochemicalShift: "old shift", structuralImpact: "old impact", plausibility: "AI said this was plausible." },
} as any;

function loadVariant(variant = "p.Arg591Trp", result: any = RESULT) {
  useVariantAnalysisStore.setState({
    gene: result.metadata.gene,
    variant,
    uniprotId: result.metadata.uniprotId,
    analysisState: { result, isLoading: false } as any,
    isNarrativeLoading: false,
    addNotification: mockAddNotification,
  });
}

/** A degraded payload, shaped as the server sends it (server/routes/variant/narrative.ts). */
const DEGRADED = {
  analysis: "### Rule-Based Clinical Summary\n\nLive AI synthesis was not applied.",
  isFallback: true,
  fallbackReason: "PROVIDER_OVERLOADED",
  fallbackMessage: "Gemini reported that the requested models are overloaded.",
  fallbackRetryable: true,
  providerDetail: "This model is currently experiencing high demand.",
  attemptedModels: ["gemini-3.7-flash"],
  insights: { biochemicalShift: "Not synthesized", structuralImpact: "Not synthesized", acmgCriteria: [] },
} as any;

const HEALTHY = {
  analysis: "### Molecular and Chemical Shift\n\nFresh narrative.",
  isFallback: false,
  insights: {
    biochemicalShift: "fresh shift",
    structuralImpact: "fresh impact",
    plausibility: "fresh plausibility",
    acmgCriteria: [{ code: "PP3", reason: "predictors agree" }],
  },
} as any;

describe("useNarrativeResynthesis", () => {
  beforeEach(() => {
    mockGetNarrative.mockReset();
    mockSetCachedVariant.mockReset();
    mockAddNotification.mockReset();
    loadVariant();
  });

  it("requests the variant it was invoked for, with an abort signal", async () => {
    mockGetNarrative.mockResolvedValue(HEALTHY);

    const { result } = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      await result.current.resynthesize();
    });

    const [payload, signal] = mockGetNarrative.mock.calls[0];
    expect(payload).toMatchObject({ gene: "GZF1", variant: "p.Arg591Trp", uniprotId: "Q9H116" });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(useVariantAnalysisStore.getState().analysisState.result?.analysis).toContain("Fresh narrative");
    expect(useVariantAnalysisStore.getState().isNarrativeLoading).toBe(false);
    expect(mockAddNotification).toHaveBeenCalledWith("success", expect.stringContaining("Clinical report updated"));
  });

  it("does not write a response into a variant the user has since switched to", async () => {
    /*
     * The inherited handler wrote over whatever the store held when the response arrived, so a
     * retry started for one variant could install its report under another variant's name.
     */
    let releaseNarrative: (value: unknown) => void = () => {};
    mockGetNarrative.mockReturnValue(new Promise(resolve => { releaseNarrative = resolve; }));

    const { result } = renderHook(() => useNarrativeResynthesis());
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.resynthesize();
    });

    // The user moves on while the request is in flight.
    const otherResult = { ...RESULT, metadata: { ...RESULT.metadata, gene: "PAH", variant: "p.Arg408Trp" } } as any;
    loadVariant("p.Arg408Trp", otherResult);

    await act(async () => {
      releaseNarrative(HEALTHY);
      await pending;
    });

    const state = useVariantAnalysisStore.getState();
    expect(state.variant).toBe("p.Arg408Trp");
    // The stale response must not have been installed under the new variant.
    expect(state.analysisState.result?.analysis).toBeUndefined();
    expect(state.analysisState.result?.metadata?.gene).toBe("PAH");
    expect(mockSetCachedVariant).not.toHaveBeenCalled();
  });

  it("clears the previous pass's AI plausibility when the new response is degraded", async () => {
    /*
     * A spread merge keeps fields the degraded payload does not carry, and
     * ClinicalInsightsCard renders its "AI-Generated Plausibility Reasoning" block whenever
     * `plausibility` is set — so stale AI prose sat under a rule-based status strip.
     */
    mockGetNarrative.mockResolvedValue(DEGRADED);

    const { result } = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      await result.current.resynthesize();
    });

    const insights = useVariantAnalysisStore.getState().analysisState.result?.insights as any;
    expect(insights.biochemicalShift).toBe("Not synthesized");
    expect(insights.plausibility).toBe("");
    expect(mockAddNotification).toHaveBeenCalledWith("info", expect.stringContaining("overloaded"));
  });

  it("keeps a fresh plausibility when the response is healthy", async () => {
    mockGetNarrative.mockResolvedValue(HEALTHY);

    const { result } = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      await result.current.resynthesize();
    });

    const insights = useVariantAnalysisStore.getState().analysisState.result?.insights as any;
    expect(insights.plausibility).toBe("fresh plausibility");
    expect(insights.biochemicalShift).toBe("fresh shift");
  });

  it("coalesces two surfaces retrying at once into one request", async () => {
    let release: (value: unknown) => void = () => {};
    mockGetNarrative.mockReturnValue(new Promise(resolve => { release = resolve; }));

    const { result } = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      const first = result.current.resynthesize();
      const second = result.current.resynthesize();
      release(HEALTHY);
      await Promise.all([first, second]);
    });

    expect(mockGetNarrative).toHaveBeenCalledTimes(1);
  });

  it("reports a transport failure and still clears the loading flag", async () => {
    mockGetNarrative.mockRejectedValue(new Error("narrative route unreachable"));

    const { result } = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      await result.current.resynthesize();
    });

    expect(mockAddNotification).toHaveBeenCalledWith("error", "narrative route unreachable");
    expect(useVariantAnalysisStore.getState().isNarrativeLoading).toBe(false);
    expect(mockSetCachedVariant).not.toHaveBeenCalled();
  });

  it("does nothing when no analysis result is loaded", async () => {
    useVariantAnalysisStore.setState({ analysisState: { result: null, isLoading: false } as any });

    const { result } = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      await result.current.resynthesize();
    });

    expect(mockGetNarrative).not.toHaveBeenCalled();
  });
});

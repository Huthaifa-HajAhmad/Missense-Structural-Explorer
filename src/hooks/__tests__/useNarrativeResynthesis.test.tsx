// @vitest-environment jsdom
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The hook extracted from the report view.
 *
 * Three of these pin defects the extraction had to fix rather than inherit: a response
 * written after the user switched variants, a degraded response retaining the previous
 * pass's AI plausibility, and two surfaces retrying at once.
 *
 * The rest pin what per-instance state could not express, and what the shared modules now own:
 * one synthesis per identity+evidence across instances, a stale `finally` that cannot clear a
 * newer request's flag, an identity guard that compares gene+variant+uniprot+run rather than the
 * variant alone, and an install that merges into the LATEST result so evidence arriving mid-flight
 * survives with an accurate "outdated" verdict.
 */
const mockGetNarrative = vi.fn();
const mockSetCachedVariant = vi.fn();
const mockAddNotification = vi.fn();
/**
 * Settings are read through a mutable holder so one test can put the reader in `off` mode.
 * `vi.hoisted` keeps the holder alive before the (hoisted) module mocks run.
 */
const mockSettings = vi.hoisted(() => ({ current: { acmgWeighting: "standard" } as any }));

vi.mock("../../apiClient", () => ({
  useApiClient: () => ({ apiClient: { getNarrative: mockGetNarrative } }),
}));

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ settings: mockSettings.current }),
}));

vi.mock("../../services/pipeline/variantCache", () => ({
  setCachedVariant: (...args: unknown[]) => mockSetCachedVariant(...args),
}));

import { useNarrativeResynthesis } from "../useNarrativeResynthesis";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { narrativeFreshness, readNarrativeEvidenceStamp } from "../../shared/narrativeEvidence";
import { DEEP_EVIDENCE_MODEL_IDS, deepEvidenceContextFromStore } from "../../shared/deepModelEvidence";
import { resetNarrativeActivity, resetNarrativeFlights } from "../../shared/narrativeResynthesis";

const RUN_ID = "1:1700000000000";

const RESULT = {
  metadata: { gene: "GZF1", variant: "p.Arg591Trp", uniprotId: "Q9H116", residueIndex: 591, pipelineRunId: RUN_ID },
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

/** A deferred response, so a test can hold a synthesis open while the world changes under it. */
function deferred() {
  let release: (value: unknown) => void = () => {};
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release: (value: unknown) => release(value) };
}

describe("useNarrativeResynthesis", () => {
  beforeEach(() => {
    mockGetNarrative.mockReset();
    mockSetCachedVariant.mockReset();
    mockAddNotification.mockReset();
    mockSettings.current = { acmgWeighting: "standard" };
    resetNarrativeFlights();
    resetNarrativeActivity();
    loadVariant();
  });

  it("requests the variant it was invoked for, with an abort signal and the shared evidence contract", async () => {
    mockGetNarrative.mockResolvedValue(HEALTHY);

    const { result } = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      await result.current.resynthesize();
    });

    const [payload, signal] = mockGetNarrative.mock.calls[0];
    expect(payload).toMatchObject({ gene: "GZF1", variant: "p.Arg591Trp", uniprotId: "Q9H116" });
    expect(signal).toBeInstanceOf(AbortSignal);
    /*
     * The request carries the deep-model block: one row per model the app knows, so the synthesis can
     * consider the stability and language-model results the report displays, and so a run that produced
     * none says so rather than leaving the model to fill the gap.
     */
    expect(payload.deepEvidence.observations.map((o: any) => o.id)).toEqual([...DEEP_EVIDENCE_MODEL_IDS]);
    expect(useVariantAnalysisStore.getState().analysisState.result?.analysis).toContain("Fresh narrative");
    expect(useVariantAnalysisStore.getState().isNarrativeLoading).toBe(false);
    expect(mockAddNotification).toHaveBeenCalledWith("success", expect.stringContaining("Clinical report updated"));
  });

  it("sends the run's per-source outcomes, so a failed source is not hashed as an absent one", async () => {
    /*
     * The evidence hash is what keeps a narrative written for a ClinVar TIMEOUT from being served to a
     * run that never asked. Both arrive as `clinvar: null`; only `serviceStatus` separates them.
     */
    const withStatus = {
      ...RESULT,
      metadata: { ...RESULT.metadata, serviceStatus: { clinvar: "timeout", gnomad: "ok" } },
      serviceStatus: { clinvar: "timeout", gnomad: "ok" },
    };
    loadVariant("p.Arg591Trp", withStatus);
    mockGetNarrative.mockResolvedValue(HEALTHY);

    const { result } = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      await result.current.resynthesize();
    });

    const [payload] = mockGetNarrative.mock.calls[0];
    expect(payload.serviceStatus).toEqual({ clinvar: "timeout", gnomad: "ok" });
    // ...and the install records which evidence revision the prose describes.
    const stamp = readNarrativeEvidenceStamp(useVariantAnalysisStore.getState().analysisState.result);
    expect(stamp?.revision).toMatch(/^nev\d+:[0-9a-f]{32}$/);
    expect(narrativeFreshness(useVariantAnalysisStore.getState().analysisState.result)).toBe("current");
  });

  it("does not write a response into a variant the user has since switched to", async () => {
    /*
     * The inherited handler wrote over whatever the store held when the response arrived, so a
     * retry started for one variant could install its report under another variant's name.
     */
    const gate = deferred();
    mockGetNarrative.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useNarrativeResynthesis());
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.resynthesize();
    });

    // The user moves on while the request is in flight.
    const otherResult = {
      ...RESULT,
      metadata: { ...RESULT.metadata, gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" },
    } as any;
    loadVariant("p.Arg408Trp", otherResult);

    await act(async () => {
      gate.release(HEALTHY);
      await pending;
    });

    const state = useVariantAnalysisStore.getState();
    expect(state.variant).toBe("p.Arg408Trp");
    // The stale response must not have been installed under the new variant.
    expect(state.analysisState.result?.analysis).toBeUndefined();
    expect(state.analysisState.result?.metadata?.gene).toBe("PAH");
    expect(mockSetCachedVariant).not.toHaveBeenCalled();
  });

  it("rejects a response for a different gene carrying the same variant string", async () => {
    /*
     * A variant notation is not unique across genes — `p.Arg591Trp` is not an identifier for GZF1 —
     * and the guard used to compare the variant alone, so a same-notation/different-gene switch was
     * written straight through.
     */
    const gate = deferred();
    mockGetNarrative.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useNarrativeResynthesis());
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.resynthesize();
    });

    const sameNotationOtherGene = {
      ...RESULT,
      metadata: { ...RESULT.metadata, gene: "PAH", uniprotId: "P00439" },
    } as any;
    loadVariant("p.Arg591Trp", sameNotationOtherGene);

    await act(async () => {
      gate.release(HEALTHY);
      await pending;
    });

    expect(useVariantAnalysisStore.getState().analysisState.result?.analysis).toBeUndefined();
    expect(mockSetCachedVariant).not.toHaveBeenCalled();
  });

  it("refuses to write into a superseded run of the same variant", async () => {
    /*
     * Same gene, same notation, a NEW run: its evidence is different and its report must not receive
     * the previous run's prose. Variant equality alone cannot tell the two runs apart.
     */
    const gate = deferred();
    mockGetNarrative.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useNarrativeResynthesis());
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.resynthesize();
    });

    useVariantAnalysisStore.setState({
      analysisState: {
        result: { ...RESULT, metadata: { ...RESULT.metadata, pipelineRunId: "2:1800000000000" } },
        isLoading: false,
      } as any,
    });

    await act(async () => {
      gate.release(HEALTHY);
      await pending;
    });

    expect(useVariantAnalysisStore.getState().analysisState.result?.analysis).toBeUndefined();
    expect(mockSetCachedVariant).not.toHaveBeenCalled();
  });

  it("merges into the latest result, so evidence that arrived mid-flight survives", async () => {
    const gate = deferred();
    mockGetNarrative.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useNarrativeResynthesis());
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.resynthesize();
    });

    /*
     * Deep-model evidence lands while the synthesis is in flight: FoldX finishes and the ESM
     * evaluation arrives. Both are what the report displays, both must survive the install — and both
     * are part of the narrative's evidence contract, so the prose that was written before them is
     * reported as predating the evidence on screen rather than silently presented as covering it.
     */
    useVariantAnalysisStore.setState({
      analysisState: {
        result: { ...RESULT, foldingDdG: 2.85, esm2Eval: { llr: -3.1 } },
        isLoading: false,
      } as any,
      foldingEnergetics: { foldx: 2.85 } as any,
    });

    await act(async () => {
      gate.release(HEALTHY);
      await pending;
    });

    const state = useVariantAnalysisStore.getState();
    const merged = state.analysisState.result as any;
    expect(merged.foldingDdG).toBe(2.85);
    expect(merged.esm2Eval).toEqual({ llr: -3.1 });
    expect(merged.analysis).toContain("Fresh narrative");
    expect(readNarrativeEvidenceStamp(merged)?.deepEvidenceIntegrated).toBe(true);
    // The ΔΔG arrived after the request, so the narrative does not describe it — the honest verdict,
    // and the one a status surface must render.
    expect(narrativeFreshness(merged, deepEvidenceContextFromStore(state))).toBe("outdated");
  });

  it("records an outdated verdict when the evidence the narrative was given changed underneath it", async () => {
    const gate = deferred();
    mockGetNarrative.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useNarrativeResynthesis());
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.resynthesize();
    });

    // A ClinVar record is read after the request was made: the prose describes a run that did not
    // have it, and the stamp is what makes that checkable rather than implied.
    useVariantAnalysisStore.setState({
      analysisState: {
        result: { ...RESULT, clinvar: { classification: "Pathogenic", uid: "9" } },
        isLoading: false,
      } as any,
    });

    await act(async () => {
      gate.release(HEALTHY);
      await pending;
    });

    const state = useVariantAnalysisStore.getState().analysisState.result as any;
    expect(state.clinvar).toEqual({ classification: "Pathogenic", uid: "9" });
    expect(narrativeFreshness(state)).toBe("outdated");
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
    expect(insights.source).toBe("rule_based");
    expect(insights.model).toBeUndefined();
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
    const gate = deferred();
    mockGetNarrative.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      const first = result.current.resynthesize();
      const second = result.current.resynthesize();
      gate.release(HEALTHY);
      await Promise.all([first, second]);
    });

    expect(mockGetNarrative).toHaveBeenCalledTimes(1);
  });

  it("coalesces across two hook instances, not just within one", async () => {
    /*
     * Each surface that renders the control (Report inspector, Residue Shifts, Insights rail) mounts
     * its own instance. A per-hook `inFlightRef` cannot see the others, so two syntheses used to run
     * for one variant and whichever answered last won the store.
     */
    const gate = deferred();
    mockGetNarrative.mockReturnValue(gate.promise);

    const first = renderHook(() => useNarrativeResynthesis());
    const second = renderHook(() => useNarrativeResynthesis());

    await act(async () => {
      const a = first.result.current.resynthesize();
      const b = second.result.current.resynthesize();
      gate.release(HEALTHY);
      await Promise.all([a, b]);
    });

    expect(mockGetNarrative).toHaveBeenCalledTimes(1);
    expect(first.result.current.isResynthesizing).toBe(false);
    expect(second.result.current.isResynthesizing).toBe(false);
    expect(useVariantAnalysisStore.getState().isNarrativeLoading).toBe(false);
    expect(mockSetCachedVariant).toHaveBeenCalledTimes(1);
  });

  it("does not clear a newer request's loading flag when an older request finishes", async () => {
    /*
     * The stale `finally`: the older request settling used to clear the flag unconditionally, so the
     * reader was told synthesis had stopped while a newer request was still on the wire (and the new
     * spinner was gone).
     */
    const gates: Array<(value: unknown) => void> = [];
    mockGetNarrative.mockImplementation(() => new Promise((resolve) => gates.push(resolve)));

    const older = renderHook(() => useNarrativeResynthesis());
    let olderPending: Promise<void> = Promise.resolve();
    act(() => {
      olderPending = older.result.current.resynthesize();
    });

    // The reader moves to another variant and retries there, so two flights are on the wire.
    const otherResult = {
      ...RESULT,
      metadata: { ...RESULT.metadata, gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" },
    } as any;
    loadVariant("p.Arg408Trp", otherResult);

    const newer = renderHook(() => useNarrativeResynthesis());
    let newerPending: Promise<void> = Promise.resolve();
    act(() => {
      newerPending = newer.result.current.resynthesize();
    });

    expect(mockGetNarrative).toHaveBeenCalledTimes(2);

    await act(async () => {
      gates[0](HEALTHY);
      await olderPending;
    });
    expect(
      useVariantAnalysisStore.getState().isNarrativeLoading,
      "the newer synthesis is still running, so the flag stays raised"
    ).toBe(true);

    await act(async () => {
      gates[1](HEALTHY);
      await newerPending;
    });
    expect(useVariantAnalysisStore.getState().isNarrativeLoading).toBe(false);
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

  it("gives a re-analysed run its own synthesis instead of joining the previous run's", async () => {
    /*
     * The coalescer's key carries the RUN. Without it, run B (same variant, byte-identical evidence)
     * joined run A's flight, and A's own install refused B because the run ids differ — so B's spinner
     * resolved and no narrative ever arrived for the run the reader is actually looking at.
     */
    const gates: Array<(value: unknown) => void> = [];
    mockGetNarrative.mockImplementation(() => new Promise(resolve => gates.push(resolve)));

    const older = renderHook(() => useNarrativeResynthesis());
    let olderPending: Promise<void> = Promise.resolve();
    act(() => {
      olderPending = older.result.current.resynthesize();
    });

    // The same variant is re-analysed: a NEW run, with the same evidence.
    const rerun = {
      ...RESULT,
      metadata: { ...RESULT.metadata, pipelineRunId: "2:1800000000000" },
    } as any;
    loadVariant("p.Arg591Trp", rerun);

    const newer = renderHook(() => useNarrativeResynthesis());
    let newerPending: Promise<void> = Promise.resolve();
    act(() => {
      newerPending = newer.result.current.resynthesize();
    });

    // Two runs, two requests.
    expect(mockGetNarrative).toHaveBeenCalledTimes(2);

    await act(async () => {
      gates[0](HEALTHY);
      await olderPending;
    });
    // The older run's response must not have landed on the new run's result.
    expect(useVariantAnalysisStore.getState().analysisState.result?.analysis).toBeUndefined();

    await act(async () => {
      gates[1](HEALTHY);
      await newerPending;
    });
    const state = useVariantAnalysisStore.getState();
    expect(state.analysisState.result?.analysis).toContain("Fresh narrative");
    // ...and the new run is still the run on screen, with its own revision recorded.
    expect(state.analysisState.result?.metadata?.pipelineRunId).toBe("2:1800000000000");
    expect(readNarrativeEvidenceStamp(state.analysisState.result)?.pipelineRunId).toBe("2:1800000000000");
  });

  it("asks for nothing when the reader has turned narrative synthesis off", async () => {
    /*
     * `off` is a statement about spending a model call, so the control must not quietly spend one.
     * It also must not pretend a synthesis happened: the report is untouched and the reader is told
     * where the setting lives.
     */
    mockSettings.current = { acmgWeighting: "standard", narrativeMode: "off" };

    const { result } = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      await result.current.resynthesize();
    });

    expect(mockGetNarrative).not.toHaveBeenCalled();
    expect(useVariantAnalysisStore.getState().isNarrativeLoading).toBe(false);
    expect(useVariantAnalysisStore.getState().analysisState.result?.analysis).toBeUndefined();
    expect(mockAddNotification).toHaveBeenCalledWith("info", expect.stringContaining("turned off in Settings"));
  });

  it("still synthesizes on an explicit request in on-demand mode", async () => {
    // `on-demand` means exactly this control; only `off` refuses.
    mockSettings.current = { acmgWeighting: "standard", narrativeMode: "on-demand" };
    mockGetNarrative.mockResolvedValue(HEALTHY);

    const { result } = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      await result.current.resynthesize();
    });

    expect(mockGetNarrative).toHaveBeenCalledTimes(1);
    expect(useVariantAnalysisStore.getState().analysisState.result?.analysis).toContain("Fresh narrative");
  });

  /**
   * `metadata.pipelineStages.narrative`.
   *
   * Both real synthesis paths must record this stage, and record it from the ACTUAL result: the run that
   * produced a narrative says `complete`, a provider's rule-based report says `degraded`, and a request
   * that never arrived says `error`. Sibling stages belong to other steps and must survive.
   */
  it("marks the narrative stage running, then complete, replacing a retained degraded status", async () => {
    // The shape a core-only cache retention leaves: prose dropped, stage marked degraded, siblings kept.
    const retained = {
      ...RESULT,
      analysis: "",
      insights: null,
      isFallback: true,
      metadata: {
        ...RESULT.metadata,
        pipelineStages: { core: "complete", landscape: "complete", narrative: "degraded" },
      },
    } as any;
    loadVariant("p.Arg591Trp", retained);

    const gate = deferred();
    mockGetNarrative.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useNarrativeResynthesis());
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.resynthesize();
    });

    // While the request is on the wire the stage says so.
    expect(
      useVariantAnalysisStore.getState().analysisState.result?.metadata?.pipelineStages
    ).toMatchObject({ core: "complete", landscape: "complete", narrative: "running" });

    await act(async () => {
      gate.release(HEALTHY);
      await pending;
    });

    const merged = useVariantAnalysisStore.getState().analysisState.result as any;
    // A successful synthesis replaces the retention's degraded status...
    expect(merged.metadata.pipelineStages).toEqual({ core: "complete", landscape: "complete", narrative: "complete" });
    // ...and the report is a real narrative again, with the evidence revision recorded.
    expect(merged.analysis).toContain("Fresh narrative");
    expect(merged.isFallback).toBe(false);
    expect(readNarrativeEvidenceStamp(merged)?.deepEvidenceIntegrated).toBe(true);
  });

  it("ends the stage degraded for a provider's rule-based report and error for a request that never arrived", async () => {
    mockGetNarrative.mockResolvedValue(DEGRADED);
    const degradedRun = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      await degradedRun.result.current.resynthesize();
    });
    expect(
      useVariantAnalysisStore.getState().analysisState.result?.metadata?.pipelineStages?.narrative
    ).toBe("degraded");

    loadVariant();
    mockGetNarrative.mockRejectedValue(new Error("narrative route unreachable"));
    const failedRun = renderHook(() => useNarrativeResynthesis());
    await act(async () => {
      await failedRun.result.current.resynthesize();
    });
    // The report keeps the narrative it had — the step is what failed, and the stage says so.
    expect(
      useVariantAnalysisStore.getState().analysisState.result?.metadata?.pipelineStages?.narrative
    ).toBe("error");
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

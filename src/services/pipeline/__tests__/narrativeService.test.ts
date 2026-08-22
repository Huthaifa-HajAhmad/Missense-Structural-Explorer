import { describe, it, expect, vi } from "vitest";
import { generateClinicalNarrative } from "../narrativeService";

describe("narrativeService", () => {
  it("generates narrative and updates analysis state insights", async () => {
    const mockApiClient = {
      getNarrative: vi.fn().mockResolvedValue({
        analysis: "Detailed clinical narrative explaining Arg408Trp disruption.",
        insights: {
          biochemicalShift: "Positive to hydrophobic",
          structuralImpact: "Steric clash in core",
          acmgCriteria: [{ code: "PS3", category: "pathogenic" }],
          acmgVerdict: "Likely Pathogenic"
        }
      })
    };

    const addToHistory = vi.fn();
    const setSelectedResidueIndex = vi.fn();
    let state: any = {
      result: {
        analysis: "Base analysis",
        insights: null
      }
    };
    const setAnalysisState = vi.fn((updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
    });
    const setLoadingStep = vi.fn();
    const setIsClinicalLoading = vi.fn();
    const setIsNarrativeLoading = vi.fn();
    const addTraceSpan = vi.fn();
    const finishTraceRun = vi.fn();

    await generateClinicalNarrative(
      {
        gene: "PAH",
        variant: "p.Arg408Trp",
        uniprotId: "P00439",
        settings: { acmgWeighting: {} },
        bpResult: { clinvar: { classification: "Pathogenic" } }
      },
      mockApiClient,
      { addToHistory, setSelectedResidueIndex },
      {
        setAnalysisState,
        setLoadingStep,
        setIsBiophysicalLoading: vi.fn(),
        setIsClinicalLoading,
        setIsNarrativeLoading
      },
      new AbortController().signal,
      1,
      () => 1,
      {
        activeTraceId: "t-nar",
        traceStart: performance.now(),
        addTraceSpan,
        finishTraceRun
      }
    );

    expect(addToHistory).toHaveBeenCalledWith("PAH", "p.Arg408Trp", "P00439");
    expect(setSelectedResidueIndex).toHaveBeenCalledWith(408);
    expect(setIsClinicalLoading).toHaveBeenCalledWith(false);
    expect(setIsNarrativeLoading).toHaveBeenCalledWith(true);
    expect(setIsNarrativeLoading).toHaveBeenLastCalledWith(false);
    expect(state.result.analysis).toBe("Detailed clinical narrative explaining Arg408Trp disruption.");
    expect(state.result.insights.acmgVerdict).toBe("Likely Pathogenic");
    expect(finishTraceRun).toHaveBeenCalledWith("t-nar", "completed");
  });

  it("handles failure with descriptive fallback markdown", async () => {
    const mockApiClient = {
      getNarrative: vi.fn().mockRejectedValue(new Error("Rate limit exceeded"))
    };

    let state: any = { result: { analysis: "Initial" } };
    const setAnalysisState = vi.fn((updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
    });

    await generateClinicalNarrative(
      {
        gene: "PAH",
        variant: "p.Arg408Trp",
        uniprotId: "P00439",
        settings: { acmgWeighting: {} },
        bpResult: null
      },
      mockApiClient,
      { addToHistory: vi.fn(), setSelectedResidueIndex: vi.fn() },
      {
        setAnalysisState,
        setLoadingStep: vi.fn(),
        setIsBiophysicalLoading: vi.fn(),
        setIsClinicalLoading: vi.fn(),
        setIsNarrativeLoading: vi.fn()
      },
      new AbortController().signal,
      1,
      () => 1
    );

    expect(state.result.analysis).toContain("Narrative Generation Failed");
    expect(state.result.analysis).toContain("Rate limit exceeded");
  });
});

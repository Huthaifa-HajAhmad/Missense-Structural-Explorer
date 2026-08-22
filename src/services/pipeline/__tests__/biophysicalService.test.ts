import { describe, it, expect, vi } from "vitest";
import { fetchBiophysicalAnalysis, fetchProgressiveLandscape, fetchProgressiveStructuralAssessments } from "../biophysicalService";

describe("biophysicalService", () => {
  describe("fetchBiophysicalAnalysis", () => {
    it("fetches multi-model biophysics data and emits trace", async () => {
      const mockApiClient = {
        getBiophysicalAnalysis: vi.fn().mockResolvedValue({
          analysis: "Pathogenic impact detected",
          clinvar: { classification: "Pathogenic" },
          predictorData: { reve: 0.89 }
        })
      };

      const addTraceSpan = vi.fn();
      const result = await fetchBiophysicalAnalysis(
        { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" },
        mockApiClient,
        new AbortController().signal,
        undefined,
        { activeTraceId: "t-bio", traceStart: performance.now(), addTraceSpan }
      );

      expect(result.analysis).toBe("Pathogenic impact detected");
      expect(addTraceSpan).toHaveBeenCalledWith(expect.objectContaining({ stage: "biophysics", status: "success" }));
    });
  });

  describe("fetchProgressiveLandscape", () => {
    it("progressively enriches analysisState when response arrives", async () => {
      const mockApiClient = {
        getLandscapeData: vi.fn().mockResolvedValue({ landscapeData: [{ pos: 408, score: 0.95 }] })
      };

      let state: any = { result: { analysis: "Base analysis" } };
      const setAnalysisState = vi.fn((updater) => {
        state = typeof updater === "function" ? updater(state) : updater;
      });

      fetchProgressiveLandscape(
        { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" },
        mockApiClient,
        new AbortController().signal,
        setAnalysisState,
        1,
        () => 1
      );

      // wait for microtask
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(setAnalysisState).toHaveBeenCalled();
      expect(state.result.landscapeData).toEqual([{ pos: 408, score: 0.95 }]);
    });
  });

  describe("fetchProgressiveStructuralAssessments", () => {
    it("progressively enriches structural assessments", async () => {
      const mockApiClient = {
        getStructuralAssessments: vi.fn().mockResolvedValue({
          esm3Eval: { score: 0.91 },
          esmcEval: { score: 0.88 },
          esm2Eval: { score: 0.85 },
          saprotEval: { score: 0.94 },
          ruleBasedInsights: { acmgVerdict: "Pathogenic" }
        })
      };

      let state: any = { result: { analysis: "Base analysis" } };
      const setAnalysisState = vi.fn((updater) => {
        state = typeof updater === "function" ? updater(state) : updater;
      });

      fetchProgressiveStructuralAssessments(
        { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" },
        mockApiClient,
        new AbortController().signal,
        setAnalysisState,
        1,
        () => 1
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(state.result.esm3Eval).toEqual({ score: 0.91 });
      expect(state.result.saprotEval).toEqual({ score: 0.94 });
    });
  });
});

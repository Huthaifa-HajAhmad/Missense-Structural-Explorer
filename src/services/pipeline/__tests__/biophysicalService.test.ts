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

    it("emits granular server sub-spans into the waterfall when serviceTimings is present", async () => {
      const mockApiClient = {
        getBiophysicalAnalysis: vi.fn().mockResolvedValue({
          analysis: "Pathogenic impact detected",
          serviceTimings: {
            clinvar: 210,
            predictorData: 480,
            pdbMapping: 190,
            esm2: 820,
            gnomadFrequency: 520
          },
          serviceStatus: {
            clinvar: "ok",
            predictorData: "ok",
            pdbMapping: "ok",
            esm2: "ok",
            gnomadFrequency: "error"
          }
        })
      };

      const addTraceSpan = vi.fn();
      await fetchBiophysicalAnalysis(
        { gene: "TP53", variant: "p.Arg175His", uniprotId: "P04637" },
        mockApiClient,
        new AbortController().signal,
        undefined,
        { activeTraceId: "trace-123", traceStart: performance.now(), addTraceSpan }
      );

      // Parent span
      expect(addTraceSpan).toHaveBeenCalledWith(expect.objectContaining({
        name: "Multi-Model Biophysics Suite (ESM-2, SaProt, ClinVar, gnomAD)",
        stage: "biophysics",
        status: "success"
      }));

      // Sub-spans
      expect(addTraceSpan).toHaveBeenCalledWith(expect.objectContaining({
        name: "↳ ClinVar Clinical Interpretation (NCBI E-Utilities)",
        stage: "clinical",
        durationMs: 210,
        status: "success"
      }));

      expect(addTraceSpan).toHaveBeenCalledWith(expect.objectContaining({
        name: "↳ In-Silico Pathogenicity (dbNSFP / AlphaMissense / CADD)",
        stage: "biophysics",
        durationMs: 480,
        status: "success"
      }));

      expect(addTraceSpan).toHaveBeenCalledWith(expect.objectContaining({
        name: "↳ 3D Structure Homology Search (RCSB PDB / AlphaFold)",
        stage: "structure",
        durationMs: 190,
        status: "success"
      }));

      expect(addTraceSpan).toHaveBeenCalledWith(expect.objectContaining({
        // Label updated to match `biophysicalService.ts`, which renamed "gnomAD v4.0" → "gnomAD r4"
        // (the dataset constant is `gnomad_r4`; no patch version is ever reported by the client, so
        // "v4.0.0" asserted a precision the code does not have). The waterfall name is a display
        // string duplicated between source and this expectation — if it drifts again, this is the
        // assertion that catches it.
        name: "↳ Population Allele Frequency (gnomAD r4 GraphQL)",
        stage: "clinical",
        durationMs: 520,
        status: "failed"
      }));
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

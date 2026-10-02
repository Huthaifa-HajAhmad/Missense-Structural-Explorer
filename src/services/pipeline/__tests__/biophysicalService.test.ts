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
        name: "Core evidence sources",
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

    /**
     * The canonical pair must travel BESIDE the submitted pair, never instead of it.
     *
     * The predictors query Ensembl VEP BY POSITION: a GRCh37 coordinate handed over as GRCh38 is the
     * wrong-locus hazard, and one handed over as GRCh37 is re-lifted downstream or refused by every
     * GRCh38-only source. The server verified a canonical locus before annotating, so the client must
     * forward it — with its build — while still stating exactly what the reader submitted. These two
     * tests pin both directions: present ⇒ forwarded, absent ⇒ the request body is byte-for-byte what
     * it was before this field existed.
     *
     * `coordinateLift` is deliberately NOT forwarded even when the transcript meta carries it: the
     * analysis route DERIVES the build decision from the facts (`deriveCoordinateLift`). A record
     * accepted from a caller is not evidence — anyone could post one claiming a verified lift — so
     * the client sends facts and lets the server write the interpretation.
     */
    it("forwards the verified canonical pair beside the submitted pair, but not the decision record", async () => {
      /**
       * The coordinate is a REAL lift: `Chr1(GRCh37):g.1256452C>A` → `Chr1(GRCh38):g.1321072C>A`
       * (the INTS11/CPSF3L locus), which is what the server can actually emit. The previous fixture
       * lifted an INDEL (`7-117199644-ATCT-A` → `7-117548628-ATCT-A`), which `liftover.ts` REFUSES —
       * it lifts single-base substitutions only, because an indel has no single position to lift and
       * an approximated one would be a different variant. A fixture the server can never produce
       * certifies the forwarding code against a shape no reader will ever see.
       */
      const coordinateLift = {
        status: "lifted" as const,
        fromAssembly: "GRCh37" as const,
        toAssembly: "GRCh38" as const,
        fromCoordinates: "1-1256452-C-A",
        toCoordinates: "1-1321072-C-A",
        reverseVerified: true
      };
      const getBiophysicalAnalysis = vi.fn().mockResolvedValue({ analysis: "ok" });

      await fetchBiophysicalAnalysis(
        {
          gene: "CFTR",
          variant: "p.Phe508del",
          uniprotId: "P13569",
          assembly: "GRCh37",
          genomicCoordinates: "1-1256452-C-A",
          resolvedAssembly: "GRCh38",
          liftedGenomicCoordinates: "1-1321072-C-A",
          coordinateLift
        } as any,
        { getBiophysicalAnalysis },
        new AbortController().signal
      );

      const body = getBiophysicalAnalysis.mock.calls[0][0];
      // The submitted pair is untouched …
      expect(body.assembly).toBe("GRCh37");
      expect(body.genomicCoordinates).toBe("1-1256452-C-A");
      // … and the canonical pair is stated alongside it, with its own build.
      expect(body.resolvedAssembly).toBe("GRCh38");
      expect(body.liftedGenomicCoordinates).toBe("1-1321072-C-A");
      // … and the caller's own claim about the lift is NOT sent.
      expect(body.coordinateLift).toBeUndefined();
    });

    it("forwards nothing extra when the transcript meta carries no build trail", async () => {
      const getBiophysicalAnalysis = vi.fn().mockResolvedValue({ analysis: "ok" });

      await fetchBiophysicalAnalysis(
        { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" },
        { getBiophysicalAnalysis },
        new AbortController().signal
      );

      const body = getBiophysicalAnalysis.mock.calls[0][0];
      expect(Object.keys(body).sort()).toEqual(["gene", "uniprotId", "variant"]);
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

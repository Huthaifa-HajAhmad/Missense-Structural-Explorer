import { describe, it, expect } from "vitest";
import {
  createAnalysisVersion,
  createPlaceholderAnalysisState,
  createCompletedAnalysisState,
  createBiophysicalErrorAnalysisState,
  createTopLevelErrorAnalysisState,
  createDemoFallbackAnalysisState
} from "../pipelineStateFactory";

describe("pipelineStateFactory", () => {
  const baseParams = {
    gene: "PAH",
    variant: "p.Arg408Trp",
    uniprotId: "P00439",
    residueIndex: 408,
    wildType: "Arg",
    mutant: "Trp",
    transcriptMeta: {
      transcriptId: "ENST00000335062",
      isManeSelect: true,
      isCanonical: true,
      maneRefSeqId: "NM_000277.3"
    }
  };

  it("creates standard analysis version metadata", () => {
    const version = createAnalysisVersion();
    expect(version.thresholds).toBe("ACMG v1.0.0-concordance");
    expect(version.geminiModel).toBe("gemini-3.5-flash");
    expect(version.foldxVersion).toBe("FoldX 5.0");
    expect(typeof version.timestamp).toBe("string");
  });

  it("creates placeholder analysis state with pending deep model evaluators", () => {
    const state = createPlaceholderAnalysisState(baseParams);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.result.analysis).toBe("Biophysical analysis in progress...");
    expect(state.result.metadata.gene).toBe("PAH");
    expect(state.result.metadata.wildType).toBe("Arg");
    expect(state.result.transcriptId).toBe("ENST00000335062");
    expect(state.result.isManeSelect).toBe(true);
  });

  it("creates completed analysis state and safely merges partial backend metadata", () => {
    const resResult = {
      analysis: "High pathogenic risk.",
      insights: { biochemicalShift: "Polar to hydrophobic" },
      predictorData: { reveScore: 0.95 },
      gnomadConstraint: { misZ: 2.1 },
      metadata: {
        sequence: "MSAQ...",
        customAnnotation: "ClinVar Verified"
      }
    };

    const state = createCompletedAnalysisState(resResult, baseParams);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.result.analysis).toBe("High pathogenic risk.");
    expect(state.result.insights).toEqual({ biochemicalShift: "Polar to hydrophobic" });
    expect(state.result.predictorData).toEqual({ reveScore: 0.95 });
    expect(state.result.gnomadConstraint).toEqual({ misZ: 2.1 });
    // Verify base metadata preserved alongside partial backend metadata
    expect(state.result.metadata.gene).toBe("PAH");
    expect(state.result.metadata.variant).toBe("p.Arg408Trp");
    expect(state.result.metadata.wildType).toBe("Arg");
    expect(state.result.metadata.mutant).toBe("Trp");
    expect(state.result.metadata.customAnnotation).toBe("ClinVar Verified");
    expect(state.result.metadata.analysisVersion.geminiModel).toBe("gemini-3.5-flash");
    // Verify deep model evaluation flags
    expect(state.result.esm3Eval).toEqual({ loading: true });
    expect(state.result.esmcEval).toEqual({ loading: true });
    expect(state.result.esm2Eval).toEqual({ loading: true });
    expect(state.result.saprotEval).toEqual({ loading: true });
  });

  it("creates biophysical error state with informative messages and safe defaults", () => {
    const state = createBiophysicalErrorAnalysisState("Network timeout", baseParams);
    expect(state.isLoading).toBe(false);
    expect(state.error).toContain("Biophysical predictor data query failed: Network timeout");
    expect(state.result.analysis).toBe("Biophysical analysis data unavailable.");
    expect(state.result.disruptionPredictor.level).toBe("unknown");
  });

  it("creates top-level error state with fallback diagnostic insights", () => {
    const state = createTopLevelErrorAnalysisState("Service Unavailable", baseParams);
    expect(state.isLoading).toBe(false);
    expect(state.error).toContain("Analysis query error: Service Unavailable");
    expect(state.result.insights.biochemicalShift).toContain("Biochemical Shift Unavailable");
    expect(state.result.insights.acmgCriteria).toEqual([]);
  });

  it("creates demo fallback state with full schema compliance", () => {
    const state = createDemoFallbackAnalysisState("Precomputed demo analysis", { shift: "Severe" }, baseParams);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.result.isDemoData).toBe(true);
    expect(state.result.analysis).toBe("Precomputed demo analysis");
    expect(state.result.insights).toEqual({ shift: "Severe" });
    expect(state.result.predictorData).toBeNull();
    expect(state.result.conservationData).toBeNull();
    expect(state.result.disruptionPredictor).toEqual({ level: "low", reason: "Default", plddt: 100 });
    expect(state.result.transcriptId).toBe("ENST00000335062");
  });

  /**
   * The genome-build trail must reach a PLACEHOLDER result, not only a completed one.
   *
   * The placeholder is what the reader sees while the fine-grained data loads. Before the build
   * trail was copied, a surface had to infer a build during that window — which is exactly how a
   * panel came to certify GRCh38 beside an HG19 chip. All FOUR fields travel together because they
   * only mean anything as a set: the submitted build, the build the annotation came from, the
   * verified canonical locus, and the decision that connects them.
   */
  describe("genome-build trail", () => {
    const lift = {
      status: "lifted" as const,
      fromAssembly: "GRCh37" as const,
      toAssembly: "GRCh38" as const,
      fromCoordinates: "1-1256452-C-A",
      toCoordinates: "1-1321072-C-A",
      reverseVerified: true
    };

    it("carries all four build-trail fields into a placeholder result", () => {
      const state = createPlaceholderAnalysisState({
        ...baseParams,
        transcriptMeta: {
          ...baseParams.transcriptMeta,
          assembly: "GRCh37",
          resolvedAssembly: "GRCh38",
          liftedGenomicCoordinates: "1-1321072-C-A",
          coordinateLift: lift
        }
      });

      expect(state.result.assembly).toBe("GRCh37");
      expect(state.result.resolvedAssembly).toBe("GRCh38");
      expect(state.result.liftedGenomicCoordinates).toBe("1-1321072-C-A");
      expect(state.result.coordinateLift).toEqual(lift);
    });

    /**
     * Copied as a GROUP from ONE source.
     *
     * A per-field fallback (`transcriptMeta.assembly ?? resResult.assembly`, then
     * `transcriptMeta.resolvedAssembly ?? resResult.resolvedAssembly`) pairs one source's
     * SUBMITTED build with the OTHER's resolved build — a trail that never existed, rendered as a
     * verified lift. The translation meta wins wholesale whenever it states anything, so a mixed
     * pair cannot be assembled from a response that disagrees with it.
     */
    it("never mixes a transcript meta build with a different resolved build from the response", () => {
      const state = createCompletedAnalysisState(
        {
          analysis: "High pathogenic risk.",
          resolvedAssembly: "GRCh38",
          liftedGenomicCoordinates: "1-1321072-C-A",
          coordinateLift: lift
        },
        {
          ...baseParams,
          transcriptMeta: {
            ...baseParams.transcriptMeta,
            // The translation meta states the SUBMITTED build only…
            assembly: "GRCh37"
          }
        }
      );

      expect(state.result.assembly).toBe("GRCh37");
      // …so the response's resolved build is NOT borrowed to complete the pair.
      expect(state.result.resolvedAssembly).toBeUndefined();
      expect(state.result.liftedGenomicCoordinates).toBeUndefined();
      expect(state.result.coordinateLift).toBeUndefined();
    });

    it("leaves an empty trail empty rather than defaulting a build", () => {
      const state = createPlaceholderAnalysisState(baseParams);

      expect(state.result.assembly).toBeUndefined();
      expect(state.result.resolvedAssembly).toBeUndefined();
      expect(state.result.liftedGenomicCoordinates).toBeUndefined();
      expect(state.result.coordinateLift).toBeUndefined();
    });
  });
});

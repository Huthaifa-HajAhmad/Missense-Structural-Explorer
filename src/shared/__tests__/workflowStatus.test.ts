import { describe, it, expect } from "vitest";
import { getWorkflowStageStatus } from "../workflowStatus.ts";
import type { AnalysisResult } from "../contracts.ts";

describe("workflowStatus Helper Unit Tests (C-7)", () => {
  it("should return complete status when view is 'search'", () => {
    const status = getWorkflowStageStatus("search", null, false, false, false);
    expect(status.status).toBe("complete");
    expect(status.desc).toBe("Variant search workspace active");
  });

  it("should return correct statuses when search is running", () => {
    const runningStatus1 = getWorkflowStageStatus("evidence", null, false, false, false, true, "Step 1/4: Querying clinical data");
    expect(runningStatus1.status).toBe("progress");
    expect(runningStatus1.desc).toBe("Step 1/4: Querying clinical data");

    const runningStatus2 = getWorkflowStageStatus("energetics", null, false, false, false, true, "Step 4/4: Biophysics");
    expect(runningStatus2.status).toBe("progress");
  });

  it("should return correct statuses when result is loaded and tasks are finished", () => {
    const mockResult: AnalysisResult = {
      clinvar: { 
        classification: "pathogenic", 
        lastEvaluated: "", 
        reviewStatus: "", 
        alleleFrequencies: [], 
        trait: "", 
        uid: null 
      },
      foldingEnergetics: { 
        foldx: 2.5,
        dynamut2: null,
        ddmut: null,
        rasp: null,
        thermompnn: null
      }
    };

    const status1 = getWorkflowStageStatus("evidence", mockResult, false, false, false);
    expect(status1.status).toBe("complete");
    expect(status1.desc).toContain("ClinVar: pathogenic");

    const status2 = getWorkflowStageStatus("energetics", mockResult, false, false, false);
    expect(status2.status).toBe("complete");
  });

  it("P1-12: energetics gate must NOT block on FoldX when only the Gemini biophysical result is present", () => {
    const geminiOnlyResult: AnalysisResult = {
      analysis: "AI biophysical assessment available.",
      biophysicalEnergetics: { predictedStabilityChange: "destabilizing" } as any
    };

    // FoldX job still running (isFolding=true) AND predictors pending — the tab must still
    // be "complete" because the Gemini narrative resolved (async-chip decision).
    const status = getWorkflowStageStatus(
      "energetics",
      geminiOnlyResult,
      /* isFolding */ true,
      /* isBiophysicalLoading */ false,
      /* isClinicalLoading */ false,
      undefined,
      undefined,
      undefined,
      /* dynamut2Status */ "pending",
      /* ddmutStatus */ "pending"
    );

    expect(status.status).toBe("complete");
    expect(status.desc).toContain("Biophysical stability models active");
  });

  it("P1-12: energetics gate shows progress only while the initial biophysical call is in flight and nothing has resolved", () => {
    const status = getWorkflowStageStatus(
      "energetics",
      { analysis: null } as any,
      /* isFolding */ false,
      /* isBiophysicalLoading */ true,
      /* isClinicalLoading */ false
    );
    expect(status.status).toBe("progress");
  });

  it("P1-12: insights tab is gated on the narrative loader only, not on FoldX liveness", () => {
    const insightsResult: AnalysisResult = {
      analysis: "Consensus narrative ready."
    };

    // FoldX dead (job failed) but narrative finished — tab must be complete.
    const notLoading = getWorkflowStageStatus(
      "insights",
      insightsResult,
      /* isFolding */ false,
      /* isBiophysicalLoading */ false,
      /* isClinicalLoading */ false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      /* isNarrativeLoading */ false
    );
    expect(notLoading.status).toBe("complete");

    const loading = getWorkflowStageStatus(
      "insights",
      insightsResult,
      false, false, false,
      undefined, undefined, undefined, undefined, undefined,
      /* isNarrativeLoading */ true
    );
    expect(loading.status).toBe("progress");
  });

  it("should mark insights, literature, and report stages as complete for cached/completed variants", () => {
    const cachedResult: AnalysisResult = {
      analysis: "Full clinical narrative cached.",
      insights: { pathogenicityScore: 0.95 } as any,
      clinvar: { classification: "Pathogenic" } as any,
      foldingEnergetics: { foldx: 2.5 } as any,
      landscapeData: [{ position: 1, score: 0.8 }] as any
    };

    const insightsStatus = getWorkflowStageStatus("insights", cachedResult, false, false, false, false, undefined, false, null, null, false);
    expect(insightsStatus.status).toBe("complete");

    const litStatus = getWorkflowStageStatus("literature", cachedResult, false, false, false, false, undefined, false, null, null, false);
    expect(litStatus.status).toBe("complete");
    expect(litStatus.desc).toContain("citations indexed");

    const reportStatus = getWorkflowStageStatus("report", cachedResult, false, false, false, false, undefined, false, null, null, false);
    expect(reportStatus.status).toBe("complete");
  });

  it("should NOT mark energetics, report, or literature as complete when placeholder analysis is present and biophysics/clinical is still loading", () => {
    const placeholderResult: AnalysisResult = {
      analysis: "Biophysical analysis in progress...",
      insights: null,
      clinvar: null,
      foldingEnergetics: null,
      landscapeData: null
    };

    // When biophysical & clinical are loading and 3D repacking is active:
    const evidenceStatus = getWorkflowStageStatus("evidence", placeholderResult, true, true, true);
    expect(evidenceStatus.status).toBe("progress");

    const structureStatus = getWorkflowStageStatus("structure", placeholderResult, true, true, true);
    expect(structureStatus.status).toBe("progress");

    const energeticsStatus = getWorkflowStageStatus("energetics", placeholderResult, true, true, true);
    expect(energeticsStatus.status).toBe("progress");
    expect(energeticsStatus.status).not.toBe("complete");

    const landscapeStatus = getWorkflowStageStatus("landscape", placeholderResult, true, true, true);
    expect(landscapeStatus.status).toBe("progress");

    const insightsStatus = getWorkflowStageStatus("insights", placeholderResult, true, true, true);
    expect(insightsStatus.status).toBe("pending");
    expect(insightsStatus.status).not.toBe("complete");

    const literatureStatus = getWorkflowStageStatus("literature", placeholderResult, true, true, true);
    expect(literatureStatus.status).toBe("progress");
    expect(literatureStatus.status).not.toBe("complete");

    const reportStatus = getWorkflowStageStatus("report", placeholderResult, true, true, true);
    expect(reportStatus.status).toBe("pending");
    expect(reportStatus.status).not.toBe("complete");
  });

  it("should mark structure stage as complete when AlphaFold coordinates have loaded with metadata and isFolding is false", () => {
    const warmupResult: AnalysisResult = {
      analysis: "Biophysical analysis in progress...",
      metadata: {
        uniprotId: "Q9H116",
        gene: "GZF1",
        variant: "p.Arg591Trp"
      }
    } as any;

    const structureStatus = getWorkflowStageStatus({
      view: "structure",
      result: warmupResult,
      isFolding: false,
      isPocketLoading: false
    });
    expect(structureStatus.status).toBe("complete");
    expect(structureStatus.desc).toContain("coordinates ready");
  });

  it("should show report stage in progress when isNarrativeLoading is true on fresh runs", () => {
    const inProgressResult: AnalysisResult = {
      analysis: "Biophysical analysis in progress...",
      metadata: { uniprotId: "Q9H116" }
    } as any;

    const reportStatus = getWorkflowStageStatus({
      view: "report",
      result: inProgressResult,
      isNarrativeLoading: true,
      isBiophysicalLoading: false,
      isClinicalLoading: false
    });
    expect(reportStatus.status).toBe("progress");
    expect(reportStatus.desc).toContain("Compiling clinical summary");
  });

  it("should mark insights and report as degraded or error when narrative generation fails", () => {
    const failedResult: AnalysisResult = {
      analysis: "### ❌ Narrative Generation Failed\n\nAn error occurred while communicating with Gemini: rate limit exceeded."
    } as any;

    const insightsStatus = getWorkflowStageStatus({
      view: "insights",
      result: failedResult,
      isNarrativeLoading: false
    });
    expect(insightsStatus.status).toBe("degraded");
    expect(insightsStatus.status).not.toBe("complete");

    const reportStatus = getWorkflowStageStatus({
      view: "report",
      result: failedResult,
      isNarrativeLoading: false
    });
    expect(reportStatus.status).toBe("error");
    expect(reportStatus.status).not.toBe("complete");
  });
});



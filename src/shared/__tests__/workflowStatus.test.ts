import { describe, it, expect } from "vitest";
import { getWorkflowStageStatus } from "../workflowStatus.ts";
import { AnalysisResult } from "../../types.ts";

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
    expect(status.desc).toContain("Gemini");
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
});

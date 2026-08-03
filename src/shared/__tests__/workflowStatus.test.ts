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
});

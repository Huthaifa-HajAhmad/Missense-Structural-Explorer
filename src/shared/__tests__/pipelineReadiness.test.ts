import { describe, it, expect } from "vitest";
import { getWorkflowStageStatus } from "../workflowStatus";

describe("independent workspace readiness", () => {
  it("does not infer loaded coordinates from UniProt or narrative", () => {
    const status = getWorkflowStageStatus({ view: "structure", result: { metadata: { uniprotId: "P00439" }, analysis: "AI prose" } as any });
    expect(status.status).toBe("pending");
  });
  it("does not infer energetic measurements from narrative", () => {
    expect(getWorkflowStageStatus({ view: "energetics", result: { analysis: "AI prose" } as any }).status).toBe("pending");
  });
  it("exports evidence while optional narrative is running", () => {
    const result = { ruleBasedInsights: { acmgVerdict: "Uncertain Significance" }, metadata: { pipelineStages: { core: "complete" } } } as any;
    expect(getWorkflowStageStatus({ view: "report", result, isNarrativeLoading: true })).toEqual({ status: "complete", desc: "Evidence report ready · Optional AI running" });
    expect(getWorkflowStageStatus({ view: "insights", result, isNarrativeLoading: true }).status).toBe("complete");
  });
  it("only reports literature complete after an actual query", () => {
    const result = { metadata: { pipelineStages: { literature: "complete" } } } as any;
    expect(getWorkflowStageStatus({ view: "literature", result }).status).toBe("complete");
  });
  it("shows landscape errors independently of completed core", () => {
    const result = { metadata: { pipelineStages: { core: "complete", landscape: "error" } } } as any;
    expect(getWorkflowStageStatus({ view: "landscape", result }).status).toBe("degraded");
  });
});

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
    // Complete evidence fixture: advisor Must-fix #3 requires navigation to report gaps when required
    // lanes are unassessed, and report complete (with optional AI note) when all lanes settled.
    const result = {
      metadata: { gene: "TP53", variant: "p.Arg175His", uniprotId: "P04637", pipelineStages: { core: "complete" } },
      ruleBasedInsights: { acmgVerdict: "Uncertain Significance", acmgCriteria: [] },
      predictorData: { caddPhred: 28.4 },
      conservationData: { revel: 0.4, spliceai: { max_ds: 0.01, ds_ag: 0.01, ds_al: 0, ds_dg: 0, ds_dl: 0 } },
      gnomadFrequency: { maxAF: 0.002, groupMaxAF: 0.002, exomeAF: 0.002, exomeAC: 20, exomeAN: 10000 },
      serviceStatus: { gnomadFrequency: "ok", uniprotFeatures: "ok" },
      uniprotFeatures: { features: [], subunitComment: "Homotetramer." },
      foldingEnergetics: { foldx: 2.5 },
    } as any;
    expect(getWorkflowStageStatus({ view: "report", result, isNarrativeLoading: true })).toEqual({ status: "complete", desc: "Complete · Optional AI running" });
    expect(getWorkflowStageStatus({ view: "insights", result, isNarrativeLoading: true })).toEqual({ status: "complete", desc: "Complete · Optional AI running" });
    // And a payload with missing evidence lanes still reports degraded/gaps rather than complete.
    const gapped = { ruleBasedInsights: { acmgVerdict: "Uncertain Significance" }, metadata: { pipelineStages: { core: "complete" } } } as any;
    expect(getWorkflowStageStatus({ view: "report", result: gapped, isNarrativeLoading: true }).status).toBe("degraded");
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

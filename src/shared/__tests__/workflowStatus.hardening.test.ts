import { describe, expect, it } from "vitest";
import { getWorkflowStageStatus, hasRealAnalysis, summarizeWorkflowStatuses } from "../workflowStatus";

const result = { metadata: { gene: "SLC12A4", variant: "p.Gln867His", uniprotId: "Q9UP95", pipelineStages: { core: "complete" } } } as any;
describe("truthful pipeline outcomes", () => {
  it("does not treat blank optional prose as completed analysis", () => {
    expect(hasRealAnalysis({ analysis: "  " })).toBe(false);
  });
  it("reads live energetics independently of the core result", () => {
    expect(getWorkflowStageStatus({ view: "energetics", result, foldingEnergetics: { foldx: 0 }, foldingStatus: "success" })).toEqual({ status: "complete", desc: "ΔΔG = 0.00 kcal/mol · Available" });
  });
  it("does not mark an empty or non-finite energetics object complete", () => {
    for (const energetics of [{}, { foldx: NaN }, { ddmut: Infinity }]) {
      expect(getWorkflowStageStatus({ view: "energetics", result, foldingEnergetics: energetics }).status).toBe("unavailable");
    }
  });
  it("settles all three failed engines instead of leaving Energetics pending", () => {
    const status = getWorkflowStageStatus({ view: "energetics", result, foldingStatus: "failed", foldingError: "Box64 Signal 11", dynamut2Status: "unavailable", ddmutStatus: "unavailable" });
    expect(status.status).toBe("error");
    expect(status.desc).toContain("FoldX");
    expect(status.desc).toContain("DynaMut2");
    expect(status.desc).toContain("DDMut");
  });
  it("retains partial numeric evidence while disclosing other engine failures", () => {
    const status = getWorkflowStageStatus({ view: "energetics", result, foldingEnergetics: { dynamut2: -1.25 }, foldingStatus: "failed", foldingError: "Native crash", ddmutStatus: "unavailable" });
    expect(status.status).toBe("degraded");
    expect(status.desc).toContain("+1.25");
  });
  it("keeps only actually pending remote engines running after FoldX settles", () => {
    expect(getWorkflowStageStatus({ view: "energetics", result, isFolding: false, dynamut2Status: "pending" }).status).toBe("progress");
  });
  it("marks an empty completed Landscape and a skipped source unavailable", () => {
    for (const outcome of ["complete", "skipped"]) {
      expect(getWorkflowStageStatus({ view: "landscape", result: { ...result, landscapeData: [], metadata: { pipelineStages: { landscape: outcome } } } }).status).toBe("unavailable");
    }
  });
  it("does not advertise three different coordinate sources from one loaded structure", () => {
    const status = getWorkflowStageStatus({ view: "structure", result, hasStructureCoordinates: true });
    expect(status.desc).toBe("Protein 3D coordinates ready");
  });
  it("settles an unsuccessful coordinates lookup independently of successful core", () => {
    expect(getWorkflowStageStatus({ view: "structure", result: { ...result, metadata: { pipelineStages: { core: "complete", coordinates: "degraded" } } } }).status).toBe("unavailable");
  });
  it("counts terminal failures but excludes literature until the reader requests it", () => {
    expect(summarizeWorkflowStatuses(["complete", "error", "unavailable", "on-demand"])).toEqual({ settled: 3, total: 3, percent: 100, hasProblems: true });
  });
  it("does not infer concurrent Landscape execution from a legacy step number", () => {
    expect(getWorkflowStageStatus({ view: "landscape", isLoadingSearch: true, loadingStep: "Step 4/4: Biophysics" }).status).toBe("pending");
  });
});

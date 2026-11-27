import { describe, expect, it } from "vitest";
import { getWorkflowStageStatus, hasRealAnalysis, summarizeWorkflowStatuses } from "../workflowStatus";

const result = { metadata: { gene: "SLC12A4", variant: "p.Gln867His", uniprotId: "Q9UP95", pipelineStages: { core: "complete" } } } as any;
describe("truthful pipeline outcomes", () => {
  it("does not treat blank optional prose as completed analysis", () => {
    expect(hasRealAnalysis({ analysis: "  " })).toBe(false);
  });
  it("reads live energetics independently of the core result", () => {
    expect(getWorkflowStageStatus({ view: "energetics", result, foldingEnergetics: { foldx: 0 }, foldingStatus: "success" })).toEqual({ status: "complete", desc: "FoldX ΔΔG = 0.00 kcal/mol · Available" });
  });
  // UROD p.Gly318Arg: a bundle saved before FoldX returned. The rail read "ΔΔG = +0.53 kcal/mol ·
  // Available" — a secondary engine's value on a stage it called complete. It now reports the
  // consensus it actually has (the median, with its count) and still names FoldX's absence.
  it("does not show a median while an engine is still running", () => {
    const energetics = { rasp: -1.4533, thermompnn: -0.106, stabilityoracle: -0.5034, stabilityoracleStatus: "done", raspStatus: "done" };
    const status = getWorkflowStageStatus({ view: "energetics", result, foldingEnergetics: energetics, thermompnnStatus: "done", isFolding: true });
    expect(status.desc).not.toContain("Median ΔΔG");
  });
  it("does not show a median when the engines withhold a stability conclusion", () => {
    const lowConfidence = { ...result, disruptionPredictor: { plddt: 20 } } as any;
    const energetics = { rasp: -1.4533, thermompnn: -0.106, stabilityoracle: -0.5034, stabilityoracleStatus: "done", raspStatus: "done", structureProvenance: { source: "alphafold" } };
    const status = getWorkflowStageStatus({ view: "energetics", result: lowConfidence, foldingEnergetics: energetics, thermompnnStatus: "done" });
    expect(status.desc).not.toContain("Median ΔΔG");
  });
  it("shows the median with its engine count and degrades the stage when FoldX has no value", () => {
    const energetics = { rasp: -1.4533, thermompnn: -0.106, stabilityoracle: -0.5034, stabilityoracleStatus: "done", raspStatus: "done" };
    const status = getWorkflowStageStatus({ view: "energetics", result, foldingEnergetics: energetics, thermompnnStatus: "done" });
    expect(status.status).toBe("degraded");
    expect(status.desc).toBe("Median ΔΔG = -0.50 kcal/mol (3 engines) · FoldX: no result");
  });
  it("names ProtVar's FoldX when it is the stand-in reading", () => {
    const status = getWorkflowStageStatus({
      view: "energetics",
      result,
      foldingEnergetics: { foldx: null, foldxMean: null, protvar: 1.9, structureProvenance: { source: "alphafold" } },
      foldingStatus: "failed",
      thermompnnStatus: "unavailable",
    });
    expect(status.desc).toContain("ProtVar FoldX ΔΔG = +1.90 kcal/mol");
  });
  it("does not mark an empty or non-finite energetics object complete", () => {
    for (const energetics of [{}, { foldx: NaN }, { thermompnn: Infinity }]) {
      expect(getWorkflowStageStatus({ view: "energetics", result, foldingEnergetics: energetics }).status).toBe("unavailable");
    }
  });
  it("settles failed engines instead of leaving Energetics pending", () => {
    const status = getWorkflowStageStatus({
      view: "energetics",
      result,
      foldingStatus: "failed",
      foldingError: "Box64 Signal 11",
      foldingEnergetics: { stabilityoracleStatus: "error" },
      thermompnnStatus: "error",
    });
    expect(status.status).toBe("error");
    expect(status.desc).toContain("FoldX");
    expect(status.desc).toContain("ThermoMPNN");
    expect(status.desc).toContain("StabilityOracle");
  });
  it("retains partial numeric evidence while disclosing other engine failures", () => {
    const status = getWorkflowStageStatus({ view: "energetics", result, foldingEnergetics: { thermompnn: 1.25 }, foldingStatus: "failed", foldingError: "Native crash", thermompnnStatus: "done" });
    expect(status.status).toBe("degraded");
    expect(status.desc).toContain("+1.25");
  });
  it("keeps only actually pending remote engines running after FoldX settles", () => {
    expect(getWorkflowStageStatus({ view: "energetics", result, isFolding: false, thermompnnStatus: "pending" }).status).toBe("progress");
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
  it("marks Energetics degraded when ThermoMPNN reports busy alongside FoldX", () => {
    const withFoldx = getWorkflowStageStatus({
      view: "energetics",
      result,
      foldingEnergetics: { foldx: 1.44 },
      foldingStatus: "success",
      thermompnnStatus: "busy",
      thermompnnError: "ThermoMPNN did not answer within 150 s.",
    });
    expect(withFoldx.status).toBe("degraded");
    expect(withFoldx.desc).toBe("FoldX ΔΔG = +1.44 kcal/mol · Some engines unavailable");

    const busyOnly = getWorkflowStageStatus({
      view: "energetics",
      result,
      thermompnnStatus: "busy",
      thermompnnError: "ThermoMPNN did not answer within 150 s.",
    });
    expect(busyOnly.status).toBe("error");
    expect(busyOnly.desc).toContain("ThermoMPNN");
  });

  it("reports whole-protein loading honestly when window residues are ready but overview is fetching", () => {
    const singleResidueStatus = getWorkflowStageStatus({
      view: "landscape",
      result: { ...result, landscapeData: [{ pos: 1 }] },
      landscapeOverviewStatus: "loading"
    });
    expect(singleResidueStatus.status).toBe("progress");
    expect(singleResidueStatus.desc).toBe("1 residue ready · Loading whole protein...");

    const multiResidueStatus = getWorkflowStageStatus({
      view: "landscape",
      result: { ...result, landscapeData: [{ pos: 1 }, { pos: 2 }] },
      landscapeOverviewStatus: "loading"
    });
    expect(multiResidueStatus.status).toBe("progress");
    expect(multiResidueStatus.desc).toBe("2 residues ready · Loading whole protein...");
  });
});

for (const view of ["insights", "report"]) it(`${view} names population gaps and local FoldX work`, () => {
 const result = { metadata: { gene: "ABCG1" }, ruleBasedInsights: { acmgCriteria: [], acmgVerdict: "Uncertain" } } as any;
 const settled = getWorkflowStageStatus({ view, result });
 expect(settled.status).toBe("degraded");
 expect(settled.desc).toContain("Population (not assessed)");
 const running = getWorkflowStageStatus({ view, result, isFolding: true });
 expect(running.status).toBe("progress");
});

for (const view of ["insights", "report"]) it(`${view} reports gaps instead of complete when ruleBasedInsights is missing`, () => {
 const result = {
  metadata: { gene: "TP53", pipelineStages: { core: "complete" } },
  clinvar: { classification: "Pathogenic" },
  predictorData: { caddPhred: 28.4 },
 } as any;
 const status = getWorkflowStageStatus({ view, result });
 expect(status.status).toBe("degraded");
 expect(status.desc).toContain("Rule-engine record (not recorded)");
});

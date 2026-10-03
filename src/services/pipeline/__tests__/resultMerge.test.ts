import { describe, it, expect } from "vitest";
import { mergeResultPatch, mergeCompletedCore, hasReusableCoreEvidence } from "../resultMerge";
import { createCompletedAnalysisState } from "../pipelineStateFactory";

const base = { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" };
const core = () => createCompletedAnalysisState({ predictorData: { revel: 0.8 }, metadata: { sequence: "MR" }, serviceStatus: { clinvar: "not_found" } }, base);

describe("stage-owned result merging", () => {
  it("retains enrichment that arrives before final core", () => {
    let state = mergeResultPatch({ result: null, isLoading: true }, { landscapeData: [{ position: 408 }], multimerData: { available: true }, esm2Eval: { llr: -1 } }, base, "structural", "complete");
    state = mergeCompletedCore(state, core(), base);
    expect(state.result.landscapeData).toEqual([{ position: 408 }]);
    expect(state.result.multimerData).toEqual({ available: true });
    expect(state.result.esm2Eval).toEqual({ llr: -1 });
    expect(state.result.predictorData.revel).toBe(0.8);
    expect(state.isLoading).toBe(false);
  });
  it("retains core that arrives before enrichment", () => {
    const state = mergeResultPatch(core(), { landscapeData: [] }, base, "landscape", "complete");
    expect(state.result.predictorData.revel).toBe(0.8);
    expect(state.result.metadata.pipelineStages.landscape).toBe("complete");
  });
  it("merges source outcomes from both metadata and top-level patches", () => {
    const first = mergeResultPatch(core(), { serviceStatus: { saprot: "ok" } }, base, "structural", "complete");
    const state = mergeResultPatch(first, { metadata: { serviceStatus: { clinvar: "timeout" } } });
    expect(state.result.serviceStatus).toEqual({ clinvar: "timeout", saprot: "ok" });
    expect(state.result.metadata.serviceStatus).toEqual(state.result.serviceStatus);
  });
  it("does not replace the enriched ACMG snapshot with earlier core", () => {
    const enriched = { acmgVerdict: "Uncertain Significance", acmgCriteria: [] };
    const state = mergeCompletedCore(mergeResultPatch(core(), { ruleBasedInsights: enriched }, base, "structural", "degraded"), core(), base);
    expect(state.result.ruleBasedInsights).toBe(enriched);
  });
  it("does not fabricate narrative text at core completion", () => {
    expect(core().result.analysis).toBe("");
  });
  it.each(["running", "error", "skipped"])("never reuses %s core because optional prose exists", stage => {
    expect(hasReusableCoreEvidence({ analysis: "A completed optional summary", metadata: { pipelineStages: { core: stage } } })).toBe(false);
  });
  it("reuses declared completed evidence without requiring optional prose", () => {
    expect(hasReusableCoreEvidence({ analysis: "", metadata: { pipelineStages: { core: "complete" } } })).toBe(true);
    expect(hasReusableCoreEvidence({ analysis: "", numberingChoices: [{}], metadata: { pipelineStages: { core: "complete" } } })).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { getWorkflowStageStatus, hasRealAnalysis, isAnalysisFailed, summarizeRunStages } from "../workflowStatus";
import { serviceStatusOf } from "../serviceStatus";
import { geminiCredentials } from "../geminiCredentials";

const finishedNoAccession: any = { ruleBasedInsights: null, metadata: { uniprotId: "", pipelineStages: { core: "complete" } } };

describe("a stage may not wait after the run has ended", () => {
  it.each(["structure", "landscape", "insights"])("%s is settled as unavailable once core finished with nothing for it", view => {
    expect(getWorkflowStageStatus({ view, result: finishedNoAccession }).status).toBe("unavailable");
  });

  it("names the missing accession as the reason", () => {
    expect(getWorkflowStageStatus({ view: "structure", result: finishedNoAccession }).desc).toMatch(/accession/i);
  });

  it("still waits while core is running", () => {
    const running: any = { metadata: { pipelineStages: { core: "running" } } };
    expect(getWorkflowStageStatus({ view: "landscape", result: running }).status).toBe("pending");
  });
});

describe("the idle Energetics row", () => {
  it("describes the stage like every other idle row", () => {
    expect(getWorkflowStageStatus({ view: "energetics" }).desc).toBe("FoldX, DynaMut2 & DDMut stability engines");
  });

  it("still says it is waiting once a search is running", () => {
    expect(getWorkflowStageStatus({ view: "energetics", isLoadingSearch: true }).desc).toMatch(/Awaiting/);
  });
});

describe("the narrative's status comes from its stage, not its wording", () => {
  const narrative = (analysis: string, stage?: string): any => ({ analysis, metadata: { pipelineStages: stage ? { narrative: stage } : {} } });

  it("accepts a finished narrative that happens to say 'unavailable'", () => {
    expect(hasRealAnalysis(narrative("Crystal data are unavailable here, yet the change is damaging.", "complete"))).toBe(true);
  });

  it("does not call a finished narrative failed for quoting an error", () => {
    expect(isAnalysisFailed(narrative("A processing error occurred in the protein.", "complete"))).toBe(false);
  });

  it("treats a degraded narrative as failed whatever it says", () => {
    expect(isAnalysisFailed(narrative("Looks fine.", "degraded"))).toBe(true);
    expect(hasRealAnalysis(narrative("Looks fine.", "degraded"))).toBe(false);
  });

  it("falls back to the wording for a stored result with no stage", () => {
    expect(isAnalysisFailed(narrative("Narrative generation failed"))).toBe(true);
    expect(hasRealAnalysis(narrative("Narrative generation failed"))).toBe(false);
  });
});

describe("one summary of the run", () => {
  const six = ["evidence", "structure", "energetics", "landscape", "insights", "report"].map(key => ({ key, status: "complete" as const }));

  it("is not changed by a problem in the optional Literature stage", () => {
    const summary = summarizeRunStages([...six, { key: "literature", status: "degraded" }]);
    expect(summary).toMatchObject({ settled: 6, total: 6, hasProblems: false });
  });

  it("counts six stages whether or not the reader opened Literature", () => {
    expect(summarizeRunStages([...six, { key: "literature", status: "on-demand" }]).total).toBe(6);
    expect(summarizeRunStages([...six, { key: "literature", status: "complete" }]).total).toBe(6);
  });
});

describe("serviceStatusOf", () => {
  it("reads a status held only in the metadata", () => {
    expect(serviceStatusOf({ metadata: { serviceStatus: { gnomadFrequency: "timeout" } } })?.gnomadFrequency).toBe("timeout");
  });

  it("keeps a metadata key the top level does not have", () => {
    expect(serviceStatusOf({ serviceStatus: { a: "ok" }, metadata: { serviceStatus: { b: "error" } } })).toEqual({ a: "ok", b: "error" });
  });

  it("lets the top level win on a shared key", () => {
    expect(serviceStatusOf({ serviceStatus: { a: "ok" }, metadata: { serviceStatus: { a: "error" } } })?.a).toBe("ok");
  });

  it("returns the top-level object itself when nothing needs merging, so hashes of it stay stable", () => {
    const top = { b: "ok", a: "ok" };
    expect(serviceStatusOf({ serviceStatus: top, metadata: { serviceStatus: { a: "ok" } } })).toBe(top);
  });

  it("is null when nothing was reported", () => {
    expect(serviceStatusOf({})).toBeNull();
  });
});

describe("geminiCredentials", () => {
  const now = 1000;

  it("is live with an unexpired session", () => {
    expect(geminiCredentials({ geminiSessionId: "s", geminiSessionExpiresAt: 2000 }, false, now)).toMatchObject({ sessionActive: true, canAttemptNarrative: true });
  });

  it("reports a lapse only when a key can relink it", () => {
    expect(geminiCredentials({ geminiSessionId: "s", geminiSessionExpiresAt: 1, geminiApiKey: "k" }, false, now)).toMatchObject({ sessionLapsed: true, canAttemptNarrative: true });
    expect(geminiCredentials({ geminiSessionId: "s", geminiSessionExpiresAt: 1 }, false, now)).toMatchObject({ sessionLapsed: false, canAttemptNarrative: false });
  });

  it("can attempt a narrative with a server key alone", () => {
    expect(geminiCredentials({}, true, now).canAttemptNarrative).toBe(true);
  });

  it("does not count a blank key", () => {
    expect(geminiCredentials({ geminiApiKey: "   " }, false, now)).toMatchObject({ keyStored: false, canAttemptNarrative: false });
  });
});

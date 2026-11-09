import { describe, it, expect } from "vitest";
import { applyRunEvent, createPipelineRun, EMPTY_RUN_LEDGER } from "../pipelineRun";

const identity = (over: { active?: number; signal?: AbortSignal } = {}) => ({
  requestId: 1,
  signal: over.signal ?? new AbortController().signal,
  getActiveRequestId: () => over.active ?? 1,
});

describe("run ledger", () => {
  it("lets announcements in any order arrive at the same ledger", () => {
    const a = applyRunEvent(applyRunEvent(EMPTY_RUN_LEDGER, { type: "stage", stage: "landscape", outcome: "running" }), { type: "stage", stage: "ppi", outcome: "running" });
    const b = applyRunEvent(applyRunEvent(EMPTY_RUN_LEDGER, { type: "stage", stage: "ppi", outcome: "running" }), { type: "stage", stage: "landscape", outcome: "running" });
    expect(a).toEqual(b);
  });

  it("turns running stages into skipped when core fails, and leaves finished ones alone", () => {
    let ledger = applyRunEvent(EMPTY_RUN_LEDGER, { type: "stage", stage: "landscape", outcome: "running" });
    ledger = applyRunEvent(ledger, { type: "stage", stage: "coordinates", outcome: "complete" });
    ledger = applyRunEvent(ledger, { type: "core-failed" });
    expect(ledger.stages).toEqual({ landscape: "skipped", coordinates: "complete", core: "error" });
    expect(ledger.failed).toBe(true);
  });

  it("applies a repeated core failure as if it happened once", () => {
    const once = applyRunEvent(EMPTY_RUN_LEDGER, { type: "core-failed" });
    expect(applyRunEvent(once, { type: "core-failed" })).toEqual(once);
  });
});

describe("pipeline run identity", () => {
  it("is stale once a newer request exists", () => {
    expect(createPipelineRun(identity({ active: 2 })).isStale()).toBe(true);
  });

  it("is stale once its signal is aborted", () => {
    const controller = new AbortController();
    const run = createPipelineRun(identity({ signal: controller.signal }));
    expect(run.isStale()).toBe(false);
    controller.abort();
    expect(run.isStale()).toBe(true);
  });

  it("refuses late evidence after core failed, while the run itself is still current", () => {
    const run = createPipelineRun(identity());
    expect(run.acceptsEvidence()).toBe(true);
    run.stopEvidence();
    expect(run.isStale()).toBe(false);
    expect(run.acceptsEvidence()).toBe(false);
  });

  it("lets stages already written on the result win over ones only announced", () => {
    const run = createPipelineRun(identity());
    run.record({ type: "stage", stage: "landscape", outcome: "running" });
    run.record({ type: "stage", stage: "ppi", outcome: "running" });
    expect(run.withAnnouncedStages({ landscape: "complete" })).toEqual({ landscape: "complete", ppi: "running" });
  });
});

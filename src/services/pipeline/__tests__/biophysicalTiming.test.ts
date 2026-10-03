import { describe, expect, it, vi } from "vitest";
import { fetchBiophysicalAnalysis, fetchProgressiveStructuralAssessments } from "../biophysicalService";

const params = { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" };

describe("measured source telemetry", () => {
  it("derives core source start from settlement minus duration and trusts only explicit cache provenance", async () => {
    const traceStart = performance.now();
    const addTraceSpan = vi.fn();
    const response = { metadata: { cacheHit: true, cacheLayer: "analysis-db" }, serviceTimings: { clinvar: 30 }, serviceTimingOffsets: { clinvar: 90 }, serviceStatus: { clinvar: "ok" } };
    await fetchBiophysicalAnalysis(params, { getBiophysicalAnalysis: vi.fn().mockResolvedValue(response) }, new AbortController().signal, undefined, { activeTraceId: "measured", traceStart, addTraceSpan });
    const spans = addTraceSpan.mock.calls.map(call => call[0]);
    const parent = spans.find(span => span.name === "Core evidence sources");
    const source = spans.find(span => span.meta?.serviceKey === "clinvar");
    expect(parent.cached).toBe(true);
    expect(parent.meta.cacheLayer).toBe("analysis-db");
    expect(source.offsetMs - parent.offsetMs).toBe(60);
    expect(source.durationMs).toBe(30);
  });

  it("does not infer a cache hit from an immediately resolved core response", async () => {
    const addTraceSpan = vi.fn();
    await fetchBiophysicalAnalysis(params, { getBiophysicalAnalysis: vi.fn().mockResolvedValue({}) }, new AbortController().signal, undefined, { activeTraceId: "fast", traceStart: performance.now(), addTraceSpan });
    expect(addTraceSpan.mock.calls[0][0]).not.toHaveProperty("cached");
  });

  it("emits real structural spans, preserves core VESM status, and reports a partial cohort as degraded", async () => {
    const addTraceSpan = vi.fn();
    let state: any = { result: { metadata: { pipelineStages: { core: "complete" } }, serviceStatus: { esm2: "timeout" } } };
    const response = {
      esm3Eval: { score: null, status: "token_required" }, esmcEval: { llr: 0 }, esm2Eval: { llr: -2 }, saprotEval: { error: "busy", status: "timeout" },
      serviceStatus: { esm3: "offline", esmc: "ok", esm2Eval: "ok", saprot: "timeout" },
      structuralTimings: { esm3: 10, esmc: 35, esm2Eval: 20, saprot: 45 },
      structuralTimingOffsets: { esm3: 20, esmc: 65, esm2Eval: 40, saprot: 60 }
    };
    await fetchProgressiveStructuralAssessments(params, { getStructuralAssessments: vi.fn().mockResolvedValue(response) }, new AbortController().signal, update => { state = update(state); }, 1, () => 1, { activeTraceId: "models", traceStart: performance.now(), addTraceSpan });
    expect(state.result.metadata.pipelineStages).toMatchObject({ core: "complete", structural: "degraded" });
    expect(state.result.serviceStatus).toMatchObject({ esm2: "timeout", esm2Eval: "ok" });
    const spans = addTraceSpan.mock.calls.map(call => call[0]);
    const model = spans.find(span => span.meta?.serviceKey === "esmc");
    const missing = spans.find(span => span.meta?.serviceKey === "esm3");
    const timeout = spans.find(span => span.meta?.serviceKey === "saprot");
    const parent = spans.find(span => !span.meta?.serviceKey);
    expect(model.durationMs).toBe(35);
    expect(model.offsetMs - parent.offsetMs).toBeGreaterThanOrEqual(29);
    expect(model.offsetMs - parent.offsetMs).toBeLessThanOrEqual(31);
    expect(missing.status).toBe("unavailable");
    expect(timeout.status).toBe("failed");
    expect(state.result.metadata.structuralTimings).toEqual(response.structuralTimings);
  });

  it("never labels four token placeholders as a completed model cohort", async () => {
    const addTraceSpan = vi.fn();
    let state: any = { result: { metadata: {} } };
    const empty = { score: null, status: "token_required" };
    await fetchProgressiveStructuralAssessments(params, { getStructuralAssessments: vi.fn().mockResolvedValue({ esm3Eval: empty, esmcEval: empty, esm2Eval: empty, saprotEval: empty }) }, new AbortController().signal, update => { state = update(state); }, 1, () => 1, { activeTraceId: "missing", traceStart: performance.now(), addTraceSpan });
    expect(state.result.metadata.pipelineStages.structural).toBe("degraded");
    expect(addTraceSpan).toHaveBeenCalledWith(expect.objectContaining({ status: "unavailable" }));
  });
});

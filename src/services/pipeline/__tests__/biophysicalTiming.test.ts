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

});

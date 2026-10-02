// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { ConsoleEntry, TraceRun, TraceSpan } from "../../types/devConsole";
import {
  barGeometry,
  buildCurl,
  buildTimeline,
  countImpacts,
  effectiveImpact,
  findOutlierSpans,
  formatDuration,
  matchesFilters,
} from "../console/consoleUtils";

const entry = (over: Partial<ConsoleEntry>): ConsoleEntry => ({
  id: "1",
  timestamp: 0,
  level: "error",
  source: "runtime",
  message: "boom",
  count: 1,
  ...over,
});

const span = (name: string, offsetMs: number, durationMs: number, over: Partial<TraceSpan> = {}): TraceSpan => ({
  id: name,
  traceId: "t",
  name,
  stage: "biophysics",
  startTime: 0,
  offsetMs,
  durationMs,
  status: "success",
  ...over,
});

const run = (spans: TraceSpan[]): TraceRun => ({
  traceId: "t",
  query: "q",
  timestamp: 0,
  totalDurationMs: Math.max(...spans.map((s) => s.offsetMs + s.durationMs)),
  status: "completed",
  spans,
});

describe("formatDuration", () => {
  it("scales units", () => {
    expect(formatDuration(912)).toBe("912ms");
    expect(formatDuration(2419)).toBe("2.42s");
    expect(formatDuration(26545)).toBe("26.5s");
    expect(formatDuration(320880)).toBe("5m 21s");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("impact bucketing", () => {
  it("counts every entry in exactly one bucket and ignores info", () => {
    const counts = countImpacts([
      entry({ impact: "fatal" }),
      entry({ impact: "degraded", level: "warn" }),
      entry({ impact: "recoverable", level: "warn" }),
      entry({ impact: "info", level: "info" }),
      entry({ impact: undefined, level: "warn" }),
    ]);
    expect(counts).toEqual({ fatal: 1, degraded: 2, recoverable: 1 });
    expect(effectiveImpact({ impact: undefined, level: "error" })).toBe("fatal");
  });
});

describe("matchesFilters", () => {
  const base = { levelFilter: "all", sourceFilter: "all", impactFilter: "all", searchQuery: "" } as const;
  it("searches message, detail and source, case-insensitively", () => {
    const e = entry({ message: "FoldX failed", detail: "stack at foo.ts", source: "biophysics" });
    expect(matchesFilters(e, { ...base, searchQuery: "foldx" })).toBe(true);
    expect(matchesFilters(e, { ...base, searchQuery: "FOO.TS" })).toBe(true);
    expect(matchesFilters(e, { ...base, searchQuery: "biophys" })).toBe(true);
    expect(matchesFilters(e, { ...base, searchQuery: "nope" })).toBe(false);
  });
  it("applies level, source and impact filters", () => {
    const e = entry({ level: "warn", source: "workflow", impact: "recoverable" });
    expect(matchesFilters(e, { ...base, levelFilter: "warn", sourceFilter: "workflow", impactFilter: "recoverable" })).toBe(true);
    expect(matchesFilters(e, { ...base, impactFilter: "fatal" })).toBe(false);
  });
});

describe("buildCurl", () => {
  it("returns null without a URL", () => {
    expect(buildCurl(entry({}))).toBeNull();
  });
  it("makes the URL absolute, quotes the body and escapes apostrophes", () => {
    const curl = buildCurl(entry({ httpMeta: { url: "/api/v1/x", method: "post", requestBody: { note: "it's" } } }))!;
    expect(curl).toContain("curl -X POST 'http");
    expect(curl).toContain("/api/v1/x'");
    expect(curl).toContain(`-d '{"note":"it'\\''s"}'`);
  });
});

describe("waterfall timeline", () => {
  // A real run: sub-second fetches beside two ~5 minute polling jobs.
  const spans = [
    span("VEP", 0, 3719),
    span("PDB", 3719, 546),
    span("Pocket", 4265, 26545),
    span("ESM", 30810, 17358),
    span("DYNAMUT2", 400, 304821, { status: "unavailable" }),
    span("DDMUT", 7000, 313822, { status: "unavailable" }),
  ];
  const r = run(spans);

  it("flags only the runaway spans", () => {
    expect([...findOutlierSpans(spans)].sort()).toEqual(["DDMUT", "DYNAMUT2"]);
  });

  it("focus scale clips the axis to the readable spans; full keeps the whole run", () => {
    const focus = buildTimeline(r, "focus");
    expect(focus.clipped).toBe(true);
    expect(focus.clippedCount).toBe(2);
    expect(focus.axisMax).toBeLessThan(60_000);
    expect(buildTimeline(r, "full").axisMax).toBe(r.totalDurationMs);
    expect(buildTimeline(r, "full").clipped).toBe(false);
  });

  it("does not clip a run with no outliers", () => {
    const calm = run([span("a", 0, 100), span("b", 100, 900)]);
    expect(buildTimeline(calm, "focus").clipped).toBe(false);
  });

  it("marks bars that run past the focused axis and keeps every bar visible", () => {
    const { axisMax } = buildTimeline(r, "focus");
    expect(barGeometry(spans[4], axisMax).clippedRight).toBe(true);
    expect(barGeometry(spans[1], axisMax).clippedRight).toBe(false);
    expect(barGeometry(spans[1], axisMax).widthPct).toBeGreaterThanOrEqual(0.8);
  });

  it("emits five ticks ending at the axis max", () => {
    const t = buildTimeline(r, "full");
    expect(t.ticks).toHaveLength(5);
    expect(t.ticks[4]).toEqual({ pct: 100, label: formatDuration(t.axisMax) });
  });
});

import { describe, expect, it } from "vitest";
import {
  buildDensitySegments,
  densityY,
  formatThresholdValue,
  isDensityPoint
} from "../DensityTrack";

const DOMAIN = [0, 1] as const;
const HEIGHT = 64;
const COL = 30;

describe("isDensityPoint", () => {
  it.each([null, undefined, NaN, Infinity, -Infinity])("rejects %p", (value) => {
    expect(isDensityPoint(value as number | null)).toBe(false);
  });

  it("accepts a finite number including zero", () => {
    expect(isDensityPoint(0)).toBe(true);
    expect(isDensityPoint(0.564)).toBe(true);
  });
});

describe("densityY", () => {
  it("maps the domain floor to the baseline and the ceiling to the top", () => {
    expect(densityY(0, DOMAIN, HEIGHT)).toBe(60);
    expect(densityY(1, DOMAIN, HEIGHT)).toBe(4);
  });

  it("clamps out-of-domain values instead of drawing outside the track", () => {
    expect(densityY(1.4, DOMAIN, HEIGHT)).toBe(4);
    expect(densityY(-0.2, DOMAIN, HEIGHT)).toBe(60);
  });

  it("degenerates to the baseline for an empty domain rather than dividing by zero", () => {
    expect(Number.isFinite(densityY(0.5, [1, 1], HEIGHT))).toBe(true);
  });
});

describe("buildDensitySegments", () => {
  it("returns an empty path for no points and for all-missing points", () => {
    expect(buildDensitySegments([], COL, DOMAIN, HEIGHT)).toBe("");
    expect(buildDensitySegments([null, null, null], COL, DOMAIN, HEIGHT)).toBe("");
  });

  it("renders a single measured position as a degenerate segment, not an invented slope", () => {
    const d = buildDensitySegments([0.5], COL, DOMAIN, HEIGHT);
    expect(d).toBe(`M 15.0,${densityY(0.5, DOMAIN, HEIGHT).toFixed(1)} L 15.0,${densityY(0.5, DOMAIN, HEIGHT).toFixed(1)}`);
  });

  it("breaks the line at a gap instead of interpolating across missing data", () => {
    const d = buildDensitySegments([1, null, 1], COL, DOMAIN, HEIGHT);
    const segments = d.split(" M ").length;
    expect(d.startsWith("M ")).toBe(true);
    expect(segments).toBe(2);
    // A fabricated zero would be a single continuous run through the middle point.
    expect(d).not.toContain("L 30.0,60.0");
  });

  it("treats a leading and a trailing gap as no segment at all", () => {
    const d = buildDensitySegments([null, 0.25, null], COL, DOMAIN, HEIGHT);
    expect(d.split("M").length - 1).toBe(1);
  });

  it("never emits NaN coordinates", () => {
    const d = buildDensitySegments([NaN, 0.1, undefined as unknown as number, 0.9], COL, DOMAIN, HEIGHT);
    expect(d).not.toContain("NaN");
  });

  it("refuses to build on a degenerate geometry", () => {
    expect(buildDensitySegments([0.5], 0, DOMAIN, HEIGHT)).toBe("");
    expect(buildDensitySegments([0.5], COL, DOMAIN, 0)).toBe("");
  });
});

describe("formatThresholdValue", () => {
  it("keeps the decimals a classifier actually compares against", () => {
    expect(formatThresholdValue(0.564)).toBe("0.564");
    expect(formatThresholdValue(0.75)).toBe("0.75");
    expect(formatThresholdValue(15)).toBe("15");
  });

  it("never rounds a cut-off onto a value that falls the other side of it", () => {
    const label = Number(formatThresholdValue(0.564));
    expect(0.562 >= label).toBe(false);
    expect(0.564 >= label).toBe(true);
  });
});

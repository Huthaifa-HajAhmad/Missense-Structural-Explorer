import { describe, it, expect } from "vitest";
import {
  STRING_CONFIDENCE_BANDS,
  STRING_CONFIDENCE_CUTS,
  THRESHOLDS,
  stringConfidenceLabel,
  stringConfidenceTier
} from "./index.ts";

/**
 * The STRING confidence bands are a claim about a third-party classifier, so the
 * tests below pin the exact cut-points STRING publishes rather than the values
 * this codebase happens to use. All four boundaries are asserted on BOTH sides:
 * a green test on 0.700 alone would still pass if the band table were shifted to
 * 0.650, so each cut-point is checked at and one step below.
 */
/**
 * The STRING confidence bands are a claim about a third-party classifier, so the
 * tests below pin the EXACT cut-points STRING publishes
 * (https://string-db.org/help/getting_started/) as literals.
 *
 * They deliberately do NOT probe `THRESHOLDS.stringDb.highest`. Reading the
 * cut-point out of the same constant the implementation branches on made the "at"
 * half of every boundary self-referential: mutating the constant upward by 0.05
 * moved the probe with it and all eight tests stayed green, while mutating it
 * downward was caught. The floor is the worst case — moving `low` from 0.150 to
 * 0.200 is invisible to this file AND to the component's fixture (whose lowest
 * partner is exactly 0.200), so only a hardcoded literal catches it.
 *
 * Every boundary is asserted on BOTH sides for the same reason.
 */
describe("stringConfidenceTier", () => {
  it("puts each published STRING cut-point in the band that claims it", () => {
    expect(THRESHOLDS.stringDb.highest).toBe(0.9);
    expect(THRESHOLDS.stringDb.high).toBe(0.7);
    expect(THRESHOLDS.stringDb.medium).toBe(0.4);
    expect(THRESHOLDS.stringDb.low).toBe(0.15);

    expect(stringConfidenceTier(0.9)).toBe("highest");
    expect(stringConfidenceTier(0.7)).toBe("high");
    expect(stringConfidenceTier(0.4)).toBe("medium");
    expect(stringConfidenceTier(0.15)).toBe("low");
  });

  it("drops a score one step below each cut-point into the next band down", () => {
    expect(stringConfidenceTier(0.899)).toBe("high");
    expect(stringConfidenceTier(0.699)).toBe("medium");
    expect(stringConfidenceTier(0.399)).toBe("low");
    expect(stringConfidenceTier(0.149)).toBeNull();
  });

  it("does not accept a raised floor as still covering STRING's low band", () => {
    // The exact hole a constant-sourced probe leaves: 0.150-0.199 is STRING's
    // lowest band, but a floor moved to 0.200 would call it unclassified and no
    // other assertion in this file would notice.
    expect(stringConfidenceTier(0.15)).toBe("low");
    expect(stringConfidenceTier(0.175)).toBe("low");
    expect(stringConfidenceTier(0.199)).toBe("low");
  });

  it("refuses a band below STRING's lowest, instead of defaulting to one", () => {
    // The defect this replaces: every score under 0.700 was labelled "Medium".
    expect(stringConfidenceTier(0.2)).toBe("low");
    expect(stringConfidenceTier(0.2)).not.toBe("medium");
    expect(stringConfidenceTier(0)).toBeNull();
    expect(stringConfidenceTier(0.1)).toBeNull();
    expect(stringConfidenceTier(0.149)).toBeNull();
  });

  it("returns null rather than a band for unusable scores", () => {
    expect(stringConfidenceTier(null)).toBeNull();
    expect(stringConfidenceTier(undefined)).toBeNull();
    expect(stringConfidenceTier(NaN)).toBeNull();
    expect(stringConfidenceTier(Infinity)).toBeNull();
  });

  it("keeps the boundaries and the scores the PPI table actually receives", () => {
    // A saturated top band and the values STRING's network endpoint returns for
    // CNNM2 — the rows that appear in the screenshot this redesign came from.
    expect(stringConfidenceTier(1)).toBe("highest");
    expect(stringConfidenceTier(0.97)).toBe("highest");
    expect(stringConfidenceTier(0.818)).toBe("high");
    expect(stringConfidenceTier(0.79)).toBe("high");
  });
});

describe("STRING_CONFIDENCE_BANDS", () => {
  it("is ordered strongest-first, so a first-match lookup is correct", () => {
    const mins = STRING_CONFIDENCE_BANDS.map((band) => band.min);
    expect(mins).toEqual([...mins].sort((a, b) => b - a));
  });

  it("labels each band with the word STRING prints, not the number", () => {
    expect(STRING_CONFIDENCE_BANDS.map((band) => band.label)).toEqual([
      "Highest",
      "High",
      "Medium",
      "Low"
    ]);
  });
});

/**
 * The rail draws a tick per interior boundary, so the cut list is a rendering
 * contract: three ticks at 0.900/0.700/0.400 and none at the 0.150 floor, which
 * is where the classifier stops naming a band rather than a boundary between two.
 */
describe("STRING_CONFIDENCE_CUTS", () => {
  it("names the three interior boundaries and excludes the floor", () => {
    expect(STRING_CONFIDENCE_CUTS.map((cut) => cut.id)).toEqual(["highest", "high", "medium"]);
    expect(STRING_CONFIDENCE_CUTS.map((cut) => cut.min)).toEqual([0.9, 0.7, 0.4]);
  });
});

describe("stringConfidenceLabel", () => {
  it("names the band for a score and declines to name one below the floor", () => {
    expect(stringConfidenceLabel(0.97)).toBe("Highest");
    expect(stringConfidenceLabel(0.05)).toBeNull();
    expect(stringConfidenceLabel(null)).toBeNull();
  });
});

/**
 * Negative control. Every guard above is only worth its line count if it CAN
 * fail, and the substitute harness that used to demonstrate exactly this was
 * gitignored and has been deleted by another agent's scratch cleanup — so the
 * control belongs in the committed suite. Each line asserts that the matcher the
 * guard depends on rejects the OLD behaviour, through the same `expect` the guard
 * uses. If a future refactor makes `toBe` stop failing on a mismatch, these fail
 * while the guards above keep passing.
 */
describe("guards can fail (negative control)", () => {
  it("rejects the previous classifier's answer for a sub-medium score", () => {
    expect(() => expect(stringConfidenceTier(0.2)).toBe("medium")).toThrow();
  });

  it("rejects treating STRING's lowest band as unclassified", () => {
    expect(() => expect(stringConfidenceTier(0.15)).toBeNull()).toThrow();
  });
});

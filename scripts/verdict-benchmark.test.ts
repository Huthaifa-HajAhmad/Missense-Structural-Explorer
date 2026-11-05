import { describe, expect, it } from "vitest";
import { resampled } from "./verdict-benchmark.ts";

describe("verdict benchmark interval", () => {
  // The usefulness rule reads `low` and `high`. A mislabelled level once turned a pass at 90% into a reported miss at 95%, so
  // this pins which is which on a known case: 100 chains, one value each, 0 to 99, and the statistic is their mean.
  const rows = Array.from({ length: 100 }, (_, i) => ({ key: `chain${i}`, value: i }));
  const score = resampled(rows, s => s.reduce((sum, r) => sum + r.value, 0) / s.length);

  it("keeps the same result between runs, so a reported number can be reproduced", () => {
    expect(score).toEqual(resampled(rows, s => s.reduce((sum, r) => sum + r.value, 0) / s.length));
    expect(score.value).toBe(49.5);
  });

  it("reports a 95% interval wider than the 90% one, near the theoretical sizes", () => {
    // The mean of 100 draws from 0 to 99 has a standard error of about 2.9, so about +/-5.7 at 95% and +/-4.8 at 90%.
    expect(score.low).toBeLessThan(score.low90);
    expect(score.high).toBeGreaterThan(score.high90);
    expect(score.high - score.low).toBeCloseTo(2 * 5.7, -0.5);
    expect(score.high90 - score.low90).toBeCloseTo(2 * 4.8, -0.5);
  });

  it("resamples whole chains, so variants on one chain do not count as independent", () => {
    const twoChains = [{ key: "a", value: 0 }, { key: "a", value: 0 }, { key: "b", value: 1 }, { key: "b", value: 1 }];
    const sizes = new Set<number>();
    resampled(twoChains, s => { sizes.add(s.length); return 0; });
    expect([...sizes]).toEqual([4]);
  });
});

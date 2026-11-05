import { describe, expect, it } from "vitest";
import { agreement, band, buildRow, DIRECTION_BAND, resampled, type Row } from "./verdict-benchmark.ts";

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

describe("verdict benchmark: how a lab value and a verdict become bands", () => {
  it("cuts lab values at 0.5 and 1.5 kcal/mol, with the edge going to the higher band", () => {
    expect([-2, 0, 0.49, 0.5, 1.49, 1.5, 6].map(band)).toEqual([0, 0, 0, 1, 1, 2, 2]);
  });

  it("gives every verdict direction the app can show a band, and none to an undecided one", () => {
    expect(DIRECTION_BAND).toEqual({
      destabilizing: 2, "mostly-destabilizing": 2, moderate: 1, "mostly-moderate": 1,
      "not-destabilizing": 0, "mostly-not-destabilizing": 0, split: null, none: null
    });
  });

  it("scores agreement only on the variants the verdict called, and says nothing when it called none", () => {
    // Lab bands: 0, 1, 2, 0. The verdict is right on the first two, wrong on the third, and silent on the last.
    const rows = [
      { measured: 0.1, verdict: 0 }, { measured: 1.0, verdict: 1 }, { measured: 2.0, verdict: 0 }, { measured: 0.2, verdict: null }
    ] as Row[];
    expect(agreement(rows, r => r.verdict)).toBeCloseTo(2 / 3, 10);
    expect(agreement(rows.slice(3), r => r.verdict)).toBeNaN();
  });
});

describe("verdict benchmark: the verdict is the one the app computes", () => {
  const foldx = (value: number) => ({ id: "x", pdb: "1ABC", chain: "A", mutation: "AA10G", residues: 100, measured: 1, ddg: { none: value, full: value, local: value } });
  const engines = (thermompnn: number, stabilityoracle: number) => ({ id: "x", thermompnn, stabilityoracle });
  const run = (f: number, t: number, s: number) => buildRow(foldx(f), engines(t, s))!;

  it("calls a clear case, and leaves a split undecided", () => {
    expect(run(3, 3, 3)).toMatchObject({ verdict: 2, bands: { foldx: 2, thermompnn: 2, stabilityoracle: 2 } });
    expect(run(0, 0, 0)).toMatchObject({ verdict: 0 });
    expect(run(2, 2, 0).verdict).toBeNull();
  });

  it("lets FoldX break a tie, and shows what the other two say without it", () => {
    // Without FoldX, ThermoMPNN says high and StabilityOracle says low-to-moderate: no call. FoldX's low value settles it.
    expect(run(-1, -1, 0.6)).toMatchObject({ verdict: 0, noFoldx: null });
    // The other way round: two engines agree on high, and a low FoldX value turns that into no call.
    expect(run(-1, 1, 1)).toMatchObject({ verdict: null, noFoldx: 2 });
  });

  it("drops FoldX only when its own reading is moderate", () => {
    const values = [-1, 0, 0.3, 0.6, 1, 1.5, 2, 3];
    let moderate = 0;
    for (const f of values) for (const t of values) for (const s of values) {
      const row = run(f, t, s);
      if (row.bands.foldx === 1) {
        moderate += 1;
        expect(row.noFoldxModerate, `FoldX ${f}, ThermoMPNN ${t}, StabilityOracle ${s}`).toBe(row.noFoldx);
      } else {
        expect(row.noFoldxModerate, `FoldX ${f}, ThermoMPNN ${t}, StabilityOracle ${s}`).toBe(row.verdict);
      }
    }
    expect(moderate).toBeGreaterThan(0); // The loop must reach the rule it checks.
  });

  it("does not score a variant an engine failed on", () => {
    expect(buildRow(foldx(1), { id: "x", thermompnn: null, stabilityoracle: 1 })).toBeNull();
  });
});

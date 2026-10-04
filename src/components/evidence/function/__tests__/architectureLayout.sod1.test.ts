import { describe, expect, it } from "vitest";
import { buildFunctionEvidence } from "../../../../shared/functionEvidence";
import { SOD1_INPUT } from "../../../../shared/__tests__/fixtures/sod1FunctionalDomains";
import { drawingMode, layoutArchitecture } from "../architectureLayout";

// SOD1 p.Ala5Val: 81 UniProt variants over 154 residues, 38 point marks. The sparse drawing named 18 and dropped 88 labels.
describe("layoutArchitecture - SOD1 p.Ala5Val, the dense drawing", () => {
  const sod = buildFunctionEvidence(SOD1_INPUT);
  const all = { start: 1, end: sod.length };

  it("draws 81 disease variants as one bar per residue, with no disease pins", () => {
    const L = layoutArchitecture(sod, 994, all, null);
    expect(L.density?.bars).toHaveLength(58);
    expect(L.pins.some((p) => p.shape === "dot")).toBe(false);
    const q = L.density!.bars.filter((b) => b.query);
    expect(q).toHaveLength(1);
    expect(q[0].start).toBe(5);
    // Height is the count: three at residue 5, one at residue 7.
    const h = (r: number) => L.density!.bars.find((b) => b.start === r)!.h;
    expect(h(5) / h(7)).toBeCloseTo(3, 5);
  });

  it("puts point marks in a lane per kind with no stems, and a disulfide bracket", () => {
    const L = layoutArchitecture(sod, 994, all, null);
    expect(L.laneMode).toBe(true);
    expect(L.pins.every((p) => !p.stem)).toBe(true);
    const yOf = (shape: string) => L.pins.filter((p) => p.shape === shape).map((p) => p.y);
    expect(Math.max(...yOf("diamond"))).toBeLessThan(Math.min(...yOf("circle")));
    expect(Math.max(...yOf("circle"))).toBeLessThan(Math.min(...yOf("tick")));
    expect(L.bonds).toHaveLength(1);
    expect(L.hiddenLabels).toBeLessThan(10);
  });

  it("draws PROSITE patterns as ticks and leaves the whole-chain Gene3D segment out", () => {
    const L = layoutArchitecture(sod, 994, all, null);
    expect(L.motifs).toHaveLength(2);
    expect(L.structural).toHaveLength(0);
    expect(L.domains).toHaveLength(1);
  });

  it("points a folded variant's bar at its table row, which selects it", () => {
    const L = layoutArchitecture(sod, 994, all, "variants-5");
    const bar = L.density!.bars.find((b) => b.start === 5)!;
    expect(bar.selected).toBe(true);
    expect(bar.rowKey).toBe("variants-5");
  });

  it("drops a layer the reader switched off, and aggregates nothing when few marks remain", () => {
    const L = layoutArchitecture(sod, 994, all, null, { hidden: new Set(["variants", "mutagenesis"]) });
    expect(L.density).toBeNull();
    expect(L.pins.some((p) => p.shape === "tick")).toBe(false);
    const near = layoutArchitecture(sod, 994, { start: 40, end: 100 }, null);
    expect(near.density).toBeNull();
    expect(drawingMode(sod, { start: 40, end: 100 }).bars).toBe(false);
    expect(drawingMode(sod, all)).toEqual({ bars: true, lanes: true });
  });
});

describe("layoutArchitecture - SOD1 pointer targets and narrow binning", () => {
  const sod = buildFunctionEvidence(SOD1_INPUT);
  const all = { start: 1, end: sod.length };

  it("tiles the bars' pointer targets, so a click on one bar never lands on its neighbour", () => {
    for (const width of [994, 380]) {
      const bars = [...layoutArchitecture(sod, width, all, null).density!.bars].sort((a, b) => a.x - b.x);
      for (let i = 1; i < bars.length; i++) expect(bars[i - 1].hit.x1).toBeLessThanOrEqual(bars[i].hit.x0 + 1e-6);
      // Each target contains its own bar's centre.
      for (const b of bars) {
        expect(b.hit.x0).toBeLessThanOrEqual(b.x + b.width / 2);
        expect(b.hit.x1).toBeGreaterThanOrEqual(b.x + b.width / 2);
      }
    }
  });

  it("tiles marks that sit closer than 24px in one row, and keeps 24px where there is room", () => {
    const L = layoutArchitecture(sod, 994, all, null);
    const rows = new Map<number, typeof L.pins>();
    for (const p of L.pins) rows.set(Math.round(p.y), [...(rows.get(Math.round(p.y)) ?? []), p]);
    for (const row of rows.values()) {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1].hit.x1).toBeLessThanOrEqual(sorted[i].hit.x0 + 1e-6);
      for (const p of sorted) expect(p.hit.x1 - p.hit.x0).toBeLessThanOrEqual(24 + 1e-6);
    }
    // The lone mark at residue 121 has room on both sides.
    const alone = L.pins.find((p) => p.residue === 121 && p.shape === "diamond")!;
    expect(alone.hit.x1 - alone.hit.x0).toBeCloseTo(24, 5);
  });

  it("does not collapse coincident marks (twins at the same residue) to zero hit width", () => {
    const L = layoutArchitecture(sod, 994, all, null);
    for (const p of L.pins) {
      expect(p.hit.x1 - p.hit.x0).toBeGreaterThan(0.5);
    }
  });

  it("bins two residues per bar at phone width without losing or double-counting a variant", () => {
    const L = layoutArchitecture(sod, 380, all, null);
    const bars = L.density!.bars;
    expect(bars.reduce((n, b) => n + b.count, 0)).toBe(81);
    expect(bars.every((b) => b.end - b.start <= 1)).toBe(true);
    expect(bars.some((b) => b.end > b.start)).toBe(true);
    const q = bars.filter((b) => b.query);
    expect(q).toHaveLength(1);
    expect(q[0].start <= 5 && 5 <= q[0].end).toBe(true);
    for (let i = 1; i < bars.length; i++) expect(bars[i].start).toBeGreaterThan(bars[i - 1].end);
  });
});

describe("layoutArchitecture - SOD1 bar track alignment", () => {
  const sod = buildFunctionEvidence(SOD1_INPUT);

  it("centres each bar on its residue, so the variant's stem lands in the middle of its own bar", () => {
    const L = layoutArchitecture(sod, 994, { start: 1, end: sod.length }, null);
    const bar = L.density!.bars.find((b) => b.query)!;
    expect(bar.x + bar.width / 2).toBeCloseTo(L.query!.x, 5);
    const x = (r: number) => L.x0 + ((r - 1) / (sod.length - 1)) * (L.x1 - L.x0);
    for (const b of L.density!.bars) expect(b.x + b.width / 2).toBeCloseTo(x(b.start), 5);
  });

  it("writes no number above the tallest bar", () => {
    expect(layoutArchitecture(sod, 994, { start: 1, end: sod.length }, null).density!.label).toBeNull();
  });
});

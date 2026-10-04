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

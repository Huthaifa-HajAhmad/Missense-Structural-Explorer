import { describe, expect, it } from "vitest";
import { buildFunctionEvidence } from "../../../../shared/functionEvidence";
import { NAE1_INPUT } from "../../../../shared/__tests__/fixtures/nae1FunctionalDomains";
import { layoutArchitecture } from "../architectureLayout";

const ev = buildFunctionEvidence(NAE1_INPUT);
const whole = { start: 1, end: ev.length };

describe("layoutArchitecture", () => {
  it("places every mark on one residue scale", () => {
    const L = layoutArchitecture(ev, 994, whole, null);
    const x = (r: number) => L.x0 + ((r - 1) / (ev.length - 1)) * (L.x1 - L.x0);
    for (const p of L.pins) expect(p.x).toBeCloseTo(x(p.residue), 6);
    expect(L.query?.x).toBeCloseTo(x(116), 6);
    expect(L.domains[0].x).toBeCloseTo(x(13), 6);
  });

  it("keeps the variant highest and its stem through the backbone", () => {
    const L = layoutArchitecture(ev, 994, whole, null);
    for (const p of L.pins) expect(p.y).toBeGreaterThan(L.query!.headY);
    expect(L.query!.stemTo).toBeGreaterThan(L.backbone.y + L.backbone.h / 2);
  });

  it("puts the domain label where the UBA3 inset and the variant stem are not", () => {
    const L = layoutArchitecture(ev, 994, whole, null);
    const label = L.domains[0].label!;
    const half = (label.text.length * label.size * 0.58) / 2;
    const region = L.regions[0];
    const [l, r] = [label.x - half, label.x + half];
    expect(r <= region.x || l >= region.x + region.width).toBe(true);
    expect(L.query!.x < l || L.query!.x > r).toBe(true);
  });

  it("drops only the marks outside a zoom window", () => {
    const L = layoutArchitecture(ev, 994, { start: 66, end: 166 }, null);
    expect(L.pins.map((p) => p.residue)).toEqual([85]);
  });

  it("draws a disulfide bond as its two cysteines, one labelled", () => {
    const withBond = buildFunctionEvidence({
      ...NAE1_INPUT,
      uniprot: { ...NAE1_INPUT.uniprot, features: [{ type: "Disulfide bond", description: "", start: 180, end: 230, evidence: [{ code: "ECO:0000269" }] }] },
    });
    const L = layoutArchitecture(withBond, 994, whole, null);
    const bond = L.pins.filter((p) => p.rowKey.startsWith("disulfide bond"));
    expect(bond.map((p) => p.residue).sort((a, b) => a - b)).toEqual([180, 230]);
    expect(bond.filter((p) => p.label).length).toBe(1);
  });
});

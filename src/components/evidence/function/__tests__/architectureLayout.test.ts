import { describe, expect, it } from "vitest";
import { buildFunctionEvidence } from "../../../../shared/functionEvidence";
import { NAE1_INPUT } from "../../../../shared/__tests__/fixtures/nae1FunctionalDomains";
import { layoutArchitecture, layoutOverview } from "../architectureLayout";

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

describe("layoutArchitecture — membrane topology lane and window-dependent strips", () => {
  const E = [{ code: "ECO:0000269", source: "PubMed", id: "1" }];
  const uniprot = {
    ...NAE1_INPUT.uniprot,
    sequenceLength: 1000,
    domainMatches: [],
    secondaryStructure: [{ kind: "helix" as const, start: 480, end: 490, pdb: "1ABC" }],
    features: [
      { type: "Topological domain", description: "Extracellular", start: 1, end: 99, evidence: E },
      { type: "Transmembrane", description: "Helical; Name=1", start: 100, end: 120, evidence: E },
      { type: "Topological domain", description: "Cytoplasmic", start: 121, end: 1000, evidence: E },
      { type: "Modified residue", description: "Phosphoserine", start: 995, end: 995, evidence: E },
    ],
  };
  const big = buildFunctionEvidence({ ...NAE1_INPUT, residue: 485, uniprot, engineCriteria: [] });
  const all = { start: 1, end: 1000 };

  it("draws topology as its own lane under the site marks and above the axis, not as boxes on the backbone", () => {
    const L = layoutArchitecture(big, 994, all, null);
    expect(L.regions).toHaveLength(0);
    expect(L.membrane?.bars).toHaveLength(1);
    expect(L.membrane?.rails.map((r) => r.side).sort()).toEqual(["inside", "outside"]);
    expect(L.membrane!.top).toBeGreaterThan(Math.max(...L.pins.map((p) => p.y)));
    expect(L.axisY).toBeGreaterThan(L.membrane!.bottom);
  });

  it("puts the outside rail above the inside rail and the bar across both", () => {
    const m = layoutArchitecture(big, 994, all, null).membrane!;
    expect(m.outsideY).toBeLessThan(m.insideY);
    expect(m.bars[0].y).toBeLessThanOrEqual(m.outsideY);
    expect(m.bars[0].y + m.bars[0].h).toBeGreaterThanOrEqual(m.insideY);
  });

  it("shrinks the lane to one line when a window shows only the inside rail", () => {
    const full = layoutArchitecture(big, 994, all, null).membrane!;
    const near = layoutArchitecture(big, 994, { start: 435, end: 535 }, null).membrane!;
    expect(near.bars).toHaveLength(0);
    expect(near.rails.map((r) => r.side)).toEqual(["inside"]);
    expect(near.bottom - near.top).toBeLessThan(full.bottom - full.top);
    expect(near.queryX).not.toBeNull();
  });

  it("draws the helix strip only in a window of 300 residues or fewer", () => {
    const wholeView = layoutArchitecture(big, 994, all, null);
    expect(wholeView.secondary).toHaveLength(0);
    expect(wholeView.showSecondary).toBe(false);
    const zoomed = layoutArchitecture(big, 994, { start: 435, end: 535 }, null);
    expect(zoomed.showSecondary).toBe(true);
    expect(zoomed.secondary).toHaveLength(1);
  });

  it("has no membrane lane when the entry annotates no topology", () => {
    expect(layoutArchitecture(ev, 994, whole, null).membrane).toBeNull();
  });

  it("starts a lower stem under a domain box on the bottom edge of the box, so it never crosses the box labels", () => {
    const withSite = buildFunctionEvidence({
      ...NAE1_INPUT,
      residue: 116,
      uniprot: { ...NAE1_INPUT.uniprot, domainMatches: (NAE1_INPUT.uniprot.domainMatches ?? []).filter((m) => m.database === "Pfam"), secondaryStructure: [], features: [{ type: "Modified residue", description: "Phosphoserine", start: 200, end: 200, evidence: E }] },
    });
    const L = layoutArchitecture(withSite, 994, whole, null);
    const pin = L.pins.find((p) => p.residue === 200)!;
    expect(pin.stemFrom).toBe(L.backbone.y + 15);
  });

  it("flips a lower label left of its mark when it would run off the right edge", () => {
    const near = buildFunctionEvidence({
      ...NAE1_INPUT,
      residue: 116,
      uniprot: { ...NAE1_INPUT.uniprot, secondaryStructure: [], features: [{ type: "Modified residue", description: "Phosphoserine", start: 166, end: 166, evidence: E }] },
    });
    const L = layoutArchitecture(near, 994, { start: 66, end: 166 }, null);
    const pin = L.pins.find((p) => p.residue === 166)!;
    expect(pin.label!.anchor).toBe("end");
    expect(pin.label!.x).toBeLessThan(pin.x);
  });

  it("drops a domain end number that the stem of the variant would cross", () => {
    const L = layoutArchitecture(ev, 994, { start: 1, end: 534 }, null);
    for (const d of L.domains) {
      for (const e of d.ends) {
        const w = e.text.length * e.size * 0.58;
        const [lo, hi] = e.anchor === "start" ? [e.x, e.x + w] : [e.x - w, e.x];
        expect(L.query!.x < lo - 4 || L.query!.x > hi + 4).toBe(true);
      }
    }
  });
});

describe("layoutOverview", () => {
  it("brackets the window on a whole-protein scale and places the variant", () => {
    const O = layoutOverview(ev, 994, { start: 66, end: 166 });
    const at = (r: number) => O.x0 + ((r - 1) / (ev.length - 1)) * (O.x1 - O.x0);
    expect(O.window.x).toBeCloseTo(at(66), 6);
    expect(O.window.x + O.window.width).toBeCloseTo(at(166), 6);
    expect(O.queryX).toBeCloseTo(at(116), 6);
    expect(O.ends.map((l) => l.text)).toEqual(["1", String(ev.length)]);
  });
});

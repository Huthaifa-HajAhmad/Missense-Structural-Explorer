import { describe, expect, it } from "vitest";
import { buildFunctionEvidence, type AnnotationRow } from "../../../../shared/functionEvidence";
import { functionEvidenceInputFrom } from "../../../../shared/functionEvidenceInput";
import { molecularWorkspaceFixture } from "../../../../test/molecularWorkspaceFixture";
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

/**
 * The 53051d6 overlap fix moved below-backbone stems onto the lowest domain box but started every
 * one of them at `lowerBackbone + 15`, so a pin with no box over it floated ~9px beneath the
 * backbone. These cover the missing stem test the review named, in both directions.
 */
describe("layoutArchitecture — below-backbone stem geometry", () => {
  const row = (over: Partial<AnnotationRow> = {}): AnnotationRow => ({
    key: "mark",
    group: "sites",
    name: "Binding site",
    note: null,
    type: "binding site",
    start: 40,
    end: 40,
    isPair: false,
    residuesText: "40",
    covers: false,
    distance: 0,
    distanceText: "0",
    evidence: "experimental",
    evidenceLabel: "Experimental",
    citation: null,
    evidenceCodes: [],
    lane: "below",
    shortLabel: "40",
    disease: false,
    substitution: null,
    detail: null,
    rowKey: "mark",
    parts: [],
    ...over,
  });
  type ArchInput = Parameters<typeof layoutArchitecture>[0];
  const evidenceWith = (over: Partial<ArchInput>): ArchInput => ({
    length: 100,
    residue: 50,
    variantShort: "p.Xxx50Yyy",
    domains: [],
    structuralDomains: [],
    secondaryStructure: [],
    rows: [row()],
    ...over,
  });
  const belowPin = (L: ReturnType<typeof layoutArchitecture>) => {
    const p = L.pins.find((x) => x.shape === "diamond");
    if (!p) throw new Error("fixture drew no below-backbone pin");
    return p;
  };

  it("touches the backbone when no domain box covers the residue", () => {
    const L = layoutArchitecture(evidenceWith({}), 800, { start: 1, end: 100 }, null);
    expect(belowPin(L).stemFrom).toBeCloseTo(L.backbone.y + L.backbone.h / 2, 5);
  });

  it("still meets the box that covers the residue, in that box's own lane", () => {
    const L = layoutArchitecture(
      evidenceWith({
        domains: [{ key: "dom", name: "Test domain", source: "Pfam", accession: "PF0001", interpro: null, entryType: "domain", segments: [{ start: 30, end: 60 }], covers: true, coverage: 0.3, url: null }],
        rows: [row(), row({ key: "match-dom", group: "domains", name: "Test domain", type: "Pfam", start: 30, end: 60, covers: true, lane: "none", rowKey: "match-dom" })],
      }),
      800,
      { start: 1, end: 100 },
      null
    );
    const boxBottom = Math.max(...L.domains.map((d) => d.y + 30));
    expect(boxBottom).toBeCloseTo(L.backbone.y + 15, 5);
    expect(belowPin(L).stemFrom).toBeCloseTo(boxBottom, 5);
  });

  it("leaves the covering box itself, not the bottom of an empty deeper lane", () => {
    // A genuinely overlapping signature forces a second lane, but the residue's own covering box
    // stays in lane 0: the stem must meet THAT box, not the lowest lane's floor.
    const L = layoutArchitecture(
      evidenceWith({
        domains: [
          { key: "dom", name: "Covering domain", source: "Pfam", accession: "PF0001", interpro: null, entryType: "domain", segments: [{ start: 30, end: 60 }], covers: true, coverage: 0.3, url: null },
          { key: "over", name: "Overlapping signature", source: "Pfam", accession: "PF0002", interpro: null, entryType: "domain", segments: [{ start: 50, end: 80 }], covers: false, coverage: 0.3, url: null },
        ],
        rows: [row(), row({ key: "match-dom", group: "domains", name: "Covering domain", type: "Pfam", start: 30, end: 60, covers: true, lane: "none", rowKey: "match-dom" })],
      }),
      800,
      { start: 1, end: 100 },
      null
    );
    const covering = L.domains.find((d) => d.key.startsWith("dom-"));
    const overlapping = L.domains.find((d) => d.key.startsWith("over-"));
    expect(covering!.lane).toBe(0);
    expect(overlapping!.lane).toBe(1);
    expect(belowPin(L).residue).toBe(40);
    const stemFrom = belowPin(L).stemFrom;
    expect(stemFrom).toBeCloseTo(covering!.y + 30, 5);
    expect(stemFrom).not.toBeCloseTo(Math.max(...L.domains.map((d) => d.y + 30)), 5); // never the lowest lane's floor
  });

  it("joins the backbone, a lower layer or the covering box on the real overlap fixture — never the dead gap", () => {
    const overlap = buildFunctionEvidence(functionEvidenceInputFrom(molecularWorkspaceFixture()));
    const L = layoutArchitecture(overlap, 900, { start: 1, end: overlap.length }, null);
    const backboneEdge = L.backbone.y + L.backbone.h / 2;
    // A secondary-structure strip or a Gene3D lane, when drawn, is the layer the stems leave instead.
    const lowerLayer = L.showSecondary
      ? Math.min(...L.secondary.map((s) => s.y)) + 8
      : L.structural.length
        ? Math.min(...L.structural.map((s) => s.y)) + 4
        : null;
    const stems = L.pins.filter((p) => p.stem && p.y > L.backbone.y + L.backbone.h);
    expect(stems.length).toBeGreaterThan(0);
    for (const p of stems) {
      // The bottom edge of the box that actually covers the residue, in that box's own lane.
      let coverBottom: number | null = null;
      for (const d of L.domains) if (p.x >= d.x && p.x <= d.x + d.width) coverBottom = Math.max(coverBottom ?? -Infinity, d.y + 30);
      const expected = lowerLayer ?? coverBottom ?? backboneEdge;
      expect(p.stemFrom, `stem for residue ${p.residue} (${coverBottom !== null ? "over a domain" : "no box"})`).toBeCloseTo(expected, 5);
    }
  });

  it("sits signatures with no shared residue on one lane and freezes lane numbers across windows", () => {
    // Demo1 90–245 and Demo3 40–80/290–380 never share a residue: an adjacent pair, not an overlap.
    // The pixel-gap packer separated such pairs; residue-space packing must keep them together, and
    // the same assignment must hold whatever window is shown.
    const lanesOf = (win: { start: number; end: number }) => {
      const L = layoutArchitecture(ev, 800, win, null);
      return new Map(L.domains.filter((d) => d.rowKey.startsWith("match-SMART-DEMO")).map((d) => [d.rowKey, d.lane]));
    };
    const whole = lanesOf({ start: 1, end: ev.length });
    expect(whole.get("match-SMART-DEMO1")).toBe(whole.get("match-SMART-DEMO3"));
    for (const win of [{ start: 55, end: 320 }, { start: 60, end: 300 }, { start: 100, end: 200 }]) {
      const m = lanesOf(win);
      const label = `window ${win.start}–${win.end}`;
      expect(m.get("match-SMART-DEMO1") ?? -1, label).toBe(whole.get("match-SMART-DEMO1") ?? -2);
      expect(m.get("match-SMART-DEMO3") ?? -1, label).toBe(whole.get("match-SMART-DEMO3") ?? -2);
    }
  });
});

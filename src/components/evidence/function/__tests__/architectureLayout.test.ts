import { describe, expect, it } from "vitest";
import { buildFunctionEvidence, type AnnotationRow, type DomainBox } from "../../../../shared/functionEvidence";
import { buildDomainUnits } from "../../../../shared/domainUnits";
import { functionEvidenceInputFrom } from "../../../../shared/functionEvidenceInput";
import { molecularWorkspaceFixture } from "../../../../test/molecularWorkspaceFixture";
import { NAE1_INPUT } from "../../../../shared/__tests__/fixtures/nae1FunctionalDomains";
import { layoutArchitecture, layoutOverview } from "../architectureLayout";
import { layoutDomainBoxes } from "../domainLaneLayout";

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

  it("draws a modification with the same shape when zoomed in as in the whole-protein lanes", () => {
    const near = layoutArchitecture(big, 994, { start: 900, end: 1000 }, null);
    expect(near.pins.find((p) => p.residue === 995)).toMatchObject({ stem: true, shape: "circle" });
  });

  it("runs the variant's line unbroken down to its tick on the topology lane", () => {
    for (const win of [all, { start: 435, end: 535 }]) {
      const L = layoutArchitecture(big, 994, win, null);
      expect(L.query!.stemTo).toBeGreaterThanOrEqual(L.membrane!.outsideY - 6);
    }
  });

  it("moves a topology label off the variant's tick when the window is centred on the variant", () => {
    const L = layoutArchitecture(big, 994, { start: 435, end: 535 }, null);
    const label = L.membrane!.labels.find((l) => l.text === "Cytoplasmic")!;
    const w = label.text.length * label.size * 0.58;
    const [l, r] = label.anchor === "start" ? [label.x, label.x + w] : label.anchor === "end" ? [label.x - w, label.x] : [label.x - w / 2, label.x + w / 2];
    expect(L.query!.x < l - 2 || L.query!.x > r + 2).toBe(true);
  });

  it("keeps every label under the backbone clear of the variant's line, in tiers and in lanes", () => {
    const sites = (at: number[]) => at.map((r) => ({ type: "Binding site", description: "", start: r, end: r, evidence: E, ligand: "ATP" }));
    for (const at of [[470, 478], Array.from({ length: 30 }, (_, i) => 380 + i * 7)]) {
      const dense = buildFunctionEvidence({ ...NAE1_INPUT, residue: 485, uniprot: { ...uniprot, features: [...uniprot.features, ...sites(at)] }, engineCriteria: [] });
      const L = layoutArchitecture(dense, 994, all, null);
      const crossed = L.pins.filter((p) => p.y > L.backbone.y && p.label).filter((p) => {
        const w = p.label!.text.length * p.label!.size * 0.58;
        const lo = p.label!.anchor === "end" ? p.label!.x - w : p.label!.x;
        return L.query!.x > lo - 2 && L.query!.x < lo + w + 2;
      });
      expect(crossed.map((p) => p.label!.text)).toEqual([]);
    }
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
  // Boxes in, units out: the layout draws the model's domain units, built here the way the model builds them.
  const evidenceWith = ({ domains = [], ...over }: Partial<ArchInput> & { domains?: DomainBox[] }): ArchInput => ({
    length: 100,
    residue: 50,
    variantShort: "p.Xxx50Yyy",
    domainUnits: buildDomainUnits(domains, [], 50),
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
    const covering = L.domains.find((d) => d.key.startsWith("dom:"));
    const overlapping = L.domains.find((d) => d.key.startsWith("over:"));
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
    // the same assignment must hold whatever window is shown. Built from the overlap fixture: the
    // module-level NAE1 evidence carries no SMART DEMO signature.
    const overlapEv = buildFunctionEvidence(functionEvidenceInputFrom(molecularWorkspaceFixture()));
    const lanesOf = (win: { start: number; end: number }) => {
      const L = layoutArchitecture(overlapEv, 800, win, null);
      return new Map(L.domains.filter((d) => d.rowKey.startsWith("match-SMART-DEMO")).map((d) => [d.rowKey, d.lane]));
    };
    const whole = lanesOf({ start: 1, end: overlapEv.length });
    expect(whole.get("match-SMART-DEMO1")).toBe(whole.get("match-SMART-DEMO3"));
    expect([...whole.keys()].sort()).toEqual(["match-SMART-DEMO1", "match-SMART-DEMO3"]);
    // Every window compared here actually draws both signatures; a window covering only one of
    // them says nothing about how the pair was packed.
    for (const win of [{ start: 55, end: 320 }, { start: 60, end: 300 }]) {
      const m = lanesOf(win);
      expect(m, `window ${win.start}–${win.end}`).toEqual(whole);
    }
  });
});

describe("layoutDomainBoxes — every box drawn carries a name when it can", () => {
  const unit = (start: number, end: number, name: string) => ({
    key: `u${start}`, entryKey: "IPR1", entryName: name, name, rowKey: `r${start}`, memberKeys: [`r${start}`], sources: [],
    start, end, core: { start, end }, covers: false, index: 1, ofEntry: 1, url: null,
  });
  const scale = (win: { start: number; end: number }) => (r: number) => 10 + ((r - win.start) / (win.end - win.start)) * 980;
  const lay = (start: number, end: number, name: string, win: { start: number; end: number }) =>
    layoutDomainBoxes({ units: [unit(start, end, name)], win, x: scale(win), bb: 100, queryX: null, regionSpans: [], selectedKey: null }).boxes[0];

  it("names a box cut by the window inside the part that is drawn", () => {
    const win = { start: 308, end: 408 };
    const box = lay(110, 330, "ABC transporter family G domain", win);
    expect(box.label).not.toBeNull();
    expect(box.label!.x).toBeGreaterThan(scale(win)(308));
    expect(box.label!.x).toBeLessThan(scale(win)(330));
  });

  it("gives a narrow box its name before its end numbers", () => {
    const box = lay(274, 332, "Walker B", { start: 1, end: 678 });
    expect(box.label?.text).toBe("Walker B");
    expect(box.ends).toEqual([]);
  });

  it("shortens a name with an ellipsis when only part of it fits, keeping the full name in the title", () => {
    const box = lay(300, 345, "ATP-binding cassette transporter", { start: 1, end: 678 });
    expect(box.label?.text).toMatch(/…$/);
    expect(box.title).toContain("ATP-binding cassette transporter");
  });
});

import { describe, expect, it } from "vitest";
import { buildFunctionEvidence } from "../../../../shared/functionEvidence";
import { layoutArchitecture } from "../architectureLayout";
import { GZF1_INPUT } from "../../../../shared/__tests__/fixtures/gzf1FunctionalDomains";

/** GZF1 p.Arg591Trp: ten zinc fingers from four signatures of one InterPro entry, one disease variant over 289–711. */
const ev = buildFunctionEvidence(GZF1_INPUT);

describe("GZF1 protein map", () => {
  it("draws the BTB domain and ten zinc fingers on one row, plus one unintegrated Pfam match", () => {
    const L = layoutArchitecture(ev, 900, { start: 1, end: ev.length }, null);
    expect(L.domains.filter((d) => d.lane === 0)).toHaveLength(11);
    // PF13894 has no InterPro entry, so it is not merged into zinc finger 3; it is the only box on a second row.
    expect(L.domains.filter((d) => d.lane > 0).map((d) => d.title)).toEqual([expect.stringContaining("PF13894")]);
    // The UniProt zinc fingers are the units' names, not a second set of insets over them.
    expect(L.regions).toHaveLength(0);
  });

  it("names the zinc-finger entry once when the boxes are too narrow for their own names", () => {
    const L = layoutArchitecture(ev, 900, { start: 1, end: ev.length }, null);
    expect(L.entryLabels.map((l) => l.text)).toContain("Zinc finger C2H2-type ×10");
  });

  it("draws the 289–711 variant as a span and no pin at 289", () => {
    const L = layoutArchitecture(ev, 900, { start: 1, end: ev.length }, null);
    expect(L.spans).toHaveLength(1);
    expect(L.pins.some((p) => p.residue === 289)).toBe(false);
    expect(L.spans[0].x2 - L.spans[0].x1).toBeGreaterThan(400);
  });

  it("keeps a unit cut by the window square on that side, and its label inside the drawing", () => {
    const L = layoutArchitecture(ev, 900, { start: 541, end: 641 }, null);
    const cut = L.domains.find((d) => d.start === 519)!;
    expect(cut.clip).toEqual({ left: true, right: false });
    for (const d of L.domains) if (d.label) expect(d.label.x).toBeGreaterThanOrEqual(L.x0);
    const tenth = L.domains.find((d) => d.start === 575)!;
    expect(tenth.core).not.toBeNull();
    expect(tenth.covers).toBe(true);
  });

  it("selects a unit from any of its database rows", () => {
    const L = layoutArchitecture(ev, 900, { start: 541, end: 641 }, "match-SMART-SM00355");
    expect(L.domains.filter((d) => d.selected).map((d) => d.start).sort((a, b) => a - b)).toEqual([519, 547, 575]);
  });
});

describe("GZF1 placement is exact", () => {
  // Every mark is placed by one residue scale; a pin, a span end, a box edge and the variant's stem must land on it.
  const exact = (width: number, win: { start: number; end: number }) => {
    const L = layoutArchitecture(ev, width, win, null);
    const at = (r: number) => L.x0 + ((Math.min(Math.max(r, win.start), win.end) - win.start) / (win.end - win.start)) * (L.x1 - L.x0);
    return { L, at };
  };
  it.each([
    [900, { start: 1, end: 711 }],
    [900, { start: 541, end: 641 }],
    [380, { start: 541, end: 641 }],
  ])("puts pins, spans, boxes and the variant stem on the scale at %i px, window %o", (width, win) => {
    const { L, at } = exact(width, win);
    for (const p of L.pins) expect(p.x).toBeCloseTo(at(p.residue), 6);
    for (const d of L.domains) {
      expect(d.x).toBeCloseTo(at(d.start), 6);
      expect(d.x + d.width).toBeCloseTo(Math.max(at(d.end), d.x + 3), 6);
    }
    for (const s of L.spans) {
      expect(s.x1).toBeCloseTo(at(289), 6);
      expect(s.x2).toBeCloseTo(at(711), 6);
    }
    expect(L.query!.x).toBeCloseTo(at(591), 6);
    // The stem runs from the variant's head down through every domain box it sits in.
    for (const d of L.domains.filter((x) => x.covers)) expect(L.query!.stemTo).toBeGreaterThan(d.y + 30);
  });
});

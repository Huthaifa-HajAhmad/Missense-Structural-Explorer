// @vitest-environment jsdom
/**
 * Landscape tab, output delivery. What the reader gets from the screen, not what the model computes:
 *   — the grids are one tab stop each, with arrow keys inside (a 620-cell heatmap was 620 tab stops);
 *   — hover or focus puts both predictors for the cell in the header;
 *   — a residue dbNSFP has no record for says so (SOD1 residue 6) instead of passing as "no score";
 *   — no row is drawn only to say it is empty (domains, regional O/E, an AlphaGenome lane with no codon in view);
 *   — the residues fill the card instead of leaving a quarter of it blank;
 *   — several ClinVar records at one residue are one marker, and a drag moves the window once.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LandscapeResidueItem } from "../../../shared/contracts";
import { fitColumnWidth, hasNoRecord, LandscapeFocus } from "../LandscapeFocus";
import { LandscapeOverview } from "../LandscapeOverview";
import { LandscapeLegend } from "../LandscapeLegend";

// SOD1 p.Ala5Val, residues 4-7. Residue 6 has no dbNSFP record (the live source returns none for it).
const rows = new Map<number, LandscapeResidueItem>([
  [4, { residx: 4, amMean: 0.2, amCount: 5, revelMean: 0.3, revelCount: 5, gerp: 1, phylop: 2, nucleotideCount: 3, substitutions: [{ alt: "E", am: 0.2, revel: 0.3 }] } as any],
  [
    5,
    {
      residx: 5, amMean: 0.7, amCount: 6, revelMean: 0.7, revelCount: 6, gerp: 4, phylop: 5, nucleotideCount: 3,
      substitutions: [
        { alt: "V", am: 0.8401, revel: 0.853 },
        { alt: "T", am: 0.5, revel: 0.6 }
      ]
    } as any
  ],
  [6, { residx: 6, amMean: null, amCount: 0, revelMean: null, revelCount: 0, gerp: null, phylop: null, nucleotideCount: 0 } as any],
  [7, { residx: 7, amMean: 0.1, amCount: 5, revelMean: 0.1, revelCount: 5, gerp: 2, phylop: 3, nucleotideCount: 3, substitutions: [{ alt: "F", am: 0.1, revel: 0.1 }] } as any]
]);

function focus(over: Record<string, unknown> = {}) {
  return render(
    <LandscapeFocus
      residues={["K", "A", "V", "C"]}
      start={4}
      target={{ wt: "A", pos: 5, mut: "V" }}
      width={15}
      rows={rows}
      mode="mean"
      colorBy="alphaMissense"
      variantScores={{ revel: 0.853, am: 0.8401, gerp: null, phylop: null }}
      domains={[]}
      selected={null}
      selectedGenomic={null}
      hoveredPos={null}
      loadingWindow={false}
      codons={new Map()}
      strand="+"
      laneStatus="ready"
      genomicPos={null}
      genomicAlt={null}
      onPickResidue={vi.fn()}
      onPickSubstitution={vi.fn()}
      onPickNucleotide={vi.fn()}
      onHover={vi.fn()}
      {...over}
    />
  );
}

describe("focus grids are keyboard-reachable", () => {
  it("leaves one tab stop in the heatmap, on the queried cell, and moves with the arrow keys", () => {
    focus();
    const grid = screen.getByRole("group", { name: /Substitution heatmap/ });
    const cells = Array.from(grid.querySelectorAll<HTMLElement>("[data-rc]"));
    expect(cells.length).toBe(20 * 4);
    const tabbable = cells.filter((c) => c.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    // A5V: the queried cell is where Tab lands.
    expect(tabbable[0].getAttribute("aria-label")).toMatch(/^A5V: AlphaMissense 0\.840/);

    tabbable[0].focus();
    fireEvent.keyDown(tabbable[0], { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reference V6");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    // One row up from V is A (the heatmap lists A first, so V is row 1): V6A.
    expect(document.activeElement?.getAttribute("data-rc")).toBe("0:2");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^V6A/);
    // Exactly one stop remains, now on the focused cell.
    expect(cells.filter((c) => c.tabIndex === 0)).toEqual([document.activeElement]);
  });

  it("makes every residue and summary cell part of a grid, not its own tab stop", () => {
    focus();
    const residueGrid = screen.getByRole("group", { name: "Residues in the focus window" });
    expect(Array.from(residueGrid.querySelectorAll<HTMLElement>("button")).filter((b) => b.tabIndex === 0)).toHaveLength(1);
  });
});

describe("hover readout", () => {
  it("shows both predictors for the cell in the header, whichever one colours the grid", () => {
    focus();
    fireEvent.mouseEnter(screen.getByLabelText(/^A5V: AlphaMissense/));
    expect(screen.getByText("A5V · AlphaMissense 0.840 (PP3) · REVEL 0.853 (PP3 Moderate) · the queried variant")).toBeTruthy();
    fireEvent.mouseLeave(screen.getByLabelText(/^A5V: AlphaMissense/));
    expect(screen.queryByText(/REVEL 0\.853/)).toBeNull();
  });

  it("says why a cell has no score instead of printing an empty reading", () => {
    focus();
    fireEvent.mouseEnter(screen.getByLabelText(/^V6A: no dbNSFP missense record/));
    expect(screen.getByText("V6A · no dbNSFP missense record at this residue")).toBeTruthy();
  });
});

describe("a residue dbNSFP has no record for", () => {
  it("is its own state, apart from 'SNV-reachable, no score'", () => {
    expect(hasNoRecord(rows.get(6))).toBe(true);
    expect(hasNoRecord(rows.get(5))).toBe(false);
    expect(hasNoRecord(undefined)).toBe(true);
    focus();
    expect(screen.getByLabelText(/^V6A: no dbNSFP missense record at this residue/).getAttribute("data-band")).toBe("norecord");
    // A residue that does have a record keeps the ordinary state for a missing substitution.
    expect(screen.getByLabelText(/^K4A: no AlphaMissense score/).getAttribute("data-band")).toBe("unscored");
  });
});

describe("rows that only said they were empty are not drawn", () => {
  it("omits the domain row when no domain overlaps the window", () => {
    focus({ domains: [] });
    expect(screen.queryByText("DOMAIN")).toBeNull();
    expect(screen.queryByText(/none annotated in this window/)).toBeNull();
  });

  it("draws the domain row when one does", () => {
    focus({ domains: [{ name: "Cu/Zn", start: 1, end: 10 }] });
    expect(screen.getByText("DOMAIN")).toBeTruthy();
  });

  it("collapses an AlphaGenome lane with no codon in view to one sentence", () => {
    const { container } = focus({ laneStatus: "ready", codons: new Map() });
    expect(screen.getByText(/none of residues 4–7 lie in it/)).toBeTruthy();
    expect(container.querySelectorAll(".ls-nt").length).toBe(0);
  });
});

describe("the residues fill the card", () => {
  it("fits columns to the measured width within sane limits, and falls back before it is measured", () => {
    // 1090 px card, 88 px gutter, 16 px right pad, 31 residues → 31 px columns, not the fixed 27.
    expect(fitColumnWidth(1090, 31, 27)).toBe(31);
    expect(fitColumnWidth(0, 31, 27)).toBe(27);
    expect(fitColumnWidth(400, 41, 21)).toBe(18);
    expect(fitColumnWidth(1090, 15, 30)).toBe(48);
  });
});

describe("LandscapeOverview", () => {
  const ctx = (clinvar: any[], regions: any[] | null = [], regionsStatus: "available" | "none" | "withheld-mapping" | "unavailable" = regions === null ? "unavailable" : "none") =>
    ({ clinvar, gnomad: [], regions, regionsStatus, transcript: null, regionsBasis: "gnomAD v4.1.1 genomic intervals", errors: [] });
  const props = (context: any) => ({
    length: 154,
    status: "ready" as const,
    positions: [],
    context,
    domains: [],
    window: { start: 1, end: 31 },
    targetPos: 5,
    mode: "mean" as const,
    lanes: { clinvar: true, gnomad: true, regions: true },
    onMove: vi.fn(),
    onPick: vi.fn(),
    pageStep: 31
  });

  it("keeps ClinVar assertion classes separate and preserves every record in count bins", () => {
    // jsdom measures every box as 0 wide, and the strip draws nothing until it has a width.
    const measure = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, width: 1540, top: 0, height: 44, right: 1540, bottom: 44, x: 0, y: 0, toJSON: () => ({}) });
    const { container } = render(
      <LandscapeOverview
        {...props(
          ctx([
            { pos: 5, cls: "other", significance: "Uncertain significance", stars: 1, hgvsp: "p.Ala5Asp" },
            { pos: 5, cls: "plp", significance: "Pathogenic", stars: 3, hgvsp: "p.Ala5Val" },
            { pos: 5, cls: "plp", significance: "Pathogenic", stars: 2, hgvsp: "p.Ala5Thr" }
          ])
        )}
      />
    );
    const markers = container.querySelectorAll("svg g[role='button']");
    expect(markers).toHaveLength(2);
    const title = markers[0].querySelector("title")!.textContent!;
    expect(title).toContain("p.Ala5Val · Pathogenic · 3★");
    expect(title).toContain("p.Ala5Thr");
    expect(markers[1].querySelector("title")!.textContent).toContain("p.Ala5Asp");
    expect(markers[0].getAttribute("aria-label")).toContain("2 ClinVar P / LP records across 1 residue position(s)");
    expect(markers[0].querySelectorAll("rect")[1].getAttribute("fill")).toBe("var(--ls-clinvar-plp)");
    measure.mockRestore();
  });

  it("omits the domain and regional-constraint rows when the gene has none, and says so once", () => {
    render(<LandscapeOverview {...props(ctx([]))} />);
    expect(screen.queryByText("Domains")).toBeNull();
    expect(screen.queryByText("Missense O/E")).toBeNull();
    expect(screen.getByText("no UniProt domain or region annotated")).toBeTruthy();
    expect(screen.getByText("no regional missense constraint call for this gene")).toBeTruthy();
    // The O/E explanation is for bars that are drawn.
    expect(screen.queryByText(/solid bar = fewer missense observed/)).toBeNull();
  });

  it("explains the O/E bars and shows the gnomAD basis when regions are drawn", () => {
    render(<LandscapeOverview {...props(ctx([], [{ start: 1, end: 10, oe: 0.4, pValue: 0.01 }]))} />);
    expect(screen.getByText(/solid bar = fewer missense observed than expected \(O\/E < 0\.6\)/)).toBeTruthy();
    expect(screen.getByText(/gnomAD v4\.1\.1 genomic intervals/)).toBeTruthy();
  });

  it("says ClinVar and gnomAD are not loaded, not pending, when the overview request failed", () => {
    render(<LandscapeOverview {...props(null)} status="error" error="request failed" />);
    expect(screen.getByText("ClinVar not loaded")).toBeTruthy();
    expect(screen.getByText("gnomAD not loaded")).toBeTruthy();
    expect(screen.queryByText(/context pending/)).toBeNull();
  });

  it("keeps the row and says so when regional constraint failed to load", () => {
    render(<LandscapeOverview {...props(ctx([], null))} />);
    expect(screen.getByText("Missense O/E")).toBeTruthy();
    expect(screen.getByText("Regional constraint not loaded")).toBeTruthy();
  });

  it("calls a withheld map withheld, not missing, when only the protein mapping is absent", () => {
    render(<LandscapeOverview {...props(ctx([], null, "withheld-mapping"))} />);
    expect(screen.getByText("Missense O/E")).toBeTruthy();
    expect(screen.getByText("Regional map withheld: transcript-to-protein mapping not verified")).toBeTruthy();
    expect(screen.queryByText("Regional constraint not loaded")).toBeNull();
  });

  it("moves the window once, on release, after a drag", () => {
    const p = props(ctx([]));
    render(<LandscapeOverview {...p} />);
    const slider = screen.getByRole("slider");
    // jsdom measures every box as 0 wide, so give the strip a real extent.
    slider.getBoundingClientRect = () => ({ left: 0, width: 1540, top: 0, height: 44, right: 1540, bottom: 44, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 700, pointerId: 1 });
    expect(p.onMove).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider, { clientX: 700, pointerId: 1 });
    expect(p.onMove).toHaveBeenCalledTimes(1);
    expect(p.onMove).toHaveBeenCalledWith(71);
  });
});

describe("LandscapeLegend", () => {
  it("keeps whole-protein keys specific to its score bars", () => {
    render(<LandscapeLegend overview colorBy="alphaMissense" laneVisible={false} />);
    expect(screen.getAllByText(/AlphaMissense bands/).length).toBeGreaterThan(0);
    expect(screen.queryByText("SNV-reachable, no score")).toBeNull();
    expect(screen.queryByText(/phyloP bar/)).toBeNull();
  });

  it("shows the bands of the tool the grid is coloured by and keeps the rest behind one disclosure", () => {
    const { container, rerender } = render(<LandscapeLegend colorBy="alphaMissense" laneVisible={false} />);
    expect(screen.getAllByText(/AlphaMissense bands/).length).toBeGreaterThan(0);
    expect(container.querySelectorAll("details table")).toHaveLength(1);
    // The full two-tool table and the caveats are inside a closed <details>.
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("Conservation is not pathogenicity");
    // The nucleotide-lane key is offered only when the lane is on screen.
    expect(details.textContent).not.toContain("AlphaGenome AVI genome-wide rank");
    rerender(<LandscapeLegend colorBy="revel" laneVisible />);
    expect(screen.getAllByText(/REVEL bands/).length).toBeGreaterThan(0);
    expect(container.querySelector("details")!.textContent).toContain("AlphaGenome AVI genome-wide rank");
  });
});

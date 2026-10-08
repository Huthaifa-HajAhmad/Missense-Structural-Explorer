// @vitest-environment jsdom
/**
 * The Landscape rail reads the tab's selection. Pinned here:
 *   — the verdict comes FIRST (score + band chip per tool), and what it is read on is named:
 *     a picked substitution or the queried variant is variant-level; a plain residue pick shows
 *     the residue mean and says the band is orientation only;
 *   — every scored substitution is a clickable letter that opens its own reading;
 *   — a residue with no dbNSFP record says so instead of printing "no score" twice;
 *   — the queried variant is marked in the residue's ClinVar list, never counted beside itself;
 *   — method and citations stay behind one disclosure.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { LandscapeInspector, placeStripChips } from "../LandscapeInspector";
import { landscapeKey } from "../../../shared/landscapeEvidence";
import { SOD1_LANDSCAPE_ROWS, SOD1_RESIDUE5_SUBS } from "../../../shared/__tests__/fixtures/sod1Landscape";

const KEY = landscapeKey("NAE1", "p.Asp116Gly", "Q13564");

const result: any = {
  metadata: { residueIndex: 116, wildType: "D", mutant: "G", variant: "p.Asp116Gly" },
  conservationData: { revel: 0.231 },
  predictorData: { amPathogenicity: 0.362 },
  landscapeData: [
    {
      residx: 116, amMean: 0.47, amMin: 0.1, amMax: 0.95, amCount: 3, revelMean: 0.41, revelMin: 0.1, revelMax: 0.9, revelCount: 3,
      gerp: 4.8, phylop: 7.6, nucleotideCount: 3,
      substitutions: [
        { alt: "G", am: 0.362, revel: 0.231 },
        { alt: "V", am: 0.95, revel: 0.9 },
        { alt: "N", am: 0.1, revel: 0.1 }
      ]
    }
  ],
  landscapeMeta: null
};

describe("LandscapeInspector", () => {
  beforeEach(() => {
    act(() => {
      useVariantAnalysisStore.setState({
        gene: "NAE1",
        variant: "p.Asp116Gly",
        uniprotId: "Q13564",
        selectedResidueIndex: 116,
        hoveredResidueIndex: null,
        selectedGenomicVariant: null,
        // The rail tab is session-persisted, so each test starts from the default again.
        landscapeRailTab: "summary",
        landscapeSelection: { key: KEY, kind: "residue", pos: 116 },
        landscapeOverview: {
          key: KEY,
          status: "ready",
          error: null,
          data: {
            positions: [],
            meta: {} as any,
            context: { clinvar: [], gnomad: [{ pos: 116, variants: 2, maxAc: 10 }], regions: [{ start: 96, end: 262, oe: 0.41, pValue: 0.001 }], regionsStatus: "available", transcript: null, regionsBasis: "gnomAD v4.1.1 regional missense", errors: [] }
          }
        }
      } as any);
    });
  });

  it("normalizes three-letter metadata and warns instead of ranking disagreeing query scores", () => {
    const conflicting = { ...result, metadata: { ...result.metadata, wildType: "Asp", mutant: "Gly" },
      predictorData: { amPathogenicity: 0.108 } };
    render(<LandscapeInspector analysisResult={conflicting} />);
    expect(screen.getByRole("button", { name: "Query D116G" })).toBeTruthy();
    expect(screen.getByText(/queried substitution D116G reads/)).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("AlphaMissense 0.108 from the predictors pipeline vs 0.362 in dbNSFP");
    expect(screen.queryByText(/^Ranks/)).toBeNull();
  });

  it("lists the residue's substitutions as letters and opens one on click without leaving the selection", () => {
    const onSelect = vi.fn();
    render(<LandscapeInspector analysisResult={result} onSelectResidueIndex={onSelect} />);
    // Context reads as key/value rows on the Summary tab; the basis comes from the payload (PR #72).
    expect(screen.getByText("2 missense, max AC 10")).toBeTruthy();
    expect(screen.getByText("0.41 (96–262, gnomAD v4.1.1 regional missense)")).toBeTruthy();
    const v = screen.getAllByRole("button", { name: /^D→V AlphaMissense 0\.950/ })[0];
    fireEvent.click(v);
    expect(useVariantAnalysisStore.getState().landscapeSelection).toMatchObject({ kind: "substitution", pos: 116, alt: "V" });
    expect(onSelect).toHaveBeenCalledWith(116);
  });

  it("keeps the selection and substitutions visible without inspector tabs", () => {
    render(<LandscapeInspector analysisResult={result} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('region', { name: 'Selected residue summary' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Substitution scores' })).toBeTruthy();
  });

  it("returns to the query and clears a previously selected substitution", () => {
    const onSelect = vi.fn();
    act(() => useVariantAnalysisStore.setState({ selectedResidueIndex: 115 }));
    render(<LandscapeInspector analysisResult={result} onSelectResidueIndex={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Query D116G' }));
    expect(onSelect).toHaveBeenCalledWith(116);
    expect(useVariantAnalysisStore.getState().landscapeSelection).toMatchObject({ pos: 116, kind: 'substitution', alt: 'G' });
  });

  it("leads with the verdict on the Summary tab: the 'Reads as' box, then the per-tool rows", () => {
    act(() => useVariantAnalysisStore.setState({ landscapeSelection: { key: KEY, kind: "substitution", pos: 116, alt: "G" } } as any));
    render(<LandscapeInspector analysisResult={result} />);
    const verdict = screen.getByRole("list", { name: "What the scores are read on" });
    expect(verdict.textContent).toContain("AlphaMissense 0.362");
    expect(verdict.textContent).toContain("Indeterminate");
    expect(verdict.textContent).toContain("REVEL 0.231");
    expect(verdict.textContent).toContain("BP4");
    // The lead box precedes the per-tool rows in the reading order.
    const readsAs = screen.getByText(/reads in the BP4 range for REVEL \(0\.231 · BP4\)/).closest(".lsr-readsas")!;
    const pos = readsAs.compareDocumentPosition(verdict);
    expect((pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect(readsAs.textContent).toContain("Reads as");
    expect(screen.getByText(/Ranks 2 of 3 scored substitutions here/)).toBeTruthy();
    expect(screen.getByText(/The queried variant/)).toBeTruthy();
  });

  it("says a plain residue pick is a summary, not a variant-level call", () => {
    // Residue 115 is not the queried residue, so the verdict reads the residue mean — and says so.
    const withNeighbour: any = {
      ...result,
      landscapeData: [
        ...result.landscapeData,
        { residx: 115, amMean: 0.2, amMin: 0.1, amMax: 0.3, amCount: 4, revelMean: 0.3, revelMin: 0.2, revelMax: 0.4, revelCount: 4, gerp: 4, phylop: 6, nucleotideCount: 3, substitutions: [] }
      ]
    };
    act(() => useVariantAnalysisStore.setState({ selectedResidueIndex: 115, landscapeSelection: { key: KEY, kind: "residue", pos: 115 } } as any));
    render(<LandscapeInspector analysisResult={withNeighbour} />);
    expect(screen.getByText(/Residue mean over its scored substitutions — orientation only/)).toBeTruthy();
  });

  it("reads the queried variant's own scores when the queried residue is picked", () => {
    render(<LandscapeInspector analysisResult={result} />);
    expect(screen.getByText(/The queried variant/)).toBeTruthy();
    expect(screen.getByText(/variant-level score, so its band applies to the variant/)).toBeTruthy();
  });

  it("says a residue has no dbNSFP record instead of printing '0 substitutions · no score' twice", () => {
    act(() => useVariantAnalysisStore.setState({ selectedResidueIndex: 6, landscapeSelection: { key: KEY, kind: "residue", pos: 6 } } as any));
    const gap: any = {
      ...result,
      landscapeData: [{ residx: 6, amMean: null, amCount: 0, revelMean: null, revelCount: 0, gerp: null, phylop: null, nucleotideCount: 0 }]
    };
    render(<LandscapeInspector analysisResult={gap} />);
    expect(screen.getByText(/dbNSFP has no missense record at residue 6/)).toBeTruthy();
    expect(screen.getByText(/absence of data, not a benign reading/)).toBeTruthy();
    expect(screen.queryByText("no score")).toBeNull();
    expect(screen.queryByText(/0 substitutions/)).toBeNull();
    // Nothing to plot, so no scatter.
    expect(screen.queryByText(/REVEL × AlphaMissense/)).toBeNull();
  });

  it("marks the queried variant in the residue's ClinVar list, apart from the other records", () => {
    act(() =>
      useVariantAnalysisStore.setState({
        landscapeOverview: {
          key: KEY,
          status: "ready",
          error: null,
          data: {
            positions: [],
            meta: {} as any,
            context: {
              clinvar: [
                { pos: 116, cls: "plp", significance: "Pathogenic", stars: 2, hgvsp: "p.Asp116Gly" },
                { pos: 116, cls: "plp", significance: "Pathogenic", stars: 2, hgvsp: "p.Asp116Val" }
              ],
              gnomad: [], regions: [], regionsStatus: "none", transcript: null, regionsBasis: "gnomAD v4.1.1 regional missense", errors: []
            }
          }
        }
      } as any)
    );
    render(<LandscapeInspector analysisResult={result} />);
    expect(screen.getByText("p.Asp116Gly Pathogenic (queried); p.Asp116Val Pathogenic")).toBeTruthy();
  });

  it("keeps the method and citations behind one disclosure below the selection", () => {
    const { container } = render(<LandscapeInspector analysisResult={result} />);
    const d = container.querySelector("details")!;
    expect(d.open).toBe(false);
    expect(d.textContent).toContain("Pejaver et al.");
  });
});

describe("placeStripChips", () => {
  it("keeps the SOD1 residue-5 letters clear of each other at rail width", () => {
    // The live failure: six chips in 0.76–0.87 used to overlap (S/V drew on top of each other).
    const chips = SOD1_RESIDUE5_SUBS.map((s) => ({ alt: s.alt, v: s.revel }));
    const placed = placeStripChips(300, chips);
    const sorted = [...placed].sort((a, b) => a.chipLeft - b.chipLeft);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].chipLeft - sorted[i - 1].chipLeft).toBeGreaterThanOrEqual(24);
    }
    // Chips stay inside the strip, and stay ordered by value.
    for (const p of placed) {
      expect(p.chipLeft).toBeGreaterThanOrEqual(0);
      expect(p.chipLeft).toBeLessThanOrEqual(300 - 24);
    }
    expect(placed.map((p) => p.value)).toEqual([...placed.map((p) => p.value)].sort((a, b) => a - b));
  });

  it("anchors stay at the true values, so a moved chip can point back at its position", () => {
    const chips = SOD1_RESIDUE5_SUBS.map((s) => ({ alt: s.alt, v: s.revel }));
    const placed = placeStripChips(300, chips);
    for (const p of placed) {
      expect(p.anchorLeft).toBeCloseTo(Math.min(Math.max(p.value * 300 - 12, 0), 300 - 24), 6);
    }
  });

  it("spreads nine chips evenly, edge to edge, when the strip is too narrow for them", () => {
    const chips = "ACDEFGHIK".split("").map((alt, i) => ({ alt, v: 0.5 + i * 0.001 }));
    const placed = placeStripChips(200, chips);
    expect(placed[0].chipLeft).toBe(0);
    expect(placed[8].chipLeft).toBeCloseTo(200 - 24, 6);
    const gaps = placed.slice(1).map((p, i) => p.chipLeft - placed[i].chipLeft);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6);
  });

  it("walks a right-edge crowd back inside instead of clipping it", () => {
    const placed = placeStripChips(300, [
      { alt: "A", v: 0.96 },
      { alt: "C", v: 0.97 },
      { alt: "G", v: 0.98 }
    ]);
    for (const p of placed) expect(p.chipLeft).toBeLessThanOrEqual(300 - 24);
    const sorted = [...placed].sort((a, b) => a.chipLeft - b.chipLeft);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].chipLeft - sorted[i - 1].chipLeft).toBeGreaterThanOrEqual(24);
    }
  });
});

// @vitest-environment jsdom
/**
 * The Landscape rail reads the tab's selection: a residue shows every scored substitution as a
 * clickable letter; picking one shows that substitution's own scores and its rank at the residue.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { LandscapeInspector } from "../LandscapeInspector";
import { landscapeKey } from "../../../shared/landscapeEvidence";

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
        landscapeSelection: { key: KEY, kind: "residue", pos: 116 },
        landscapeOverview: {
          key: KEY,
          status: "ready",
          error: null,
          data: {
            positions: [],
            meta: {} as any,
            context: { clinvar: [], gnomad: [{ pos: 116, variants: 2, maxAc: 10 }], regions: [{ start: 96, end: 262, oe: 0.41, pValue: 0.001 }], transcript: null, regionsBasis: "gnomAD v2", errors: [] }
          }
        }
      } as any);
    });
  });

  it("lists the residue's substitutions as letters and opens one on click", () => {
    const onSelect = vi.fn();
    render(<LandscapeInspector analysisResult={result} onSelectResidueIndex={onSelect} />);
    expect(screen.getByText("gnomAD: 2 missense, max AC 10")).toBeTruthy();
    expect(screen.getByText("Regional O/E 0.41 (96–262, gnomAD v2)")).toBeTruthy();
    const v = screen.getAllByRole("button", { name: /^D→V AlphaMissense 0\.950/ })[0];
    fireEvent.click(v);
    expect(useVariantAnalysisStore.getState().landscapeSelection).toMatchObject({ kind: "substitution", pos: 116, alt: "V" });
    expect(onSelect).toHaveBeenCalledWith(116);
  });

  it("shows the selected substitution's own scores and its rank at the residue", () => {
    act(() => useVariantAnalysisStore.setState({ landscapeSelection: { key: KEY, kind: "substitution", pos: 116, alt: "G" } } as any));
    render(<LandscapeInspector analysisResult={result} />);
    expect(screen.getByText("the queried variant")).toBeTruthy();
    expect(screen.getByText("AlphaMissense 0.362 · Indeterminate")).toBeTruthy();
    expect(screen.getByText("REVEL 0.231 · BP4")).toBeTruthy();
    expect(screen.getByText(/Ranks 2 of 3 scored substitutions here/)).toBeTruthy();
  });
});

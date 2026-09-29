// @vitest-environment jsdom
/**
 * Landscape tab, rendered. Pins the audit's fixes that live in markup rather than in pure rules:
 *   S2 — every REVEL / AM cell is a residue summary; the variant's own score is a separate mark;
 *   S3 — cells carry the calibrated band;
 *   S8 — a − strand grid shows the coding strand (complemented), queried cell included;
 *   D1 — the tab says "loading" while the sequence loads, not "press Analyze".
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SequenceRowGrid } from "../SequenceRowGrid";
import type { LandscapeResidueItem } from "../../../shared/contracts";

const fetchWithAuth = vi.fn();
vi.mock("../../../apiClient", () => ({
  useApiClient: () => ({ fetchWithAuth, apiClient: { getLandscapeData: vi.fn(async () => ({ landscapeData: [] })) } })
}));

const sequenceState = { sequence: "", isLoading: false, error: null as string | null };
vi.mock("../../../hooks/useProteinSequence", () => ({ useProteinSequence: () => sequenceState }));
vi.mock("../../../context/SettingsContext", () => ({ useSettings: () => ({ settings: { seqColorScheme: "chemical" } }) }));

import { GenomicSaturationHeatmap } from "../GenomicSaturationHeatmap";
import SequenceVisualizer from "../../SequenceVisualizer";

const rows: LandscapeResidueItem[] = [
  { residx: 115, revelMean: 0.2, revelMin: 0.1, revelMax: 0.3, revelCount: 6, amMean: 0.1, amMin: 0.05, amMax: 0.2, amCount: 6, gerp: 5, phylop: 8, nucleotideCount: 3 },
  { residx: 116, revelMean: 0.7, revelMin: 0.1, revelMax: 0.95, revelCount: 7, amMean: 0.85, amMin: 0.3, amMax: 0.99, amCount: 7, gerp: 1, phylop: 0.5, nucleotideCount: 3 },
  { residx: 117, revelMean: null, amMean: null, gerp: null, phylop: null }
];

function renderGrid() {
  return render(
    <SequenceRowGrid
      wildWindow={["S", "D", "P"]}
      relativeStartIndex={115}
      mutation={{ wt: "D", pos: 116, mut: "G" }}
      residueIndex={null}
      hoveredResidueIndex={null}
      landscapeMap={new Map(rows.map((r) => [r.residx, r]))}
      metricMode="mean"
      variantScores={{ revel: 0.231, am: 0.362, gerp: 4.78, phylop: 7.64 }}
      domains={[{ name: "ThiF", start: 100, end: 116 }]}
      residueClass={() => "hydrophobic"}
      onResidueHover={() => {}}
      loadingWindow={false}
    />
  );
}

describe("SequenceRowGrid", () => {
  it("shows the residue summary in the target cell and names the variant score separately", () => {
    renderGrid();
    const cell = screen.getByLabelText(/^Residue 116 REVEL mean/);
    expect(cell.textContent).toBe(".70");
    expect(cell.getAttribute("data-band")).toBe("pp3-supporting");
    expect(cell.getAttribute("aria-label")).toMatch(/over 7 missense substitutions \(range 0\.100–0\.950\).*this variant 0\.231 \(BP4\)/);
    // Variant markers are drawn on the profile, not joined to it.
    expect(screen.getByText("D116G REVEL 0.231 (this variant)")).toBeTruthy();
  });

  it("puts conservation on its own ramp and marks absent scores as absent", () => {
    renderGrid();
    expect(screen.getByLabelText(/^Residue 115 phyloP100way 8\.00/).getAttribute("data-level")).toBe("3");
    expect(screen.getByLabelText("Residue 117 REVEL: no score returned").getAttribute("data-band")).toBe("none");
  });

  it("draws UniProt domains on the residue axis", () => {
    renderGrid();
    expect(screen.getByTitle("ThiF (100–116)")).toBeTruthy();
  });
});

describe("GenomicSaturationHeatmap on a − strand gene", () => {
  it("complements bases and still highlights the queried substitution", async () => {
    fetchWithAuth.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          chrom: "16",
          start: 100,
          end: 101,
          strand: "-",
          positions: [
            { pos: 101, ref: "T", isExonic: true, codonIndex: 116, codonPosition: 2, variants: { C: { phred: 12 }, A: { phred: 3 }, G: { phred: 25 } }, meanPhred: 13, maxPhred: 25 },
            { pos: 100, ref: "C", isExonic: true, codonIndex: 116, codonPosition: 3, variants: { A: { phred: 1 }, G: { phred: 2 }, T: { phred: 3 } }, meanPhred: 2, maxPhred: 3 }
          ]
        }),
        { status: 200 }
      )
    );
    render(
      <GenomicSaturationHeatmap
        chrom="16"
        genomicPos={101}
        genomicAlt="C"
        spliceProximity={{ chrom: "16", exonStart: 100, exonEnd: 101, exonNumber: 6, strand: "-" }}
        mutationIndex={116}
        residueIndex={null}
      />
    );
    await waitFor(() => expect(screen.getByText("coding strand (−), complemented")).toBeTruthy());
    // Genomic T>C is coding A>G: the queried cell sits in row G, and its label names the genomic change.
    const queried = screen.getByLabelText(/chr16:101 T>C .*AVI Phred 12\.0/);
    expect(queried.getAttribute("data-base")).toBe("G");
    // The reference cell for genomic T is drawn as A.
    expect(screen.getByLabelText(/^Reference A at chr16:101/)).toBeTruthy();
  });
});

describe("SequenceVisualizer states", () => {
  it("says it is loading while the sequence loads, not that the user must run an analysis", () => {
    sequenceState.isLoading = true;
    render(<SequenceVisualizer uniprotId="Q13564" gene="NAE1" variant="p.Asp116Gly" residueIndex={116} />);
    expect(screen.getByRole("status").textContent).toMatch(/Loading the UniProt sequence for Q13564/);
    expect(screen.queryByText(/Analyze Mutation Effect/)).toBeNull();
    sequenceState.isLoading = false;
  });

  it("reports a failed sequence load as a failure", () => {
    sequenceState.error = "UniProt sequence data unavailable.";
    render(<SequenceVisualizer uniprotId="Q13564" gene="NAE1" variant="p.Asp116Gly" residueIndex={116} />);
    expect(within(screen.getByRole("alert")).getByText(/could not be loaded/)).toBeTruthy();
    sequenceState.error = null;
  });
});

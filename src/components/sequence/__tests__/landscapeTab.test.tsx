// @vitest-environment jsdom
/**
 * Landscape tab, rendered. Pins what lives in markup rather than in pure rules:
 *   — the focus heatmap shows single substitutions on the calibrated bands, marks the queried one,
 *     and hatches substitutions one SNV cannot reach;
 *   — the nucleotide lane sits under its residue on the coding strand;
 *   — the exon panel on a − strand gene shows the coding strand;
 *   — the overview moves the window and reports a lane it could not load as "not loaded";
 *   — loading / failure states for the sequence.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AlphaGenomeSaturationPosition, LandscapeResidueItem } from "../../../shared/contracts";

vi.mock("../../../apiClient", () => ({
  useApiClient: () => ({ fetchWithAuth: vi.fn(), apiClient: { getLandscapeData: vi.fn(async () => ({ landscapeData: [] })), getLandscapeOverview: vi.fn(() => new Promise(() => {})) } })
}));
const sequenceState = { sequence: "", isLoading: false, error: null as string | null };
vi.mock("../../../hooks/useProteinSequence", () => ({ useProteinSequence: () => sequenceState }));
vi.mock("../../../context/SettingsContext", () => ({ useSettings: () => ({ settings: { seqColorScheme: "chemical" } }) }));

import { LandscapeFocus } from "../LandscapeFocus";
import { LandscapeOverview } from "../LandscapeOverview";
import { GenomicSaturationHeatmap } from "../GenomicSaturationHeatmap";
import { alignCodonsToSequence, codonsByResidue } from "../useAlphaGenomeRegion";
import SequenceVisualizer, { resolveTarget } from "../../SequenceVisualizer";

// NAE1-like: residue 116 is D (coding GAT), gene on the − strand. Genomic positions descend 5'→3'.
const minusStrandCodon: AlphaGenomeSaturationPosition[] = [
  { pos: 102, ref: "C", isExonic: true, codonIndex: 116, codonPosition: 1, variants: { A: { phred: 22 }, G: { phred: 8 }, T: { phred: 15 } }, meanPhred: 15, maxPhred: 22 },
  { pos: 101, ref: "T", isExonic: true, codonIndex: 116, codonPosition: 2, variants: { A: { phred: 3 }, C: { phred: 12 }, G: { phred: 25 } }, meanPhred: 13, maxPhred: 25 },
  { pos: 100, ref: "A", isExonic: true, codonIndex: 116, codonPosition: 3, variants: { C: { phred: 1 }, G: { phred: 2 }, T: { phred: 3 } }, meanPhred: 2, maxPhred: 3 }
] as any;

const rows = new Map<number, LandscapeResidueItem>([
  [115, { residx: 115, amMean: 0.1, amMax: 0.2, amCount: 6, revelMean: 0.2, revelCount: 6, gerp: 5, phylop: 8, nucleotideCount: 3, substitutions: [{ alt: "P", am: 0.95, revel: 0.8 }] }],
  [
    116,
    {
      residx: 116, amMean: 0.4, amMax: 0.9, amCount: 7, revelMean: 0.3, revelCount: 7, gerp: 4.8, phylop: 7.6, nucleotideCount: 3,
      substitutions: [
        { alt: "G", am: 0.362, revel: 0.231 },
        { alt: "V", am: 0.95, revel: 0.9 },
        { alt: "N", am: 0.1, revel: 0.1 }
      ]
    }
  ]
]);

function renderFocus(onPickSubstitution = vi.fn(), onPickNucleotide = vi.fn()) {
  render(
    <LandscapeFocus
      residues={["N", "D"]}
      start={115}
      target={{ wt: "D", pos: 116, mut: "G" }}
      width={15}
      rows={rows}
      mode="mean"
      colorBy="alphaMissense"
      variantScores={{ revel: 0.231, am: 0.362, gerp: 4.78, phylop: 7.64 }}
      domains={[{ name: "Domain 1", start: 100, end: 116 }]}
      selected={null}
      selectedGenomic={null}
      hoveredPos={null}
      loadingWindow={false}
      codons={codonsByResidue(minusStrandCodon, "-")}
      strand="-"
      laneStatus="ready"
      genomicPos={101}
      genomicAlt="C"
      onPickResidue={vi.fn()}
      onPickSubstitution={onPickSubstitution}
      onPickNucleotide={onPickNucleotide}
      onHover={vi.fn()}
    />
  );
}

describe("LandscapeFocus", () => {
  it("colours single substitutions on the calibrated bands and outlines the queried one", () => {
    const pick = vi.fn();
    renderFocus(pick);
    const query = screen.getByLabelText(/^D116G: AlphaMissense 0\.362 \(Indeterminate\) · the queried variant/);
    expect(query.getAttribute("data-band")).toBe("indeterminate");
    expect(query.getAttribute("data-focus")).toBe("target");
    expect(screen.getByLabelText(/^D116V: AlphaMissense 0\.950 \(PP3 Moderate\)/).getAttribute("data-band")).toBe("pp3-moderate");
    fireEvent.click(query);
    expect(pick).toHaveBeenCalledWith(116, "G");
  });

  it("hatches substitutions one SNV cannot reach, using the codon from the nucleotide lane", () => {
    renderFocus();
    // GAT → W needs two changes; GAT → E (GAA/GAG) is one change but unscored here.
    expect(screen.getByLabelText(/^D116W: needs two or more nucleotide changes/).getAttribute("data-band")).toBe("unreachable");
    expect(screen.getByLabelText(/^D116E: no AlphaMissense score \(SNV-reachable\)/).getAttribute("data-band")).toBe("unscored");
  });

  it("puts the codon's bases under its residue on the coding strand and marks the queried SNV", () => {
    const pick = vi.fn();
    renderFocus(vi.fn(), pick);
    // Genomic T>C at 101 is coding A>G at codon position 2 → D116G.
    const q = screen.getByLabelText(/^Coding A>G at codon 116 position 2 \(genomic 101 T>C\) → D116G, AVI Phred 12\.0/);
    expect(q.getAttribute("data-focus")).toBe("target");
    expect(q.getAttribute("data-rank")).toBe("1");
    fireEvent.click(q);
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ genomicAlt: "C", codonIndex: 116, codonPosition: 2 }));
    expect(screen.getByText("Nucleotides · coding strand (−), complemented · three columns under each residue")).toBeTruthy();
  });
});

describe("LandscapeOverview", () => {
  it("moves the window from the keyboard without selecting, and says when a lane was not loaded", () => {
    const pick = vi.fn();
    const move = vi.fn();
    render(
      <LandscapeOverview
        length={534}
        status="ready"
        positions={[]}
        context={{ clinvar: null, gnomad: [], regions: [], regionsStatus: "none", transcript: null, regionsBasis: "gnomAD v4.1.1 genomic intervals", errors: ["ClinVar not loaded"] }}
        domains={[]}
        window={{ start: 101, end: 131 }}
        targetPos={116}
        mode="mean"
        lanes={{ clinvar: true, gnomad: true, regions: true }}
        onMove={move}
        onPick={pick}
        pageStep={31}
      />
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(move).toHaveBeenLastCalledWith(117);
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(move).toHaveBeenLastCalledWith(147);
    expect(pick).not.toHaveBeenCalled();
    expect(screen.getByText("ClinVar not loaded")).toBeTruthy();
    expect(screen.getByText("no regional missense constraint call for this gene")).toBeTruthy();
  });
});

describe("GenomicSaturationHeatmap on a − strand gene", () => {
  it("complements bases and still highlights the queried substitution", () => {
    render(
      <GenomicSaturationHeatmap
        region={{
          params: { chrom: "16", start: 100, end: 102, clamped: false, strand: "-", exonNumber: 6, exonStart: 100, exonEnd: 102 },
          data: { chrom: "16", start: 100, end: 102, strand: "-", positions: minusStrandCodon } as any,
          pending: false,
          error: null,
          reload: vi.fn()
        }}
        genomicPos={101}
        genomicAlt="C"
        mutationIndex={116}
        residueIndex={null}
      />
    );
    expect(screen.getByText("coding strand (−), complemented")).toBeTruthy();
    const queried = screen.getByLabelText(/chr16:101 T>C .*AVI Phred 12\.0/);
    expect(queried.getAttribute("data-base")).toBe("G");
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

  it("lays out finding, overview and focus once the sequence and scores are in", () => {
    sequenceState.sequence = "M".repeat(100) + "SGSFVEESPENLLDNDPSFFCRFTVVVATQL" + "A".repeat(50);
    render(
      <SequenceVisualizer
        uniprotId="Q13564"
        gene="NAE1"
        variant="p.Asp116Gly"
        residueIndex={116}
        landscapeData={[...rows.values()]}
        conservationData={{ revel: 0.231 }}
        predictorData={{ amPathogenicity: 0.362 }}
      />
    );
    expect(screen.getByText(/^D116G: REVEL 0\.231 \(BP4\) · AlphaMissense 0\.362 \(Indeterminate\); it ranks 2 of 3/)).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Focus window position" })).toBeTruthy();
    expect(screen.getByRole("group", { name: /Substitution heatmap/ })).toBeTruthy();
    sequenceState.sequence = "";
  });
});

describe("resolveTarget", () => {
  it("takes the pipeline's residue for genomic notation instead of following the selection", () => {
    expect(resolveTarget("16-66823281-T-C", { pos: 116, wt: "D", mut: "G" })).toEqual({ pos: 116, wt: "D", mut: "G" });
    expect(resolveTarget("16-66823281-T-C", null).pos).toBe(0);
  });

  it("prefers the resolved (remapped) numbering over the typed one", () => {
    expect(resolveTarget("p.Asp125Gly", { pos: 116, wt: "Asp", mut: "Gly" })).toEqual({ pos: 116, wt: "D", mut: "G" });
    expect(resolveTarget("p.Asp116Gly", null)).toEqual({ pos: 116, wt: "D", mut: "G" });
  });
});

describe("alignCodonsToSequence", () => {
  it("keeps a codon that encodes its residue and drops one that does not", () => {
    const seq = "A".repeat(115) + "D";
    const good = codonsByResidue(minusStrandCodon, "-"); // GAT → D at 116
    expect(alignCodonsToSequence(good, seq)).toMatchObject({ mismatches: 0 });
    expect(alignCodonsToSequence(good, seq).codons.has(116)).toBe(true);
    // Genomic A at codon position 2 → coding T: GTT encodes V, not the D drawn at 116.
    const wrong = codonsByResidue(minusStrandCodon.map((p, i) => (i === 1 ? { ...p, ref: "A" } : p)) as any, "-");
    const aligned = alignCodonsToSequence(wrong, seq);
    expect(aligned.mismatches).toBe(1);
    expect(aligned.codons.has(116)).toBe(false);
  });
});

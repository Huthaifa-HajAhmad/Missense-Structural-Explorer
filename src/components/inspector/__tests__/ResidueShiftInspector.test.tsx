// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResidueShiftInspector } from "../ResidueShiftInspector";

/** The MACO1 p.Glu433Lys payload the inspector must explain. */
const ANALYSIS_RESULT = {
  metadata: {
    gene: "MACO1",
    variant: "p.Glu433Lys",
    wildType: "Glu",
    mutant: "Lys",
    residueIndex: 433
  },
  insights: {
    biochemicalShift:
      "Charge swap: Negative (Glu) to Positive (Lys). Size increase. Significant change in pKa and polarity."
  }
} as any;

/** The P2Rank payload from the same screenshot: 28 Å away, 2% index, 370 Å³. */
const DISTAL_POCKET = {
  status: "success",
  pocketDistance: 28.14,
  pocketScore: 2,
  pocketVolume: 370,
  likelyCofactor: "None recorded in curated annotations",
  sasPoints: 37,
  surfaceAtoms: 20,
  pocketResidues: [{ name: "HIS", index: 292, distance: 29.9 }]
} as any;

describe("ResidueShiftInspector", () => {
  it("waits rather than rendering half a pane when there is no analysis", () => {
    render(<ResidueShiftInspector analysisResult={null} />);
    expect(screen.getByText(/Awaiting variant analysis data/)).toBeInTheDocument();
  });

  it("carries the biochemical narrative relocated out of the main column", () => {
    render(<ResidueShiftInspector analysisResult={ANALYSIS_RESULT} />);
    expect(
      screen.getByText(/Charge swap: Negative \(Glu\) to Positive \(Lys\)/)
    ).toBeInTheDocument();
    expect(screen.getByText("AI synthesis")).toBeInTheDocument();
  });

  it("flags the axis where the AI prose disagrees with the scales", () => {
    render(<ResidueShiftInspector analysisResult={ANALYSIS_RESULT} />);

    expect(screen.getByText("Prose and scales disagree")).toBeInTheDocument();
    // Polarity is 100 -> 100, yet the narrative claims a change in it. The claim is
    // reported by axis name, framed as a mismatch for the reader to weigh.
    expect(screen.getByText("polarity")).toBeInTheDocument();
    expect(screen.getByText(/while the scales hold that axis flat \(100 \u2192 100\)/)).toBeInTheDocument();
    // The panel must not present the fixed descriptor table as ground truth.
    expect(screen.getByText(/the scales are fixed descriptors, not ground truth/)).toBeInTheDocument();
  });

  it("does not raise a discrepancy flag when the prose matches the scales", () => {
    render(
      <ResidueShiftInspector
        analysisResult={{
          ...ANALYSIS_RESULT,
          insights: { biochemicalShift: "Charge swap with a size increase." }
        }}
      />
    );
    expect(screen.queryByText("Prose and scales disagree")).not.toBeInTheDocument();
  });

  it("falls back to a labelled rule-based state when the AI prose is unusable", () => {
    render(
      <ResidueShiftInspector
        analysisResult={{
          ...ANALYSIS_RESULT,
          insights: { biochemicalShift: "\u26a0\ufe0f **Biochemical Shift Unavailable** (Failed)" }
        }}
      />
    );

    expect(screen.getByText("Rule-based only")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    // The derived interpretation still renders, so the pane is never blank.
    expect(screen.getByText(/3 of 4 axes move/)).toBeInTheDocument();
  });

  it("shows a skeleton instead of prose while synthesis is in flight", () => {
    render(
      <ResidueShiftInspector
        analysisResult={{ ...ANALYSIS_RESULT, insights: { biochemicalShift: "" } }}
        isNarrativeLoading
      />
    );
    expect(screen.getByText("Synthesising")).toBeInTheDocument();
  });

  it("gives every axis a plain-language reading in the derived section", () => {
    render(<ResidueShiftInspector analysisResult={ANALYSIS_RESULT} />);

    // Each axis is described in words as well as numbers, so the reader does not
    // have to already know what "polarity 100 -> 100" implies.
    expect(screen.getByText(/moderate change on this scale: the side chain becomes bulkier/)).toBeInTheDocument();
    expect(screen.getByText(/Unchanged on this axis/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/further toward the positive end of this index/).length
    ).toBeGreaterThan(0);
  });

  it("explains the P2Rank numbers for a reader who is not a structural biologist", () => {
    render(<ResidueShiftInspector analysisResult={ANALYSIS_RESULT} computedPocket={DISTAL_POCKET} />);

    expect(screen.getByText("Distal to the nearest predicted cavity")).toBeInTheDocument();
    // The distance is stated once in prose and once as a banded value.
    expect(screen.getAllByText(/28\.14/).length).toBeGreaterThan(0);
    expect(screen.getByText(/unlikely to act by reshaping it/)).toBeInTheDocument();
    expect(screen.getByText("DISTAL_SURFACE")).toBeInTheDocument();
  });

  it("describes the ranking index accurately rather than denying it is calibrated", () => {
    // P2Rank documents this field as a calibrated site probability per model
    // profile. The panel previously claimed the opposite, which was false.
    render(<ResidueShiftInspector analysisResult={ANALYSIS_RESULT} computedPocket={DISTAL_POCKET} />);
    expect(screen.getByText(/calibrated against known complexes, per model profile/)).toBeInTheDocument();
    expect(screen.queryByText(/not a calibrated probability/)).not.toBeInTheDocument();
  });

  it("does not print a fabricated volume unit when no measured volume is declared", () => {
    // The production payload's pocketVolume is sas_points × 10; with no provenance
    // saying otherwise, no Å³ value may be shown.
    render(<ResidueShiftInspector analysisResult={ANALYSIS_RESULT} computedPocket={DISTAL_POCKET} />);
    expect(screen.getByText("Volume not reported")).toBeInTheDocument();
    expect(screen.getByText(/37 surface pts/)).toBeInTheDocument();
    expect(screen.queryByText(/370/)).not.toBeInTheDocument();
  });

  it("separates a failed scan from a search that found nothing", () => {
    const { rerender } = render(
      <ResidueShiftInspector analysisResult={ANALYSIS_RESULT} pocketError="Java 17 not initialised" />
    );
    expect(screen.getByText("Cavity scan failed")).toBeInTheDocument();
    expect(screen.getByText(/Java 17 not initialised/)).toBeInTheDocument();

    rerender(
      <ResidueShiftInspector
        analysisResult={ANALYSIS_RESULT}
        computedPocket={{ status: "none_detected" } as any}
      />
    );
    expect(screen.getByText("No cavity returned for this residue")).toBeInTheDocument();
    expect(screen.queryByText(/Java 17 not initialised/)).not.toBeInTheDocument();
  });

  it("offers a retry on the inspector when the scan failed", () => {
    const onRetryPocket = vi.fn();
    render(
      <ResidueShiftInspector
        analysisResult={ANALYSIS_RESULT}
        pocketError="P2Rank timeout"
        onRetryPocket={onRetryPocket}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Retry pocket detection/i }));
    expect(onRetryPocket).toHaveBeenCalledTimes(1);
  });

  it("exposes the scale reference behind a disclosure so the pane stays scannable", () => {
    render(<ResidueShiftInspector analysisResult={ANALYSIS_RESULT} />);

    const toggle = screen.getByRole("button", { name: /How To Read These Scales/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Kyte & Doolittle hydropathy/)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Kyte & Doolittle hydropathy/)).toBeInTheDocument();
    expect(screen.getByText(/not calibrated to any clinical outcome/)).toBeInTheDocument();
  });

  it("copies a report-ready interpretation that names both residues and the cavity", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ResidueShiftInspector analysisResult={ANALYSIS_RESULT} computedPocket={DISTAL_POCKET} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy the full residue-shift interpretation/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("MACO1 p.Glu433Lys");
    expect(copied).toContain("Charge swap");
    expect(copied).toContain("Distal to the nearest predicted cavity");
    expect(copied).toContain("Hydrophobicity: 10 \u2192 5");
  });

  it("reports a clipboard failure instead of silently claiming success", async () => {
    // Clipboard writes reject when the document is unfocused or permission is
    // denied; the rejection path used to be missing entirely.
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ResidueShiftInspector analysisResult={ANALYSIS_RESULT} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy the full residue-shift interpretation/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Copy failed/ })).toBeInTheDocument()
    );
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("renders hostile narrative markup as inert text, not as DOM", () => {
    /*
     * Guards the property an automated security review flagged as an XSS risk: the
     * narrative is a model-generated string, and it reaches the DOM only as a JSX
     * text child, which React escapes. `stripInlineMarkdown` does string
     * replacements and never produces HTML, and nothing here uses
     * dangerouslySetInnerHTML.
     *
     * If a future refactor reintroduces innerHTML to "support markdown", this test
     * fails instead of silently shipping an injection point.
     */
    const hostile = '**<img src=x onerror="alert(1)">** and <script>alert(2)</script>';

    const { container } = render(
      <ResidueShiftInspector
        analysisResult={{ ...ANALYSIS_RESULT, insights: { biochemicalShift: hostile } }}
      />
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    // The emphasis markers are stripped; the angle brackets survive as characters.
    expect(screen.getByText(/<img src=x onerror="alert\(1\)">/)).toBeInTheDocument();
  });

  it("cites the sources behind the scales and the pocket detector", () => {
    render(<ResidueShiftInspector analysisResult={ANALYSIS_RESULT} />);
    expect(screen.getByText(/Krivak & Hoksza 2018/)).toBeInTheDocument();
    expect(screen.getByText(/Kyte & Doolittle 1982/)).toBeInTheDocument();
    // The citation comes from the shared metric registry, so the link text is the
    // registered paper title rather than a bespoke label invented here.
    expect(screen.getByRole("link", { name: /Krivak & Hoksza/ })).toHaveAttribute(
      "href",
      expect.stringContaining("doi.org")
    );
  });
});

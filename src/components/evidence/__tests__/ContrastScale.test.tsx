// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BiochemicalContrastScales } from "../ContrastScale";
import { buildBiochemicalContrast } from "../../../shared/residueShiftEvidence";
import { INSPECTOR_FOCUS_EVENT, INSPECTOR_SECTIONS } from "../../../lib/inspectorFocus";

const GLU = { hydrophobicity: 10, charge: 0, size: 60, polarity: 100 };
const LYS = { hydrophobicity: 5, charge: 95, size: 80, polarity: 100 };

function contrast() {
  return buildBiochemicalContrast({
    wildTypeCode: "E",
    mutantCode: "K",
    wildTypeLabel: "Glu",
    mutantLabel: "Lys",
    wildTypeValues: GLU,
    mutantValues: LYS
  });
}

describe("BiochemicalContrastScales", () => {
  it("labels every axis and both residue markers", () => {
    render(<BiochemicalContrastScales contrast={contrast()} />);

    expect(screen.getByText("Hydrophobicity")).toBeInTheDocument();
    expect(screen.getByText("Residue Volume / Size")).toBeInTheDocument();
    expect(screen.getByText("Polarity")).toBeInTheDocument();
    expect(screen.getByText("Isoelectric Charge Index")).toBeInTheDocument();

    // Marker legend names the two residues rather than relying on colour alone.
    expect(screen.getByText("Glu")).toBeInTheDocument();
    expect(screen.getByText("Lys")).toBeInTheDocument();
    // The grey "same position" key only appears because polarity is unchanged.
    expect(screen.getByText("same position")).toBeInTheDocument();
  });

  it("spells out what each end of every axis means", () => {
    render(<BiochemicalContrastScales contrast={contrast()} />);

    expect(screen.getByText("Hydrophilic")).toBeInTheDocument();
    expect(screen.getByText("Hydrophobic")).toBeInTheDocument();
    expect(screen.getByText("Nonpolar")).toBeInTheDocument();
    expect(screen.getByText("Polar")).toBeInTheDocument();
    expect(screen.getByText("Negative")).toBeInTheDocument();
    expect(screen.getByText("Positive")).toBeInTheDocument();
    expect(screen.getByText("Neutral")).toBeInTheDocument();
  });

  it("describes the change in words instead of only encoding it in colour", () => {
    render(<BiochemicalContrastScales contrast={contrast()} />);

    expect(screen.getByText(/moderate increase/)).toBeInTheDocument();
    expect(screen.getByText(/slight decrease/)).toBeInTheDocument();
    expect(screen.getByText(/marked increase/)).toBeInTheDocument();
  });

  it("does not render an unchanged axis as a change", () => {
    render(<BiochemicalContrastScales contrast={contrast()} />);

    // Polarity is 100 -> 100: one "unchanged" chip, and an accessible label that
    // says so explicitly rather than showing a full-width filled bar.
    expect(screen.getByText("unchanged")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Polarity: wild type 100 and variant 100 are identical on a 0 to 100 scale/)
    ).toBeInTheDocument();
  });

  it("gives every changed axis an accessible description of the move", () => {
    render(<BiochemicalContrastScales contrast={contrast()} />);

    expect(
      screen.getByLabelText(/Isoelectric Charge Index: wild type 0 to variant 95 on a 0 to 100 scale, a marked increase/)
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Hydrophobicity: wild type 10 to variant 5 on a 0 to 100 scale, a slight decrease/)
    ).toBeInTheDocument();
  });

  it("keeps both markers fully inside the track at the extremes", () => {
    const { container } = render(<BiochemicalContrastScales contrast={contrast()} />);

    // The charge axis runs 0 -> 95, so the wild-type marker sits on the left edge
    // where a naive centred offset would be half clipped by the track.
    const styleLefts = Array.from(container.querySelectorAll<HTMLElement>('[style*="clamp("]')).map(
      node => node.style.left
    );
    expect(styleLefts.length).toBeGreaterThan(0);
    for (const left of styleLefts) {
      expect(left).toContain("clamp(0px");
      expect(left).toContain("calc(100% - 3px)");
    }
  });

  it("summarises the contrast without asserting pathogenicity", () => {
    render(<BiochemicalContrastScales contrast={contrast()} />);

    const summary = screen.getByText(/3 of 4 axes move/);
    expect(summary).toBeInTheDocument();
    expect(summary.textContent).not.toMatch(/pathogenic|deleterious|damaging/i);
    expect(screen.getByText(/not predictions/)).toBeInTheDocument();
  });

  it("offers a working way to the relocated interpretation, not just a pointer", () => {
    const seen: string[] = [];
    const handler = (event: Event) => seen.push((event as CustomEvent<{ sectionId: string }>).detail.sectionId);
    window.addEventListener(INSPECTOR_FOCUS_EVENT, handler);
    try {
      render(<BiochemicalContrastScales contrast={contrast()} />);
      fireEvent.click(screen.getByRole("button", { name: /Open the worked interpretation/i }));
    } finally {
      window.removeEventListener(INSPECTOR_FOCUS_EVENT, handler);
    }

    expect(seen).toEqual([INSPECTOR_SECTIONS.residueShiftNarrative]);
  });

  it("renders an explicit unavailable state when the scales cannot be derived", () => {
    render(<BiochemicalContrastScales contrast={null} />);
    expect(screen.getByText(/Property scales are unavailable/)).toBeInTheDocument();
  });

  it("distinguishes loading from permanently unavailable", () => {
    render(<BiochemicalContrastScales contrast={null} isLoading />);
    expect(screen.getByText(/Waiting for residue property scales/)).toBeInTheDocument();
  });
});

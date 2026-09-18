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
    const { container } = render(<BiochemicalContrastScales contrast={contrast()} />);

    // Polarity is 100 -> 100: the chip says so and both values agree, rather than
    // a full-width filled bar that read as the largest possible change. The value
    // pair is matched across the row because the arrow is its own element.
    expect(screen.getByText("unchanged")).toBeInTheDocument();
    expect(container.textContent).toMatch(/100\s*→\s*100/);
  });

  it("states a changed axis as a value pair plus words, with no duplicate graphic label", () => {
    render(<BiochemicalContrastScales contrast={contrast()} />);

    // The values and the magnitude/direction words are the accessible content.
    expect(screen.getByText(/marked increase/)).toBeInTheDocument();
    expect(screen.getByText(/slight decrease/)).toBeInTheDocument();
    expect(screen.getByText("Isoelectric Charge Index")).toBeInTheDocument();

    // The track is decoration: it must not carry a second, sentence-length
    // description of the same row for a screen reader to read out twice.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("distinguishes the two markers by position and shape, not by hue alone", () => {
    const { container } = render(<BiochemicalContrastScales contrast={contrast()} />);

    // The hydrophobicity row (10 -> 5) has one marker per residue.
    const markers = Array.from(container.querySelectorAll<HTMLElement>("span")).filter(
      node => node.className.includes("w-[3px]") && node.className.includes("absolute")
    );
    expect(markers.length).toBeGreaterThanOrEqual(2);

    const upper = markers.filter(node => node.className.includes("top-0"));
    const lower = markers.filter(node => node.className.includes("bottom-0"));
    expect(upper.length).toBeGreaterThan(0);
    expect(lower.length).toBeGreaterThan(0);

    // Identity colours are the palette the wild-type/mutant cards use, not the
    // semantic success/danger tokens — which asserted a verdict about the residue.
    expect(markers.some(node => node.className.includes("bg-emerald-500"))).toBe(true);
    expect(markers.some(node => node.className.includes("bg-rose-500"))).toBe(true);
    expect(markers.some(node => /cs-text-(success|danger)/.test(node.className))).toBe(false);
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

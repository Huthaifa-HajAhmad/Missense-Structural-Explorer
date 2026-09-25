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

    // Marker legend names the two residues and says which fill is which, so the
    // hollow/solid convention is stated rather than assumed.
    expect(screen.getByText("Glu")).toBeInTheDocument();
    expect(screen.getByText("Lys")).toBeInTheDocument();
    expect(screen.getByText("wild type")).toBeInTheDocument();
    expect(screen.getByText("variant")).toBeInTheDocument();
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

    // One grey dot, not a marker per residue: there is nothing to tell apart.
    expect(container.querySelectorAll('[data-scale-marker="shared"]').length).toBe(1);
    expect(container.querySelectorAll('[data-scale-marker="wild-type"]').length).toBe(3);
    expect(container.querySelectorAll('[data-scale-marker="variant"]').length).toBe(3);
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

  it("distinguishes the two residues by fill, not by hue alone", () => {
    const { container } = render(<BiochemicalContrastScales contrast={contrast()} />);

    const wildType = container.querySelector<HTMLElement>('[data-scale-marker="wild-type"]');
    const variant = container.querySelector<HTMLElement>('[data-scale-marker="variant"]');
    expect(wildType).not.toBeNull();
    expect(variant).not.toBeNull();

    // Hollow ring = wild type, solid dot = variant. Fill survives greyscale,
    // colour-vision deficiency and small sizes, where the earlier 3px half-height
    // split was too small to see at all.
    expect(wildType!.className).toContain("border-emerald-500");
    expect(wildType!.className).toContain("bg-cs-bg-subtle");
    expect(variant!.className).toContain("bg-rose-500");
    expect(variant!.className).not.toContain("border-2");

    // Identity colours are the palette the wild-type/mutant cards use, not the
    // semantic success/danger tokens — which asserted a verdict about the residue.
    expect(wildType!.className).not.toMatch(/cs-text-(success|danger)/);
    expect(variant!.className).not.toMatch(/cs-text-(success|danger)/);
  });

  it("keeps both markers fully inside the track at the extremes", () => {
    const { container } = render(<BiochemicalContrastScales contrast={contrast()} />);

    // The charge axis runs 0 -> 95, so the wild-type dot sits on the left edge
    // where a naive centred offset would be half clipped by the track.
    //
    // Selected by the marker's own data attribute: the direction chevron is also
    // clamped (5px wide, so a different bound), and a style-based query would have
    // asserted the markers' bound against it.
    const markers = Array.from(container.querySelectorAll<HTMLElement>("[data-scale-marker]"));
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      expect(marker.style.left).toContain("clamp(0px");
      expect(marker.style.left).toContain("calc(100% - 10px)");
    }
  });

  it("keeps the direction chevron inside the track at both extremes", () => {
    /*
     * Regression, found in review: the chevron used to be anchored just outside the
     * span's leading edge, which the track's `overflow-hidden` clipped to a ~1px
     * sliver whenever a change ended at 0% or 100% — reachable with the shipped
     * scale table (Ala→Ile hydrophobicity ends at 100%, Lys→Glu charge starts at
     * 0%). It is now seated beside the variant dot, and clamped so it can never
     * leave the track.
     */
    const { container } = render(<BiochemicalContrastScales contrast={contrast()} />);

    const chevrons = Array.from(container.querySelectorAll<HTMLElement>('[data-move-arrow]'));
    expect(chevrons.length).toBeGreaterThan(0);
    for (const chevron of chevrons) {
      expect(chevron.style.left).toContain("clamp(0px");
      expect(chevron.style.left).toContain("calc(100% - 5px)");
    }
  });

  it("points the chevron toward the variant, whichever way the value moves", () => {
    const { container } = render(<BiochemicalContrastScales contrast={contrast()} />);

    // Charge (0 -> 95) and size (60 -> 80) increase: the triangle's coloured border
    // is on its left face, so the apex faces right, toward the higher position.
    const increase = container.querySelector<HTMLElement>('[data-move-arrow="increase"]');
    expect(increase).not.toBeNull();
    expect(increase!.getAttribute("style")).toContain("border-left");
    expect(increase!.getAttribute("style")).not.toContain("border-right: 5px");

    // A wide decrease must face the other way: apex left, toward the lower position.
    const decrease = buildBiochemicalContrast({
      wildTypeCode: "I",
      mutantCode: "D",
      wildTypeValues: { hydrophobicity: 100, charge: 50, size: 75, polarity: 10 },
      mutantValues: { hydrophobicity: 10, charge: 0, size: 45, polarity: 100 }
    })!;
    const { container: decreaseContainer } = render(<BiochemicalContrastScales contrast={decrease} />);
    const leftArrow = decreaseContainer.querySelector<HTMLElement>('[data-move-arrow="decrease"]');
    expect(leftArrow).not.toBeNull();
    expect(leftArrow!.getAttribute("style")).toContain("border-right");
    expect(leftArrow!.getAttribute("style")).not.toContain("border-left: 5px");
  });

  it("drops the chevron when the move is too small to seat one between the dots", () => {
    // Every changed axis moves 2 points: the 10px dots nearly touch, and a chevron
    // between them would be hidden under a dot. Direction stays legible from the
    // chip and the printed value pair, so nothing is lost by suppressing it.
    const tiny = buildBiochemicalContrast({
      wildTypeCode: "A",
      mutantCode: "V",
      wildTypeValues: { hydrophobicity: 60, charge: 50, size: 25, polarity: 15 },
      mutantValues: { hydrophobicity: 58, charge: 50, size: 27, polarity: 13 }
    })!;
    const { container } = render(<BiochemicalContrastScales contrast={tiny} />);

    expect(container.querySelectorAll("[data-move-arrow]").length).toBe(0);
    // The markers themselves still render: only the chevron is suppressed.
    expect(container.querySelectorAll("[data-scale-marker]").length).toBeGreaterThan(0);
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

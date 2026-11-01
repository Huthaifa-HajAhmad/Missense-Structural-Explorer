// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResidueGlyph } from "../ResidueGlyph";
import { PropertyDumbbell } from "../PropertyDumbbell";
import { PocketDistanceStrip } from "../PocketDistanceStrip";
import { diffSideChains } from "../../../../shared/sideChainTopology";
import type { BiochemicalContrastRow, PocketStrip } from "../../../../shared/residueContextEvidence";

describe("ResidueGlyph", () => {
  it("renders null if diff is null", () => {
    const { container } = render(
      <ResidueGlyph diff={null} wildType="X" mutant="Z" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders 2D side-chain skeletal diff for Asp -> Gly", () => {
    const diff = diffSideChains("Asp", "Gly");
    expect(diff).not.toBeNull();

    render(
      <ResidueGlyph
        diff={diff}
        wildType="Asp"
        mutant="Gly"
        wildTypeName="Aspartate"
        mutantName="Glycine"
      />
    );

    expect(screen.getByTestId("residue-glyph-pair")).toBeInTheDocument();
    expect(screen.getByText("Asp")).toBeInTheDocument();
    expect(screen.getByText("Gly")).toBeInTheDocument();
    expect(screen.getByText("Aspartate")).toBeInTheDocument();
    expect(screen.getByText("Glycine")).toBeInTheDocument();

    const summary = screen.getByTestId("glyph-diff-summary");
    expect(summary).toHaveTextContent(/CB, CG, OD1 and OD2 lost/i);
    expect(summary).toHaveTextContent('CB = beta carbon');
    expect(summary).toHaveTextContent('OD1 = delta oxygen 1');
    expect(summary).not.toHaveTextContent('sulfur');
  });
});

describe("PropertyDumbbell", () => {
  const diffRow: BiochemicalContrastRow = {
    key: "charge",
    label: "Net charge",
    wildTypeValue: 0,
    mutantValue: 50,
    wildTypePosition: 0,
    mutantPosition: 50,
    spanStart: 0,
    spanWidth: 50,
    absoluteDelta: 50,
    delta: 50,
    deltaLabel: "+50",
    direction: "increase",
    magnitude: "marked",
    magnitudeLabel: "marked",
    plainChange: "gains positive charge",
    changePredicate: "gains a positive charge",
    lowAnchor: "−1",
    highAnchor: "+1",
    midpointLabel: "0 neutral",
    unit: "e",
    wildTypeNative: "−1",
    mutantNative: "0",
    interpretation: "gains charge",
    rationale: "test rationale",
    source: "test source",
  };

  const sameRow: BiochemicalContrastRow = {
    ...diffRow,
    mutantValue: 0,
    mutantPosition: 0,
    spanStart: 0,
    spanWidth: 0,
    absoluteDelta: 0,
    deltaLabel: "0",
    direction: "unchanged",
    magnitude: "unchanged",
    plainChange: "neutral on both sides",
    changePredicate: "remains neutral",
    wildTypeNative: "0",
    mutantNative: "0",
  };

  it("connects distinct values with a direction arrow", () => {
    const { container } = render(
      <PropertyDumbbell
        row={diffRow}
        wildType="Asp"
        mutant="Gly"
      />
    );

    expect(container.querySelector(".rsx-track__wt")).toBeInTheDocument();
    expect(container.querySelector(".rsx-track__mut")).toBeInTheDocument();
    expect(container.querySelector(".rsx-track__span")).not.toBeInTheDocument();
    expect(container.querySelector(".rsx-track__direction")).toHaveAttribute("data-direction", "right");

    expect(container.querySelectorAll(".rsx-track__context-tick")).toHaveLength(0);
    expect(container.querySelector("details")).not.toBeInTheDocument();
  });

  it("keeps both residue markers visible when values are identical", () => {
    const { container } = render(
      <PropertyDumbbell
        row={sameRow}
        wildType="Ala"
        mutant="Val"
      />
    );

    expect(container.querySelector(".rsx-track__wt")).toHaveAttribute("data-coincident", "true");
    expect(container.querySelector(".rsx-track__mut")).toBeInTheDocument();
    expect(container.querySelector(".rsx-track__span")).not.toBeInTheDocument();
    expect(container.querySelector(".rsx-track__direction")).not.toBeInTheDocument();
  });

  it("points the arrow left when the variant value is lower", () => {
    const { container } = render(
      <PropertyDumbbell row={{ ...diffRow, wildTypePosition: 80, mutantPosition: 20 }} wildType="Asp" mutant="Gly" />
    );
    const arrow = container.querySelector<HTMLElement>(".rsx-track__direction")!;
    expect(arrow).toHaveAttribute("data-direction", "left");
    // Spans from the variant marker to the wild-type marker.
    expect(arrow.style.left).toBe("20%");
    expect(arrow.style.width).toBe("60%");
  });

  it("draws no arrow when the markers are too close for its head, but keeps both markers", () => {
    const { container } = render(
      <PropertyDumbbell row={{ ...diffRow, wildTypePosition: 40, mutantPosition: 41.2 }} wildType="His" mutant="Arg" />
    );
    expect(container.querySelector(".rsx-track__direction")).not.toBeInTheDocument();
    expect(container.querySelector(".rsx-track__wt")).not.toHaveAttribute("data-coincident");
    expect(container.querySelector(".rsx-track__mut")).toBeInTheDocument();
  });

  it("rings markers that overlap even when the values differ slightly", () => {
    const { container } = render(
      <PropertyDumbbell row={{ ...diffRow, wildTypePosition: 40, mutantPosition: 40.1 }} wildType="His" mutant="Arg" />
    );
    expect(container.querySelector(".rsx-track__wt")).toHaveAttribute("data-coincident", "true");
    expect(container.querySelector(".rsx-track__direction")).not.toBeInTheDocument();
  });
});

describe("PocketDistanceStrip", () => {
  const mockStrip: PocketStrip = {
    max: 25,
    marks: [4, 8, 12],
    origin: "residue 116",
    centre: {
      distance: 23.1,
      reference: "the cavity centre",
      position: (23.1 / 25) * 100,
    },
    residues: [
      {
        index: 131,
        chain: "A",
        label: "Leu131",
        distance: 17.8,
        position: (17.8 / 25) * 100,
        lane: 0,
      },
      {
        index: 152,
        chain: "A",
        label: "Ile152",
        distance: 20.0,
        position: (20.0 / 25) * 100,
        lane: 1,
      },
    ],
    lanes: 2,
  };

  it("names the reference the strip really measures to, not a fixed phrase", () => {
    render(<PocketDistanceStrip strip={{ ...mockStrip, centre: { ...mockStrip.centre!, reference: "the centroid of the pocket residues" } }} />);
    expect(screen.getByTestId("pocket-strip-key")).toHaveTextContent("23.1 Å to the centroid of the pocket residues");
    expect(screen.queryByText(/cavity centre/i)).not.toBeInTheDocument();
  });

  it("renders the continuous distance track, cut-points, centre diamond, and interactive residue buttons", () => {
    const onSelectResidue = vi.fn();
    const onViewIn3d = vi.fn();

    render(
      <PocketDistanceStrip
        strip={mockStrip}
        onSelectResidue={onSelectResidue}
        onViewIn3d={onViewIn3d}
      />
    );

    expect(screen.getByTestId("pocket-distance-strip")).toBeInTheDocument();
    expect(screen.getByText(/distance from residue 116, in Å/i)).toBeInTheDocument();
    expect(screen.getByText("0 Å")).toBeInTheDocument();
    expect(screen.getByText("25 Å")).toBeInTheDocument();
    expect(screen.getByText("12.5 Å")).toBeInTheDocument();
    // One key names every mark, including the dashed cut-points, and says what the diamond is measured to.
    const key = screen.getByTestId("pocket-strip-key");
    expect(key).toHaveTextContent("residue 116, 0 Å");
    expect(key).toHaveTextContent("23.1 Å to the cavity centre");
    expect(key).toHaveTextContent("Pocket residues");
    expect(key).toHaveTextContent("4, 8, 12 Å cut-points");

    const residueButtons = screen.getAllByRole("button", { name: /Select/ });
    expect(residueButtons.length).toBe(2);
    expect(residueButtons[0]).toHaveTextContent("Leu131 A17.8 Å");

    fireEvent.click(residueButtons[0]);
    expect(onSelectResidue).toHaveBeenCalledWith(131);

    const view3dBtn = screen.getByRole("button", { name: /View in 3D/ });
    fireEvent.click(view3dBtn);
    expect(onViewIn3d).toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResidueGlyph } from "../ResidueGlyph";
import { PropertyDumbbell } from "../PropertyDumbbell";
import { PocketDistanceStrip } from "../PocketDistanceStrip";
import { diffSideChains } from "../../../../shared/sideChainTopology";
import type { BiochemicalContrastRow, PocketStrip, ScaleTick } from "../../../../shared/residueContextEvidence";

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

  const mockTicks: ScaleTick[] = [
    { position: 0, native: "−1", codes: ["D", "E"] },
    { position: 50, native: "0", codes: ["A", "G", "V"] },
    { position: 100, native: "+1", codes: ["K", "R"] },
  ];

  it("renders distinct wild-type and mutant dots without a connecting span", () => {
    const { container } = render(
      <PropertyDumbbell
        row={diffRow}
        wildType="Asp"
        mutant="Gly"
        contextTicks={mockTicks}
      />
    );

    expect(container.querySelector(".rsx-track__wt")).toBeInTheDocument();
    expect(container.querySelector(".rsx-track__mut")).toBeInTheDocument();
    expect(container.querySelector(".rsx-track__span")).not.toBeInTheDocument();
    expect(container.querySelector(".rsx-track__same")).not.toBeInTheDocument();

    const ticks = container.querySelectorAll(".rsx-track__context-tick");
    expect(ticks.length).toBe(3);
  });

  it("keeps both residue markers visible when values are identical", () => {
    const { container } = render(
      <PropertyDumbbell
        row={sameRow}
        wildType="Ala"
        mutant="Val"
        contextTicks={mockTicks}
      />
    );

    expect(container.querySelector(".rsx-track__wt")).toHaveAttribute("data-coincident", "true");
    expect(container.querySelector(".rsx-track__mut")).toBeInTheDocument();
    expect(container.querySelector(".rsx-track__span")).not.toBeInTheDocument();
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
    expect(screen.getByText(/distance from residue 116/i)).toBeInTheDocument();
    expect(screen.getByText("0 Å")).toBeInTheDocument();
    expect(screen.getByText("25 Å")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(/◆ 23\.1 Å \(the cavity centre\)/)).toBeInTheDocument();

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

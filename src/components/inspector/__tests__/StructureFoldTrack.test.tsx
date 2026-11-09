// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StructureFoldTrack } from "../StructureFoldTrack";
import { StructureSelectionCard } from "../StructureSelectionCard";
import type { StructureSelection } from "../../../shared/structureSelection";
import type { Structure3dEvidence } from "../../../shared/structure3dEvidence";

afterEach(cleanup);

const SECONDARY = {
  source: "dssp" as const, chain: "A", residueCount: 100,
  segments: [
    { cls: "coil" as const, start: 1, end: 9 },
    { cls: "alpha-helix" as const, start: 10, end: 29 },
    { cls: "turn" as const, start: 30, end: 31 },
    { cls: "strand" as const, start: 32, end: 41 },
    { cls: "coil" as const, start: 42, end: 100 },
  ],
};

describe("StructureFoldTrack", () => {
  it("draws helices and strands as blocks, regions below, and both marks", () => {
    render(<StructureFoldTrack secondary={SECONDARY} length={100} structureName="AF-P1-F1 v6" variantPosition={20} selectedPosition={60}
      regions={[{ kind: "domain", label: "Kinase", start: 5, end: 45 }, { kind: "linker", label: "Linker", start: 46, end: 55 }]} />);
    const track = screen.getByTestId("structure-fold-track");
    expect([...track.querySelectorAll("rect title")].map(t => t.textContent)).toEqual(["α-helix 10–29", "β-strand 32–41", "Domain: Kinase 5–45", "Linker: Linker 46–55"]);
    expect(track.querySelectorAll(".s3d-track__mark")).toHaveLength(2);
    expect(track.textContent).toContain("Helix segments · 1 (20%)");
    expect(track.textContent).toContain("Strands · 1 (10%)");
    expect(track.getAttribute("title")).toContain("DSSP (Kabsch & Sander 1983), computed by Mol* on AF-P1-F1 v6.");
    expect(track.textContent).not.toContain("Top row");
    expect(track.textContent).toContain("Variant site");
    expect(track.textContent).toContain("Selected");
  });

  it("moves the selection with the arrow keys, so the track is not pointer-only", () => {
    const onSelectResidue = vi.fn();
    render(<StructureFoldTrack secondary={SECONDARY} length={100} structureName={null} variantPosition={null} selectedPosition={42} regions={[]} onSelectResidue={onSelectResidue} />);
    const svg = screen.getByTestId("structure-fold-track").querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("slider");
    expect(svg.getAttribute("aria-valuenow")).toBe("42");
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(onSelectResidue).toHaveBeenLastCalledWith(43);
    fireEvent.keyDown(svg, { key: "ArrowRight", shiftKey: true });
    expect(onSelectResidue).toHaveBeenLastCalledWith(52);
    fireEvent.keyDown(svg, { key: "Home" });
    expect(onSelectResidue).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(svg, { key: "End" });
    expect(onSelectResidue).toHaveBeenLastCalledWith(100);
  });

  it("says why the fold row is absent instead of promising it will appear", () => {
    render(<StructureFoldTrack secondary={null} secondaryNote="This entry is numbered by its own author codes, not UniProt." length={100} structureName={null} variantPosition={null} selectedPosition={null} regions={[]} />);
    expect(screen.getByTestId("structure-fold-track").textContent).toContain("numbered by its own author codes");
    expect(screen.getByTestId("structure-fold-track").textContent).not.toContain("once the model is drawn");
  });

  it("selects the residue under the pointer", () => {
    const onSelectResidue = vi.fn();
    render(<StructureFoldTrack secondary={SECONDARY} length={100} structureName={null} variantPosition={null} selectedPosition={null} regions={[]} onSelectResidue={onSelectResidue} />);
    const svg = screen.getByTestId("structure-fold-track").querySelector("svg")!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 44, right: 200, bottom: 44, x: 0, y: 0, toJSON() {} });
    fireEvent.click(svg, { clientX: 99 });
    expect(onSelectResidue).toHaveBeenCalledWith(50);
  });
});

describe("StructureSelectionCard", () => {
  const site = { position: 159, substitution: "Ser159Cys", canAddressVariantSite: true } as Structure3dEvidence["site"];
  const selection: StructureSelection = {
    position: 20, state: "available", isQueriedSite: false, summary: "ARG 20 · chain A", source: "AF-P1-F1 v6",
    residue: { resName: "ARG", chain: "A", caBFactor: 95 }, residueName: "Arginine",
    measurement: { label: "Cα pLDDT", value: "95.0", note: "B-factor column holds AlphaFold pLDDT (0–100)." },
    band: { label: "Very high", color: 0x0053d6 },
    secondary: { segment: { cls: "alpha-helix", start: 10, end: 29 }, index: 11, length: 20 }, secondarySource: "dssp",
    regions: [{ kind: "domain", label: "Kinase", start: 5, end: 45, evidence: "Experimental" }],
    betweenDomains: null,
    siteDistance: { angstrom: 18.24, separation: 139 },
  };

  it("reads identity, fold, confidence, distance and annotation in that order, each with its source", () => {
    render(<StructureSelectionCard selection={selection} site={site} onReturn={vi.fn()} />);
    expect(screen.getByRole("heading").textContent).toBe("Arg20Selected");
    const rows = [...screen.getByTestId("structure-selection-facts").querySelectorAll("dt")].map(dt => dt.textContent);
    expect(rows).toEqual(["Secondary structure", "Cα pLDDT", "To the variant site", "UniProt annotation"]);
    expect(screen.getByText("α-helix 10–29 · residue 11 of 20")).toBeTruthy();
    expect(screen.getByText(/backbone i→i\+4 hydrogen bonds\. DSSP on these coordinates/)).toBeTruthy();
    expect(screen.getByText("95.0")).toBeTruthy();
    expect(screen.getByText("very high")).toBeTruthy();
    expect(screen.getByText("18.2 Å")).toBeTruthy();
    expect(screen.getByText(/139 apart in sequence/)).toBeTruthy();
  });

  it("keeps the return action for an off-site selection", () => {
    const onReturn = vi.fn();
    render(<StructureSelectionCard selection={selection} site={site} onReturn={onReturn} />);
    fireEvent.click(screen.getByRole("button", { name: "Return to Ser159Cys" }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});

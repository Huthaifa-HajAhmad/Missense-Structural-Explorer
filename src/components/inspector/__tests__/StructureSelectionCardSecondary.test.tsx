// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StructureSelectionCard } from "../StructureSelectionCard";
import type { StructureSelection } from "../../../shared/structureSelection";
import type { Structure3dEvidence } from "../../../shared/structure3dEvidence";

/** A residue whose secondary-structure read is still running must not also say "no assignment" (B8). */
const selection = { state: "available", secondary: null, position: 358, residueLabel: "Gly358", measurement: null, band: null } as unknown as StructureSelection;
const site = { canAddressVariantSite: false, position: null } as unknown as Structure3dEvidence["site"];

describe("selected-residue card: secondary-structure state (B8)", () => {
  it("says nothing about the assignment while it is still being read", () => {
    render(<StructureSelectionCard selection={selection} site={site} onReturn={() => {}} secondaryReading />);
    expect(screen.queryByText("No assignment has been read for this model.")).toBeNull();
    expect(screen.queryByText("Secondary structure")).toBeNull();
  });

  it("says no assignment has been read once the read has ended", () => {
    render(<StructureSelectionCard selection={selection} site={site} onReturn={() => {}} secondaryReading={false} />);
    expect(screen.getByText("No assignment has been read for this model.")).toBeInTheDocument();
  });
});

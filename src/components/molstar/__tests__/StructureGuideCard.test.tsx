// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StructureGuideCard } from "../StructureGuideCard";

afterEach(cleanup);

const base = {
  items: [
    { key: "site", color: 0xc46849, shape: "sticks" as const, text: "Variant residue Ala5", sub: "pLDDT 96 at this residue (AlphaFold DB)" },
    { key: "companions", color: 0x3b6ea5, shape: "sticks" as const, text: "ClinVar P/LP missense residues, germline (67)", sub: "66 residues, drawn on this model by number" },
  ],
  labels: true, onToggleLabels: vi.fn(), labelAll: { count: 66, on: false }, onToggleLabelAll: vi.fn(), onOpenGuide: vi.fn(),
};

describe("StructureGuideCard", () => {
  it("keys each highlighted thing with its drawn colour", () => {
    render(<StructureGuideCard {...base} />);
    const site = document.querySelector<HTMLElement>('[data-guide-item="site"] .s3d-guide__swatch')!;
    expect(site.style.getPropertyValue("--swatch")).toBe("#c46849");
    expect(screen.getByText("ClinVar P/LP missense residues, germline (67)")).toBeTruthy();
  });

  it("offers to label a large highlighted set only while labels are on, and only on request", () => {
    const { rerender } = render(<StructureGuideCard {...base} />);
    fireEvent.click(screen.getByLabelText("Label all 66 highlighted"));
    expect(base.onToggleLabelAll).toHaveBeenCalled();
    rerender(<StructureGuideCard {...base} labels={false} />);
    expect(screen.queryByLabelText("Label all 66 highlighted")).toBeNull();
  });

  it("shows the checkbox's own state, and names the capped number the canvas will label", () => {
    const { rerender } = render(<StructureGuideCard {...base} labelAll={{ count: 66, labelled: 60, on: true }} />);
    expect(screen.getByLabelText("Label 60 of 66 highlighted")).toBeChecked();
    rerender(<StructureGuideCard {...base} labelAll={{ count: 66, labelled: 60, on: false }} />);
    expect(screen.getByLabelText("Label 60 of 66 highlighted")).not.toBeChecked();
  });

  it("shows no label-all control for a set the viewer labels on its own", () => {
    render(<StructureGuideCard {...base} labelAll={null} />);
    expect(screen.queryByLabelText(/Label (all|\d+ of)/)).toBeNull();
  });

  it("opens the guide to reading a structure", () => {
    render(<StructureGuideCard {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /How to read a structure/ }));
    expect(base.onOpenGuide).toHaveBeenCalled();
  });

  it("draws nothing when nothing is highlighted", () => {
    const { container } = render(<StructureGuideCard {...base} items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

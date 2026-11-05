// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StructureGuideCard } from "../StructureGuideCard";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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

  it("keeps the guide available but collapsed on a phone", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<StructureGuideCard {...base} />);
    expect(screen.queryByLabelText("Residue labels")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show canvas guide" }));
    expect(screen.getByLabelText("Residue labels")).toBeTruthy();
  });

  it("collapses when resized to a narrow screen even after a desktop toggle, and removes its listener", () => {
    let changed = () => {};
    const media = { matches: true, addEventListener: vi.fn((_event, callback) => { changed = callback; }), removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", vi.fn(() => media));
    const view = render(<StructureGuideCard {...base} />);
    expect(screen.getByLabelText("Residue labels")).toBeTruthy();
    // Toggle closed and back open on desktop
    fireEvent.click(screen.getByRole("button", { name: "Hide canvas guide" }));
    fireEvent.click(screen.getByRole("button", { name: "Show canvas guide" }));
    expect(screen.getByLabelText("Residue labels")).toBeTruthy();
    act(() => { media.matches = false; changed(); });
    expect(screen.queryByLabelText("Residue labels")).toBeNull();
    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", changed);
  });

  it("draws nothing when nothing is highlighted", () => {
    const { container } = render(<StructureGuideCard {...base} items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("supports interactive focus, dismiss actions, tabular badges, and dual-colour superposition swatches", () => {
    const onFocusSite = vi.fn();
    const onFocusSelected = vi.fn();
    const onClearSelected = vi.fn();
    const onFocusCluster = vi.fn();
    const onClearCluster = vi.fn();
    const onFocusPocket = vi.fn();
    const onClearPocket = vi.fn();
    const onFocusContacts = vi.fn();
    const onClearContacts = vi.fn();
    render(
      <StructureGuideCard
        {...base}
        items={[
          {
            key: "site",
            color: 0x64748b,
            secondaryColor: 0xc46849,
            shape: "pair",
            text: "Variant residue Arg175",
            badge: "p.R175H",
            onClick: onFocusSite,
            actionLabel: "Focus camera on variant residue",
          },
          {
            key: "selected",
            color: null,
            shape: "sticks",
            text: "Selected residue Leu200",
            badge: "88.0",
            onClick: onFocusSelected,
            actionLabel: "Frame selected residue Leu200",
            onClear: onClearSelected,
            clearLabel: "Return to variant site",
          },
          {
            key: "companions",
            color: 0x3b6ea5,
            shape: "sticks",
            text: "ClinVar P/LP missense residues",
            badge: "66",
            onClick: onFocusCluster,
            onClear: onClearCluster,
            clearLabel: "Clear highlighted residue group",
          },
          {
            key: "pocket",
            color: 0x2f6b5e,
            shape: "surface",
            text: "Predicted pocket lining (P2Rank)",
            badge: "18 aa",
            onClick: onFocusPocket,
            actionLabel: "Frame predicted pocket lining",
            onClear: onClearPocket,
            clearLabel: "Hide pocket on structure",
          },
          {
            key: "contacts",
            color: null,
            shape: "dashes",
            text: "Close-up: residues within 5 Å and their contacts",
            badge: "5 Å",
            onClick: onFocusContacts,
            actionLabel: "Frame 5 Å neighbourhood",
            onClear: onClearContacts,
            clearLabel: "Exit site close-up",
          },
        ]}
      />,
    );

    const pairSwatch = document.querySelector<HTMLElement>('[data-guide-item="site"] .s3d-guide__swatch')!;
    expect(pairSwatch.getAttribute("data-shape")).toBe("pair");
    expect(pairSwatch.style.getPropertyValue("--swatch")).toBe("#64748b");
    expect(pairSwatch.style.getPropertyValue("--swatch-2")).toBe("#c46849");
    expect(screen.getByText("p.R175H")).toBeTruthy();

    // Null-colour swatch omits inline style and sets data-colour="none"
    const selectedSwatch = document.querySelector<HTMLElement>('[data-guide-item="selected"] .s3d-guide__swatch')!;
    expect(selectedSwatch.getAttribute("data-colour")).toBe("none");
    expect(selectedSwatch.getAttribute("style")).toBeNull();

    // Clicking the row text/body button directly or via accessible name triggers the single row button
    fireEvent.click(screen.getByText("Variant residue Arg175"));
    expect(onFocusSite).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Focus camera on variant residue" }));
    expect(onFocusSite).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Frame predicted pocket lining" }));
    expect(onFocusPocket).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Hide pocket on structure" }));
    expect(onClearPocket).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Return to variant site" }));
    expect(onClearSelected).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear highlighted residue group" }));
    expect(onClearCluster).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Exit site close-up" }));
    expect(onClearContacts).toHaveBeenCalledTimes(1);

    // Collapsing the guide renders all 5 mini swatch dots with shape/pair/null-colour metadata
    const toggleBtn = screen.getByRole("button", { name: "Hide canvas guide" });
    expect(toggleBtn.getAttribute("aria-controls")).toBe("s3d-guide-body");
    fireEvent.click(toggleBtn);
    const card = document.querySelector<HTMLElement>('[data-testid="structure-guide-card"]')!;
    expect(card.getAttribute("data-collapsed")).toBe("true");
    const dots = card.querySelectorAll<HTMLElement>(".s3d-guide__mini-dot");
    expect(dots).toHaveLength(5);
    expect(dots[0].getAttribute("data-shape")).toBe("pair");
    expect(dots[0].style.getPropertyValue("--swatch-2")).toBe("#c46849");
    expect(dots[1].getAttribute("data-colour")).toBe("none");
    expect(dots[4].getAttribute("data-shape")).toBe("dashes");
  });

  it("handles labelled=0 and missing onToggleLabelAll safely", () => {
    render(
      <StructureGuideCard
        {...base}
        labelAll={{ count: 15, labelled: 0, on: false }}
        onToggleLabelAll={undefined}
      />,
    );
    const checkbox = screen.getByLabelText("Label 0 of 15 highlighted") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });
});


// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import VariantHeader from "../../VariantHeader";
import HeaderBar from "../../HeaderBar";
import { buildVariantHeaderModel } from "../variantHeaderModel";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import type { AnalysisResult } from "../../../types";

/**
 * The option-B variant chrome: identity in the top bar, a one-line context strip under it.
 */

const constraint = {
  provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
  regionalRelease: "4.1.1",
  missense_z: 1.09,
  loeuf: 0.94,
  pli: 0,
  oe_mis: 0.9,
  isPP2Constrained: false,
  hasRegionalData: false,
  regionalConstraint: null,
} as any;

const clean = {
  gnomadConstraint: constraint,
  isManeSelect: true,
  transcriptId: "ENST00000290810",
  maneRefSeqId: "NM_003905.4",
  predictorData: {
    amPathogenicity: null, amClass: null, caddPhred: null,
    gnomadVariantId: "16-66823281-T-C", gnomadVariantAssembly: "GRCh38",
    locusResolution: { route: "vep-hgvs", canonicalBy: "vep", retryable: false, steps: [] },
  },
} as unknown as AnalysisResult;

/** The reported run: the GRCh38 lookup fell back to the hg19 locus. */
const fallback = {
  ...clean,
  coordinateLift: { status: "not-needed", fromAssembly: "GRCh38", toAssembly: "GRCh38" },
  predictorData: {
    amPathogenicity: null, amClass: null, caddPhred: null,
    gnomadVariantId: "16-66857184-T-C", gnomadVariantAssembly: "GRCh37",
    locusResolution: { route: "fallback", canonicalBy: null, retryable: true, steps: [] },
  },
} as unknown as AnalysisResult;

const props = (analysisResult: AnalysisResult | null) => ({ gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", analysisResult });

describe("context strip", () => {
  it("shows each metric as a chip with its value, micro-track and verdict", () => {
    render(<VariantHeader {...props(clean)} />);
    const chips = within(screen.getByRole("list", { name: "Gene constraint, gnomAD v4.1.2" })).getAllByRole("listitem");
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent("Missense Z");
    expect(chips[0]).toHaveTextContent("+1.09");
    // +1.09 is below the constraint range but is not "tolerant": a positive Z is only slightly fewer than expected.
    expect(chips[0]).toHaveTextContent("Not constrained");
    expect(chips[0].querySelector(".vcs-mini-dot")).not.toBeNull();
  });

  it("opens a reading's card on a click, and a second click closes it", () => {
    render(<VariantHeader {...props(clean)} />);
    const chip = screen.getByRole("button", { name: /^LOEUF/ });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(chip).not.toHaveAttribute("aria-controls");

    fireEvent.click(chip);
    const card = screen.getByTestId("constraint-card");
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(chip).toHaveAttribute("aria-controls", card.id);
    expect(card).toHaveAttribute("data-metric", "loeuf");
    // One reading per card: its own full track, and who set its cut-points.
    expect(card.querySelectorAll("li.vh-metric")).toHaveLength(1);
    expect(within(card).getByText("gnomAD", { selector: ".cx-origin" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /gnomAD guidance/ })).toHaveAttribute("target", "_blank");

    fireEvent.click(chip);
    expect(screen.queryByTestId("constraint-card")).toBeNull();
  });

  it("opens a reading's card on keyboard focus, and Tab reaches the card's action next", () => {
    render(<VariantHeader {...props(clean)} />);
    const chip = screen.getByRole("button", { name: /^Missense Z/ });
    const matches = vi.spyOn(chip, "matches").mockImplementation((selector: string) => selector === ":focus-visible");
    fireEvent.focus(chip);
    matches.mockRestore();
    const card = screen.getByTestId("constraint-card");
    expect(within(card).getByText(/PP2 is read from the regional O\/E at the variant, not from Z/)).toBeInTheDocument();
    // The card sits right after its chip in the DOM, so Tab order runs chip → card action → next chip.
    const inspect = within(card).getByRole("button", { name: "Open in inspector" });
    expect(chip.compareDocumentPosition(inspect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chip.closest("li")?.contains(inspect)).toBe(true);
  });

  it("does not open a card when focus arrives from a pointer", () => {
    render(<VariantHeader {...props(clean)} />);
    const chip = screen.getByRole("button", { name: /^Missense Z/ });
    vi.spyOn(chip, "matches").mockReturnValue(false);
    fireEvent.focus(chip);
    expect(screen.queryByTestId("constraint-card")).toBeNull();
  });

  it("closes the card on Escape with focus returned to its chip", () => {
    render(<VariantHeader {...props(clean)} />);
    const chip = screen.getByRole("button", { name: /^Missense Z/ });
    fireEvent.click(chip);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("constraint-card")).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it("closes the card on a click outside it, but not on a click inside it", () => {
    render(<div><VariantHeader {...props(clean)} /><p>page</p></div>);
    fireEvent.click(screen.getByRole("button", { name: /^Missense Z/ }));
    fireEvent.mouseDown(screen.getByTestId("constraint-card"));
    expect(screen.getByTestId("constraint-card")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("page"));
    expect(screen.queryByTestId("constraint-card")).toBeNull();
  });

  it("closes the card when focus leaves the chip and its card", () => {
    render(<VariantHeader {...props(clean)} />);
    const chip = screen.getByRole("button", { name: /^Missense Z/ });
    fireEvent.click(chip);
    fireEvent.blur(chip, { relatedTarget: screen.getByRole("button", { name: /^LOEUF/ }) });
    expect(screen.queryByTestId("constraint-card")).toBeNull();
  });

  it("keeps the card open when a press on its text moves focus from the chip to the card", () => {
    render(<VariantHeader {...props(clean)} />);
    const chip = screen.getByRole("button", { name: /^Missense Z/ });
    fireEvent.click(chip);
    const card = screen.getByTestId("constraint-card");
    // Chromium focuses the nearest focusable ancestor on a press; without one the blur has
    // `relatedTarget === null` and closes the card under the pointer. The card is that target.
    expect(card).toHaveAttribute("tabindex", "-1");
    fireEvent.blur(chip, { relatedTarget: card });
    expect(screen.getByTestId("constraint-card")).toBeInTheDocument();
    expect(chip).toHaveAttribute("aria-expanded", "true");
    // Leaving for somewhere else, or for nowhere, still closes it.
    fireEvent.blur(card, { relatedTarget: null });
    expect(screen.queryByTestId("constraint-card")).toBeNull();
  });

  it("hands a reading to the inspector and marks its chip as inspected", () => {
    useVariantAnalysisStore.getState().setConstraintFocus(null);
    render(<VariantHeader {...props(clean)} />);
    const chip = screen.getByRole("button", { name: /^Regional O\/E/ });
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("button", { name: "Open in inspector" }));
    expect(useVariantAnalysisStore.getState().constraintFocus).toBe("regional-oe");
    expect(screen.queryByTestId("constraint-card")).toBeNull();
    expect(chip).toHaveAttribute("data-inspected", "true");
    expect(chip).toHaveAccessibleName(/shown in the inspector/);
  });

  it("tags a measured reading whose release differs from the group's label, and nothing else", () => {
    const measured = {
      ...clean,
      gnomadConstraint: { ...constraint, hasRegionalData: true, regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "Ala1 to Gly9" } },
    } as unknown as AnalysisResult;
    const { unmount } = render(<VariantHeader {...props(measured)} />);
    expect(screen.getByRole("button", { name: /^Regional O\/E/ })).toHaveTextContent("v4.1.1");
    unmount();
    // No regional value, so no release to attribute.
    render(<VariantHeader {...props(clean)} />);
    expect(screen.getByRole("button", { name: /^Regional O\/E/ }).querySelector(".vcs-chip-release")).toBeNull();
    expect(screen.getByRole("button", { name: /^Missense Z/ }).querySelector(".vcs-chip-release")).toBeNull();
    expect(screen.getByRole("button", { name: /^LOEUF/ }).querySelector(".vcs-chip-release")).toBeNull();
  });

  it("has no run state on a clean run", () => {
    render(<VariantHeader {...props(clean)} />);
    expect(screen.queryByTestId("run-state")).toBeNull();
  });

  it("closes the card and gives the rail back when switching variants", () => {
    const { rerender } = render(<VariantHeader {...props(clean)} />);
    fireEvent.click(screen.getByRole("button", { name: /^Missense Z/ }));
    useVariantAnalysisStore.getState().setConstraintFocus("missense-z");
    expect(screen.getByTestId("constraint-card")).toBeInTheDocument();

    rerender(<VariantHeader {...props(clean)} variant="p.Arg175His" />);
    expect(screen.queryByTestId("constraint-card")).toBeNull();
    expect(useVariantAnalysisStore.getState().constraintFocus).toBeNull();
  });
});

describe("run-state slot", () => {
  beforeEach(() => useVariantAnalysisStore.getState().resetVariantAnalysisState());

  it("renders provide-allele recovery action and triggers callback", () => {
    const onProvideAllele = vi.fn();
    const ambiguousResult = {
      ...fallback,
      predictorData: {
        ...fallback.predictorData!,
        locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "ambiguous-allele", steps: [] },
      },
    } as unknown as AnalysisResult;

    render(<VariantHeader {...props(ambiguousResult)} onProvideAllele={onProvideAllele} />);
    const actionBtn = screen.getByRole("button", { name: /provide nucleotide allele/i });
    expect(actionBtn).toBeInTheDocument();
    fireEvent.click(actionBtn);
    expect(onProvideAllele).toHaveBeenCalledTimes(1);
  });

  it("announces a fallback locus and offers the re-run", () => {
    render(<VariantHeader {...props(fallback)} />);
    const state = screen.getByTestId("run-state");
    expect(state).toHaveAttribute("role", "status");
    expect(state).toHaveTextContent("hg19 fallback");
    expect(state).toHaveAttribute("title", expect.stringMatching(/GRCh38 lookup .*did not complete/));

    const before = useVariantAnalysisStore.getState().rerunNonce;
    fireEvent.click(within(state).getByRole("button", { name: /Re-run/ }));
    expect(useVariantAnalysisStore.getState().rerunNonce).toBe(before + 1);
  });

  it("does not offer a re-run that cannot help", () => {
    const definitive = {
      ...fallback,
      predictorData: { ...fallback.predictorData!, locusResolution: { route: "fallback", canonicalBy: null, retryable: false, steps: [] } },
    } as unknown as AnalysisResult;
    render(<VariantHeader {...props(definitive)} />);
    expect(screen.getByTestId("run-state")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Re-run/ })).toBeNull();
  });

  it("flags a gnomAD outage too", () => {
    const outage = { ...clean, serviceStatus: { gnomadFrequency: "timeout" } } as unknown as AnalysisResult;
    expect(buildVariantHeaderModel(props(outage)).runState?.label).toBe("gnomAD did not answer");
  });
});

describe("top bar", () => {
  const base = { isOffline: false, isDark: false, onToggleTheme: () => {}, onOpenSettings: () => {} };

  it("titles itself with the variant on analysis views, instead of a breadcrumb", () => {
    render(<HeaderBar {...base} variant={props(clean)} />);
    const identity = screen.getByRole("group", { name: "Active variant" });
    expect(identity).toHaveTextContent("NAE1");
    expect(identity).toHaveTextContent("p.Asp116Gly");
    expect(identity).toHaveTextContent("NM_003905.4");
    expect(identity).toHaveTextContent("MANE Select");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });

  it("offers the icon search, not a breadcrumb, when no variant is on screen", () => {
    render(<HeaderBar {...base} variant={null} />);
    const search = screen.getByRole("button", { name: /search views or run a variant/i });
    expect(search.textContent).toBe("");
    expect(search.querySelectorAll("svg")).toHaveLength(1);
    expect(search.querySelector("kbd")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Active variant" })).toBeNull();
  });
});

// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import VariantHeader from "../../VariantHeader";
import HeaderBar from "../../HeaderBar";
import { buildVariantHeaderModel } from "../variantHeaderModel";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import type { AnalysisResult } from "../../../types";

/**
 * The option-B variant chrome: identity in the top bar, a one-line context strip under it.
 */

const constraint = {
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
    const chips = within(screen.getByRole("list", { name: "Gene constraint, gnomAD v2" })).getAllByRole("listitem");
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent("Missense Z");
    expect(chips[0]).toHaveTextContent("+1.09");
    // +1.09 is below the constraint range but is not "tolerant": a positive Z is only slightly fewer than expected.
    expect(chips[0]).toHaveTextContent("Not constrained");
    expect(chips[0].querySelector(".vcs-mini-dot")).not.toBeNull();
  });

  it("discloses the full tracks from Details, and closes on Escape with focus returned", () => {
    render(<VariantHeader {...props(clean)} />);
    const details = screen.getByRole("button", { name: /^Details/ });
    expect(details).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Gene constraint reference ranges" })).toBeNull();

    fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Gene constraint reference ranges" });
    expect(details).toHaveAttribute("aria-controls", panel.id);
    expect(panel.querySelectorAll("li.vh-metric")).toHaveLength(3);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Gene constraint reference ranges" })).toBeNull();
    expect(document.activeElement).toBe(details);
  });

  it("closes the panel on a click outside it", () => {
    render(<div><VariantHeader {...props(clean)} /><p>page</p></div>);
    fireEvent.click(screen.getByRole("button", { name: /^Details/ }));
    fireEvent.mouseDown(screen.getByText("page"));
    expect(screen.queryByRole("region", { name: "Gene constraint reference ranges" })).toBeNull();
  });

  it("has no run state on a clean run", () => {
    render(<VariantHeader {...props(clean)} />);
    expect(screen.queryByTestId("run-state")).toBeNull();
  });
});

describe("run-state slot", () => {
  beforeEach(() => useVariantAnalysisStore.getState().resetVariantAnalysisState());

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
  const base = { masterView: "evidence" as const, isBiophysicalLoading: false, isOffline: false, isDark: false, onToggleTheme: () => {}, onOpenSettings: () => {} };

  it("titles itself with the variant on analysis views, instead of a breadcrumb", () => {
    render(<HeaderBar {...base} activeEvidenceTab="clinical" variant={props(clean)} />);
    const identity = screen.getByRole("group", { name: "Active variant" });
    expect(identity).toHaveTextContent("NAE1");
    expect(identity).toHaveTextContent("p.Asp116Gly");
    expect(identity).toHaveTextContent("NM_003905.4");
    expect(identity).toHaveTextContent("MANE Select");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });

  it("keeps the breadcrumb when no variant is on screen", () => {
    render(<HeaderBar {...base} activeEvidenceTab="clinical" variant={null} />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Population data");
    expect(screen.queryByRole("group", { name: "Active variant" })).toBeNull();
  });
});

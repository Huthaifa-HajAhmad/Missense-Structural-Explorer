// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ViewInspector from "../ViewInspector";
import VariantHeader from "../../VariantHeader";
import { ConstraintInspector } from "../ConstraintInspector";
import { SettingsProvider } from "../../../context/SettingsContext";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { buildConstraintProvenance } from "../../header/constraintMetrics";
import type { AnalysisResult } from "../../../types";

/**
 * Gene constraint borrows the inspector rail from whatever page is open: the strip's card sends a
 * reading (`constraintFocus`), the rail swaps to it, and Back, Escape or navigating returns the rail
 * to the page. These pin that contract end to end, plus the inspector's own content.
 */

const RESULT = {
  metadata: { gene: "UROD", variant: "p.Gly318Arg", wildType: "Gly", mutant: "Arg", residueIndex: 318 },
  gnomadConstraint: {
    provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000126088", transcriptId: "ENST00000246337", transcriptVersion: "9", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
    regionalRelease: "4.1.1",
    missense_z: 1.78,
    loeuf: 0.96,
    pli: 0,
    oe_mis: 0.8,
    isPP2Constrained: false,
    hasRegionalData: true,
    regionalConstraint: { isConstrained: true, oeRatio: 0.81, pValue: 0.0004, regionText: "Ala290 to Val367" },
  },
} as unknown as AnalysisResult;

function renderRail(overrides: Record<string, unknown> = {}) {
  const props = {
    activeView: "evidence" as const,
    onViewChange: vi.fn(),
    analysisResult: RESULT,
    isFolding: false,
    isBiophysicalLoading: false,
    isClinicalLoading: false,
    isNarrativeLoading: false,
    gene: "UROD",
    variant: "p.Gly318Arg",
    uniprotId: "P06132",
    activeEvidenceTab: "clinical",
    ...overrides,
  };
  const ui = (p: typeof props) => (
    <SettingsProvider>
      <VariantHeader gene={p.gene} variant={p.variant} uniprotId={p.uniprotId} analysisResult={p.analysisResult} />
      <ViewInspector {...(p as any)} />
    </SettingsProvider>
  );
  const result = render(ui(props));
  return { ...result, rerenderWith: (next: Record<string, unknown>) => result.rerender(ui({ ...props, ...next })) };
}

const sendToInspector = (name: RegExp) => {
  fireEvent.click(screen.getByRole("button", { name }));
  fireEvent.click(screen.getByRole("button", { name: "Open in inspector" }));
};

describe("Gene constraint in the inspector", () => {
  beforeEach(() => {
    localStorage.clear();
    useVariantAnalysisStore.getState().setConstraintFocus(null);
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("swaps the page's rail for the reading the card sent, and focuses that reading", () => {
    renderRail();
    expect(screen.queryByTestId("constraint-inspector")).toBeNull();

    sendToInspector(/^LOEUF/);

    const view = screen.getByTestId("constraint-inspector");
    expect(view).toHaveAttribute("data-focus", "loeuf");
    const rail = screen.getByLabelText("Context & Provenance Inspector");
    expect(rail).toHaveTextContent("Gene constraint");
    expect(rail).toHaveTextContent("gnomAD v4.1.2 · gene-level context");
    expect(rail.querySelector('[data-inspector-mode="gene-constraint"]')).not.toBeNull();
    const row = view.querySelector<HTMLElement>("#constraint-metric-loeuf");
    expect(row).toHaveAttribute("data-focused", "true");
    expect(document.activeElement).toBe(row);
  });

  it("opens a collapsed rail for the reading", () => {
    localStorage.setItem("cs-inspector-collapsed", "true");
    renderRail();
    expect(screen.getByLabelText("Collapsed Context Inspector")).toBeInTheDocument();
    sendToInspector(/^Missense Z/);
    expect(screen.getByTestId("constraint-inspector")).toBeInTheDocument();
    expect(localStorage.getItem("cs-inspector-collapsed")).toBe("false");
  });

  it("gives the rail back on Back, naming the page, with focus returned to the chip", () => {
    renderRail();
    sendToInspector(/^Regional O\/E/);
    const back = screen.getByRole("button", { name: "Back to Evidence Lineage" });
    fireEvent.click(back);
    expect(screen.queryByTestId("constraint-inspector")).toBeNull();
    expect(useVariantAnalysisStore.getState().constraintFocus).toBeNull();
    const chip = screen.getByRole("button", { name: /^Regional O\/E/ });
    expect(document.activeElement).toBe(chip);
    // Returning focus is not a request to look at the reading again.
    expect(screen.queryByTestId("constraint-card")).toBeNull();
    expect(chip).not.toHaveAttribute("data-inspected");
  });

  it("gives the rail back on Escape inside it", () => {
    renderRail();
    sendToInspector(/^Missense Z/);
    fireEvent.keyDown(screen.getByTestId("constraint-inspector"), { key: "Escape" });
    expect(screen.queryByTestId("constraint-inspector")).toBeNull();
  });

  it("drops the reading when the result is cleared, so it cannot resurface on the next result", () => {
    const { rerenderWith } = renderRail();
    sendToInspector(/^LOEUF/);
    expect(useVariantAnalysisStore.getState().constraintFocus).toBe("loeuf");
    act(() => rerenderWith({ analysisResult: null }));
    expect(useVariantAnalysisStore.getState().constraintFocus).toBeNull();
    act(() => rerenderWith({ analysisResult: RESULT }));
    expect(screen.queryByTestId("constraint-inspector")).toBeNull();
  });

  it("gives the rail back when the reader moves to another page or tab", () => {
    const { rerenderWith } = renderRail();
    sendToInspector(/^Missense Z/);
    expect(screen.getByTestId("constraint-inspector")).toBeInTheDocument();
    act(() => rerenderWith({ activeEvidenceTab: "predictors" }));
    expect(screen.queryByTestId("constraint-inspector")).toBeNull();
    expect(useVariantAnalysisStore.getState().constraintFocus).toBeNull();
  });
});

describe("ConstraintInspector content", () => {
  const view = () => within(screen.getByRole("region", { name: "Gene constraint reference ranges" }));

  it("scopes the readings to the gene and states they do not classify the variant", () => {
    render(<ConstraintInspector analysisResult={RESULT} gene="UROD" variant="p.Gly318Arg" focus={null} />);
    expect(view().getByText(/Gene-level context for/)).toHaveTextContent("Gene-level context for UROD. It does not classify p.Gly318Arg.");
  });

  it("names who set each track's cut-points", () => {
    render(<ConstraintInspector analysisResult={RESULT} gene="UROD" variant="p.Gly318Arg" focus={null} />);
    const origins = Array.from(document.querySelectorAll(".cx-sources .cx-origin")).map((el) => el.textContent);
    expect(origins).toEqual(["App-defined", "gnomAD", "Calibrated"]);
    expect(view().getByText("2.0 · 3.09")).toBeInTheDocument();
    expect(view().getByText("0.36 · 0.45")).toBeInTheDocument();
    expect(view().getByText("PP2 ≤ 0.36 · ≤ 0.59")).toBeInTheDocument();
  });

  it("shows the facts that used to be tooltip-only", () => {
    render(<ConstraintInspector analysisResult={RESULT} gene="UROD" variant="p.Gly318Arg" focus={null} />);
    // PP2 calibrated regional rule, Chao et al. v3; replaced gene Z proxy: Z is gene context, not PP2.
    expect(view().getByText("Gene context; PP2 is read from the regional O/E at the variant, not from Z.")).toBeInTheDocument();
    expect(view().getByText("O/E 0.81 lies between the PP2 and BP1 bands; no evidence either way.")).toBeInTheDocument();
    expect(view().getByText("Interval Ala290 to Val367, regional chi-square p = 4.0×10⁻⁴ (approximate).")).toBeInTheDocument();
  });

  it("lists each release separately: regional metrics are v4.1.1, not the gene metrics' v4.1.2", () => {
    render(<ConstraintInspector analysisResult={RESULT} gene="UROD" variant="p.Gly318Arg" focus={null} />);
    expect(view().getByRole("link", { name: /gnomAD v4\.1\.2/ })).toHaveAttribute(
      "href",
      "https://gnomad.broadinstitute.org/gene/ENSG00000126088?dataset=gnomad_r4"
    );
    expect(view().getByText("gnomAD v4.1.1")).toBeInTheDocument();
    expect(view().getByText("ENST00000246337.9")).toBeInTheDocument();
    expect(view().getByText("Annotated transcript")).toBeInTheDocument();
  });

  it("names no source and no cut-points for a payload without provenance", () => {
    const { provenance, ...legacy } = (RESULT as any).gnomadConstraint;
    const result = { ...RESULT, gnomadConstraint: legacy } as AnalysisResult;
    expect(buildConstraintProvenance(result)).toBeNull();
    render(<ConstraintInspector analysisResult={result} gene="UROD" variant="p.Gly318Arg" focus={null} />);
    expect(view().queryByText("Assembly")).toBeNull();
    expect(document.querySelectorAll(".cx-sources .cx-origin")).toHaveLength(0);
  });
});

// @vitest-environment jsdom
/**
 * The Insights screen and rail after the 2026-11-24 audit: a stale summary is flagged where it is
 * read, the model's inputs are the run's own, repeated facts appear once, and rows the engine never
 * counts sit apart from the rows that can carry a criterion.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InsightsScreen, type InsightsNarrative } from "../InsightsScreen";
import { InsightsInspector } from "../../inspector/InsightsInspector";
import { ReviewWorkspaceProvider } from "../../review/ReviewWorkspace";
import { SettingsProvider } from "../../../context/SettingsContext";
import { buildInsightsEvidence } from "../../../shared/insightsEvidence";
import { functionEvidenceInputFrom } from "../../evidence/function/functionInput";
import { nae1Reference } from "../../../shared/__tests__/fixtures/splicingReference";

const result = nae1Reference();
/** The reference fixture is unclassified; these views need a recorded criterion. */
const classified = nae1Reference({ ruleBasedInsights: { acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [{ code: "PP3", reason: "Recorded calibrated criterion" }] }, insights: { acmgCriteria: [] } });
const build = (r = result, deep?: string[]) =>
  buildInsightsEvidence({ result: r, functionInput: functionEvidenceInputFrom(r), stability: null, deepEnginesNamed: deep });
const narrative = (over: Partial<InsightsNarrative> = {}): InsightsNarrative => ({
  paragraphs: ["The change sits in a conserved loop."], sourceSection: null, truncated: false, isAi: true, model: "gemini", outdated: false, ...over,
});
const openSummary = () => fireEvent.click(screen.getByRole("tab", { name: "Written summary" }));

describe("Written summary", () => {
  it("warns, where the text is read, that an outdated summary describes earlier evidence", () => {
    render(<InsightsScreen evidence={build()} narrative={narrative({ outdated: true })} />);
    openSummary();
    expect(screen.getByRole("note")).toHaveTextContent(/describes earlier evidence/);
    expect(screen.queryByText(/Shown to the model:/)).toBeNull();
  });

  it("lists the deep-model sources this run named, not every engine the prompt can carry", () => {
    render(<InsightsScreen evidence={build(result, ["FoldX"])} narrative={narrative()} />);
    openSummary();
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText(/deep-model observations \(FoldX\)/)).toBeInTheDocument();
    expect(screen.queryByText(/StabilityOracle/)).toBeNull();
  });
});

describe("Evidence map", () => {
  it("puts the rows the engine never counts in their own group after the rows that can count", () => {
    render(<InsightsScreen evidence={build()} narrative={null} />);
    const group = screen.getByRole("group", { name: "Context the engine never counts" });
    expect(within(group).getAllByRole("button", { pressed: false }).map(b => b.textContent))
      .toEqual(["Stability", "Assembly", "Genome-wide scores"]);
  });
});

describe("Criterion records", () => {
  it("folds codes with no recorded reason into one row", () => {
    render(<InsightsScreen evidence={build(classified)} narrative={null} />);
    fireEvent.click(screen.getByRole("tab", { name: "Criterion records" }));
    expect(screen.queryAllByText("The engine recorded no criterion for this code.")).toHaveLength(0);
    expect(screen.getByRole("rowheader", { name: /No criterion recorded/ })).toBeInTheDocument();
  });
});

describe("Evidence gaps", () => {
  it("names the kinds of evidence behind each strength it asks for", () => {
    render(<InsightsScreen evidence={build(classified)} narrative={null} />);
    fireEvent.click(screen.getByRole("tab", { name: "Evidence gaps" }));
    expect(screen.getByText(/PS3 functional assay/)).toBeInTheDocument();
  });
});

describe("Several candidate alleles", () => {
  it("says under the verdict that frequency criteria hold for every allele", () => {
    const alleles = (outcomes: string[]) => nae1Reference({
      gnomadFrequency: { candidates: outcomes.map(outcome => ({ outcome })) },
      predictorData: { ...result.predictorData, locusResolution: { route: "fallback", canonicalBy: null, failureKind: "multiple-candidates", steps: [], candidates: [{}, {}] } },
    });
    render(<InsightsScreen evidence={build(alleles(["found", "found"]))} narrative={null} />);
    expect(screen.getByText(/can come from 2 nucleotide alleles.*was read for each/)).toBeInTheDocument();
  });

  it("does not say frequency was read for every allele when one reading is missing", () => {
    const r = nae1Reference({
      gnomadFrequency: { candidates: [{ outcome: "found" }, { outcome: "failed" }] },
      predictorData: { ...result.predictorData, locusResolution: { route: "fallback", canonicalBy: null, failureKind: "multiple-candidates", steps: [], candidates: [{}, {}] } },
    });
    render(<InsightsScreen evidence={build(r)} narrative={null} />);
    expect(screen.queryByText(/was read for each/)).toBeNull();
    expect(screen.getByText(/at least one allele has no reading/)).toBeInTheDocument();
  });

  it("draws no bar for a lane whose live inputs are unavailable", () => {
    const ev = build(classified);
    const lane = { ...ev.lanes[0], state: "absent" as const, counted: true, lean: "pathogenic" as const };
    render(<InsightsScreen evidence={{ ...ev, lanes: [lane, ...ev.lanes.slice(1)] }} narrative={null} />);
    expect(document.querySelector(`[data-lane="computational"] .ins-bar`)).toBeNull();
  });
});

describe("Insights rail", () => {
  const renderBoth = () => render(
    <SettingsProvider><ReviewWorkspaceProvider result={result}>
      <InsightsScreen evidence={build()} narrative={null} /><InsightsInspector analysisResult={result} />
    </ReviewWorkspaceProvider></SettingsProvider>,
  );

  it("does not repeat the in-silico call or show empty settings", () => {
    renderBoth();
    expect(screen.queryByRole("heading", { name: /In-silico call/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Synthesis directions/ })).toBeNull();
    expect(screen.queryByText("Not recorded", { selector: "dd span" })).toBeNull();
  });

  it("shows the empty pin prompt only on the evidence map", () => {
    renderBoth();
    expect(screen.getByRole("region", { name: "Selected evidence reading" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Criterion records" }));
    expect(screen.queryByRole("region", { name: "Selected evidence reading" })).toBeNull();
  });
});

describe("Classification scale", () => {
  it("shows the five-tier scale under the verdict, with no disclosure to open", () => {
    render(<InsightsScreen evidence={build(classified)} narrative={null} />);
    expect(screen.queryByText("Classification scale and combining rule")).toBeNull();
    const scale = screen.getByRole("img", { name: /ACMG tier 3 of 5: Uncertain/ });
    expect(within(scale).getByText("Uncertain")).toHaveAttribute("aria-current", "true");
  });
});

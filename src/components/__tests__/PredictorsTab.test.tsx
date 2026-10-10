// @vitest-environment jsdom
/**
 * PredictorsTab.test.tsx — what the Predictors screen is allowed to claim.
 *
 * The screen renders from `src/shared/predictorEvidence.ts`; these assertions hold the surface to
 * that model's contract (the model's own arithmetic is pinned in predictorEvidence.test.ts).
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ settings: { alphagenomeApiKey: "" }, openSettingsTab: vi.fn() }),
}));

import { PredictorsTab } from "../evidence/PredictorsTab";
import { EvidenceWorkspaceProvider } from "../evidence/EvidenceWorkspace";

function gzf1(overrides: Record<string, any> = {}) {
  return {
    metadata: { gene: "GZF1", variant: "p.Arg591Trp", acmgWeighting: "standard" },
    predictorData: { caddPhred: 29.5, amPathogenicity: 0.835, amClass: "likely_pathogenic" },
    conservationData: {
      revel: 0.234, bayesdel: 0.092, metarnn: 0.767, clinpred: 0.998, eigenPhred: 6.3, dann: 0.999,
      popeve: -3.931, gerp: 5.0, phylop: 4.91, consurf: null, gpnStar: -8.81,
      alphagenome: { status: "live", aviPhred: 26.4, topPercentile: 0.23, topModality: "AlphaMissense" },
    },
    esmcEval: { llr: -9.55, provenance: "VESM-150M (local sidecar)" },
    esm2Eval: { llr: -4.78 },
    saprotEval: { llr: -3.16 },
    ...overrides,
  } as any;
}

function renderTab(result: any, extra: Record<string, unknown> = {}) {
  // Production always mounts the tabs under the workspace provider; the tests follow. These
  // assertions target the SOURCE RECORDS view, so open it explicitly.
  const rendered = render(
    <EvidenceWorkspaceProvider result={result}>
      <PredictorsTab {...({ analysisState: { result, isLoading: false }, ...extra } as any)} />
    </EvidenceWorkspaceProvider>
  );
  fireEvent.click(screen.getByRole("tab", { name: "Source records" }));
  return rendered;
}

describe("PredictorsTab", () => {
  it("starts the informational table groups collapsed and expands them on request", () => {
    renderTab(gzf1());
    const table = screen.getByTestId("predictor-readings");
    const group = table.querySelector("tbody[data-group='genome']")!;
    expect(group.getAttribute("data-collapsed")).toBe("true");
    expect(table.querySelector("tbody[data-group='vote']")!.hasAttribute("data-collapsed")).toBe(false);
    fireEvent.click(within(group as HTMLElement).getByRole("button", { name: /Show \d+ of \d+ scored/ }));
    expect(group.hasAttribute("data-collapsed")).toBe(false);
  });

  it("explains each non-voting family in its own card, never counting them", () => {
    renderTab(gzf1());
    const card = screen.getByTestId("predictor-informational");
    for (const g of ["protein-lm", "genome", "conservation"]) {
      const fam = within(card).getByTestId(`predictor-family-${g}`);
      expect(fam.textContent).toMatch(/What it measures/);
      expect(fam.textContent).toMatch(/Why it is not counted/);
    }
    expect(card.textContent).toMatch(/never change the PP3 \/ BP4 call/);
  });

  it("prints the calibrated reference's band edges on its ruler", () => {
    renderTab(gzf1());
    const ref = screen.getByTestId("predictor-reference-row");
    const edges = Array.from(ref.querySelectorAll(".prd-ruler__cut")).map(n => n.textContent);
    expect(edges).toEqual(expect.arrayContaining(["0.644", "0.29"]));
  });

  it("states the finding once, and marks an unconfirmed code as unconfirmed", () => {
    renderTab(gzf1());
    const summary = screen.getByTestId("predictor-summary");
    expect(summary.querySelector("strong")!.textContent).toBe(
      "The vote supports PP3, 4 to 1, but REVEL, the calibrated reference, reads BP4.",
    );
    const chip = screen.getByTestId("predictor-verdict");
    expect(chip.textContent).toBe("PP3");
    expect(chip.getAttribute("aria-label")).toMatch(/unconfirmed/);
  });

  it("shows the engine's recorded code, not the vote's, when the payload has one", () => {
    renderTab(gzf1({ ruleBasedInsights: { acmgCriteria: [{ code: "PP3_Moderate", reason: "earlier engine" }] } }));
    expect(screen.getByTestId("predictor-verdict").textContent).toBe("PP3 Moderate");
  });

  it("says when the calibrated reference points the other way, in the summary, not a banner", () => {
    renderTab(gzf1());
    const summary = screen.getByTestId("predictor-summary");
    expect(summary.getAttribute("data-tone")).toBe("warning");
    expect(summary.textContent).toMatch(/ClinGen advises one pre-specified calibrated tool/);
    expect(screen.queryByTestId("reference-callout")).toBeNull();
    expect(screen.getByTestId("predictor-reference-row").getAttribute("data-relation")).toBe("opposes");
    expect(screen.getByTestId("predictor-reference-call").textContent).toBe("BP4");
    expect(screen.getByTestId("predictor-vote-call").textContent).toBe("PP3");
  });

  it("does not repeat the voters' scores or the count on the finding card", () => {
    renderTab(gzf1());
    const card = screen.getByTestId("predictor-finding");
    // 0.767 is MetaRNN's score: it belongs to the readings table only.
    expect(card.textContent).not.toMatch(/0\.767/);
    expect(card.textContent!.match(/4 to 1/g)).toHaveLength(1);
    const key = screen.getByTestId("predictor-vote-key");
    expect(key.textContent).toMatch(/4 pathogenic/);
    expect(key.textContent).toMatch(/1 benign/);
    const tally = within(screen.getByTestId("predictor-vote-row")).getByRole("list", { name: "Voting tools by call" });
    expect(tally.querySelectorAll(".prd-tally__tool")).toHaveLength(7);
  });

  it("keeps a row for the calibrated reference when neither REVEL nor BayesDel scored", () => {
    renderTab(gzf1({ conservationData: { ...gzf1().conservationData, revel: null, bayesdel: null } }));
    const row = screen.getByTestId("predictor-reference-row");
    expect(row.getAttribute("data-relation")).toBe("absent");
    expect(row.textContent).toMatch(/Neither REVEL nor BayesDel scored this variant/);
    expect(screen.getByTestId("predictor-reference-call").textContent).toBe("No result");
  });

  it("warns, without a banner, when the weighting withheld the vote's code", () => {
    renderTab(gzf1({ metadata: { acmgWeighting: "strict-structural" }, ruleBasedInsights: { acmgCriteria: [] } }));
    const summary = screen.getByTestId("predictor-summary");
    expect(summary.getAttribute("data-state")).toBe("withheld");
    expect(summary.textContent).toMatch(/strict-structural ACMG weighting withholds it/);
    expect(screen.getByTestId("predictor-verdict").textContent).toBe("No PP3 / BP4");
  });

  it("says when the payload was classified by an earlier engine", () => {
    renderTab(gzf1({ ruleBasedInsights: { acmgCriteria: [{ code: "PP3_Moderate", reason: "" }] } }));
    expect(screen.getByTestId("predictor-summary").textContent).toMatch(/earlier engine/);
  });

  it("shows No votes, not a code, when nothing scored", () => {
    renderTab({ metadata: {}, predictorData: {}, conservationData: {}, ruleBasedInsights: { acmgCriteria: [] } });
    expect(screen.getByTestId("predictor-vote-call").textContent).toBe("No votes");
    expect(screen.getByTestId("predictor-summary").textContent).toMatch(/^No PP3 or BP4: no voting tool scored this variant\.$/);
  });

  it("does not call popEVE −3.93 deleterious", () => {
    renderTab(gzf1());
    const row = screen.getByTestId("predictor-popeve");
    expect(row.textContent).toMatch(/Above cut-point/);
    expect(row.textContent).not.toMatch(/Deleterious/);
  });

  it("lists AlphaGenome as informational with its caveats", () => {
    renderTab(gzf1());
    const row = screen.getByTestId("predictor-alphagenome");
    expect(within(row).getByText("Informational")).toBeTruthy();
    expect(within(row).getByText("Rank, not probability")).toBeTruthy();
    expect(within(row).getByText("Contains AlphaMissense")).toBeTruthy();
    expect(row.textContent).not.toMatch(/PP3/);
  });

  it("puts every tool in one table, voting tools first", () => {
    renderTab(gzf1());
    const table = screen.getByTestId("predictor-readings");
    const groups = Array.from(table.querySelectorAll("tbody")).map(b => b.getAttribute("data-group"));
    expect(groups).toEqual(["vote", "protein-lm", "genome", "conservation"]);
    expect(table.querySelectorAll("tbody[data-group='vote'] tr[data-votes]").length).toBe(7);
  });

  it("marks conservation as not counted even when it reaches a calibrated band", () => {
    renderTab(gzf1({ conservationData: { ...gzf1().conservationData, phylop: 8.1 } }));
    const row = screen.getByTestId("predictor-phylop");
    expect(row.textContent).toMatch(/PP3/);
    expect(row.textContent).toMatch(/not counted/);
  });
  it("aligns scores on the decimal point and keeps chips for readings that make a call", () => {
    renderTab(gzf1());
    const cadd = screen.getByTestId("predictor-cadd");
    expect(cadd.querySelector(".prd-dec__int")!.textContent).toBe("29");
    expect(cadd.querySelector(".prd-dec__frac")!.textContent).toBe(".5");
    const dann = screen.getByTestId("predictor-dann");
    expect(dann.querySelector(".prd-status .ev-tier")).toBeNull();
    expect(dann.textContent).toMatch(/Informational/);
    // A bare axis carries no "No cut-point" caption; the legend says it once.
    expect(dann.textContent).not.toMatch(/No cut-point/);
    expect(screen.getByLabelText("Legend").textContent).toMatch(/No published cut-point/);
  });
  it("draws the strength ladder in the finding, with the variant in the band each calibrated tool reached", () => {
    renderTab(gzf1());
    const finding = screen.getByTestId("predictor-finding");
    const ladder = within(finding).getByTestId("strength-ladder");
    expect(ladder.getAttribute("aria-label")).toMatch(/REVEL: BP4 Supporting/);
    expect(within(ladder).getByTestId("ladder-revel").getAttribute("data-at")).toMatch(/^(PP3|BP4|none)/);
    // The ladder carries no scores: those live once, in the readings table.
    expect(ladder.textContent).not.toMatch(/0\.767/);
  });

  it("shows a side, not a strength, for the tools that publish only the authors' cut-point", () => {
    renderTab(gzf1());
    const ladder = screen.getByTestId("strength-ladder");
    // popEVE -3.931 is above its -4.617 cut: between, which the old table also refused to call deleterious.
    for (const [key, side] of [["metarnn", "pathogenic"], ["clinpred", "pathogenic"], ["popeve", "between"]]) {
      const row = within(ladder).getByTestId(`ladder-${key}`);
      expect(row.getAttribute("data-side")).toBe(side);
      // One dot, on one of three flat cells; no graded strength cell is drawn.
      expect(row.querySelectorAll(".prd-ladder__side")).toHaveLength(3);
      expect(row.querySelectorAll(".prd-ladder__dot")).toHaveLength(1);
      expect(row.querySelector(".prd-ladder__cell")).toBeNull();
    }
    expect(ladder.textContent).toMatch(/Direction only/);
  });

  it("says a ladder row has no result instead of drawing an empty one", () => {
    renderTab(gzf1({ conservationData: { ...gzf1().conservationData, popeve: null } }));
    const row = screen.getByTestId("ladder-popeve");
    expect(row.getAttribute("data-side")).toBe("none-scored");
    expect(row.querySelector(".prd-ladder__dot")).toBeNull();
    expect(row.textContent).toMatch(/No result|computed/);
  });

  it("writes the cut-points in words under each calibrated ruler", () => {
    renderTab(gzf1());
    expect(screen.getByTestId("predictor-revel").textContent).toMatch(/PP3 ≥ 0\.644 · 0\.773 · 0\.932/);
    expect(screen.getByTestId("predictor-metarnn").textContent).toMatch(/≥ 0\.5/);
  });
  it("tints a direction-only side red or green only for a tool the engine counts, and says why they differ to a screen reader", () => {
    renderTab(gzf1());
    const ladder = screen.getByTestId("strength-ladder");
    expect(ladder.getAttribute("aria-label")).toMatch(/direction only have just their authors' cut-point/);
    const here = ladder.querySelectorAll(".prd-ladder__side[data-here]");
    expect(here.length).toBe(3);
    for (const cell of Array.from(here)) expect(cell.hasAttribute("data-votes")).toBe(true);
  });
});

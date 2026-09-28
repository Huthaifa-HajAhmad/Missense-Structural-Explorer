// @vitest-environment jsdom
/**
 * PredictorsTab.test.tsx — what the Predictors screen is allowed to claim.
 *
 * The screen renders from `src/shared/predictorEvidence.ts`; these assertions hold the surface to
 * that model's contract (the model's own arithmetic is pinned in predictorEvidence.test.ts).
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ settings: { alphagenomeApiKey: "" }, openSettingsTab: vi.fn() }),
}));

import { PredictorsTab } from "../evidence/PredictorsTab";

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
  return render(<PredictorsTab {...({ analysisState: { result, isLoading: false }, ...extra } as any)} />);
}

describe("PredictorsTab", () => {
  it("states the count and the rule, and marks an unconfirmed code as unconfirmed", () => {
    renderTab(gzf1());
    expect(screen.getByText("4–1")).toBeTruthy();
    expect(screen.getByText("Pathogenic calls outnumber benign")).toBeTruthy();
    const chip = screen.getByTestId("predictor-verdict");
    expect(chip.textContent).toBe("PP3");
    expect(chip.getAttribute("aria-label")).toMatch(/unconfirmed/);
  });

  it("shows the engine's recorded code, not the vote's, when the payload has one", () => {
    renderTab(gzf1({ ruleBasedInsights: { acmgCriteria: [{ code: "PP3_Moderate", reason: "earlier engine" }] } }));
    expect(screen.getByTestId("predictor-verdict").textContent).toBe("PP3_Moderate");
  });

  it("says when the calibrated reference points the other way", () => {
    renderTab(gzf1());
    const callout = screen.getByTestId("reference-callout");
    expect(callout.textContent).toMatch(/REVEL/);
    expect(callout.textContent).toMatch(/BP4 band/);
    expect(callout.textContent).toMatch(/other way/);
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
});

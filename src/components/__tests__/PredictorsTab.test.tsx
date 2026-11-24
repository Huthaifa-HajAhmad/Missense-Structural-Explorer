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
      popeve: -3.931, gerp: 5.0, phylop: 4.91, scorecons: null,
      // A result stored before GPN-MSA was retired still carries its score; the tab must ignore it.
      gpnStar: -8.81,
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
  // assertions start on Native score scales; rule and strength tests select their own topic.
  const rendered = render(
    <EvidenceWorkspaceProvider result={result}>
      <PredictorsTab {...({ analysisState: { result, isLoading: false }, ...extra } as any)} />
    </EvidenceWorkspaceProvider>
  );
  fireEvent.click(screen.getByRole("tab", { name: "Native score scales" }));
  return rendered;
}

describe("PredictorsTab", () => {
  it("shows local agreement on Comparison and pins contributors for inspection", async () => {
    renderTab(gzf1());
    fireEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    const row = screen.getByTestId("predictor-local-agreement");
    expect(row.textContent).toContain("never change PP3 / BP4");
    // The summary states what the readings say together; each reading is listed once, in the outside-the-comparison card.
    expect(within(row).queryByRole("button")).toBeNull();
    const groups = screen.getByTestId("predictor-unplotted-groups");
    expect(within(groups).queryByRole("button", { name: /ESM-2|VESM|SaProt/ })).toBeNull();
    expect(within(groups).getByRole("button", { name: /ESM1b/ }).textContent).toContain("No result");
    // Numeric readings split at the decimal point so the column lines up; states keep the muted "absent" treatment.
    const avi = within(groups).getByRole("button", { name: /AlphaGenome/ });
    expect(avi.querySelector(".prd-dec__int")!.textContent).toBe("26");
    expect(avi.querySelector(".prd-dec__frac")!.textContent).toBe(".4");
    // GPN-MSA, DANN, Eigen, MetaRNN and ClinPred were retired: no row for them, even with an old stored score.
    expect(within(groups).queryByRole("button", { name: /GPN|DANN|Eigen|MetaRNN|ClinPred/ })).toBeNull();
    expect(within(groups).getByRole("button", { name: /ESM1b/ }).querySelector("strong[data-state='absent']")).toBeTruthy();
  });

  it("separates missing marked tools from returned scores in Comparison", () => {
    renderTab(gzf1({ conservationData: { ...gzf1().conservationData, gerp: null, popeve: null } }));
    fireEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    const groups = screen.getByTestId("predictor-unplotted-groups");
    for (const name of ["GERP", "popEVE", "ESM1b"]) {
      const button = within(groups).getByRole("button", { name: new RegExp(name) });
      expect(button.textContent).toContain("No result");
      expect(button.textContent).not.toContain("?");
    }
    expect(groups.querySelectorAll("section").length).toBeGreaterThan(1);
  });

  it("names a timed-out provider instead of calling it a completed miss", () => {
    renderTab(gzf1({
      conservationData: {
        ...gzf1().conservationData,
        bayesdel: null,
        popeve: null,
        modelStatus: { base: "timeout", popeve: "timeout" },
      },
    }));
    fireEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    const groups = screen.getByTestId("predictor-unplotted-groups");
    expect(groups.textContent).toContain("Timed out");
    expect(groups.textContent).not.toContain("BayesDel noAF (No result)");
  });

  it("starts the informational table groups collapsed and expands them on request", () => {
    renderTab(gzf1());
    const table = screen.getByTestId("predictor-readings");
    const group = table.querySelector("tbody[data-group='genome']")!;
    expect(group.getAttribute("data-collapsed")).toBe("true");
    expect(table.querySelector("tbody[data-group='primary']")!.hasAttribute("data-collapsed")).toBe(false);
    fireEvent.click(within(group as HTMLElement).getByRole("button", { name: /Show \d+ of \d+ scored/ }));
    expect(group.hasAttribute("data-collapsed")).toBe(false);
  });

  it("explains each informational family in its own card, never counting them", () => {
    renderTab(gzf1());
    const card = screen.getByTestId("predictor-informational");
    for (const g of ["severity", "genome", "conservation"]) {
      const fam = within(card).getByTestId(`predictor-family-${g}`);
      expect(fam.textContent).toMatch(/What it measures/);
      expect(fam.textContent).toMatch(/Why it is not counted/);
      // The scientific explanation is visible by default; it may be collapsed on request, but a
      // print/PDF must not silently lose the sentence that says why the model is not counted.
      const guide = fam.querySelector("details.prd-family-guide")!;
      expect(guide.hasAttribute("open")).toBe(true);
      expect(within(guide as HTMLElement).getByText(/What it measures/)).toBeInTheDocument();
    }
    expect(card.textContent).toMatch(/never change the PP3 \/ BP4 call/);
  });

  it("prints the primary tool's band edges on its ruler", () => {
    renderTab(gzf1());
    fireEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    const ref = screen.getByTestId("predictor-primary-row");
    const edges = Array.from(ref.querySelectorAll(".prd-ruler__cut")).map(n => n.textContent);
    expect(edges).toEqual(expect.arrayContaining(["0.644", "0.29"]));
  });

  it("states the finding once, and marks an unconfirmed code as unconfirmed", () => {
    renderTab(gzf1());
    const summary = screen.getByTestId("predictor-summary");
    expect(summary.querySelector("strong")!.textContent).toBe("The rule gives BP4 from REVEL 0.234.");
    const chip = screen.getByTestId("predictor-verdict");
    expect(chip.textContent).toBe("BP4");
    expect(chip.getAttribute("aria-label")).toMatch(/unconfirmed/);
  });

  it("shows the engine's recorded code, not the rule's, when the payload has one", () => {
    renderTab(gzf1({ ruleBasedInsights: { acmgCriteria: [{ code: "PP3_Moderate", reason: "earlier engine" }] } }));
    expect(screen.getByTestId("predictor-verdict").textContent).toBe("PP3 Moderate");
  });

  it("says when another calibrated tool points the other way, in the summary, not a banner", () => {
    renderTab(gzf1());
    fireEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    const summary = screen.getByTestId("predictor-summary");
    expect(summary.getAttribute("data-tone")).toBe("warning");
    expect(summary.textContent).toMatch(/AlphaMissense 0\.835 \(PP3\) points the other way/);
    expect(screen.queryByTestId("reference-callout")).toBeNull();
    expect(screen.getByTestId("predictor-primary-call").textContent).toBe("BP4");
    expect(screen.getByTestId("predictor-chain-call").textContent).toBe("BP4");
  });

  it("draws the fixed order once, marking the tool that answered and the one that disagrees", () => {
    renderTab(gzf1());
    fireEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    const list = within(screen.getByTestId("predictor-chain-row")).getByRole("list", { name: /Calibrated tools in order/ });
    const roles = Array.from(list.querySelectorAll(".prd-tally__tool")).map(n => n.getAttribute("data-role"));
    expect(roles).toEqual(["active", "after", "disagrees", "after"]);
    // The order row names tools, not scores: those live in the readings table (and the disagreement sentence).
    expect(screen.getByTestId("predictor-chain-row").textContent).not.toMatch(/0\.835|0\.234/);
  });

  it("says the dbNSFP scores did not arrive, not that no tool scored, after a timeout", () => {
    renderTab(gzf1({ conservationData: { ...gzf1().conservationData, revel: null, bayesdel: null, modelStatus: { base: "timeout" } } }));
    fireEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    expect(screen.getByTestId("predictor-primary-row").getAttribute("data-outcome")).toBe("withheld-base");
    expect(screen.getByTestId("predictor-primary-row").textContent).toMatch(/dbNSFP scores did not arrive/);
    expect(screen.getByTestId("predictor-chain-key").textContent).toMatch(/re-run the analysis/);
  });

  it("keeps a row for the primary tool when no calibrated tool scored", () => {
    renderTab(gzf1({ predictorData: {}, conservationData: { ...gzf1().conservationData, revel: null, bayesdel: null } }));
    fireEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    const row = screen.getByTestId("predictor-primary-row");
    expect(row.getAttribute("data-outcome")).toBe("no-score");
    expect(row.textContent).toMatch(/None of the calibrated tools scored this variant/);
    expect(screen.getByTestId("predictor-primary-call").textContent).toBe("No result");
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

  it("shows no code when nothing scored", () => {
    renderTab({ metadata: {}, predictorData: {}, conservationData: {}, ruleBasedInsights: { acmgCriteria: [] } });
    fireEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    expect(screen.getByTestId("predictor-chain-call").textContent).toBe("Neither");
    expect(screen.getByTestId("predictor-summary").textContent).toMatch(/^No PP3 or BP4: none of the calibrated tools scored this variant\.$/);
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

  it("puts every tool in one table, the calibrated tools first in their fixed order", () => {
    renderTab(gzf1());
    const table = screen.getByTestId("predictor-readings");
    const groups = Array.from(table.querySelectorAll("tbody")).map(b => b.getAttribute("data-group"));
    expect(groups).toEqual(["primary", "severity", "genome", "conservation"]);
    const chain = Array.from(table.querySelectorAll("tbody[data-group='primary'] tr[data-chain]")).map(r => r.getAttribute("data-chain"));
    expect(chain).toEqual(["revel", "bayesdel", "alphaMissense", "esm1b"]);
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
    const avi = screen.getByTestId("predictor-alphagenome");
    expect(avi.querySelector(".prd-status .ev-tier")).toBeNull();
    expect(avi.textContent).toMatch(/Informational/);
    // A bare axis carries no "No cut-point" caption; the legend says it once.
    expect(avi.textContent).not.toMatch(/No cut-point/);
    // DANN and Eigen were retired: an old stored score draws no row.
    expect(screen.queryByTestId("predictor-dann")).toBeNull();
    expect(screen.queryByTestId("predictor-eigen")).toBeNull();
    expect(screen.getByLabelText("Legend").textContent).toMatch(/No published cut-point/);
  });
  it("draws the strength ladder in the finding, with the variant in the band each calibrated tool reached", () => {
    renderTab(gzf1());
    fireEvent.click(screen.getByRole("tab", { name: "Strength bands" }));
    const finding = screen.getByTestId("predictor-finding");
    const ladder = within(finding).getByTestId("strength-ladder");
    expect(ladder.getAttribute("aria-label")).toMatch(/REVEL: BP4 Supporting/);
    expect(within(ladder).getByTestId("ladder-revel").getAttribute("data-at")).toMatch(/^(PP3|BP4|none)/);
    // The ladder carries no scores: those live once, in the readings table.
    expect(ladder.textContent).not.toMatch(/0\.835/);
  });

  it("shows a side, not a strength, for the tools that publish only the authors' cut-point", () => {
    renderTab(gzf1());
    fireEvent.click(screen.getByRole("tab", { name: "Strength bands" }));
    const ladder = screen.getByTestId("strength-ladder");
    // popEVE -3.931 is above its -4.617 cut: between, which the old table also refused to call deleterious.
    for (const [key, side] of [["popeve", "between"]]) {
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
    fireEvent.click(screen.getByRole("tab", { name: "Strength bands" }));
    const row = screen.getByTestId("ladder-popeve");
    expect(row.getAttribute("data-side")).toBe("none-scored");
    expect(row.querySelector(".prd-ladder__dot")).toBeNull();
    expect(row.textContent).toMatch(/No result|computed/);
  });

  it("writes the cut-points in words under each calibrated ruler", () => {
    renderTab(gzf1());
    expect(screen.getByTestId("predictor-revel").textContent).toMatch(/PP3 ≥ 0\.644 · 0\.773 · 0\.932/);
    expect(screen.getByTestId("predictor-popeve").textContent).toMatch(/≤ −4\.617/);
  });
  it("never tints a direction-only side as counted, and says why to a screen reader", () => {
    renderTab(gzf1());
    fireEvent.click(screen.getByRole("tab", { name: "Strength bands" }));
    const ladder = screen.getByTestId("strength-ladder");
    expect(ladder.getAttribute("aria-label")).toMatch(/direction only have just their authors' cut-point/);
    const here = ladder.querySelectorAll(".prd-ladder__side[data-here]");
    expect(here.length).toBe(1);
    // popEVE is informational: its side is marked but not tinted.
    expect(within(ladder).getByTestId("ladder-popeve").querySelector(".prd-ladder__side[data-here]")!.hasAttribute("data-chain")).toBe(false);
  });

  it("renders candidate-consensus CADD as a range on the ruler, shown but never setting PP3/BP4", () => {
    const r = gzf1({
      predictorData: {
        amPathogenicity: 0.835,
        amClass: "likely_pathogenic",
        caddPhred: null,
        gnomadVariantId: null,
        gnomadVariantAssembly: null,
        locusResolution: {
          route: "fallback",
          canonicalBy: null,
          retryable: false,
          failureKind: "multiple-candidates",
          steps: [],
          candidates: [
            { grch37Id: null, id: "4-1804392-G-A", canonicalBy: "protvar", retryable: false, caddPhred: 25.7, caddSource: "ProtVar" },
            { grch37Id: null, id: "4-1804392-G-C", canonicalBy: "protvar", retryable: false, caddPhred: 28.5, caddSource: "ProtVar" },
          ],
        },
      },
    });
    renderTab(r);
    const row = screen.getByTestId("predictor-cadd");
    expect(row.textContent).toMatch(/25\.7–28\.5/);
    expect(row.textContent).toMatch(/PP3/);
    expect(row.querySelector(".prd-ruler__range")).not.toBeNull();
    expect(row.querySelectorAll(".prd-ruler__marker")).toHaveLength(2);
    expect(row.getAttribute("data-chain")).toBeNull();
  });

  it("explains candidate disagreement on the CADD row", () => {
    const r = gzf1({
      predictorData: {
        amPathogenicity: 0.835,
        amClass: "likely_pathogenic",
        caddPhred: null,
        gnomadVariantId: null,
        gnomadVariantAssembly: null,
        locusResolution: {
          route: "fallback",
          canonicalBy: null,
          retryable: false,
          failureKind: "multiple-candidates",
          steps: [],
          candidates: [
            { grch37Id: null, id: "4-1804392-G-C", canonicalBy: "protvar", retryable: false, caddPhred: 24.5, caddSource: "ProtVar" },
            { grch37Id: null, id: "4-1804392-G-A", canonicalBy: "protvar", retryable: false, caddPhred: 25.7, caddSource: "ProtVar" },
          ],
        },
      },
    });
    renderTab(r);
    const row = screen.getByTestId("predictor-cadd");
    expect(row.textContent).toMatch(/Candidates disagree/);
    expect(row.textContent).toMatch(/G>C 24\.5 Indeterminate vs G>A 25\.7 PP3 Supporting/);
    expect(row.querySelector(".prd-ruler")).toBeNull();
    expect(row.getAttribute("data-chain")).toBeNull();
  });

  it("displays ClinGen VCEP caps, exclusions, and Walker 2023 splicing PP3 in Comparison", () => {
    const first = renderTab(gzf1({
      metadata: { gene: "PTEN", variant: "p.Arg130Gln", acmgWeighting: "standard" },
      conservationData: { revel: 0.95, spliceai: { max_ds: 0.01 } },
      ruleBasedInsights: { acmgCriteria: [{ code: "PP3", reason: "PTEN VCEP" }] },
    }));
    fireEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    expect(screen.getByTestId("predictor-chain-row").textContent).toContain("GN003 v3.2");
    expect(screen.getByTestId("predictor-primary-call").textContent).toBe("PP3");
    first.unmount();

    const second = renderTab(gzf1({
      metadata: { gene: "PALB2", variant: "p.Leu100Pro", acmgWeighting: "standard" },
      conservationData: { revel: 0.95, spliceai: { max_ds: 0.01 } },
      ruleBasedInsights: { acmgCriteria: [] },
    }));
    fireEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    expect(screen.getByTestId("predictor-primary-call").textContent).toBe("Excluded");
    second.unmount();
  });
});


// @vitest-environment jsdom
/**
 * SplicingTab.test.tsx — what the RNA Splicing screen and its rail are allowed to claim.
 *
 * Both render from `src/shared/splicingEvidence.ts`; the model's own rules are pinned in
 * splicingEvidence.test.ts. These hold the surfaces to its contract on the reference variant
 * (NAE1 p.Asp116Gly) and on a scored one.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ settings: { alphagenomeApiKey: "" }, openSettingsTab: vi.fn() }),
}));
vi.mock("../../stores/useVariantAnalysisStore", () => ({
  useVariantAnalysisStore: (sel: any) => sel({ analysisState: { isLoading: false } }),
}));

import { SplicingTab } from "../evidence/SplicingTab";
import { SplicingRail } from "../inspector/SplicingRail";
import { nae1Reference } from "../../shared/__tests__/fixtures/splicingReference";

const renderTab = (result: any, extra: Record<string, unknown> = {}) =>
  render(<SplicingTab {...({ analysisState: { result, isLoading: false }, onTabChange: vi.fn(), ...extra } as any)} />);

describe("SplicingTab — reference variant (no SpliceAI score)", () => {
  it("says the rule was not applied, and never prints a splicing PP3/BP4", () => {
    const { container } = renderTab(nae1Reference());
    expect(screen.getByTestId("splicing-verdict").textContent).toBe("Rule not applied");
    expect(screen.getByText("No SpliceAI score reached this variant")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Pathogenic Supporting|Benign Supporting/);
  });

  it("no longer asserts a mechanism of pathogenicity", () => {
    const { container } = renderTab(nae1Reference());
    expect(container.textContent).not.toMatch(/Tertiary Structure-Dominant|driven by post-translational|Misfolding \/ Aggregation|Dual-Hit/);
  });

  it("names the coordinate problem instead of calling the absence a result", () => {
    renderTab(nae1Reference());
    expect(screen.getByTestId("reference-mismatch").textContent).toMatch(/reference base does not match/);
    expect(screen.getByTestId("relation-callout").textContent).toMatch(/nothing here checks the splicing side/);
  });

  it("places the variant at +26 from the acceptor, outside dbscSNV's window", () => {
    renderTab(nae1Reference());
    expect(screen.getByRole("img", { name: /position \+26 of the acceptor.*outside it/ })).toBeTruthy();
    expect(screen.getByTestId("splice-dbscsnv-ada").textContent).toMatch(/−12 to \+2 at an acceptor/);
  });

  it("uses no legacy status words", () => {
    const { container } = renderTab(nae1Reference());
    expect(container.textContent).not.toMatch(/\bN\/A\b|Standby|Unannotated|Unmapped|Offline/);
  });
});

describe("SplicingTab — scored variant", () => {
  const scored = (max: number, engineCode: string | null = null) =>
    nae1Reference({
      conservationData: {
        spliceai: { ds_ag: 0.01, ds_al: max, ds_dg: 0, ds_dl: 0, max_ds: max, dp: { ds_ag: 3, ds_al: -12, ds_dg: 0, ds_dl: 1 } },
        alphagenome: { status: "live", aviPhred: 12, message: null, featureAttributions: { Splicing: 0.2, AlphaMissense: 0.8 } },
      },
      ...(engineCode ? { ruleBasedInsights: { acmgCriteria: [{ code: engineCode, reason: "vote" }] } } : {}),
    });

  it("draws the splicing code dashed and says the engine does not apply it", () => {
    renderTab(scored(0.45));
    const chip = screen.getByTestId("splicing-verdict");
    expect(chip.textContent).toBe("PP3 · splicing");
    expect(chip.getAttribute("aria-label")).toMatch(/not applied by the engine/);
  });

  it("warns when splicing supports PP3 and the engine recorded BP4", () => {
    renderTab(scored(0.45, "BP4"));
    expect(screen.getByTestId("relation-callout").textContent).toMatch(/review it\s+before accepting BP4/);
  });

  it("shows AlphaGenome's splicing share, not a signed SHAP ×100", () => {
    renderTab(scored(0.03));
    const row = screen.getByTestId("splice-alphagenome-splicing");
    expect(row.textContent).toMatch(/20%/);
    expect(row.textContent).toMatch(/Informational/);
    expect(row.textContent).not.toMatch(/Primary Driver/);
  });
});

describe("SplicingRail", () => {
  it("traces score → rule → context → engine, and cites Walker 2023 for the bands", () => {
    const { container } = render(<SplicingRail analysisResult={nae1Reference()} />);
    const steps = screen.getByTestId("splicing-rule-trace").querySelectorAll("li");
    expect(steps).toHaveLength(4);
    expect(steps[1].textContent).toMatch(/Not applied — needs a SpliceAI score/);
    expect(steps[3].getAttribute("data-state")).toBe("warn");
    expect(container.textContent).toMatch(/doi:10\.1016\/j\.ajhg\.2023\.06\.002/);
    // The old rail cited Pejaver 2022 (the missense calibration) as the splicing source.
    expect(container.textContent).not.toMatch(/Pejaver/);
  });

  it("marks the band the score sits in", () => {
    const result = nae1Reference({ conservationData: { spliceai: { ds_ag: 0, ds_al: 0.05, ds_dg: 0, ds_dl: 0, max_ds: 0.05 } } });
    render(<SplicingRail analysisResult={result} />);
    const active = screen.getByTestId("splicing-bands").querySelector("[data-active]");
    expect(active?.textContent).toMatch(/BP4 · splicing.*this variant/);
  });
});

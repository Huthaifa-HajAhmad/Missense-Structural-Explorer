// @vitest-environment jsdom
/**
 * SplicingTab.test.tsx — what the RNA Splicing screen and its rail are allowed to claim.
 *
 * Both render from `src/shared/splicingEvidence.ts`; the model's own rules are pinned in
 * splicingEvidence.test.ts. These hold the surfaces to its contract on the reference variant
 * (NAE1 p.Asp116Gly) and on a scored one.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
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
    // Both dbscSNV models are out of window for the same reason: one row, not the reason twice.
    expect(screen.getByTestId("splice-dbscsnv").textContent).toMatch(/−12 to \+2 at an acceptor/);
    expect(screen.queryByTestId("splice-dbscsnv-rf")).toBeNull();
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

describe("SplicingTab — splice map", () => {
  // NAE1 has no exon bounds, but the fixture's exon length (80 bp) and +26 acceptor position are enough.
  const withScores = (ds: Record<string, number>, dp: Record<string, number>) =>
    nae1Reference({
      conservationData: { spliceai: { ds_ag: 0, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: Math.max(...Object.values(ds)), ...ds, dp } },
    });

  it("retains an unpositioned maximum and prevents a focused axis from hiding it", () => {
    renderTab(withScores({ ds_ag: 0.9, ds_dl: 0.05 }, { ds_dl: 40 }));
    expect((screen.getByRole("option", { name: "0–0.3 (focused range)" }) as HTMLOptionElement).disabled).toBe(true);
    expect((screen.getByLabelText("SpliceAI delta axis") as HTMLSelectElement).value).toBe("full");
    expect(screen.getByTestId("map-note").textContent).toMatch(/no delta position/);
    const unplaced = screen.getByTestId("predicted-ds_ag");
    expect(unplaced.textContent).toMatch(/Acceptor gain/);
    expect(unplaced.textContent).toMatch(/Not returned/);
    expect(unplaced.textContent).toMatch(/delta position/);
    expect(screen.getByTestId("splicing-finding").textContent).toContain("0.90");
    expect(screen.queryByTestId("map-ds_ag")).toBeNull();
  });

  it("resets zoom and focus for a new transcript but retains them when re-scoring the same transcript", () => {
    const result = withScores({ ds_dl: 0.05 }, { ds_dl: 40 });
    const { rerender } = renderTab(result);
    fireEvent.change(screen.getByLabelText("Map view"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("SpliceAI delta axis"), { target: { value: "focused" } });
    const update = (next: any) => rerender(<SplicingTab {...({ analysisState: { result: next, isLoading: false } } as any)} />);
    update(withScores({ ds_dl: 0.06 }, { ds_dl: 40 }));
    expect((screen.getByLabelText("Map view") as HTMLSelectElement).value).toBe("50");
    expect((screen.getByLabelText("SpliceAI delta axis") as HTMLSelectElement).value).toBe("focused");
    update({ ...result, maneRefSeqId: "NM_999999.1" });
    expect((screen.getByLabelText("Map view") as HTMLSelectElement).value).toBe("auto");
    expect((screen.getByLabelText("SpliceAI delta axis") as HTMLSelectElement).value).toBe("full");
  });

  it("forces the full axis when a same-transcript re-score exceeds the focused range", () => {
    const { rerender } = renderTab(withScores({ ds_dl: 0.05 }, { ds_dl: 40 }));
    fireEvent.change(screen.getByLabelText("SpliceAI delta axis"), { target: { value: "focused" } });
    rerender(<SplicingTab {...({ analysisState: { result: withScores({ ds_dl: 0.9 }, { ds_dl: 40 }), isLoading: false } } as any)} />);
    expect((screen.getByLabelText("SpliceAI delta axis") as HTMLSelectElement).value).toBe("full");
    expect(screen.getByText("SpliceAI Δ · 0–1")).toBeTruthy();
  });

  it("separates map zoom from scoring and shows off-view positions honestly", () => {
    renderTab(withScores({ ds_dl: 0.62 }, { ds_dl: 400 }));
    fireEvent.change(screen.getByLabelText("Map view"), { target: { value: "50" } });
    const mark = screen.getByTestId("map-ds_dl");
    expect(mark.querySelector("circle")).toBeNull();
    expect(mark.querySelector("path")).toBeTruthy();
    expect(mark.textContent).toMatch(/outside the map view/);
    expect(screen.getByTestId("splicing-finding").textContent).toContain("0.62");
  });

  it("lets readers inspect small non-zero signals without changing the rule", () => {
    renderTab(withScores({ ds_dl: 0.001 }, { ds_dl: 40 }));
    const verdict = screen.getByTestId("splicing-verdict").textContent;
    fireEvent.click(screen.getByRole("checkbox", { name: /Show non-zero signals/ }));
    expect(screen.getByTestId("map-ds_dl").querySelector("title")!.textContent).toContain("0.001");
    expect(screen.getByTestId("splicing-verdict").textContent).toBe(verdict);
    fireEvent.change(screen.getByLabelText("SpliceAI delta axis"), { target: { value: "focused" } });
    expect(screen.getByText("SpliceAI Δ · 0–0.3")).toBeTruthy();
  });

  it("draws a lollipop for a channel that scores, labelled and placed in transcript direction", () => {
    renderTab(withScores({ ds_dl: 0.62 }, { ds_dl: 40 }));
    const lollipop = screen.getByTestId("map-ds_dl");
    expect(lollipop.querySelector("text")!.textContent).toContain("Donor loss 0.62");
    // Reverse-strand gene: genomic +40 is 40 bases UPSTREAM, so the map says −40, and so does the aria label.
    expect(screen.getByRole("img", { name: /donor loss 0\.62 at −40 bases/ })).toBeTruthy();
  });

  it("shows the no-signal row, and says so in words, when no channel scores", () => {
    renderTab(withScores({ ds_dl: 0.001 }, { ds_dl: 40 }));
    expect(screen.queryByTestId("map-ds_dl")).toBeNull();
    expect(screen.getByTestId("map-no-signal-row")).toBeTruthy();
    const note = screen.getByTestId("map-note").textContent!;
    expect(note).toMatch(/No SpliceAI channel reaches 0\.01/);
    expect(note).toMatch(/drawn in the no-signal row/);
  });

  it("draws sub-floor channels in a no-signal row instead of leaving them out", () => {
    renderTab(withScores({ ds_dl: 0.62 }, { ds_dl: 40, ds_ag: -30 }));
    const row = screen.getByTestId("map-no-signal-row");
    expect(row).toBeTruthy();
    // Three exact zeros: acceptor gain, acceptor loss, donor gain.
    expect(screen.getByTestId("map-quiet-ds_ag").textContent).toContain("Acceptor gain 0.00");
    expect(screen.getByTestId("map-quiet-ds_al")).toBeTruthy();
    expect(screen.getByTestId("map-quiet-ds_dg").textContent).toContain("Donor gain 0.00");
    // Still not placed as lollipops.
    expect(screen.queryByTestId("map-ds_ag")).toBeNull();
    // The note says they are drawn in the row, and never "not drawn".
    const note = screen.getByTestId("map-note").textContent!;
    expect(note).toMatch(/3 scored channels are drawn in the no-signal row/);
    expect(note).not.toMatch(/not drawn/);
    // The map's accessible description says so too, so it is not silent to a screen reader.
    expect(screen.getByRole("img", { name: /drawn in the no-signal row below the axis/ })).toBeTruthy();
    // The always-visible section carries their exact scores; the old collapsed <details> is gone.
    const section = screen.getByTestId("predicted-sites");
    expect(section.textContent).toContain("Predicted splice sites");
    expect(section.closest("details")).toBeNull();
    const quietGain = screen.getByTestId("predicted-ds_ag");
    expect(quietGain.textContent).toMatch(/Acceptor gain/);
    expect(quietGain.textContent).toMatch(/No predicted site/);
    expect(quietGain.querySelector(".spl-key")!.getAttribute("data-kind")).toBe("no-signal");
  });

  it("moves non-zero sub-floor channels to lollipops when asked, but never an exactly-zero one", () => {
    renderTab(withScores({ ds_al: 0.004 }, { ds_ag: -30, ds_al: 12 }));
    expect(screen.getByTestId("map-quiet-ds_al").textContent).toContain("Acceptor loss < 0.01");
    fireEvent.click(screen.getByRole("checkbox", { name: /Show non-zero signals/ }));
    // The non-zero channel moves onto the axis…
    expect(screen.getByTestId("map-ds_al")).toBeTruthy();
    expect(screen.queryByTestId("map-quiet-ds_al")).toBeNull();
    // …while the three exact zeros stay in the no-signal row.
    expect(screen.getByTestId("map-quiet-ds_ag")).toBeTruthy();
    expect(screen.getByTestId("map-quiet-ds_dg")).toBeTruthy();
    expect(screen.getByTestId("map-quiet-ds_dl")).toBeTruthy();
  });

  it("does not claim a channel was below the floor when SpliceAI returned nothing at all", () => {
    renderTab(nae1Reference());
    expect(screen.getByTestId("map-note").textContent).toMatch(/returned no score/);
    expect(screen.getByTestId("map-note").textContent).not.toMatch(/reaches 0\.01/);
    expect(screen.queryByTestId("map-no-signal-row")).toBeNull();
  });

  it("states the four channels' shared caveat and scale once, not once per channel", () => {
    const { container } = renderTab(withScores({ ds_ag: 0.4, ds_al: 0.2, ds_dg: 0.1, ds_dl: 0.05 }, { ds_dg: 5 }));
    // The caveat the four cards used to repeat now stands once for the group.
    expect(container.textContent!.match(/not an observed effect/g)).toHaveLength(1);
    expect(screen.getByText(/Gain predicts a splice site created or strengthened/)).toBeTruthy();
    // One shared 0–1 axis for the group, none under the individual dot plots.
    expect(container.querySelectorAll(".spl-channels__axis")).toHaveLength(1);
    expect(container.querySelectorAll(".spl-channel-plot__axis")).toHaveLength(0);
    // Each dot plot keeps its own accessible scale label.
    expect(screen.getAllByRole("img", { name: /on a shared 0 to 1 scale/ })).toHaveLength(4);
  });

  it("labels the distance figure and sets the coverage status and caveat apart", () => {
    renderTab(nae1Reference());
    expect(screen.getByText("Distance to nearest splice junction")).toBeTruthy();
    expect(screen.getByText(/\+26 from the acceptor/)).toBeTruthy();
    expect(screen.getByText("the 26th base of exon 6 from its acceptor boundary.")).toBeTruthy();
    expect(screen.getByText(/Outside dbscSNV's window and the canonical dinucleotide\./)).toBeTruthy();
    expect(screen.getByText(/Distance from a junction is context/)).toBeTruthy();
  });

  it("names why SpliceAI has no score, in the table and with a state label that is not 'No result'", () => {
    renderTab(nae1Reference({ conservationData: { spliceaiFailure: { kind: "coordinate-rejected", httpStatus: 400, detail: "REF does not match" } } }));
    const row = screen.getByTestId("splice-spliceai");
    expect(row.textContent).toMatch(/refused this variant \(HTTP 400\)/);
    expect(row.textContent).toMatch(/Coordinate rejected/);
  });

  it("keeps dbscSNV and AlphaGenome out of the hero, where the table already holds them", () => {
    renderTab(nae1Reference({
      conservationData: { spliceai: { ds_ag: 0, ds_al: 0, ds_dg: 0, ds_dl: 0.62, max_ds: 0.62, dp: { ds_dl: 40 }, provenance: { source: "broad-lookup", distanceBp: 500, masked: 1, computedLive: true } } },
    }));
    const hero = screen.getByTestId("splicing-finding");
    expect(hero.textContent).not.toMatch(/dbscSNV/);
    expect(hero.textContent).not.toMatch(/AlphaGenome splicing/);
    expect(hero.textContent).toMatch(/Broad Lookup/);
  });
});

describe("SplicingTab — predicted splice sites (always visible)", () => {
  const MINUS = "\u2212";
  const withScores = (ds: Record<string, number>, dp: Record<string, number>) =>
    nae1Reference({
      conservationData: { spliceai: { ds_ag: 0, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: Math.max(...Object.values(ds)), ...ds, dp } },
    });

  it("renders the conclusion as a visible semantic table, not a collapsed details", () => {
    renderTab(withScores({ ds_dg: 0.14 }, { ds_dg: 2 }));
    const section = screen.getByTestId("predicted-sites");
    expect(section.closest("details")).toBeNull();
    expect(section.querySelector("table")).toBeTruthy();
    expect([...section.querySelectorAll("thead th")].map(h => h.textContent)).toEqual(["Channel", "Δ", "Position", "Status"]);
    expect(section.querySelectorAll('th[scope="col"]')).toHaveLength(4);
    expect(section.querySelector('tbody th')!.getAttribute("scope")).toBe("row");
  });

  it("puts the conclusion in one sentence for a single placed prediction", () => {
    renderTab(withScores({ ds_dg: 0.14 }, { ds_dg: 2 }));
    expect(screen.getByTestId("predicted-sites-summary").textContent).toBe(
      `SpliceAI places 1 predicted site: donor gain at ${MINUS}2 bp (Δ 0.14), which does not coincide with the annotated donor.`
    );
    const row = screen.getByTestId("predicted-ds_dg");
    expect(row.textContent).toMatch(/Donor gain/);
    expect(row.textContent).toContain("0.14");
    expect(row.textContent).toContain(`${MINUS}2 bp`);
    expect(row.textContent).toMatch(/No matching annotated site in the supplied geometry/);
    expect(row.querySelector(".spl-key")!.getAttribute("data-kind")).toBe("gain");
  });

  it("says no site is placed when all four channels are below the floor", () => {
    renderTab(withScores({ ds_dl: 0.001 }, { ds_dl: 40 }));
    expect(screen.getByTestId("predicted-sites-summary").textContent).toBe(
      "SpliceAI places no predicted site; all four channels score below 0.01."
    );
    // Exact Δ, not the "< 0.01" the figure prints.
    const quietRow = screen.getByTestId("predicted-ds_dl");
    expect(quietRow.textContent).toContain("0.001");
    expect(quietRow.textContent).not.toContain("< 0.01");
  });

  it("orders placed predictions by descending Δ, then missing positions, then quiet channels", () => {
    renderTab(withScores({ ds_ag: 0.2, ds_al: 0.5, ds_dg: 0.4, ds_dl: 0.05 }, { ds_ag: 25, ds_al: 100, ds_dg: -54, ds_dl: 40 }));
    const rows = [...screen.getByTestId("predicted-sites").querySelectorAll("tbody tr")];
    expect(rows.map(r => r.getAttribute("data-testid"))).toEqual([
      "predicted-ds_al",
      "predicted-ds_dg",
      "predicted-ds_ag",
      "predicted-ds_dl",
    ]);
    expect(screen.getByTestId("predicted-ds_dg").textContent).toMatch(/Coincides with annotated donor \(within 1 bp\)/);
    expect(screen.getByTestId("predicted-ds_ag").textContent).toMatch(/Coincides with annotated acceptor \(within 1 bp\)/);
    const summary = screen.getByTestId("predicted-sites-summary").textContent!;
    expect(summary).toContain("SpliceAI places 4 predicted sites");
    expect(summary).toContain("2 of 4 coincide with an annotated site");
  });

  it("lists missing-position channels before quiet ones, each with its own status", () => {
    renderTab(withScores({ ds_ag: 0.9, ds_dl: 0.05 }, { ds_dl: 40 }));
    const rows = [...screen.getByTestId("predicted-sites").querySelectorAll("tbody tr")];
    expect(rows.map(r => r.getAttribute("data-testid"))).toEqual([
      "predicted-ds_dl",
      "predicted-ds_ag",
      "predicted-ds_al",
      "predicted-ds_dg",
    ]);
    const missing = screen.getByTestId("predicted-ds_ag");
    expect(missing.textContent).toMatch(/Not returned/);
    expect(missing.textContent).toMatch(/contributes to the maximum/);
    const quiet = screen.getByTestId("predicted-ds_al");
    expect(quiet.textContent).toMatch(/No predicted site — Δ too small/);
    // The quiet Δ is the exact value, and its marker matches the map's no-signal key.
    expect(quiet.querySelector(".spl-preds__delta")!.textContent).toBe("0");
    expect(quiet.querySelector(".spl-key")!.getAttribute("data-kind")).toBe("no-signal");
  });

  it("marks a prediction outside the current map view when the reader zooms past it", () => {
    renderTab(withScores({ ds_dl: 0.62 }, { ds_dl: 400 }));
    expect(screen.getByTestId("predicted-ds_dl").textContent).toMatch(/No matching annotated site/);
    fireEvent.change(screen.getByLabelText("Map view"), { target: { value: "50" } });
    expect(screen.getByTestId("predicted-ds_dl").textContent).toMatch(/Outside the map view/);
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

// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EnergeticsView from "../EnergeticsView";
import { deriveConsensus } from "../ClinicalInsightsCard";
import { SettingsProvider } from "../../context/SettingsContext";

/**
 * First component coverage for the Energetics tab.
 *
 * These tests pin the *behaviour the audit found broken*, at the level a user actually sees,
 * using the real MACO1 p.Glu433Lys run that exposed it. They deliberately assert on rendered
 * text rather than internal state, because every defect they guard against was a rendered
 * claim that contradicted another rendered claim on the same screen.
 */

const CLASS_PROPS = {
  isDark: false,
  classCard: "",
  classCardHeader: "",
  classCardTitle: "",
  classBorderSec: "",
  classTextBody: "",
  classTextMute: "",
};

/** The observed run: only DynaMut2 returned a value; FoldX timed out with a failed repair. */
const MACO1_ENERGETICS = {
  foldx: null,
  foldxMean: null,
  foldxSd: null,
  foldxRepairFailed: true,
  vdw: null,
  electrostatics: null,
  localSidechainRmsd: null,
  stericClashWarning: false,
  dynamut2: -0.09,
  ddmut: null,
  rasp: null,
  raspReason: "Residue position is not present in the pre-computed database",
  thermompnn: null,
  stabilityoracle: null,
};

function analysisState() {
  return {
    result: {
      metadata: { gene: "MACO1", variant: "p.Glu433Lys", residueIndex: 433 },
      // Widened deliberately: an empty-array literal infers `never[]`, which would make the features
      // fixture below unassignable — and an empty array is exactly the case that cannot distinguish the
      // export's `uniprotFeatures?.features` from a mishandled wrapper object.
      uniprotFeatures: { features: [] as Array<Record<string, unknown>> },
      conservationData: {},
    },
  };
}

function renderView(overrides: Record<string, unknown> = {}) {
  const props = {
    ...CLASS_PROPS,
    analysisState: analysisState(),
    foldingDdG: null,
    foldingStatus: "failed",
    foldingEnergetics: MACO1_ENERGETICS,
    dynamut2Status: "done",
    ddmutStatus: "unavailable",
    // Post-settle state: ThermoMPNN reported pending with no job id, so it is terminal, not live.
    thermompnnStatus: "unavailable",
    thermompnnError: null,
    disruptionPredictor: { plddt: 92 },
    isFolding: false,
    foldingError: "Simulation timed out after 5 minutes.",
    ...overrides,
  };
  return render(
    <SettingsProvider>
      <EnergeticsView {...(props as any)} />
    </SettingsProvider>
  );
}

describe("EnergeticsView — the observed single-engine run", () => {
  it("renders without crashing", () => {
    const { container } = renderView();
    expect(container.textContent ?? "").not.toBe("");
  });

  it("states coverage next to the verdict instead of burying it", () => {
    const { container } = renderView();
    const text = container.textContent ?? "";
    // The engine count is part of the headline, not a 9px footnote.
    expect(text).toContain("1 of 6 engines");
    // ...and it is said in words as well as in the count.
    expect(text).toContain("Single-engine estimate");
  });

  it("marks the single-engine verdict as provisional rather than a confident all-clear", () => {
    renderView();
    // Assert the STYLE, not the words. The previous version asserted the string
    // "Single-Tool Estimate", which the verdict itself contains — so deleting the provisional
    // styling entirely still passed. The dashed border is the thing that distinguishes a
    // 1-of-6 estimate from a 6-of-6 one.
    const badge = screen.getByText(/Single-Tool Estimate/);
    expect(badge.className).toContain("border-dashed");
  });

  it("never prints one value with two opposite signs", () => {
    const { container } = renderView();
    const text = container.textContent ?? "";
    // DynaMut2 reported −0.09 natively; the canonical form is +0.09 and MUST be the only form
    // shown. The table used to negate it while the breakdown printed the raw sign.
    expect(text).not.toContain("-0.09");
    const occurrences = (text.match(/0\.09 kcal\/mol/g) ?? []).length;
    expect(occurrences, "the value should appear in both the table and the breakdown").toBeGreaterThanOrEqual(2);
  });

  it("renders no legacy status vocabulary", () => {
    const { container } = renderView();
    const text = container.textContent ?? "";
    const legacy = [
      "Standby",
      "Not in Zenodo DB",
      "Upstream Congested",
      "In Progress",
      "Initializing",
      "Coverage Limited",
      "Unavailable (No Heuristics)",
      "N/A",
    ];
    for (const label of legacy) {
      expect(text, `legacy label "${label}" must not be rendered`).not.toContain(label);
    }
  });

  it("explains each degraded engine in plain language inside its row", () => {
    const { container } = renderView();
    const text = container.textContent ?? "";
    // DDMut's honest reason, not a fabricated claim about a congested queue.
    expect(text).toContain("did not answer in time");
    // RaSP's absence. The copy deliberately does not name the protein, because the server returns
    // the same sentence for a protein outside the covered set and a position within a covered one.
    expect(text).toContain("No precomputed RaSP score is available for this variant");
    expect(text).not.toContain("exists for this protein");
  });

  it("says why a value is shown but not counted", () => {
    // FoldX retains its number after a failed repair while the consensus excludes it. That
    // exclusion used to be invisible: a danger-toned "Destabilizing" badge, absent from the
    // breakdown, and nothing saying why.
    const { container } = renderView({
      foldingEnergetics: { ...MACO1_ENERGETICS, foldx: 3.0, foldxMean: 3.0 },
      dynamut2Status: "done",
    });
    expect(container.textContent ?? "").toContain("Not counted");
  });

  it("does not surface a raw server error as body copy", () => {
    const { container } = renderView();
    // The timeout text is available only as a tooltip/detail, never as the primary reason.
    expect(container.textContent ?? "").not.toContain("Simulation timed out after 5 minutes.");
  });

  it("does not freeze a stalled engine as running", () => {
    const { container } = renderView();
    const text = container.textContent ?? "";
    // A stalled engine that settled without a value is "No result", not a spinner. The fixture's
    // thermompnnStatus is "unavailable", which is what `settleUnreachableRemoteEngines` writes for a
    // pending engine that has no job id to poll.
    expect(text).toContain("No result");
    expect(text).not.toContain("Calculating:");
  });

  it("does show a live remote engine as running, because a pending status implies a poller", () => {
    // The converse of the case above, and the regression the review found: `isFolding` clears when
    // the FoldX leg ends, while `useJobPoller` keeps polling for up to ten minutes. Deriving
    // activity from `isFolding` alone rendered a running engine as "the run ended".
    const { container } = renderView({ thermompnnStatus: "pending", isFolding: false });
    const text = container.textContent ?? "";
    expect(text).toContain("Running");
    expect(text).toContain("Calculating: ThermoMPNN");
  });
});

describe("EnergeticsView — a fully populated run", () => {
  const FULL = {
    foldx: 2.0,
    foldxMean: 2.0,
    foldxSd: 0.3,
    foldxRepairFailed: false,
    dynamut2: -1.5,
    ddmut: -1.2,
    rasp: 1.4,
    thermompnn: 1.1,
    stabilityoracle: 1.3,
  };

  it("reports full coverage and does not call the verdict single-tool", () => {
    const { container } = renderView({
      foldingEnergetics: FULL,
      foldingStatus: "success",
      foldingError: null,
      dynamut2Status: "done",
      ddmutStatus: "done",
      thermompnnStatus: "done",
    });
    const text = container.textContent ?? "";
    expect(text).toContain("6 of 6 engines");
    expect(text).toContain("All 6 engines returned a value.");
    expect(text).not.toContain("Single-engine estimate");
    expect(text).not.toContain("Single-Tool Estimate");
  });

  it("applies each engine's own cut-points rather than FoldX's", () => {
    const { container } = renderView({
      foldingEnergetics: FULL,
      foldingStatus: "success",
      foldingError: null,
      dynamut2Status: "done",
      ddmutStatus: "done",
      thermompnnStatus: "done",
    });
    // Scoped to RaSP's own row. The previous version asserted the page text contained
    // "Destabilizing", which the verdict ("High Misfolding Risk (Destabilizing Consensus)") also
    // contains — so blanking the entire Risk column still passed.
    const raspRow = screen.getByRole("row", { name: /RaSP/ });
    // RaSP at +1.4 clears its own cut of 1.0 → high. Under FoldX's 1.5 it would be "Moderately
    // destabilizing".
    expect(within(raspRow).getByText("Destabilizing")).toBeInTheDocument();
    expect(within(raspRow).queryByText("Moderately destabilizing")).toBeNull();
    // And the page still should not claim a moderate band anywhere.
    expect(container.textContent ?? "").not.toContain("Moderately destabilizing");
  });

  it("shows an ensemble mean with its spread and states the unit once", () => {
    const { container } = renderView({
      foldingEnergetics: FULL,
      foldingStatus: "success",
      foldingError: null,
      dynamut2Status: "done",
      ddmutStatus: "done",
      thermompnnStatus: "done",
    });
    expect(container.textContent ?? "").toContain("2.00 ± 0.30 kcal/mol");
  });

  it("does not claim a spread that was never measured", () => {
    const { container } = renderView({
      foldingEnergetics: { ...FULL, foldxSd: null },
      foldingStatus: "success",
      foldingError: null,
      dynamut2Status: "done",
      ddmutStatus: "done",
      thermompnnStatus: "done",
    });
    const text = container.textContent ?? "";
    expect(text).toContain("2.00 kcal/mol");
    expect(text).not.toContain("± 0.00");
  });

  it("puts the Type and Risk headers over their own columns", () => {
    // 36aecc4 changed the body cells to w-[30%]/w-[20%] while the header still declared
    // w-[35%]/w-[15%], so the labels no longer sat over their columns. That commit touched no test
    // file, so any width mutation passed the whole suite.
    renderView();
    expect(screen.getByRole("columnheader", { name: "Type" }).className).toContain("w-[30%]");
    expect(screen.getByRole("columnheader", { name: "Risk" }).className).toContain("w-[20%]");

    /**
     * F8: the invariant is TWO-SIDED and only the header half was pinned. The body cells carry the same
     * widths (EnergeticsView.tsx:579, :581), so a body-only drift back to w-[35%]/w-[15%] would recreate
     * the misalignment this test is named for with the suite green.
     */
    const widthOf = (el: Element) => (el.className.match(/w-\[\d+%\]/) ?? [""])[0];
    const headerWidths = screen.getAllByRole("columnheader").map(widthOf).filter(Boolean);
    // The first BODY ROW, not the first N cells of the whole table: cells come back in document order
    // across every row, so slicing by the header count picked the wrong columns and the assertion failed
    // for a reason that had nothing to do with widths.
    const firstBodyRow = screen.getAllByRole("row")[1];
    const firstRowWidths = within(firstBodyRow).getAllByRole("cell").map(widthOf).filter(Boolean);

    expect(headerWidths.length, "the header must declare widths").toBeGreaterThan(0);
    expect(
      firstRowWidths,
      "body cells must declare the same column widths as their headers"
    ).toEqual(headerWidths);
  });

  it("does not say no engine returned a value when one is displayed but not counted", () => {
    /**
     * This copy took TWO attempts and had no test, so a mutation check was the only thing that could
     * reveal it. The first version branched on `hasValidConsensus` and the second on
     * `computed === 0` — and BOTH are true for the excluded-FoldX case, because `computed` counts
     * CONTRIBUTIONS. So each printed "no engine has returned a value yet" directly beneath a row
     * displaying 3.00 kcal/mol with a "Not counted" badge.
     *
     * The test has to be value-based: an engine with no value is either still running or missing, so
     * "no value at all" is `missing + running === intended`.
     */
    renderView({
      // foldx is EXCLUDED and every other engine is absent, so no engine counts and the consensus is
      // null — which is the only state in which the copy branch renders at all. (A first attempt
      // spread MACO1's values in, leaving a countable DynaMut2, so the verdict block rendered instead
      // and the test could not find the copy.)
      foldingEnergetics: {
        ...MACO1_ENERGETICS,
        foldx: 3.0,
        foldxMean: 3.0,
        dynamut2: null,
      },
      foldingStatus: "success",
      dynamut2Status: "done",
    });

    expect(screen.getByText(/No returned value could be counted/)).toBeInTheDocument();
    expect(screen.queryByText(/No engine has returned a value yet/)).toBeNull();
    // ...and the row it would have contradicted is on screen.
    expect(screen.getAllByText("Not counted").length).toBeGreaterThan(0);
  });

  it("does say no engine returned a value when none did", () => {
    // The converse, so the branch cannot be hard-coded to the new string.
    renderView({ foldingEnergetics: {}, foldingStatus: "success" });

    expect(screen.getByText(/No engine has returned a value yet/)).toBeInTheDocument();
    expect(screen.queryByText(/No returned value could be counted/)).toBeNull();
  });

  it("shows the same verdict the export derives, from the SAME inputs", () => {
    /**
     * F10. The equivalence test in `clinicalExportVerdict.test.ts` compares `deriveConsensus` against a
     * HAND TRANSCRIPTION of this component's construction — so the two sides can drift apart and the
     * test still passes, because the transcription agrees with itself. This asserts the screen and the
     * export against each other, from one set of props, so drift on EITHER side fails it.
     *
     * The features array is deliberately NON-EMPTY. With `features: []`, which is what the other
     * fixtures use, the export's `result.uniprotFeatures?.features` and any mishandling of the wrapper
     * object both yield "no context" — so the one input where the two constructions could disagree
     * produces identical output either way, and a test built on it cannot tell.
     */
    const engines = {
      ...MACO1_ENERGETICS,
      foldx: 2.0,
      foldxMean: 2.0,
      foldxRepairFailed: false,
      dynamut2: -1.0,
      ddmut: -1.0,
      rasp: 1.5,
      thermompnn: 1.1,
      stabilityoracle: 1.3,
    };
    const state = analysisState();
    state.result.uniprotFeatures = {
      features: [{ type: "DOMAIN", description: "Example", begin: 400, end: 460 }],
    };

    const derived = deriveConsensus({
      result: state.result as any,
      foldingEnergetics: engines,
      foldingDdG: null,
      plddt: undefined,
    });
    expect(derived?.consensusVerdict, "the export must derive a verdict").toBeTruthy();

    renderView({
      // The fixture carries a features array the real `AnalysisResult` type spells more narrowly.
      analysisState: state as any,
      foldingEnergetics: engines,
      foldingStatus: "success",
      dynamut2Status: "done",
      ddmutStatus: "done",
      thermompnnStatus: "done",
    });

    expect(
      screen.getByText(derived!.consensusVerdict),
      "the screen and the export computed different verdicts from the same inputs"
    ).toBeInTheDocument();
  });
});

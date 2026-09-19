// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EnergeticsView from "../EnergeticsView";
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
      uniprotFeatures: { features: [] },
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
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EnergeticsInspector from "./EnergeticsInspector";
import { SettingsProvider } from "../../context/SettingsContext";

/**
 * The inspector's first tests — 368 changed lines that had none.
 *
 * Plan item 7, plus the cross-surface half of UI-F1. Two things are pinned here, both of which a
 * review found unasserted:
 *
 *   1. the contrast fix. The diagnostics card header had used `text-cs-text-warning` (#D97706) on
 *      `bg-cs-surface-2` (#FAF9F6) — 3.03:1 for 10.5px bold text, against a 4.5:1 minimum — and the
 *      commit that repaired it touched no test file at all, so any className mutation passed the
 *      whole suite. The warning ICON keeps its semantic colour deliberately; the TEXT does not.
 *   2. the exclusion reaching this surface. The inspector rendered an excluded FoldX value as
 *      "Computed" with a green dot while the main column called the same number "Not counted" — one
 *      panel certifying what the other discarded. The badge, the muted dot and the reason are all
 *      asserted here.
 */

function renderInspector(overrides: Record<string, unknown> = {}) {
  const props = {
    analysisResult: {
      metadata: { gene: "MACO1", variant: "p.Glu433Lys", residueIndex: 433 },
      uniprotFeatures: { features: [] },
      conservationData: {},
    },
    foldingEnergetics: null,
    foldingStatus: null,
    foldingError: null,
    dynamut2Status: null,
    ddmutStatus: null,
    thermompnnStatus: null,
    thermompnnError: null,
    disruptionPredictor: null,
    isFolding: false,
    ...overrides,
  };

  return render(
    <SettingsProvider>
      <EnergeticsInspector {...(props as any)} />
    </SettingsProvider>
  );
}

describe("EnergeticsInspector — the diagnostics it renders", () => {
  it("renders the low-confidence card even when no engine is missing", () => {
    /**
     * The card used to sit INSIDE the `diagnostics.length > 0` gate, so on a run where every engine
     * returned a value — the good case — a low-pLDDT template produced an empty array and the warning
     * vanished: the more complete the run, the less the panel said about its own reliability.
     *
     * ALL SIX engines must carry a value for this test to be about that. A first version left
     * ThermoMPNN and StabilityOracle absent, so `diagnostics` held two entries and the card rendered
     * under the fixed gate AND the reverted one — the named defect could not fail it.
     */
    renderInspector({
      disruptionPredictor: { plddt: 40 },
      foldingEnergetics: {
        foldx: 2.0,
        foldxMean: 2.0,
        dynamut2: -1.0,
        ddmut: -1.0,
        rasp: 1.5,
        thermompnn: 1.1,
        stabilityoracle: 1.3,
      },
      foldingStatus: "success",
      dynamut2Status: "done",
      ddmutStatus: "done",
      thermompnnStatus: "done",
    });

    expect(screen.getByText(/Low-confidence template/)).toBeInTheDocument();
    // This is the assertion that makes the test about the GATE: with no engine missing, only
    // `|| isLowConfidence` can be keeping the section on screen.
    expect(screen.queryByText(/What Is Missing, And Why/)).toBeInTheDocument();
    expect(screen.queryByText(/— No result/)).toBeNull();
  });

  it("gives that card's text a readable colour, not the warning tone", () => {
    renderInspector({ disruptionPredictor: { plddt: 40 }, foldingStatus: "success" });

    const heading = screen.getByText(/Low-confidence template/).closest("div");
    expect(heading).not.toBeNull();
    // The measured regression was text-cs-text-warning on the soft surface = 3.03:1.
    expect(heading!.className).not.toContain("text-cs-text-warning");
    expect(heading!.className).toContain("text-cs-text-primary");
  });

  it("calls an excluded value Not counted, matching the main column", () => {
    renderInspector({
      foldingEnergetics: { foldx: 3.0, foldxMean: 3.0, foldxRepairFailed: true },
      foldingStatus: "success",
    });

    // The telemetry row must not say "Computed" for a value the view is discarding.
    expect(screen.queryByText("Computed")).toBeNull();
    expect(screen.getAllByText("Not counted").length).toBeGreaterThan(0);
    // ...and the reason must be rendered, not merely carried on the outcome.
    expect(screen.getByText(/excluded from the consensus/)).toBeInTheDocument();
  });

  it("does not call a counted value Not counted", () => {
    // The negative, so the badge cannot be applied unconditionally.
    renderInspector({
      foldingEnergetics: { foldx: 3.0, foldxMean: 3.0, dynamut2: -1.0, ddmut: -1.5 },
      foldingStatus: "success",
      dynamut2Status: "done",
      ddmutStatus: "done",
    });

    expect(screen.queryByText("Not counted")).toBeNull();
  });
});

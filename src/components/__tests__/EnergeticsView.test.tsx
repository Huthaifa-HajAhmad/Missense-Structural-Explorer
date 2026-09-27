// @vitest-environment jsdom
import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EnergeticsView from "../EnergeticsView";
import { deriveConsensus } from "../ClinicalInsightsCard";
import { SettingsProvider } from "../../context/SettingsContext";
import { INSPECTOR_FOCUS_EVENT, INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";

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
    const { container } = renderView();    const text = container.textContent ?? "";
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

describe("EnergeticsView — UI polish & interactive affordances", () => {
  it("renders docked polarity chips in the table card footer and avoids orphan footnote", () => {
    const { container } = renderView();
    expect(screen.getByText("+ΔΔG Destabilizing")).toBeInTheDocument();
    expect(screen.getByText("−ΔΔG Stabilizing")).toBeInTheDocument();
    expect(screen.getByText(/Normalized convention · Engine-specific calibrated cut-points/)).toBeInTheDocument();
    expect(container.querySelector("p.font-mono.text-cs-text-muted")).toBeNull();
  });

  it("renders inline structure provenance badge inside consensus header row", () => {
    renderView({
      foldingEnergetics: {
        ...MACO1_ENERGETICS,
        structureProvenance: {
          source: "alphafold",
          uniprotId: "Q9H257",
        } as any,
      },
    });
    expect(screen.getByText("AlphaFold prediction")).toBeInTheDocument();
  });

  it("dispatches inspector focus request when 'Inspect Live Telemetry' is clicked", () => {
    let dispatchedDetail: any = null;
    const listener = (e: Event) => {
      dispatchedDetail = (e as CustomEvent).detail;
    };
    window.addEventListener(INSPECTOR_FOCUS_EVENT, listener);
    try {
      renderView();
      const inspectBtn = screen.getByRole("button", { name: /Inspect Live Telemetry/i });
      fireEvent.click(inspectBtn);
      expect(dispatchedDetail).toEqual({ sectionId: INSPECTOR_SECTIONS.stabilityTelemetry });
    } finally {
      window.removeEventListener(INSPECTOR_FOCUS_EVENT, listener);
    }
  });

  it("renders experimental structure provenance with PDB link and resolution", () => {
    renderView({
      foldingEnergetics: {
        ...MACO1_ENERGETICS,
        structureProvenance: {
          source: "experimental",
          pdbId: "1abc",
          chainId: "A",
          resolution: 1.8,
        } as any,
      },
    });
    expect(screen.getByText("Experimental structure")).toBeInTheDocument();
    const pdbLink = screen.getByTitle("Open 1ABC in RCSB PDB");
    expect(pdbLink).toHaveAttribute("href", "https://www.rcsb.org/structure/1ABC");
    expect(screen.getByText("1.8 Å")).toBeInTheDocument();
  });

  it("renders structural homolog provenance with sequence identity", () => {
    renderView({
      foldingEnergetics: {
        ...MACO1_ENERGETICS,
        structureProvenance: {
          source: "homolog",
          identity: 85,
        } as any,
      },
    });
    expect(screen.getByText("Structural homolog")).toBeInTheDocument();
    expect(screen.getByText(/\(85% id\)/)).toBeInTheDocument();
  });

  it("suppresses provenance badge while folding simulation is in flight", () => {
    renderView({
      isFolding: true,
      foldingEnergetics: {
        ...MACO1_ENERGETICS,
        structureProvenance: {
          source: "alphafold",
          uniprotId: "Q9H257",
        } as any,
      },
    });
    expect(screen.queryByText("AlphaFold prediction")).toBeNull();
  });

  it("renders contextualized repair failure explanation for experimental template 6N7E (3.5 Å)", () => {
    renderView({
      foldingEnergetics: {
        ...MACO1_ENERGETICS,
        foldx: -2.12,
        foldxMean: -2.12,
        foldxRepairFailed: true,
        structureProvenance: {
          source: "experimental",
          pdbId: "6N7E",
          chainId: "A",
          resolution: 3.5,
        } as any,
      },
    });

    expect(screen.getByText("Experimental structure")).toBeInTheDocument();
    expect(screen.getByText("6N7E")).toBeInTheDocument();
    expect(screen.getByText("3.5 Å")).toBeInTheDocument();

    // In the "What is missing, and why" card or diagnostics section
    expect(
      screen.getByText(/Structure repair failed on experimental model 6N7E \(3.5 Å\)/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Shown for reference only — excluded from the consensus\./)).toBeInTheDocument();
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROGRESS BANNER — the surface that replaced an elapsed-time fiction
 * ─────────────────────────────────────────────────────────────────────────────
 * It used to advance through hardcoded stages at 12 s / 40 s / 75 s and then sit on "Finalizing —
 * Aggregating calibrated multi-tool consensus" for the rest of the run: five of six minutes, while
 * the machine was repacking a template. The stage now comes from the worker, the age from a duration
 * the SERVER measured, and an unreported phase says so instead of guessing.
 *
 * Nothing rendered this banner before, so every one of those properties was unguarded.
 */
describe("EnergeticsView — FoldX progress banner", () => {
  it("names the reported stage and the queue position, and shows no age while queued", () => {
    const { container } = renderView({
      isFolding: true,
      foldingProgress: { phase: "queued", elapsedMs: null, queuePosition: 2, receivedAt: Date.now() },
    });

    const text = container.textContent ?? "";
    expect(text).toContain("1. Queued");
    expect(text).toContain("2 jobs ahead");
    expect(text).toContain("Waiting for a free force-field worker");
    // A queued job has no execution clock: an "Elapsed" here would be measuring the spinner.
    expect(text).not.toContain("Elapsed:");
  });

  it("says the stage is unreported rather than guessing one", () => {
    const { container } = renderView({
      isFolding: true,
      foldingProgress: { phase: null, elapsedMs: 4_000, queuePosition: null, receivedAt: Date.now() },
    });

    const text = container.textContent ?? "";
    expect(text).toContain("not reported by the compute server yet");
    /**
     * No stage may be claimed. The stepper LABELS are always on screen — they are the legend of what
     * a FoldX run consists of — so the assertion is about which cell is active, which the cell
     * carries as data rather than leaving to be inferred from text.
     */
    expect(container.querySelectorAll("[data-foldx-stage]")).toHaveLength(4);
    expect(container.querySelectorAll('[data-foldx-stage][data-active="true"]')).toHaveLength(0);
  });

  it("reports the age of the JOB, from the duration the server measured", () => {
    const { container } = renderView({
      isFolding: true,
      foldingProgress: { phase: "repairing", elapsedMs: 65_000, queuePosition: null, receivedAt: Date.now() },
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Structure repair");
    expect(text).toContain("Repacking side chains");
    expect(text).toContain("Elapsed: 1m 05s");
    // ...and exactly one cell is active: the reported one.
    const active = container.querySelectorAll('[data-foldx-stage][data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("data-foldx-stage")).toBe("2");
  });

  it("offers the hide control only once a row has settled", () => {
    // Every engine null: hiding the running rows would reveal nothing, and the control lives inside
    // the banner it hides — so pressing it early left no way back and no progress surface at all.
    const allNull = {
      ...MACO1_ENERGETICS,
      dynamut2: null,
    };
    const noResults = renderView({ isFolding: true, foldingEnergetics: allNull, dynamut2Status: "pending" });
    expect(within(noResults.container).queryByText("Hide pending engines")).toBeNull();

    // With one engine settled there is something to reveal, so the control is offered.
    const withResults = renderView({
      isFolding: true,
      foldingProgress: { phase: "modelling", elapsedMs: 1_000, queuePosition: null, receivedAt: Date.now() },
    });
    expect(within(withResults.container).getByText("Hide pending engines")).toBeInTheDocument();
  });

  it("discloses an un-repaired template, and keeps both caveats when the template is also low-confidence", () => {
    const { container } = renderView({
      isFolding: false,
      disruptionPredictor: { plddt: 60 },
      foldingEnergetics: {
        ...MACO1_ENERGETICS,
        foldx: 1.4,
        foldxMean: 1.4,
        // The shared fixture models a FAILED repair; this case is the quieter one — repair never
        // attempted — and inheriting the failure would short-circuit the disclosure under test.
        foldxRepairFailed: false,
        foldxRepairSkipped: true,
        foldxRepairSkippedReason: "large-structure",
      },
    });

    const text = container.textContent ?? "";
    // Both facts, not the first one: the skip note used to be REPLACED by the pLDDT note, and
    // AlphaFold templates — the likeliest low-pLDDT case — set exactly that skip reason.
    expect(text).toContain("Template not repaired (large structure)");
    expect(text).toContain("Low template confidence (pLDDT 60.0)");
  });
});


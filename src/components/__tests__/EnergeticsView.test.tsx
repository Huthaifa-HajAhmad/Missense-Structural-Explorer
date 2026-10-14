// @vitest-environment jsdom
import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EnergeticsView from "../EnergeticsView";
import { energeticsAgreementText, buildEnergeticsEvidence } from "../../shared/energeticsEvidence";
import { DdgRuler } from "../energetics/DdgRuler";
import { SettingsProvider } from "../../context/SettingsContext";

/**
 * Component coverage for the Energetics tab (rebuilt on `shared/energeticsEvidence.ts`).
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
  const rendered = render(
    <SettingsProvider>
      <EnergeticsView {...(props as any)} />
    </SettingsProvider>
  );
  // These existing scientific contracts exercise the detailed records, now a named workspace tab.
  const records = within(rendered.container).queryByRole('tab', { name: 'Engine records' });
  if (records) fireEvent.click(records);
  return rendered;
}

describe("EnergeticsView — the observed single-engine run", () => {
  it('opens the actual explanation from each of the six engine records, including absent results', () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    renderView();
    for (const name of ['FoldX', 'DynaMut2', 'DDMut', 'RaSP', 'ThermoMPNN', 'StabilityOracle']) {
      fireEvent.click(screen.getByRole('button', { name: `About ${name}` }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toContain(name);
      expect(dialog.textContent).not.toContain('Explanation unavailable');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close explanation' }));
    }
  });
  it("renders without crashing", () => {
    const { container } = renderView();
    expect(container.textContent ?? "").not.toBe("");
  });

  it("states coverage in the finding, and says one engine is too few to read as agreement", () => {
    const { container } = renderView();
    const text = container.textContent ?? "";
    expect(text).toContain("1 of 6 engines");
    expect(screen.getByTestId("energetics-summary")).toHaveTextContent("too few to read as agreement");
    expect(screen.getByTestId("energetics-summary").getAttribute("data-tone")).toBe("warning");
    expect(screen.getByTestId("energetics-median")).toHaveTextContent("+0.09");
    expect(text).toContain("Single engine — not a median");
  });

  it("never prints one value with two opposite signs", () => {
    const { container } = renderView();
    const text = container.textContent ?? "";
    // DynaMut2 reported −0.09 natively; the canonical form is +0.09 and MUST be the only form shown.
    expect(text).not.toMatch(/[-−]0\.09/);
    expect(text).toContain("+0.09");
  });

  it("shows no probability, interval or 'calibrated' claim", () => {
    // The gauge, the "90% conformal prediction interval" and the per-engine "P:" rows came from
    // hand-typed curves (tools/train_stacker.py). They are removed, not relabelled.
    const { container } = renderView({
      foldingEnergetics: { ...MACO1_ENERGETICS, foldx: 2.0, foldxMean: 2.0, foldxRepairFailed: false, thermompnn: 0.3 },
      foldingStatus: "success",
      thermompnnStatus: "done",
    });
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/calibrated|conformal|probability|P: \d/i);
    expect(text).toContain("Local destabilizing mark (not published)");
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
    renderView();
    expect(screen.getByTestId("energetics-ddmut")).toHaveTextContent("did not answer in time");
    const rasp = screen.getByTestId("energetics-rasp");
    expect(rasp).toHaveTextContent("No precomputed RaSP score is available for this variant");
    // ...and says how small the bundled set is, so "not covered" is not read as rare.
    expect(rasp).toHaveTextContent("1,345 human proteins with experimental structures");
    expect(rasp).not.toHaveTextContent("exists for this protein");
  });

  it("says why a value is shown but not counted", () => {
    renderView({
      foldingEnergetics: { ...MACO1_ENERGETICS, foldx: 3.0, foldxMean: 3.0 },
      dynamut2Status: "done",
    });
    const foldx = screen.getByTestId("energetics-foldx");
    expect(within(foldx).getAllByText("Not counted").length).toBeGreaterThan(0);
    expect(foldx).toHaveTextContent("excluded from the consensus");
    // ...and the excluded value does not enter the agreement.
    expect(screen.getByTestId("energetics-tally-key")).toHaveTextContent("1 not destabilizing");
  });

  it("does not surface a raw server error as body copy", () => {
    const { container } = renderView();
    expect(container.textContent ?? "").not.toContain("Simulation timed out after 5 minutes.");
  });

  it("does not freeze a stalled engine as running", () => {
    renderView();
    expect(screen.getByTestId("energetics-thermompnn").getAttribute("data-state")).not.toBe("running");
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("does show a live remote engine as running, because a pending status implies a poller", () => {
    renderView({ thermompnnStatus: "pending", isFolding: false });
    const row = screen.getByTestId("energetics-thermompnn");
    expect(row.getAttribute("data-state")).toBe("running");
    expect(within(row).getByText("Running")).toBeInTheDocument();
    expect(screen.getByTestId("energetics-tally-key")).toHaveTextContent("1 running");
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
    structureProvenance: { source: "experimental", pdbId: "1abc", chainId: "A", resolution: 1.8, foldxRuns: 5 } as any,
  };
  const settled = {
    foldingEnergetics: FULL,
    foldingStatus: "success",
    foldingError: null,
    dynamut2Status: "done",
    ddmutStatus: "done",
    thermompnnStatus: "done",
  };

  it("reports full coverage and full agreement", () => {
    const { container } = renderView(settled);
    const text = container.textContent ?? "";
    expect(text).toContain("6 of 6 engines");
    expect(screen.getByTestId("energetics-verdict")).toHaveTextContent("Destabilizing");
    expect(screen.getByTestId("energetics-summary")).toHaveTextContent(
      "All 6 engines that returned a value predict destabilization."
    );
    expect(text).not.toContain("too few");
  });

  it("applies each engine's own marks rather than FoldX's", () => {
    renderView(settled);
    const raspRow = screen.getByTestId("energetics-rasp");
    // RaSP at +1.4 clears its own mark of +1.0; under FoldX's 1.5 it would be "Moderately destabilizing".
    expect(within(raspRow).getByText("Destabilizing")).toBeInTheDocument();
    expect(within(raspRow).queryByText("Moderately destabilizing")).toBeNull();
    expect(within(raspRow).getByText("local mark +1")).toBeInTheDocument();
    expect(within(screen.getByTestId("energetics-foldx")).getByText("local mark +1.5")).toBeInTheDocument();
  });

  it("states the ensemble spread as run-to-run spread, not an error bar", () => {
    renderView(settled);
    const foldx = screen.getByTestId("energetics-foldx");
    expect(foldx).toHaveTextContent("+2.00");
    expect(foldx).toHaveTextContent("Mean of 5 BuildModel runs; run-to-run spread 0.30 kcal/mol, not an error bar.");
  });

  it("does not claim a spread that was never measured", () => {
    const { container } = renderView({ ...settled, foldingEnergetics: { ...FULL, foldxSd: null } });
    const text = container.textContent ?? "";
    expect(text).not.toContain("± 0.00");
    expect(text).not.toContain("spread");
  });

  it("puts every engine on the same labelled axis", () => {
    renderView(settled);
    const rulers = screen.getAllByRole("img");
    expect(rulers).toHaveLength(6);
    expect(rulers[0].getAttribute("aria-label")).toContain("on a −3 to +5 kcal/mol axis");
    expect(rulers[0].getAttribute("aria-label")).toContain("local destabilizing mark +1.5");
  });

  it("says no engine returned a value when none did", () => {
    renderView({ foldingEnergetics: {}, foldingStatus: "success" });
    expect(screen.getByTestId("energetics-summary")).toHaveTextContent("No stability engine returned a ΔΔG for this variant.");
    expect(screen.getByTestId("energetics-verdict")).toHaveTextContent("No ΔΔG");
  });

  it("gives the report the same sentence the tab states", () => {
    renderView(settled);
    const lead = screen.getByTestId("energetics-summary").querySelector("strong")!.textContent!;
    expect(energeticsAgreementText(FULL)).toContain(lead);
  });

  it("says ΔΔG is not an ACMG input rather than implying a code", () => {
    const { container } = renderView(settled);
    expect(container.textContent ?? "").toContain("Not an ACMG input");
    expect(container.textContent ?? "").not.toMatch(/\bPP3\b|\bPM1\b/);
  });
});

describe("EnergeticsView — the comparison tab", () => {
  /** The default renderView switches to Engine records; these need the Comparison tab as opened. */
  function renderComparisonView(overrides: Record<string, unknown> = {}) {
    const props = {
      ...CLASS_PROPS,
      analysisState: analysisState(),
      foldingDdG: null,
      foldingStatus: "failed",
      foldingEnergetics: MACO1_ENERGETICS,
      dynamut2Status: "done",
      ddmutStatus: "unavailable",
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

  it("does not call a two-engine reading an agreement", async () => {
    // FoldX returned a value its failed repair excludes; DynaMut2 and DDMut are the only counted
    // engines. The old comparison finding said "The methods agree" while Engine records, on the
    // same screen, said two is too few to read as agreement.
    const { container } = renderComparisonView({
      foldingStatus: "success",
      foldingError: null,
      foldingEnergetics: { foldx: 2.5, foldxMean: 2.5, foldxRepairFailed: true, dynamut2: -2.0, ddmut: -1.5 },
      dynamut2Status: "done",
      ddmutStatus: "done",
    });
    const finding = await screen.findByText(/Both methods/);
    expect(finding).toBeInTheDocument();
    expect((container.textContent ?? "")).toContain("too few to read as agreement");
    expect((container.textContent ?? "")).not.toContain("The methods agree");
  });

  it("clears the pin when the same method is activated again", async () => {
    renderComparisonView();
    const chip = await screen.findByRole("button", { name: /RaSP/ }, { timeout: 6000 });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("EnergeticsView — structure provenance", () => {
  it("names an experimental template with its PDB link and resolution", () => {
    renderView({
      foldingEnergetics: {
        ...MACO1_ENERGETICS,
        structureProvenance: { source: "experimental", pdbId: "1abc", chainId: "A", resolution: 1.8 } as any,
      },
    });
    const fact = screen.getByTestId("energetics-structure");
    expect(fact).toHaveTextContent("Experimental structure");
    expect(within(fact).getByRole("link")).toHaveAttribute("href", "https://www.rcsb.org/structure/1ABC");
    expect(fact).toHaveTextContent("1.8 Å");
  });

  it("names a homology template with its sequence identity", () => {
    renderView({
      foldingEnergetics: {
        ...MACO1_ENERGETICS,
        structureProvenance: { source: "homolog", pdbId: "2xyz", identity: 85, resolution: 2.1 } as any,
      },
    });
    const fact = screen.getByTestId("energetics-structure");
    expect(fact).toHaveTextContent("Structural homolog");
    expect(fact).toHaveTextContent("85% identity");
  });

  it("does not name a template while the run is still resolving one", () => {
    renderView({
      isFolding: true,
      foldingEnergetics: { ...MACO1_ENERGETICS, structureProvenance: { source: "alphafold" } as any },
    });
    expect(screen.queryByText("AlphaFold prediction")).toBeNull();
  });

  it("explains a failed repair on an experimental template 6N7E (3.5 Å)", () => {
    renderView({
      foldingEnergetics: {
        ...MACO1_ENERGETICS,
        foldx: -2.12,
        foldxMean: -2.12,
        foldxRepairFailed: true,
        structureProvenance: { source: "experimental", pdbId: "6N7E", chainId: "A", resolution: 3.5 } as any,
      },
    });
    expect(screen.getByTestId("energetics-structure")).toHaveTextContent("Repair failed");
    expect(screen.getByTestId("energetics-foldx")).toHaveTextContent(
      "Structure repair failed on experimental model 6N7E (3.5 Å), so this estimate came from an unminimised model."
    );
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
      foldingStatus: null,
      foldingProgress: { phase: "queued", elapsedMs: null, queuePosition: 2, receivedAt: Date.now() },
    });

    const text = container.textContent ?? "";
    expect(text).toContain("1. Queued");
    expect(text).toContain("2 jobs ahead");
    expect(text).toContain("Waiting for a compute worker to start this job");
    // A queued job has no execution clock: an "Elapsed" here would be measuring the spinner.
    expect(text).not.toContain("Elapsed:");
  });

  it("names the person's own computer, and why, when live routing placed the job there", () => {
    const reason = "It runs on Lab PC, which is expected to finish first.";
    const runsOn = { where: "your_computer" as const, computerName: "Lab PC", started: false, expectedMs: { p50: 9000, p90: 18000 }, basis: "prior" as const, samples: 0, reasons: [reason] };
    const { container, getByTestId } = renderView({
      isFolding: true,
      foldingStatus: null,
      foldingProgress: { phase: "queued", elapsedMs: null, queuePosition: 0, receivedAt: Date.now(), runsOn },
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Waiting for your computer (Lab PC) to pick it up.");
    expect(text).not.toContain("compute worker");
    expect(getByTestId("energetics-runs-on").textContent).toBe(reason); // the queue line already names the computer
  });

  it("says where a running job runs", () => {
    const runsOn = { where: "your_computer" as const, computerName: "Lab PC", started: true, expectedMs: null, basis: null, samples: null, reasons: [] };
    const { getByTestId, container } = renderView({
      isFolding: true,
      foldingStatus: null,
      foldingProgress: { phase: null, elapsedMs: 2_000, queuePosition: null, receivedAt: Date.now(), runsOn },
    });
    expect(getByTestId("energetics-runs-on").textContent).toBe("Running on your computer (Lab PC).");
    expect(container.textContent).toContain("Your computer (Lab PC) has not reported a stage yet.");
    // Screen readers hear it too, not only sighted readers.
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Running on your computer (Lab PC).");
  });

  it("does not repeat the wait for a job queued on the shared server", () => {
    const runsOn = { where: "server" as const, computerName: null, started: false, expectedMs: null, basis: null, samples: null, reasons: [] };
    const { container, queryByTestId } = renderView({
      isFolding: true,
      foldingStatus: null,
      foldingProgress: { phase: "queued", elapsedMs: null, queuePosition: 1, receivedAt: Date.now(), runsOn },
    });
    expect(queryByTestId("energetics-runs-on")).toBeNull();
    expect(container.textContent).not.toContain("Waiting for the shared server");
  });

  it("says the stage is unreported rather than guessing one", () => {
    const { container } = renderView({
      isFolding: true,
      foldingStatus: null,
      foldingProgress: { phase: null, elapsedMs: 4_000, queuePosition: null, receivedAt: Date.now() },
    });

    const text = container.textContent ?? "";
    expect(text).toContain("has not reported a stage yet");
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
      foldingStatus: null,
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

  it("once FoldX has its own result, says so and keeps the other engines in view", () => {
    const { container } = renderView({
      isFolding: true,
      foldingStatus: "success",
      foldingProgress: { phase: "scoring", elapsedMs: 90_000, queuePosition: null, receivedAt: Date.now() },
    });
    const text = container.textContent ?? "";
    expect(text).toContain("FoldX score ready");
    expect(container.querySelectorAll('[data-foldx-stage][data-active="true"]')).toHaveLength(0);
    expect(container.querySelectorAll(".nrg-progress__engine")).toHaveLength(6);
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
      foldingStatus: null,
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

    // Both facts, not the first one: the skip note used to be REPLACED by the pLDDT note, and
    // AlphaFold templates — the likeliest low-pLDDT case — set exactly that skip reason.
    const foldx = screen.getByTestId("energetics-foldx");
    expect(within(foldx).getByText("Unrepaired template")).toBeInTheDocument();
    expect(within(foldx).getByText("Low pLDDT")).toBeInTheDocument();
    expect(screen.getByTestId("energetics-summary")).toHaveTextContent("pLDDT 60.0");
    expect(container.textContent ?? "").toContain("unrepaired template");
  });
});


describe("DdgRuler — one unit per row", () => {
  it("labels the axis and the mark in kJ/mol when the value is shown in kJ/mol", () => {
    const foldx = buildEnergeticsEvidence({ foldingEnergetics: { foldx: 2.0, foldxMean: 2.0 }, foldingStatus: "success" }).readings[0];
    const { container } = render(<DdgRuler reading={foldx} unit="kJ/mol" />);
    const label = screen.getByRole("img").getAttribute("aria-label")!;
    expect(label).toContain("+8.37 kJ/mol");
    expect(label).toContain("−12.6 to +20.9 kJ/mol axis");
    expect(label).toContain("local destabilizing mark +6.3");
    expect(label).not.toContain("kcal");
    expect(container.querySelector(".nrg-ruler__axis")!.textContent).toBe("−12.60+20.9");
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import EnergeticsInspector from "./EnergeticsInspector";
import { SettingsProvider } from "../../context/SettingsContext";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";

/**
 * The Energetics rail (Evidence Lineage), rebuilt on `shared/energeticsEvidence.ts`.
 *
 * Earlier history of this file, kept because the invariants still hold:
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

const NAE1 = {
  foldx: 2.62,
  foldxMean: 2.62,
  foldxSd: 0,
  foldxRepairSkipped: true,
  foldxRepairSkippedReason: "large-structure",
  dynamut2: null,
  ddmut: null,
  rasp: null,
  raspReason: "Residue position is not present in the pre-computed database",
  thermompnn: -0.36,
  stabilityoracle: -0.06,
  structureProvenance: {
    source: "experimental",
    pdbId: "1YOV",
    chainId: "A",
    resolution: 2.8,
    foldxRuns: 5,
    raspDatasetSnapshot: "2023-Zenodo-6835877",
    vesmModel: "VESM_150M_v1",
  },
};

describe("EnergeticsInspector — the rule trace", () => {
  it("traces structure → engines → marks → summary → engine record for the reference run", () => {
    renderInspector({ foldingEnergetics: NAE1, foldingStatus: "success", thermompnnStatus: "done" });
    const trace = screen.getByTestId("energetics-rule-trace");
    const steps = trace.querySelectorAll("li");
    expect(steps).toHaveLength(5);
    expect(steps[0]).toHaveTextContent("Experimental structure · 1YOV:A · 2.8 Å");
    expect(steps[0]).toHaveTextContent("FoldX template: not repaired (large structure)");
    expect(steps[0].getAttribute("data-state")).toBe("warn");
    expect(steps[1]).toHaveTextContent("3 of 6 engines");
    // F8: a missing engine carries its reason, not a bare name.
    expect(steps[1]).toHaveTextContent("No value: DynaMut2 — The run ended without returning a value");
    expect(steps[1]).toHaveTextContent("RaSP — No precomputed RaSP score is available");
    expect(steps[2]).toHaveTextContent("1 destabilizing · 0 moderate · 2 not destabilizing");
    expect(steps[3]).toHaveTextContent("Engines disagree · median −0.06 kcal/mol");
    expect(steps[3].getAttribute("data-state")).toBe("warn");
    expect(steps[4]).toHaveTextContent("Not an ACMG input");
  });

  it("lists each engine's local mark beside this variant's value", () => {
    renderInspector({ foldingEnergetics: NAE1, foldingStatus: "success", thermompnnStatus: "done" });
    const marks = screen.getByTestId("energetics-marks");
    const foldx = within(marks).getByText("FoldX").closest("tr")!;
    expect(foldx).toHaveTextContent("≥ +1.5");
    expect(foldx).toHaveTextContent("+2.62");
    expect(foldx).toHaveTextContent("Past mark");
    expect(marks).toHaveTextContent("Method");
    expect(foldx.getAttribute("data-active")).toBe("true");
    expect(marks.closest("section")).toHaveTextContent("FoldX publishes no threshold");
  });

  it("states no probability and no hard-coded physical constants", () => {
    const { container } = renderInspector({ foldingEnergetics: NAE1, foldingStatus: "success", thermompnnStatus: "done" });
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/298\.15|ProTherm|conformal|P: \d/);
    expect(text).toContain("No calibrated probability is shown");
  });

  it("names a dataset or model only when the engine that uses it returned a value", () => {
    const { container } = renderInspector({ foldingEnergetics: NAE1, foldingStatus: "success", thermompnnStatus: "done" });
    const text = container.textContent ?? "";
    // The server stamps both on every run; neither produced a number here.
    expect(text).not.toContain("VESM_150M_v1");
    expect(text).not.toContain("2023-Zenodo-6835877");
    expect(text).toContain("FoldX runs");  });
});

describe("EnergeticsInspector — FoldX on two templates", () => {
  const withProtvar = { ...NAE1, protvar: 1.12, protvarStatus: "done", protvarPlddt: 88, protvarModel: "AF-Q13564-F1" };

  it("sets the local run beside ProtVar's, with the gap and a cross-check-only note", () => {
    renderInspector({ foldingEnergetics: withProtvar, foldingStatus: "success", thermompnnStatus: "done" });
    const section = screen.getByTestId("foldx-template-check");
    expect(section).toHaveTextContent("1YOV:A (experimental, 2.8 Å)");
    expect(section).toHaveTextContent("not repaired");
    expect(section).toHaveTextContent("AF-Q13564-F1");
    expect(section).toHaveTextContent("+2.62");
    expect(section).toHaveTextContent("+1.12");
    expect(section).toHaveTextContent("−1.50");
    expect(section).toHaveTextContent("The two FoldX values differ by 1.50 kcal/mol");
    expect(section).toHaveTextContent("Cross-check only");
  });

  it("is absent when ProtVar has no value", () => {
    renderInspector({ foldingEnergetics: NAE1, foldingStatus: "success", thermompnnStatus: "done" });
    expect(screen.queryByTestId("foldx-template-check")).toBeNull();
  });

  it("does not claim ProtVar's value rests on this run's template", () => {
    renderInspector({ foldingEnergetics: withProtvar, foldingStatus: "success", thermompnnStatus: "done", selectedEngine: "protvar" });
    const panel = document.getElementById(INSPECTOR_SECTIONS.stabilityMethod)!;
    expect(panel).toHaveTextContent("AlphaFold DB model AF-Q13564-F1");
    expect(panel).not.toHaveTextContent("1YOV");
  });

  it("says ProtVar is the FoldX value when it stands in for a missing local run on an AlphaFold template", () => {
    renderInspector({
      foldingEnergetics: { protvar: 1.9, protvarStatus: "done", protvarModel: "AF-Q13564-F1", structureProvenance: { source: "alphafold" } },
      foldingStatus: "failed",
      thermompnnStatus: "done",
    });
    expect(screen.getByTestId("energetics-rule-trace")).toHaveTextContent("FoldX value: ProtVar precomputed on AF-Q13564-F1; no local value");
    expect(screen.queryByTestId("foldx-template-check")).toBeNull();
  });
});

describe("EnergeticsInspector — engines without a value", () => {
  it("gives each missing engine its state and reason, with raw detail behind a disclosure", () => {
    renderInspector({
      foldingEnergetics: NAE1,
      foldingStatus: "success",
      thermompnnStatus: "done",
      ddmutStatus: "unavailable",
    });
    const missing = screen.getByTestId("energetics-missing");
    expect(within(missing).getByText("DDMut").closest("li")).toHaveTextContent("Provider busy");
    const rasp = within(missing).getByText("RaSP").closest("li")!;
    expect(rasp).toHaveTextContent("Not covered");
    expect(rasp.querySelector("details")).toHaveTextContent("Residue position is not present in the pre-computed database");
  });

  it("carries the low-confidence warning even when every engine returned a value", () => {
    /**
     * The warning used to sit inside the diagnostics gate, so on a complete run it vanished: the more
     * complete the run, the less the panel said about its own reliability.
     */
    renderInspector({
      foldingEnergetics: {
        foldx: 1.2,
        foldxMean: 1.2,
        dynamut2: -0.4,
        ddmut: -0.3,
        rasp: 0.9,
        thermompnn: 0.8,
        stabilityoracle: 0.7,
      },
      dynamut2Status: "done",
      ddmutStatus: "done",
      thermompnnStatus: "done",
      disruptionPredictor: { plddt: 55 },
    });
    expect(screen.queryByTestId("energetics-missing")).toBeNull();
    expect(screen.getByTestId("energetics-rule-trace")).toHaveTextContent("AlphaFold pLDDT 55.0 at this residue");
  });

  it("calls an excluded value 'not counted', matching the main column", () => {
    renderInspector({
      foldingEnergetics: { foldx: 3.0, foldxMean: 3.0, foldxRepairFailed: true },
      foldingStatus: "success",
    });
    expect(screen.getByTestId("energetics-rule-trace")).toHaveTextContent("Shown, not counted: FoldX");
    expect(within(screen.getByTestId("energetics-marks")).getByText("FoldX").closest("tr")).toHaveTextContent("Not counted");
  });

  it("keeps the canonical focus target the view links to", () => {
    renderInspector();
    const target = document.getElementById(INSPECTOR_SECTIONS.stabilityTelemetry);
    expect(target).not.toBeNull();
    expect(target!.getAttribute("tabindex")).toBe("-1");
  });

  it("names a refused non-wild-type template and links the AlphaFold model this run used", () => {
    renderInspector({
      analysisResult: {
        metadata: { gene: "UROD", variant: "p.Gly318Arg", residueIndex: 318, uniprotId: "P06132" },
        uniprotFeatures: { features: [] },
        conservationData: {},
      },
      foldingEnergetics: {
        foldx: -1.75,
        foldxMean: -1.75,
        structureProvenance: {
          source: "alphafold",
          afdbVersion: "v6",
          excludedExperimental: { pdbId: "1R3S", chainId: "A", differences: ["D86G (engineered mutation)"] },
        },
      },
      foldingStatus: "success",
    });
    const note = screen.getByTestId("energetics-excluded-template");
    expect(note).toHaveTextContent("1R3S:A is not the wild type — D86G (engineered mutation) — so this run used the AlphaFold model");
    expect(within(note).getByRole("link", { name: /AlphaFold model/ })).toHaveAttribute(
      "href",
      "https://alphafold.ebi.ac.uk/entry/P06132"
    );
  });

  it("says a refused template could not be checked, never that it is a mutant", () => {
    renderInspector({
      foldingEnergetics: {
        foldx: -1.75,
        foldxMean: -1.75,
        structureProvenance: {
          source: "alphafold",
          excludedExperimental: { pdbId: "1R3S", chainId: "A", differences: [], unverified: true },
        },
      },
      foldingStatus: "success",
    });
    const note = screen.getByTestId("energetics-excluded-template");
    expect(note).toHaveTextContent("could not be checked against UniProt");
    expect(note).not.toHaveTextContent("is not the wild type");
  });

  it("names a structural homolog when Tier 2 was unavailable, not a hard-coded AlphaFold model", () => {
    renderInspector({
      foldingEnergetics: {
        foldx: -1.75,
        foldxMean: -1.75,
        structureProvenance: {
          source: "homolog",
          pdbId: "5XYZ",
          chainId: "B",
          identity: 60,
          excludedExperimental: { pdbId: "1R3S", chainId: "A", differences: ["D86G"] },
        },
      },
      foldingStatus: "success",
    });
    const note = screen.getByTestId("energetics-excluded-template");
    expect(note).toHaveTextContent("this run used the structural homolog");
    expect(note).not.toHaveTextContent("AlphaFold model");
  });
});

describe("EnergeticsInspector — the method inspector section", () => {
  it("announces a pin in one small live line, not the whole section", () => {
    // The section used to carry `aria-live="polite"` itself: every pin re-announced the method's
    // description, dl rows, caveat paragraphs… The announcement is now one bounded sr-only status
    // line with the name and value.
    renderInspector({ foldingEnergetics: NAE1, foldingStatus: "success", thermompnnStatus: "done", selectedEngine: "dynamut2" });
    expect(screen.getByTestId("energetics-rail").querySelector("section")).not.toHaveAttribute("aria-live");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("DynaMut2");
    // The sign-convention sentence the inspector is the only surface for.
    const sign = document.getElementById("nrg-selected-title")!.closest("section")!;
    expect(sign.textContent).toContain("Provider sign reversed for comparison; positive here means less stable folding.");
  });

  it("states FoldX's native sign convention without claiming a reversal", () => {
    renderInspector({ foldingEnergetics: NAE1, foldingStatus: "success", thermompnnStatus: "done", selectedEngine: "foldx" });
    expect(screen.getByRole("status")).toHaveTextContent("FoldX pinned · +2.62");
    const section = document.getElementById("nrg-selected-title")!.closest("section")!;
    expect(section.textContent).toContain("Positive means less stable folding.");
    expect(section.textContent).not.toContain("reversed");
  });
});

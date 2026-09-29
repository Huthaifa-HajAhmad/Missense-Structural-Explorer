// @vitest-environment jsdom
/**
 * EvidenceInspector.test.tsx — the Score thresholds pane of the evidence inspector.
 *
 * Pins what the rail may claim: a rule trace read from the same model as the tab, BP1 reported as
 * not assessed, the bands this variant reached, and the full ClinGen point scale labelled as a
 * reference. It must never again print a cross-modal "concordance" verdict or the invented BP3 key.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("../../../context/SettingsContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../context/SettingsContext")>();
  return { ...actual, useSettings: () => ({ settings: { alphagenomeApiKey: "" }, openSettingsTab: vi.fn() }) };
});

import { render, screen, within } from "@testing-library/react";
import { EvidenceInspector } from "../EvidenceInspector";
import { INSPECTOR_SECTIONS } from "../../../lib/inspectorFocus";
import { NAE1_RESULT } from "../../../shared/__tests__/fixtures/nae1Thresholds";

function renderPane(result: any = NAE1_RESULT) {
  return render(<EvidenceInspector analysisResult={result} activeEvidenceTab="guidelines" foldingDdG={2.62} />);
}

describe("EvidenceInspector — score thresholds pane", () => {
  it("traces the vote, the PP2 rule, BP1 and the engine record", () => {
    renderPane();
    const trace = within(screen.getByTestId("threshold-rule-trace"));
    expect(trace.getByText("3 pathogenic · 1 benign · 2 indeterminate")).toBeTruthy();
    expect(trace.getByText("Z 1.09, o/e 0.88 → not met")).toBeTruthy();
    expect(trace.getByText("Not assessed")).toBeTruthy();
    expect(trace.getByText("PP3")).toBeTruthy();
  });

  it("lists only the bands this variant reached", () => {
    renderPane();
    const bands = within(screen.getByTestId("threshold-bands-reached"));
    expect(bands.getByText("REVEL 0.231 · BP4")).toBeTruthy();
    expect(bands.getByText("CADD 26.3 · PP3")).toBeTruthy();
    expect(bands.getByText("phyloP 7.64 · PP3 (not counted)")).toBeTruthy();
    expect(bands.queryByText(/AlphaMissense/)).toBeNull();
  });

  it("warns when the payload still carries an automatic BP1", () => {
    renderPane({ ...NAE1_RESULT, ruleBasedInsights: { acmgCriteria: [{ code: "PP3" }, { code: "BP1" }] } });
    expect(screen.getByText(/records BP1 from an earlier engine/)).toBeTruthy();
  });

  it("shows the whole point scale as a reference and keeps the method notes as the focus target", () => {
    renderPane();
    for (const id of ["B", "LB", "VUS", "LP", "P"]) expect(screen.getByText(id)).toBeTruthy();
    expect(screen.getByText(/not by summing points/)).toBeTruthy();
    const notes = document.getElementById(INSPECTOR_SECTIONS.thresholdKey);
    expect(notes?.getAttribute("tabindex")).toBe("-1");
    expect(document.body.textContent).not.toMatch(/concordance/i);
    expect(document.body.textContent).not.toMatch(/structurally neutral substitution/);
  });
});

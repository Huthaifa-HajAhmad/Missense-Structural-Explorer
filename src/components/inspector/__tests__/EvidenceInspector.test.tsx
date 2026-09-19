// @vitest-environment jsdom
/**
 * EvidenceInspector.test.tsx — the Thresholds pane of the evidence inspector.
 *
 * Pins the inspector-usefulness invariants: the live match roll-up driven by
 * the shared row builder, the relocated verbose ACMG key (the focus target of
 * the main column's pointer button), and the retained ClinGen point scale.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { EvidenceInspector } from "../EvidenceInspector";
import { INSPECTOR_SECTIONS } from "../../../lib/inspectorFocus";

const MACO1_RESULT: any = {
  predictorData: { caddPhred: 32.0, amPathogenicity: 0.933, amClass: "pathogenic" },
  conservationData: {
    revel: 0.527, bayesdel: 0.125, metarnn: 0.836, clinpred: 0.923,
    eigenPhred: 11.7, dann: 0.999, popeve: -4.235, esm1b: -13.54,
    gerp: 6.03, phylop: 9.57
  },
  esmcEval: { llr: -8.43 },
  dynamut2: null, ddmut: null, rasp: null, thermompnn: null,
  misZ: 3.13, loeuf: null
};

function renderPane(props: Partial<React.ComponentProps<typeof EvidenceInspector>> = {}) {
  return render(
    <EvidenceInspector
      analysisResult={MACO1_RESULT}
      activeEvidenceTab="guidelines"
      foldingDdG={-0.97}
      {...props}
    />
  );
}

describe("EvidenceInspector — thresholds pane", () => {
  it("summarises live matches from the same row builder as the table", () => {
    renderPane();
    const pane = screen.getByText("Live Threshold Matches").closest("div");
    expect(pane).toBeTruthy();
    const scope = within(pane!.parentElement!);
    // One chip per non-empty group, with the matched counts for this payload.
    expect(scope.getByText("path.")).toBeTruthy();
    expect(scope.getByText("benign")).toBeTruthy();
    expect(scope.getByText("no data")).toBeTruthy();
    // Matched metrics are listed by name with their scores. REVEL's score also
    // appears in the concordance card above, so match all occurrences.
    expect(scope.getByText("REVEL")).toBeTruthy();
    expect(scope.getAllByText("0.527").length).toBeGreaterThanOrEqual(1);
  });

  it("hosts the relocated ACMG/AMP evidence-code key as a focus target", () => {
    renderPane();
    const key = screen.getByText("ACMG/AMP Evidence Codes Key").closest("div");
    expect(key?.id).toBe(INSPECTOR_SECTIONS.thresholdKey);
    expect(key?.getAttribute("tabindex")).toBe("-1");
    // The relocation also closed the old key's PP2/BP1 documentation gap.
    expect(screen.getByText("PP2 / BP1")).toBeTruthy();
  });

  it("keeps the concordance status and the ClinGen point scale", () => {
    renderPane();
    expect(screen.getByText("Moderate-Risk Concordance (Pathogenic Support)")).toBeTruthy();
    expect(screen.getByText("ClinGen Evidence Point Scale")).toBeTruthy();
    expect(screen.getByText("8 points")).toBeTruthy();
  });

  it("offers a cross-link into the Predictors tab", () => {
    renderPane({ onSelectEvidenceTab: () => {} });
    expect(screen.getByRole("button", { name: /Open In-Silico Predictors/i })).toBeTruthy();
  });
});

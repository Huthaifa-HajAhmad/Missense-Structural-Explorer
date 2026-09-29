// @vitest-environment jsdom
/**
 * PerturbationTab.test.tsx — what the Structural perturbation screen and its rail may claim.
 *
 * Both render `buildPerturbationEvidence` (pinned in src/shared/__tests__/perturbationEvidence.test.ts);
 * these hold the surfaces to that contract on the reference variant, NAE1 p.Asp116Gly.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({
    settings: { saprotEngine: "remote-hf", defaultPerturbationModel: "saprot" },
    updateSetting: vi.fn(),
    openSettingsTab: vi.fn()
  })
}));

import { PerturbationTab } from "../evidence/PerturbationTab";
import { PerturbationRail } from "../inspector/PerturbationRail";
import { NAE1_ENERGETICS, NAE1_RESULT } from "../../shared/__tests__/fixtures/nae1Perturbation";

function renderTab(result: any = NAE1_RESULT, extra: Record<string, unknown> = {}) {
  return render(
    <PerturbationTab
      {...({ analysisState: { result, isLoading: false }, foldingEnergetics: NAE1_ENERGETICS, structuralDiff: null, metrics: null, ...extra } as any)}
    />
  );
}

describe("PerturbationTab", () => {
  it("leads with the within-model rank, not a composite score", () => {
    renderTab();
    const hero = screen.getByTestId("perturbation-finding");
    expect(hero.textContent).toContain("3 of 3");
    expect(hero.textContent).toContain("All 3 models place Gly among the three least-preferred residues");
    expect(document.body.textContent).not.toMatch(/\/ 100|Consensus verdict|Moderate disruption|Local perturbation score/i);
  });

  it("reads the engine record instead of implying ACMG weight", () => {
    renderTab();
    expect(screen.getByTestId("perturbation-engine-chip").textContent).toBe("Informational");
    expect(screen.getByTestId("perturbation-engine-record").textContent).toContain("Not counted in PP3/BP4");
  });

  it("names the SaProt model that served the numbers and its real width", () => {
    renderTab();
    const row = screen.getByTestId("ptb-lm-saprot");
    expect(row.textContent).toContain("Served by SaProt (SaProt_35M_AF2 - Remote)");
    expect(row.textContent).not.toMatch(/near zero/);
    expect(document.body.textContent).not.toContain("State: p");
  });

  it("does not print the ΔΔG SD beside the VdW term, nor call it stability", () => {
    renderTab();
    const vdw = screen.getByTestId("ptb-phys-vdw");
    expect(vdw.textContent).toContain("+0.62");
    expect(vdw.textContent).not.toContain("±");
    expect(document.body.textContent).not.toMatch(/neutral stability/i);
  });

  it("states absence in words: contacts and SASA without a comparison are not zeros", () => {
    renderTab();
    const contacts = screen.getByTestId("ptb-phys-contacts");
    expect(contacts.textContent).toContain("No contact comparison was run.");
    expect(contacts.textContent).not.toMatch(/\b0\b/);
  });

  it("drops the heuristic ESM3 impact line and labels the confidence as the input's", () => {
    renderTab();
    expect(document.body.textContent).not.toMatch(/rotamer realignment|Refinement drift|de novo backbone/i);
    expect(screen.getByTestId("ptb-esm3-context").textContent).toMatch(/input structure/i);
  });

  it("uses no legacy status words for a failed or running model", () => {
    renderTab({ ...NAE1_RESULT, esm2Eval: { error: "Request timed out" }, esmcEval: { loading: true } });
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Standby|N\/A/);
    expect(within(screen.getByTestId("ptb-lm-esmc")).getByText("Running")).toBeTruthy();
  });

  it("switches the residue detail between models from the strip", () => {
    renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: /^ESMC/ })[0]);
    expect(document.getElementById("ptb-detail-title")!.textContent).toContain("ESMC-6B");
  });
});

describe("PerturbationRail", () => {
  it("traces models → scale → rank → physics → engine, with the least-preferred band marked", () => {
    render(<PerturbationRail analysisResult={NAE1_RESULT} foldingEnergetics={NAE1_ENERGETICS} saprotEngine="remote-hf" />);
    const trace = screen.getByTestId("perturbation-rule-trace");
    expect(trace.textContent).toContain("3 model families → no shared scale");
    expect(trace.textContent).toContain("Informational — not counted in PP3/BP4");
    const bands = screen.getByTestId("perturbation-rank-bands");
    expect(bands.textContent).toContain("this variant · 20/20");
    expect(screen.getByTestId("perturbation-rail").textContent).toContain("480-dim");
    expect(screen.getByTestId("perturbation-rail").textContent).not.toMatch(/template-conditioned|cosine distance while SaProt/);
  });
});

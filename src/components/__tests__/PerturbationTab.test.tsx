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
import { SLC12A4_RESULT } from "../../shared/__tests__/fixtures/slc12a4Perturbation";

function renderTab(result: any = NAE1_RESULT, extra: Record<string, unknown> = {}) {
  return render(
    <PerturbationTab
      {...({ analysisState: { result, isLoading: false }, foldingEnergetics: NAE1_ENERGETICS, structuralDiff: null, metrics: null, ...extra } as any)}
    />
  );
}

describe("PerturbationTab", () => {
  it.each([
    ['VESM-150M fallback', 'VESM embedding drift', 'VESM embedding analysis'],
    ['ESM3-Medium (Remote)', 'ESM3 embedding drift', 'ESM3 representation analysis'],
    [undefined, 'Sequence embedding drift', 'Embedding drift'],
  ])('uses the served model and operation for %s', (provenance, label, title) => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    renderTab({ ...NAE1_RESULT, esm3Eval: { ...NAE1_RESULT.esm3Eval, provenance } });
    const row = screen.getByTestId('ptb-esm3');
    expect(row.textContent).toContain(label);
    fireEvent.click(within(row).getByRole('button'));
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog.textContent).toMatch(/embedding/i);
    if (provenance?.includes('VESM')) {
      expect(dialog.textContent).toContain('cosine distance');
      expect(dialog.textContent).toContain('not a log-likelihood ratio');
    }
  });
  it("leads with each model's direction, not a composite score", () => {
    renderTab();
    const hero = screen.getByTestId("perturbation-finding");
    expect(hero.textContent).toContain("3 of 3");
    expect(hero.textContent).toContain("models favour native Asp over Gly at residue 116");
    expect(hero.textContent).toContain("SaProt, ESM-2 and ESMC favour native Asp over Gly");
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

  it("renders ESM3 remoteEngineNote in ptb-esm3 when present", () => {
    renderTab({
      ...NAE1_RESULT,
      esm3Eval: {
        ...NAE1_RESULT.esm3Eval,
        remoteEngineNote: "remote skipped (recent refusal: 451: Unavailable For Legal Reasons)"
      }
    });
    const row = screen.getByTestId("ptb-esm3");
    expect(row.textContent).toContain("Engine notes");
    expect(row.textContent).toContain("remote skipped (recent refusal: 451: Unavailable For Legal Reasons)");
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

describe("PerturbationTab — SLC12A4 p.Gln867His", () => {
  it("does not read rank bands as tolerance when the native holds the probability", () => {
    renderTab(SLC12A4_RESULT, { foldingEnergetics: null });
    const hero = screen.getByTestId("perturbation-finding");
    expect(hero.textContent).toContain("2 of 3");
    expect(hero.textContent).toContain("models favour native Gln over His at residue 867");
    expect(hero.textContent).not.toMatch(/dispreferred half|disagree|most preferred/i);
    expect(within(screen.getByTestId("ptb-lm-esmc")).getByText("Favours Gln")).toBeTruthy();
    expect(screen.getByTestId("ptb-lm-esmc").textContent).toContain("His 3rd of 20 · Gln 1st");
  });

  it("names SaProt's flat, sequence-only reading in one callout", () => {
    renderTab(SLC12A4_RESULT, { foldingEnergetics: null });
    const callout = screen.getByTestId("ptb-caveat-saprot");
    expect(callout.textContent).toMatch(/no structure token/);
    expect(callout.textContent).toMatch(/no preference to read/);
    expect(within(screen.getByTestId("ptb-lm-saprot")).getByText("No preference")).toBeTruthy();
  });

  it("states an absent shift window in one line instead of an empty half-panel", () => {
    renderTab(SLC12A4_RESULT, { foldingEnergetics: null });
    expect(screen.getByTestId("ptb-shift-absent").textContent).toMatch(/Embedding shift not returned/);
  });

  it("says where ESM3's drift peaks relative to the variant", () => {
    renderTab(SLC12A4_RESULT, { foldingEnergetics: null });
    expect(screen.getByTestId("ptb-esm3-peak").textContent).toContain("Largest change at residue 4, 863 residues from the variant");
    expect(screen.getByTestId("ptb-esm3").textContent).toContain("Peak away from the variant");
  });

  it("reports a failed FoldX run with its reason", () => {
    renderTab(SLC12A4_RESULT, { foldingEnergetics: null, foldingStatus: "failed", foldingError: "RepairPDB exceeded its time budget." });
    expect(screen.getByTestId("ptb-foldx-absent").textContent).toContain("The FoldX run failed: RepairPDB exceeded its time budget.");
    expect(within(screen.getByTestId("ptb-foldx-absent")).getByText("Failed")).toBeTruthy();
  });
});

describe("PerturbationRail", () => {
  it("traces each model's direction on SLC12A4, setting the flat model aside", () => {
    render(<PerturbationRail analysisResult={SLC12A4_RESULT} saprotEngine="remote-hf" activePerturbationModel="esm2" />);
    const trace = screen.getByTestId("perturbation-direction-trace");
    expect(trace.textContent).toContain("Favours Gln · 384×");
    expect(trace.textContent).toContain("No preference · flat");
    expect(screen.getByTestId("perturbation-rule-trace").textContent).toContain("2 favour Gln, 0 favour His, 1 flat (not read).");
  });

  it("traces models → scale → rank → physics → engine, with the least-preferred band marked", () => {
    render(<PerturbationRail analysisResult={NAE1_RESULT} foldingEnergetics={NAE1_ENERGETICS} saprotEngine="remote-hf" />);
    const trace = screen.getByTestId("perturbation-rule-trace");
    expect(trace.textContent).toContain("3 model families → no shared scale");
    expect(trace.textContent).toContain("Informational — not counted in PP3/BP4");
    const bands = screen.getByTestId("perturbation-rank-bands");
    expect(bands.textContent).toContain("Gly · 20/20");
    expect(screen.getByTestId("perturbation-rail").textContent).toContain("480-dim");
    expect(screen.getByTestId("perturbation-rail").textContent).not.toMatch(/template-conditioned|cosine distance while SaProt/);
  });
});

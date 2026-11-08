// @vitest-environment jsdom
/**
 * PerturbationTab.test.tsx — what the Structural perturbation screen and its rail may claim.
 *
 * Both render `buildPerturbationEvidence` (pinned in src/shared/__tests__/perturbationEvidence.test.ts);
 * these hold the surfaces to that contract on the reference variant, NAE1 p.Asp116Gly.
 */
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({
    settings: { saprotEngine: "remote-hf", defaultPerturbationModel: "saprot" },
    updateSetting: vi.fn(),
    openSettingsTab: vi.fn()
  })
}));

import { PerturbationTab } from "../evidence/PerturbationTab";
import { EvidenceWorkspaceProvider } from "../evidence/EvidenceWorkspace";
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
  it('preserves diagnostics and recovery actions after removing duplicate model rows', async () => {
    const result = { ...NAE1_RESULT,
      saprotEval: { error: 'Request timed out', status: 'timeout', remoteEngineNote: 'Remote queue exhausted', fallbackReason: 'Local checkpoint unavailable' },
      esm2Eval: { error: 'ESM-2 sidecar returned HTTP 401', status: 'unauthorized' }, esmcEval: { error: 'Engine unavailable', status: 'offline' }
    };
    const retry = vi.fn(); const settings = vi.fn();
    render(<EvidenceWorkspaceProvider result={result}>
      <PerturbationTab {...({ analysisState: { result, isLoading: false }, foldingEnergetics: NAE1_ENERGETICS, onRetryStructural: retry, onOpenSettings: settings } as any)} />
    </EvidenceWorkspaceProvider>);
    // A model with a recovery action shows it in plain view, never behind a disclosure.
    const support = within(screen.getByRole('region', { name: 'Model notices' }));
    expect(document.querySelector('details.mol-finding-details')).toBeNull();
    expect(support.getByText('Remote queue exhausted')).toBeInTheDocument();
    expect(support.getByText('Local checkpoint unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('ptb-lm-saprot')).not.toBeInTheDocument();
    fireEvent.click(support.getByRole('button', { name: 'Open connection settings' }));
    expect(settings).toHaveBeenCalledOnce();
    await act(async () => { fireEvent.click(support.getByRole('button', { name: 'Run SaProt 35M instead' })); });
    expect(retry).toHaveBeenCalledWith({ saprotEngine: 'saprot-35m' });
  });
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
    // A plain sentence for a newcomer, then one card per model with its own odds.
    expect(hero.textContent).toContain("All 3 language models expect Asp at position 116 and find Gly less likely.");
    expect(hero.textContent).toContain("It is not proof that the variant is harmful.");
    expect(hero.textContent).toContain("Asp 1,087× as likely as Gly");
    expect(hero.textContent).toContain("Each bar lists the 20 amino acids");
    expect(hero.textContent).not.toMatch(/ΔLLR/);
    // No disclosures hide the model records, coverage or engine record.
    expect(hero.querySelector("details")).toBeNull();
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
        remoteEngineNote: "remote skipped (recent refusal: 451: Unavailable For Legal Reasons)",
        remoteFailure: { provider: "biohub", code: "region" }
      }
    });
    const row = screen.getByTestId("ptb-esm3");
    expect(row.textContent).toContain("Engine notes");
    expect(row.textContent).toContain("Biohub is not available from this server's region.");
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
    // One selector: the strip. The residue detail names the model and points back to it.
    expect(screen.queryByText("Choose a model in the comparison above.")).toBeNull();
    expect(screen.queryByText("How to read this tab")).toBeNull();
    expect(screen.queryByRole("group", { name: "Model shown in residue detail" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Show detail/ })).toBeNull();
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

  it("details the first model with a reading, not a flat one, when the chosen model has no result", () => {
    // SaProt is flat and listed first; ESM-2 returned nothing; ESMC favours Gln.
    const result = { ...SLC12A4_RESULT, esm2Eval: undefined };
    render(<PerturbationRail analysisResult={result} saprotEngine="remote-hf" activePerturbationModel="esm2" />);
    expect(screen.getByText("Selected model · ESMC")).toBeTruthy();
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
    expect(screen.getByTestId("perturbation-rail").textContent).toContain("peak at residue 116");
  });
});

describe("PerturbationTab — packing and geometry", () => {
  it("states the method and input confidence, and draws the clash and contact counts", () => {
    const result = { ...NAE1_RESULT, disruptionPredictor: { bFactorKind: "plddt", plddt: 58.2 } };
    render(
      <EvidenceWorkspaceProvider result={result}>
        <PerturbationTab {...({
          analysisState: { result, isLoading: false },
          foldingEnergetics: NAE1_ENERGETICS,
          structuralDiff: { mutantModel: "foldx-buildmodel", clashes: { diff: 2, wtClashCount: 3, mutClashCount: 5 } },
          metrics: { lostContacts: 1, gainedContacts: 2 }
        } as any)} />
      </EvidenceWorkspaceProvider>
    );
    fireEvent.click(screen.getByRole("tab", { name: "Packing & geometry" }));
    expect(screen.getByText(/Input model confidence at residue 116: pLDDT 58\.2 · Low/)).toBeInTheDocument();
    expect(screen.getByText("Geometry in a low-confidence region describes the model more than the protein.")).toBeInTheDocument();
    expect(screen.getByText(/Fixed backbone · 5 runs/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Heavy-atom clashes: 3 → 5. Reference 3. Mutant 5" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Residue contacts within 4 Å: −1 / +2. Lost 1. Gained 2" })).toBeInTheDocument();
    expect(within(screen.getByTestId("ptb-phys-clash")).getByText("Plotted above")).toBeInTheDocument();
    expect(within(screen.getByTestId("ptb-phys-contacts")).getByText("Plotted above")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("No reading mark");
  });
});

describe("PerturbationTab — packing and geometry without a FoldX model", () => {
  it("leaves out the empty chart area", () => {
    const { container } = render(
      <EvidenceWorkspaceProvider result={SLC12A4_RESULT}>
        <PerturbationTab {...({ analysisState: { result: SLC12A4_RESULT, isLoading: false }, foldingEnergetics: null, structuralDiff: null, metrics: null } as any)} />
      </EvidenceWorkspaceProvider>
    );
    fireEvent.click(screen.getByRole("tab", { name: "Packing & geometry" }));
    expect(screen.getByTestId("ptb-foldx-absent")).toBeInTheDocument();
    expect(container.querySelector(".ptb-energy-plots")).toBeNull();
  });
});

describe("PerturbationTab — headline figure and inspector access", () => {
  it("shows a split instead of presenting a minority as the answer", () => {
    // SaProt favours the variant, ESM-2 is near even, ESMC favours the native residue: no majority.
    renderTab({
      ...NAE1_RESULT,
      saprotEval: { ...NAE1_RESULT.saprotEval, llr: 3 },
      esm2Eval: { ...NAE1_RESULT.esm2Eval, llr: 0.1 }
    });
    const hero = screen.getByTestId("perturbation-finding");
    expect(hero.textContent).toContain("Split");
    expect(hero.textContent).toContain("1 favour native Asp · 1 favour Gly · 1 near even at residue 116");
    expect(hero.textContent).not.toMatch(/\b1 of 3\b/);
  });

  it("says nothing about where the embedding peak is when its distance is unknown", () => {
    renderTab({ ...NAE1_RESULT, esm3Eval: { ...NAE1_RESULT.esm3Eval, maxDriftResidue: undefined } });
    expect(within(screen.getByTestId("ptb-esm3")).queryByText(/^Peak (at|near|away)/)).toBeNull();
    renderTab();
    expect(screen.getAllByTestId("ptb-esm3").some(row => /Peak at the variant/.test(row.textContent ?? ""))).toBe(true);
  });

  it("pins a FoldX reading from its name so the inspector can show its record", () => {
    render(
      <EvidenceWorkspaceProvider result={NAE1_RESULT}>
        <PerturbationTab {...({ analysisState: { result: NAE1_RESULT, isLoading: false }, foldingEnergetics: NAE1_ENERGETICS } as any)} />
      </EvidenceWorkspaceProvider>
    );
    fireEvent.click(screen.getByRole("tab", { name: "Packing & geometry" }));
    const pin = within(screen.getByTestId("ptb-phys-vdw")).getByRole("button", { name: "Van der Waals clash term" });
    expect(pin).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(pin);
    expect(pin).toHaveAttribute("aria-pressed", "true");
  });
});

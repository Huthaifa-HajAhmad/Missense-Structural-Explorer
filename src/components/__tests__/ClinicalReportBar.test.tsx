// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ClinicalReportBar from "../ClinicalReportBar";
import { SettingsProvider } from "../../context/SettingsContext";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { DEFAULT_REPORT_SECTIONS } from "../../stores/slices/uiSlice";

/**
 * The Report screen: every block can be left out and edited, edits are marked and revertible, and only
 * the rule engine's tier is ever shown as the classification.
 */

beforeAll(() => {
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

const result: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", acmgWeighting: "standard" },
  analysis: "### Clinical and Pathogenicity Interpretation\n\nThe model's own prose.",
  predictorData: { caddPhred: 26.3, amPathogenicity: 0.362, amClass: "ambiguous", source: "Ensembl VEP" },
  conservationData: { revel: 0.231, metarnn: 0.529, clinpred: 0.977 },
  ruleBasedInsights: { plausibility: "", acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [{ code: "PP3", reason: "3/6 predictors agree" }], partialEvidence: { available: [], unavailable: [] } },
  insights: {
    acmgVerdict: "Variant of Uncertain Significance (VUS)", model: "gemini-test", source: "ai_inference",
    acmgCriteria: [
      { code: "PP3", reason: "3/6 predictors agree", source: "database_verified" },
      { code: "PS3", reason: "assay in a cited abstract", source: "ai_suggested" },
    ],
  },
};

function renderScreen(onOpenEvidenceTab = vi.fn(), onNavigateToView = vi.fn()) {
  render(
    <SettingsProvider>
      <ClinicalReportBar analysisState={{ result, isLoading: false, error: null } as any} onNavigateToView={onNavigateToView} onOpenEvidenceTab={onOpenEvidenceTab} />
    </SettingsProvider>
  );
  return { onOpenEvidenceTab, onNavigateToView };
}

beforeEach(() => {
  const s = useVariantAnalysisStore.getState();
  s.setGene("NAE1"); s.setVariant("p.Asp116Gly"); s.setUniprotId("Q13564");
  s.setReportSections({ ...DEFAULT_REPORT_SECTIONS });
  s.loadReportDraft(null);
});

describe("ClinicalReportBar", () => {
  it("shows the engine's tier as the classification and lists the model's proposal as not counted", () => {
    renderScreen();
    expect(screen.getByTestId("report-verdict")).toHaveTextContent("Variant of Uncertain Significance (VUS)");
    const card = document.getElementById("report-classification")!;
    fireEvent.click(within(card).getByRole("button", { name: "Show all checked criteria" }));
    const ps3 = within(card).getByText("PS3").closest("tr")!;
    expect(ps3).toHaveTextContent("Not counted");
  });

  it("says a prompt-less run has no written summary rather than inventing one", () => {
    useVariantAnalysisStore.getState().setReportSections({ ...DEFAULT_REPORT_SECTIONS });
    render(
      <SettingsProvider>
        <ClinicalReportBar analysisState={{ result: { ...result, analysis: "" }, isLoading: false, error: null } as any} />
      </SettingsProvider>
    );
    expect(document.getElementById("report-summary")).toHaveTextContent("No written summary was produced");
  });

  it("leaves a block out, lists it under Not in this report, and names it in the footer", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("checkbox", { name: "Leave out RNA splicing" }));

    expect(document.querySelector('[data-block="splicing"]')).toBeNull();
    expect(within(screen.getByTestId("report-left-out")).getByText("RNA splicing")).toBeInTheDocument();
    expect(screen.getByTestId("report-footer")).toHaveTextContent("RNA splicing");

    fireEvent.click(within(screen.getByTestId("report-left-out")).getByRole("button", { name: "Include" }));
    expect(document.querySelector('[data-block="splicing"]')).not.toBeNull();
  });

  it("warns when a left-out block's criterion is still counted", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("checkbox", { name: "Leave out Computational evidence" }));
    expect(screen.getByTestId("report-left-out")).toHaveTextContent("PP3 is still counted in the classification");
  });

  it("lets every block be edited, marks the edit, and reverts to the draft", () => {
    renderScreen();
    const card = () => document.querySelector('[data-block="classification"]') as HTMLElement;
    fireEvent.click(within(card()).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(card()).getByRole("textbox"), { target: { value: "My reading of the case." } });
    fireEvent.click(within(card()).getByRole("button", { name: "Save text" }));

    expect(card()).toHaveTextContent("My reading of the case.");
    expect(card()).toHaveTextContent("Edited by the author");
    // Editing prose never changes the classification.
    expect(screen.getByTestId("report-verdict")).toHaveTextContent("Variant of Uncertain Significance (VUS)");

    fireEvent.click(within(card()).getByRole("button", { name: "Revert to draft" }));
    expect(card()).not.toHaveTextContent("My reading of the case.");
    expect(card()).not.toHaveTextContent("Edited by the author");
  });

  it("opens the evidence tab a block reads from", () => {
    const { onOpenEvidenceTab } = renderScreen();
    const card = document.querySelector('[data-block="computational"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "In-silico predictors" }));
    expect(onOpenEvidenceTab).toHaveBeenCalledWith("predictors");
  });

  it("renders an empty state rather than a blank report when nothing is loaded", () => {
    render(
      <SettingsProvider>
        <ClinicalReportBar analysisState={{ result: null, isLoading: false, error: null } as any} />
      </SettingsProvider>
    );
    expect(screen.getByTestId("report-empty")).toBeInTheDocument();
  });
});


describe("report authoring transactions", () => {
  it("cancels an edit without modifying the draft", () => {
    renderScreen();
    const card = document.getElementById("report-classification")!;
    fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(card).getByRole("textbox"), { target: { value: "Discard this" } });
    fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(useVariantAnalysisStore.getState().reportEdits.classification).toBeUndefined();
    expect(card).not.toHaveTextContent("Discard this");
  });
  it("saves intentional blank prose without clearing the protected verdict", () => {
    renderScreen();
    const card = document.getElementById("report-classification")!;
    fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(card).getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save text" }));
    expect(useVariantAnalysisStore.getState().reportEdits.classification?.text).toBe("");
    expect(screen.getByTestId("report-verdict")).toHaveTextContent("VUS");
  });
});

describe("report views", () => {
  beforeEach(() => useVariantAnalysisStore.getState().setReportView("document"));

  it('separates prose editing from citations and methods without changing export inclusion', () => {
    renderScreen();
    const before = useVariantAnalysisStore.getState().reportSections;
    fireEvent.click(screen.getByRole('tab', { name: 'Citations & methods' }));
    expect(document.getElementById('report-method')!.closest('[hidden]')).toBeNull();
    expect(document.getElementById('report-classification')!.closest('[hidden]')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Narrative & notes' }));
    expect(document.getElementById('report-method')!.closest('[hidden]')).not.toBeNull();
    expect(useVariantAnalysisStore.getState().reportSections).toEqual(before);
  });

  it("shows one part of the document per pill and says exports still take every ticked section", () => {
    renderScreen();
    expect(document.getElementById("report-classification")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Evidence readings" }));
    expect(screen.getByRole("tab", { name: "Evidence readings" })).toHaveAttribute("aria-selected", "true");
    // Hidden, not unmounted: the browser's print of this screen still carries the whole document.
    expect(document.getElementById("report-classification")!.closest("[hidden]")).not.toBeNull();
    expect(document.getElementById("report-computational")!.closest("[hidden]")).toBeNull();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Exports still include every ticked section");
  });

  it("lists a left-out block only under its own part", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("checkbox", { name: "Leave out RNA splicing" }));
    fireEvent.click(screen.getByRole("tab", { name: "Interpretation" }));
    expect(screen.queryByTestId("report-left-out")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Evidence readings" }));
    expect(within(screen.getByTestId("report-left-out")).getByText("RNA splicing")).toBeInTheDocument();
  });
});

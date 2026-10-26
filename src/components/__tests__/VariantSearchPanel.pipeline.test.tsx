// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VariantSearchPanel from "../VariantSearchPanel";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { SettingsProvider } from "../../context/SettingsContext";

beforeEach(() => { useVariantAnalysisStore.getState().resetVariantAnalysisState(); });
function renderPipeline() {
  render(<SettingsProvider><VariantSearchPanel /></SettingsProvider>);
}
function seed() {
  const store = useVariantAnalysisStore.getState();
  store.setAnalysisState({ isLoading: false, error: null, result: {
    metadata: { gene: "SLC12A4", variant: "p.Gln867His", uniprotId: "Q9UP95", pipelineStages: { core: "complete", landscape: "complete" } },
    ruleBasedInsights: { acmgVerdict: "Uncertain Significance" }, landscapeData: [{ position: 867 }]
  } as any });
  store.setPdbText("ATOM coordinates");
  return store;
}
describe("pipeline rail engine-state parity", () => {
  it("shows delayed readiness guidance in the progress summary and lets the reader dismiss it", () => {
    vi.useFakeTimers();
    try {
      const store = seed();
      store.setFoldingStatus("loading");
      store.setIsFolding(true);
      renderPipeline();
      expect(screen.queryByText(/No need to wait/)).toBeNull();
      act(() => { vi.advanceTimersByTime(10_000); });
      const notice = screen.getByText(/No need to wait/).closest('[role="status"]');
      expect(notice).not.toBeNull();
      expect(notice?.closest('.workbench-pipeline-summary')).not.toBeNull();
      expect(notice).toHaveTextContent('Evidence');
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
      expect(screen.queryByText(/No need to wait/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("shows real stored energy values without copying them into core evidence", () => {
    const store = seed();
    store.setFoldingStatus("success");
    store.setFoldingEnergetics({ foldx: 2.5 });
    renderPipeline();
    expect(screen.getByText("ΔΔG = +2.50 kcal/mol · Available")).toBeInTheDocument();
    expect(screen.getByText("On demand")).toBeInTheDocument();
    expect(screen.getByText("6 of 6 settled")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "6");
  });
  it("discloses settled failures and partial readiness instead of pending or all-green success", () => {
    const store = seed();
    store.setFoldingStatus("failed");
    store.setFoldingError("Native process crash through Box64");
    store.setDynamut2Status("unavailable");
    store.setDdmutStatus("unavailable");
    renderPipeline();
    expect(screen.getByText("Workspace ready · Partial results")).toBeInTheDocument();
    expect(screen.getByText(/FoldX, DynaMut2, DDMut failed or unavailable/)).toBeInTheDocument();
    expect(screen.getByLabelText("partial results")).toBeInTheDocument();
    expect(screen.getByText("6 of 6 settled")).toBeInTheDocument();
  });
  it("settles rolling spinner and active tab dot to complete checkmark when all 6 stages have settled", () => {
    const store = seed();
    store.setFoldingStatus("success");
    store.setFoldingEnergetics({ foldx: 2.5 });
    renderPipeline();

    // 1. Header shows Workspace ready with no rolling spinner
    expect(screen.getByText("Workspace ready")).toBeInTheDocument();
    expect(document.querySelector(".cs-spinner")).toBeNull();

    // 2. Tab badge shows complete (green dot), not running (pulsing dot)
    expect(screen.getByLabelText("complete")).toBeInTheDocument();
    expect(screen.queryByLabelText("running")).toBeNull();

    // 3. Counter reports 6 of 6 settled
    expect(screen.getByText("6 of 6 settled")).toBeInTheDocument();

    // 4. Explore-early hint notice is dismissed
    expect(screen.queryByText(/No need to wait — the workspace is already live/)).toBeNull();
  });
  it("truthfully displays 'Analysis failed' and structured non-missense refusal prompt on intronic coordinate refusal", () => {
    const store = useVariantAnalysisStore.getState();
    store.setAnalysisState({
      isLoading: false,
      error: 'Analysis query error: Genomic coordinate translated to non-missense consequence (BMI1 p.?): Protein effect unknown: "p.?". The reference annotation does not predict a protein change for this coordinate, so it is not a missense substitution.',
      result: {
        isDemoData: false,
        metadata: {
          gene: "BMI1",
          variant: "p.?",
          uniprotId: "",
          pipelineStages: { core: "error" },
        },
        nonMissenseRefusal: {
          gene: "BMI1",
          hgvsc: "NM_005180.9:c.317-21C>G",
          hgvsp: "p.?",
          consequence: ["intron_variant"],
          isCoding: false,
          hasCodon: false,
          reason: "Intronic variant: does not alter a coding sequence or codon.",
        },
        insights: {
          biochemicalShift: "⚠️ Biochemical Shift Unavailable",
          structuralImpact: "⚠️ Structural Impact Unavailable",
          acmgCriteria: [],
        },
      } as any,
    });

    renderPipeline();

    expect(screen.getByText("Analysis failed")).toBeInTheDocument();
    expect(screen.getByTestId("non-missense-error-prompt")).toBeInTheDocument();
    expect(screen.getByText("Variant Out of Scope: Non-Missense Consequence")).toBeInTheDocument();
    expect(screen.getByText("Non-coding / Intronic · No mature codon")).toBeInTheDocument();
    expect(screen.getByText("NM_005180.9:c.317-21C>G")).toBeInTheDocument();
    expect(screen.getByText(/Does this variant alter a codon\?/)).toBeInTheDocument();
    expect(screen.getByText(/Recommended resolution:/)).toBeInTheDocument();
    expect(screen.getByText(/ClinVar \(NCBI\)/)).toBeInTheDocument();
    expect(screen.getByText(/gnomAD \(Broad\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("analysis failed")).toBeInTheDocument();
  });
});

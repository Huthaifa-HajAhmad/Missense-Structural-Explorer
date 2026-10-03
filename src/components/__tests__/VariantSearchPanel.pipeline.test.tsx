// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import VariantSearchPanel from "../VariantSearchPanel";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { SettingsProvider } from "../../context/SettingsContext";

beforeEach(() => { useVariantAnalysisStore.getState().resetVariantAnalysisState(); });
function renderPipeline() {
  render(<SettingsProvider><VariantSearchPanel isDark={false} classCard="" classCardHeader="" classCardTitle="" classInput="" classBorderSec="" /></SettingsProvider>);
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
});

// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import ReportInspector from "../ReportInspector";
import { SettingsProvider } from "../../../context/SettingsContext";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { DEFAULT_REPORT_SECTIONS } from "../../../stores/slices/uiSlice";

const result: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564" },
  analysis: "",
  ruleBasedInsights: { plausibility: "", acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [{ code: "PP3", reason: "3/6" }], partialEvidence: { available: [], unavailable: [] } },
  insights: { acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [{ code: "PP3", reason: "3/6", source: "database_verified" }] },
};

function mount() {
  render(
    <SettingsProvider>
      <ReportInspector analysisResult={result} gene="NAE1" variant="p.Asp116Gly" />
    </SettingsProvider>
  );
}

beforeEach(() => {
  const s = useVariantAnalysisStore.getState();
  s.setReportSections({ ...DEFAULT_REPORT_SECTIONS });
  s.loadReportDraft(null);
});

describe("ReportInspector", () => {
  it("ticks and unticks any block, identity and classification included", () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Leave out Classification" }));
    expect(useVariantAnalysisStore.getState().reportSections.classification).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Include Classification" })).toBeInTheDocument();
  });

  it("applies the One page preset to the ticks only", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "One page" }));
    const s = useVariantAnalysisStore.getState().reportSections;
    expect(s.classification).toBe(true);
    expect(s.method).toBe(true);
    expect(s.stability).toBe(false);
  });

  it("does not offer a Word or PowerPoint button that does nothing", () => {
    mount();
    expect(screen.queryByRole("button", { name: /Word|PowerPoint/ })).toBeNull();
  });

  it("names the input fields and warns against patient identifiers", () => {
    mount();
    expect(screen.getByLabelText("Prepared by")).toBeInTheDocument();
    expect(screen.getByText(/Do not enter patient identifiers/)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import React from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useReportDocument } from "../useReportDocument";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import type { ReportBuild } from "../../../shared/reportDocument";
import { SettingsProvider } from "../../../context/SettingsContext";

const result: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564" },
  analysis: "",
  ruleBasedInsights: { plausibility: "", acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [{ code: "PP3", reason: "3/6" }], partialEvidence: { available: [], unavailable: [] } },
};

describe("useReportDocument", () => {
  it("hands the screen and the rail the same document, built once, and rebuilds it when the draft changes", () => {
    const seen: ReportBuild[] = [];
    const Probe = () => { seen.push(useReportDocument(result).doc); return null; };
    render(<SettingsProvider><Probe /><Probe /></SettingsProvider>);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);

    act(() => useVariantAnalysisStore.getState().setReportMeta({ title: "Case A" }));
    const [a, b] = seen.slice(-2);
    expect(a).toBe(b);
    expect(a).not.toBe(seen[0]);
    expect(a.title).toBe("Case A");
    act(() => useVariantAnalysisStore.getState().setReportMeta({ title: "" }));
  });

  it("reflects isClinicalLoading independently of isBiophysicalLoading and analysisState.isLoading", () => {
    let latest: ReportBuild | null = null;
    const Probe = () => { latest = useReportDocument(result).doc; return null; };
    render(<SettingsProvider><Probe /></SettingsProvider>);
    expect(latest!.completeness.state).not.toBe("running");

    act(() => useVariantAnalysisStore.getState().setIsClinicalLoading(true));
    expect(latest!.completeness.state).toBe("running");
    act(() => useVariantAnalysisStore.getState().setIsClinicalLoading(false));
  });
});

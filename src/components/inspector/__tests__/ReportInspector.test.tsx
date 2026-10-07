// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportInspector from "../ReportInspector";
import { SettingsProvider } from "../../../context/SettingsContext";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { DEFAULT_REPORT_SECTIONS } from "../../../stores/slices/uiSlice";
import { reportDraftKeys } from "../../../stores/reportDraftStorage";
import { downloadBlob } from "../../report/reportExport";

vi.mock("../../report/reportExport", async () => ({ ...await vi.importActual<typeof import("../../report/reportExport")>("../../report/reportExport"), downloadBlob: vi.fn() }));

const result: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564" },
  analysis: "",
  ruleBasedInsights: { plausibility: "", acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [{ code: "PP3", reason: "3/6" }], partialEvidence: { available: [], unavailable: [] } },
  insights: { acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [{ code: "PP3", reason: "3/6", source: "database_verified" }] },
};

function mount(analysisResult = result) {
  render(
    <SettingsProvider>
      <ReportInspector analysisResult={analysisResult} gene="NAE1" variant="p.Asp116Gly" />
    </SettingsProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const s = useVariantAnalysisStore.getState();
  s.setGene("NAE1"); s.setVariant("p.Asp116Gly"); s.setUniprotId("Q13564");
  s.setReportSections({ ...DEFAULT_REPORT_SECTIONS });
  s.loadReportDraft(null);
  s.setReportDraftRecovery(null);
  s.setNotifications(() => []);
});

describe("ReportInspector", () => {
  it("ticks and unticks any block, identity and classification included", () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Leave out Classification" }));
    expect(useVariantAnalysisStore.getState().reportSections.classification).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Include Classification" })).toBeInTheDocument();
  });

  it("applies the Brief report preset to the ticks only", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Brief report" }));
    const s = useVariantAnalysisStore.getState().reportSections;
    expect(s.classification).toBe(true);
    expect(s.method).toBe(true);
    expect(s.stability).toBe(false);
  });

  it("offers the Word and PowerPoint exports", () => {
    mount();
    expect(screen.getByRole("button", { name: "Download Word (.docx)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PowerPoint (.pptx)" })).toBeInTheDocument();
  });

  it("names the input fields and warns against patient identifiers", () => {
    mount();
    expect(screen.getByLabelText("Prepared by")).toBeInTheDocument();
    expect(screen.getByText(/Do not enter patient identifiers/)).toBeInTheDocument();
  });

  it("saves a portable draft with the same typed transcript identity as browser persistence", () => {
    const resolved = { ...result, transcriptId: "ENST-A", predictorData: { transcriptId: "ENST-B" } };
    mount(resolved);
    fireEvent.click(screen.getByText("Advanced export and drafts"));
    fireEvent.click(screen.getByRole("button", { name: "Save draft file" }));
    const envelope = JSON.parse(vi.mocked(downloadBlob).mock.calls.at(-1)![2] as string);
    expect(envelope.identity).toBe(reportDraftKeys("NAE1", "Q13564", "p.Asp116Gly", resolved).key);
    expect(envelope.identity).toContain("ENST-A");
    expect(envelope.identity).not.toContain("ENST-B");
  });

  it("rejects reopening a draft from a different transcript", async () => {
    const resolved = { ...result, transcriptId: "ENST-A" };
    const draft = { sections: DEFAULT_REPORT_SECTIONS, edits: {}, meta: { title: "Other transcript", preparedBy: "", caseRef: "" }, citations: [] };
    const text = JSON.stringify({ schema: "mse.report-draft/1", identity: reportDraftKeys("NAE1", "Q13564", "p.Asp116Gly", { ...resolved, transcriptId: "ENST-B" }).key, draft });
    const file = new File([text], "draft.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => text });
    mount(resolved);
    fireEvent.change(screen.getByLabelText("Reopen report draft file"), { target: { files: [file] } });
    await waitFor(() => expect(useVariantAnalysisStore.getState().notifications.some(n => n.message.includes("different variant or reference"))).toBe(true));
    expect(useVariantAnalysisStore.getState().reportMeta.title).toBe("");
  });

  it.each(["Keep current draft", "Use saved draft"])("offers both conflicting drafts for download before %s", choice => {
    const resolved = { ...result, transcriptId: "ENST-A" };
    const identity = reportDraftKeys("NAE1", "Q13564", "p.Asp116Gly", resolved);
    const saved = { sections: DEFAULT_REPORT_SECTIONS, edits: {}, meta: { title: "Saved reference draft", preparedBy: "", caseRef: "" }, citations: [] };
    useVariantAnalysisStore.getState().setReportMeta({ title: "Pending author work" });
    useVariantAnalysisStore.getState().setReportDraftRecovery({ identity: identity.key!, sourceKey: identity.baseKey!, saved });
    mount(resolved);
    fireEvent.click(screen.getByRole("button", { name: "Download current draft" }));
    expect(JSON.parse(vi.mocked(downloadBlob).mock.calls.at(-1)![2] as string).draft.meta.title).toBe("Pending author work");
    fireEvent.click(screen.getByRole("button", { name: "Download saved draft" }));
    expect(JSON.parse(vi.mocked(downloadBlob).mock.calls.at(-1)![2] as string).draft.meta.title).toBe("Saved reference draft");
    fireEvent.click(screen.getByRole("button", { name: choice }));
    expect(useVariantAnalysisStore.getState().reportDraftRecovery).toBeNull();
    expect(useVariantAnalysisStore.getState().reportMeta.title).toBe(choice === "Use saved draft" ? "Saved reference draft" : "Pending author work");
  });
});

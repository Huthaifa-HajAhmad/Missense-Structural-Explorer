// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportInspector from "../ReportInspector";
import { SettingsProvider } from "../../../context/SettingsContext";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { DEFAULT_REPORT_SECTIONS } from "../../../stores/slices/uiSlice";
import { BLOCK_ORDER } from "../../../shared/reportDocument";
import { EXPORT_FORMATS } from "../../report/rail/useReportExports";
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
  s.setReportView("document");
});

describe("ReportInspector", () => {
  it("keeps rendering when a run arrives after the empty state", () => {
    // A new run clears the result while the rail stays mounted; the rail must survive both directions.
    const tree = (analysisResult: any) => (
      <SettingsProvider>
        <ReportInspector analysisResult={analysisResult} gene="NAE1" variant="p.Asp116Gly" />
      </SettingsProvider>
    );
    const { rerender } = render(tree(null));
    expect(screen.getByText("Run a variant to build a report.")).toBeInTheDocument();
    rerender(tree(result));
    expect(screen.getByRole("button", { name: "Brief report" })).toBeInTheDocument();
    rerender(tree(null));
    expect(screen.getByText("Run a variant to build a report.")).toBeInTheDocument();
  });

  it("ticks and unticks any block, identity and classification included", () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Classification in export" }));
    expect(useVariantAnalysisStore.getState().reportSections.classification).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Classification in export" })).not.toBeChecked();
  });

  it("applies the Brief report preset to the ticks only", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Brief report" }));
    const s = useVariantAnalysisStore.getState().reportSections;
    expect(s.classification).toBe(true);
    expect(s.method).toBe(true);
    expect(s.stability).toBe(false);
  });

  it("offers every format once, in the export menu", () => {
    mount();
    const menu = screen.getByRole("combobox", { name: /Export report/ });
    expect(within(menu).getAllByRole("option").map(o => o.textContent)).toEqual(EXPORT_FORMATS.map(f => f.label));
    expect(within(menu).getAllByRole("option")).toHaveLength(6);
    expect(screen.queryByText("Other report formats")).toBeNull();
  });

  it("reports one outcome line per export", async () => {
    mount();
    fireEvent.change(screen.getByRole("combobox", { name: /Export report/ }), { target: { value: "json" } });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByText(/^Document \(\.json\) downloaded at /)).toBeInTheDocument();
    expect(vi.mocked(downloadBlob)).toHaveBeenCalledTimes(1);
  });

  it("drops the export outcome line once the document it described has changed", async () => {
    mount();
    fireEvent.change(screen.getByRole("combobox", { name: /Export report/ }), { target: { value: "json" } });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByText(/downloaded at/)).toBeInTheDocument();
    act(() => useVariantAnalysisStore.getState().toggleReportSection("classification"));
    expect(screen.queryByText(/downloaded at/)).toBeNull();
  });

  it("does not say ready when no section is ticked", () => {
    useVariantAnalysisStore.getState().setReportSections(Object.fromEntries(BLOCK_ORDER.map(k => [k, false])) as any);
    mount();
    expect(screen.queryByText("Ready to export. Nothing needs review.")).toBeNull();
    expect(screen.getByText("Nothing is ticked, so an export would be empty.")).toBeInTheDocument();
  });

  it("lists an empty section without an export tick", () => {
    mount();
    expect(screen.queryByRole("checkbox", { name: "Author's notes in export" })).toBeNull();
    expect(screen.getByRole("button", { name: "Go to Author's notes" })).toBeEnabled();
  });

  it("names the input fields and warns against patient identifiers", () => {
    mount();
    expect(screen.getByLabelText("Prepared by")).toBeInTheDocument();
    expect(screen.getByText(/Do not enter patient identifiers/)).toBeInTheDocument();
  });

  it("saves a portable draft with the same typed transcript identity as browser persistence", () => {
    const resolved = { ...result, transcriptId: "ENST-A", predictorData: { transcriptId: "ENST-B" } };
    mount(resolved);
    fireEvent.click(screen.getByText("Evidence bundle, draft files and diagnostics"));
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

  it("clears the conflict banner once a draft file is reopened, so later edits save normally", async () => {
    const resolved = { ...result, transcriptId: "ENST-A" };
    const identity = reportDraftKeys("NAE1", "Q13564", "p.Asp116Gly", resolved);
    const saved = { sections: DEFAULT_REPORT_SECTIONS, edits: {}, meta: { title: "Saved reference draft", preparedBy: "", caseRef: "" }, citations: [] };
    useVariantAnalysisStore.getState().setReportDraftRecovery({ identity: identity.key!, sourceKey: identity.baseKey!, saved });
    const draft = { sections: DEFAULT_REPORT_SECTIONS, edits: {}, meta: { title: "From file", preparedBy: "", caseRef: "" }, citations: [] };
    const text = JSON.stringify({ schema: "mse.report-draft/1", identity: identity.key, draft });
    const file = new File([text], "draft.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => text });
    mount(resolved);
    fireEvent.change(screen.getByLabelText("Reopen report draft file"), { target: { files: [file] } });
    await waitFor(() => expect(useVariantAnalysisStore.getState().reportMeta.title).toBe("From file"));
    expect(useVariantAnalysisStore.getState().reportDraftRecovery).toBeNull();
    expect(screen.queryByRole("button", { name: "Use saved draft" })).toBeNull();
  });

  it("brings a block's part of the document on screen before jumping to it", () => {
    useVariantAnalysisStore.getState().setReportView("evidence");
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Go to Author's notes" }));
    expect(useVariantAnalysisStore.getState().reportView).toBe("writing");
  });

  it("says the report is ready when nothing needs review, and names the reason when something does", () => {
    mount();
    expect(screen.getByText("Ready to export. Nothing needs review.")).toBeInTheDocument();
    cleanup();
    useVariantAnalysisStore.getState().setReportEdit("computational", "Mine.", "an older draft");
    mount();
    expect(screen.getByRole("button", { name: /Computational evidence.*Evidence changed after your edit/ })).toBeInTheDocument();
  });

  it("offers the summary's next step from the shared status model", () => {
    mount();
    expect(screen.getByRole("button", { name: "Configure Gemini" })).toBeInTheDocument();
  });

  it("includes settings weighting and derived consensus context in exported evidence bundles", () => {
    localStorage.setItem("missenseUserSettings", JSON.stringify({ acmgWeighting: "strict" }));
    const s = useVariantAnalysisStore.getState();
    s.setFoldingEnergetics({
      consensusVerdict: "Stale Snapshot",
      evidenceComplete: false,
      pendingTools: ["stabilityoracle"],
      foldx: { status: "done", ddg: 2.9 },
      rasp: { status: "done", ddg: 2.1 },
      thermompnn: { status: "done", ddg: 1.8 },
    } as any);
    try {
      mount();
      fireEvent.click(screen.getByRole("button", { name: "Download Full evidence bundle (.json)" }));
      const bundle = JSON.parse(vi.mocked(downloadBlob).mock.calls.at(-1)![2] as string);
      expect(bundle.provenanceManifest.queryCoordinate.acmgWeighting).toBe("strict");
      expect(bundle.provenanceManifest.verdictSummary.stabilityVerdict).not.toBe("Stale Snapshot");
      expect(bundle.provenanceManifest.verdictSummary.stabilityVerdict).toBeTruthy();
      expect(bundle.provenanceManifest.verdictSummary.stabilityEvidenceComplete).toBe(false);
      expect(bundle.provenanceManifest.verdictSummary.pendingEngines).toEqual(["stabilityoracle"]);
    } finally {
      localStorage.clear();
      s.setFoldingEnergetics(null);
    }
  });
});

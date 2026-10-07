// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { defaultReportSections } from "../../shared/reportDocument";
import { parseReportDraftFile, readReportDraft, reportDraftKey, writeReportDraft } from "../../stores/reportDraftStorage";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { useReportDraftPersistence } from "../report/useReportDocument";

const draft = () => ({ sections: defaultReportSections(), edits: { notes: { text: "", base: "", evidenceId: "snapshot" } }, meta: { title: "Review", preparedBy: "Author", caseRef: "" }, citations: [] });

beforeEach(() => {
  localStorage.clear();
  useVariantAnalysisStore.setState({ analysisState: { result: null, isLoading: false, error: null } });
  useVariantAnalysisStore.getState().loadReportDraft(null);
});

describe("identity-bound report drafts", () => {
  it("round trips a deliberate blank edit and its evidence snapshot", () => {
    const key = reportDraftKey("SOD1", "P00441", "p.Ala5Val", "GRCh38");
    expect(writeReportDraft(key, draft())).toBe(true);
    expect(readReportDraft(key)?.edits.notes).toEqual(draft().edits.notes);
    expect(reportDraftKey("SOD1", "P00441", "p.Ala5Val", "GRCh37")).not.toBe(key);
  });

  it("rejects malformed persisted fields before loading them into the screen", () => {
    for (const invalid of [null, { ...draft(), meta: null }, { ...draft(), sections: [] }, { ...draft(), meta: { title: 42 } }, { ...draft(), edits: { notes: { text: 1, base: "" } } }]) {
      localStorage.setItem("mse.reportDraft.v1:test", JSON.stringify(invalid));
      expect(readReportDraft("test")).toBeNull();
    }
  });

  it("imports only supported, bounded drafts for the same resolved identity", () => {
    const file = JSON.stringify({ schema: "mse.report-draft/1", identity: "variant|GRCh38", draft: draft() });
    expect(parseReportDraftFile(file, "variant|GRCh38")).toEqual(draft());
    expect(() => parseReportDraftFile(file, "variant|GRCh37")).toThrow(/different variant/);
    expect(() => parseReportDraftFile("x".repeat(2_000_001), "variant|GRCh38")).toThrow(/too large/);
    expect(() => parseReportDraftFile("null", "variant|GRCh38")).toThrow(/unsupported/);
  });

  it("flushes pending edits to their original variant during rapid switching", () => {
    vi.useFakeTimers();
    const a = reportDraftKey("SOD1", "P00441", "p.Ala5Val")!;
    const b = reportDraftKey("SOD1", "P00441", "p.Gly94Ala")!;
    writeReportDraft(b, { ...draft(), meta: { ...draft().meta, title: "Variant B" } });
    const { rerender, unmount } = renderHook(({ variant }) => useReportDraftPersistence("SOD1", "P00441", variant), { initialProps: { variant: "p.Ala5Val" } });
    act(() => useVariantAnalysisStore.getState().setReportEdit("notes", "Variant A notes", ""));
    rerender({ variant: "p.Gly94Ala" });
    act(() => vi.advanceTimersByTime(350));
    expect(readReportDraft(a)?.edits.notes?.text).toBe("Variant A notes");
    expect(readReportDraft(b)?.meta.title).toBe("Variant B");
    expect(readReportDraft(b)?.edits.notes?.text).toBe("");
    unmount();
    vi.useRealTimers();
  });

  it("reports session-only persistence when browser storage is blocked", () => {
    vi.useFakeTimers();
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    const { unmount } = renderHook(() => useReportDraftPersistence("SOD1", "P00441", "p.Ala5Val"));
    act(() => vi.advanceTimersByTime(350));
    expect(useVariantAnalysisStore.getState().reportDraftStatus).toBe("session-only");
    unmount();
    blocked.mockRestore();
    vi.useRealTimers();
  });
});

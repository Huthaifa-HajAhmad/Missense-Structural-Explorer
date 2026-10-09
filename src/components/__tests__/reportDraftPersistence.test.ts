// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { defaultReportSections } from "../../shared/reportDocument";
import { parseReportDraftFile, readReportDraft, reportDraftKey, reportDraftKeys, writeReportDraft } from "../../stores/reportDraftStorage";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { useReportDraftPersistence } from "../report/useReportDocument";

const draft = () => ({ sections: defaultReportSections(), edits: { notes: { text: "", base: "", evidenceId: "snapshot" } }, meta: { title: "Review", preparedBy: "Author", caseRef: "" }, citations: [] });
const resolved = (transcriptId = "ENST-A"): any => ({ metadata: { gene: "SOD1", variant: "p.Ala5Val", uniprotId: "P00441" }, transcriptId,
  predictorData: { gnomadVariantAssembly: "GRCh38", gnomadVariantId: "21-31659783-C-T" } });
const keys = (result: any) => reportDraftKeys("SOD1", "P00441", "p.Ala5Val", result);
const setResult = (result: any) => useVariantAnalysisStore.setState({ analysisState: { result, isLoading: false, error: null } });
const currentDraft = () => {
  const s = useVariantAnalysisStore.getState();
  return { sections: s.reportSections, edits: s.reportEdits, meta: s.reportMeta, citations: s.reportCitations };
};

beforeEach(() => {
  localStorage.clear();
  useVariantAnalysisStore.setState({ analysisState: { result: null, isLoading: false, error: null } });
  useVariantAnalysisStore.getState().loadReportDraft(null);
  useVariantAnalysisStore.getState().setReportDraftRecovery(null);
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

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

  it("uses the typed selected transcript, with predictor transcript as fallback, in file and browser identity", () => {
    const a = resolved("ENST-A");
    const b = resolved("ENST-B");
    a.predictorData.transcriptId = "ENST-B";
    expect(keys(a).key).not.toBe(keys(b).key);
    const fallback = { ...a, transcriptId: null };
    expect(keys(fallback).key).toBe(keys(b).key);
    const file = JSON.stringify({ schema: "mse.report-draft/1", identity: keys(a).key, draft: draft() });
    expect(parseReportDraftFile(file, keys(a).key!)).toEqual(draft());
    expect(() => parseReportDraftFile(file, keys(b).key!)).toThrow(/different variant/);
  });

  it("migrates a legacy draft once and does not reuse it for a different transcript", () => {
    const a = resolved();
    const legacy = draft();
    writeReportDraft(keys(a).baseKey, legacy);
    setResult(a);
    const { unmount } = renderHook(() => useReportDraftPersistence("SOD1", "P00441", "p.Ala5Val"));
    expect(currentDraft()).toEqual(legacy);
    expect(readReportDraft(keys(a).key)).toEqual(legacy);
    expect(readReportDraft(keys(a).baseKey)).toBeNull();
    act(() => setResult(resolved("ENST-B")));
    expect(currentDraft().meta.title).toBe("");
    act(() => setResult(a));
    expect(currentDraft()).toEqual(legacy);
    unmount();
  });

  it("recovers drafts saved with the previous missing-transcript reference key", () => {
    const a = resolved();
    writeReportDraft(keys(a).legacyReferenceKey, draft());
    setResult(a);
    const { unmount } = renderHook(() => useReportDraftPersistence("SOD1", "P00441", "p.Ala5Val"));
    expect(currentDraft()).toEqual(draft());
    expect(readReportDraft(keys(a).key)).toEqual(draft());
    expect(readReportDraft(keys(a).legacyReferenceKey)).toBeNull();
    unmount();
  });

  it("preserves all pending author work when the result resolves before the save debounce", () => {
    const { unmount } = renderHook(() => useReportDraftPersistence("SOD1", "P00441", "p.Ala5Val"));
    const pending = { ...draft(), sections: { ...defaultReportSections(), classification: false },
      citations: [{ id: "123", title: "Pinned paper", authors: "Author", journal: "Journal", year: 2026 }] };
    act(() => useVariantAnalysisStore.getState().loadReportDraft(pending));
    act(() => setResult(resolved()));
    expect(currentDraft()).toEqual(pending);
    expect(readReportDraft(keys(resolved()).key)).toEqual(pending);
    unmount();
  });

  it("keeps the same unresolved key when a result returns no reference", () => {
    const { unmount } = renderHook(() => useReportDraftPersistence("SOD1", "P00441", "p.Ala5Val"));
    act(() => useVariantAnalysisStore.getState().loadReportDraft(draft()));
    const noReference: any = { metadata: resolved().metadata };
    act(() => setResult(noReference));
    expect(keys(noReference).key).toBe(keys(null).key);
    expect(currentDraft()).toEqual(draft());
    unmount();
  });

  it("preserves live work when missing reference fields resolve even if storage is blocked", () => {
    const a = resolved();
    const partial = { ...a, predictorData: { ...a.predictorData, gnomadVariantId: null } };
    setResult(partial);
    const { unmount } = renderHook(() => useReportDraftPersistence("SOD1", "P00441", "p.Ala5Val"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    act(() => useVariantAnalysisStore.getState().loadReportDraft(draft()));
    act(() => setResult(a));
    expect(currentDraft()).toEqual(draft());
    unmount();
  });

  it("recovers an old all-null reference draft without creating a new resolved identity", () => {
    const noReference: any = { metadata: resolved().metadata };
    writeReportDraft(keys(noReference).legacyReferenceKey, draft());
    setResult(noReference);
    const { unmount } = renderHook(() => useReportDraftPersistence("SOD1", "P00441", "p.Ala5Val"));
    expect(currentDraft()).toEqual(draft());
    expect(readReportDraft(keys(null).key)).toEqual(draft());
    unmount();
  });

  it("retains the legacy copy and author work if migration storage is blocked", () => {
    const a = resolved();
    writeReportDraft(keys(a).baseKey, draft());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    setResult(a);
    const { unmount } = renderHook(() => useReportDraftPersistence("SOD1", "P00441", "p.Ala5Val"));
    expect(currentDraft()).toEqual(draft());
    expect(readReportDraft(keys(a).baseKey)).toEqual(draft());
    expect(readReportDraft(keys(a).key)).toBeNull();
    unmount();
  });

  it.each(["current", "saved"])("preserves conflicting drafts until the author chooses the %s draft", choice => {
    vi.useFakeTimers();
    const a = resolved();
    const saved = { ...draft(), meta: { ...draft().meta, title: "Existing reference draft" } };
    writeReportDraft(keys(a).key, saved);
    const { unmount } = renderHook(() => useReportDraftPersistence("SOD1", "P00441", "p.Ala5Val"));
    act(() => useVariantAnalysisStore.getState().loadReportDraft(draft()));
    act(() => setResult(a));
    act(() => vi.advanceTimersByTime(350));
    expect(currentDraft()).toEqual(draft());
    expect(readReportDraft(keys(a).key)).toEqual(saved);
    expect(useVariantAnalysisStore.getState().reportDraftRecovery?.saved).toEqual(saved);
    act(() => {
      if (choice === "saved") useVariantAnalysisStore.getState().loadReportDraft(saved);
      useVariantAnalysisStore.getState().setReportDraftRecovery(null);
    });
    act(() => vi.advanceTimersByTime(350));
    expect(readReportDraft(keys(a).key)).toEqual(choice === "saved" ? saved : draft());
    expect(readReportDraft(keys(a).baseKey)).toBeNull();
    unmount();
  });

  it("keeps an unresolved conflict attached to its transcript across switching and remounting", () => {
    vi.useFakeTimers();
    const a = resolved();
    const saved = { ...draft(), meta: { ...draft().meta, title: "Saved reference draft" } };
    writeReportDraft(keys(a).key, saved);
    const hook = renderHook(() => useReportDraftPersistence("SOD1", "P00441", "p.Ala5Val"));
    act(() => useVariantAnalysisStore.getState().loadReportDraft(draft()));
    act(() => setResult(a));
    act(() => setResult(resolved("ENST-B")));
    expect(currentDraft().meta.title).toBe("");
    expect(useVariantAnalysisStore.getState().reportDraftRecovery).toBeNull();
    hook.unmount();
    setResult(a);
    const restored = renderHook(() => useReportDraftPersistence("SOD1", "P00441", "p.Ala5Val"));
    expect(currentDraft()).toEqual(draft());
    expect(useVariantAnalysisStore.getState().reportDraftRecovery?.saved).toEqual(saved);
    expect(readReportDraft(keys(a).key)).toEqual(saved);
    restored.unmount();
  });
});

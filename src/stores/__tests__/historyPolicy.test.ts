// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useVariantAnalysisStore } from "../useVariantAnalysisStore";

const KEY = "variant_search_history";
const stored = () => localStorage.getItem(KEY);
const save = (gene: string, variant: string) =>
  useVariantAnalysisStore.getState().addToHistory({ gene, variant, uniprotId: "" });

describe("search history follows the reader's Settings choice", () => {
  beforeEach(() => {
    localStorage.clear();
    useVariantAnalysisStore.getState().clearHistory();
  });

  it("keeps recents for this tab only while saving is off", () => {
    useVariantAnalysisStore.getState().setHistoryPolicy({ save: false, limit: 5 });
    save("PAH", "p.Arg408Trp");

    expect(useVariantAnalysisStore.getState().history).toHaveLength(1);
    expect(stored()).toBeNull();
  });

  it("removes history already on disk when saving is switched off", () => {
    useVariantAnalysisStore.getState().setHistoryPolicy({ save: true, limit: 5 });
    save("PAH", "p.Arg408Trp");
    expect(stored()).not.toBeNull();

    useVariantAnalysisStore.getState().setHistoryPolicy({ save: false, limit: 5 });
    expect(stored()).toBeNull();
    expect(useVariantAnalysisStore.getState().history).toHaveLength(1);
  });

  it("writes recents to the browser once saving is on, trimmed to the limit", () => {
    useVariantAnalysisStore.getState().setHistoryPolicy({ save: false, limit: 5 });
    save("PAH", "p.Arg408Trp");
    save("BRAF", "p.Val600Glu");
    save("KRAS", "p.Gly12Asp");

    useVariantAnalysisStore.getState().setHistoryPolicy({ save: true, limit: 2 });

    expect(useVariantAnalysisStore.getState().history.map((h) => h.gene)).toEqual(["KRAS", "BRAF"]);
    expect(JSON.parse(stored() ?? "[]")).toHaveLength(2);
  });

  it("applies the limit to new searches", () => {
    useVariantAnalysisStore.getState().setHistoryPolicy({ save: true, limit: 2 });
    save("PAH", "p.Arg408Trp");
    save("BRAF", "p.Val600Glu");
    save("KRAS", "p.Gly12Asp");

    expect(useVariantAnalysisStore.getState().history).toHaveLength(2);
  });

  it("clears the live list and every stored copy, including older storage keys", () => {
    useVariantAnalysisStore.getState().setHistoryPolicy({ save: true, limit: 5 });
    save("PAH", "p.Arg408Trp");
    localStorage.setItem("variantHistory", "[]");
    localStorage.setItem("variantHistoryObfuscated", "x");

    useVariantAnalysisStore.getState().clearHistory();

    expect(useVariantAnalysisStore.getState().history).toEqual([]);
    expect([stored(), localStorage.getItem("variantHistory"), localStorage.getItem("variantHistoryObfuscated")])
      .toEqual([null, null, null]);
  });
});

describe("automatic alert banners follow the reader's Settings choice", () => {
  beforeEach(() => useVariantAnalysisStore.getState().setNotifications([]));
  const messages = () => useVariantAnalysisStore.getState().notifications.map((n) => n.message);

  it("holds back background warnings when automatic banners are off", () => {
    useVariantAnalysisStore.getState().setAutoShowAlerts(false);
    useVariantAnalysisStore.getState().addNotification("warn", "DDMut job failed", { background: true });

    expect(messages()).toEqual([]);
  });

  it("still answers an action the reader just took", () => {
    useVariantAnalysisStore.getState().setAutoShowAlerts(false);
    useVariantAnalysisStore.getState().addNotification("error", "Could not build the Word file.");

    expect(messages()).toEqual(["Could not build the Word file."]);
  });

  it("shows background warnings when automatic banners are on", () => {
    useVariantAnalysisStore.getState().setAutoShowAlerts(true);
    useVariantAnalysisStore.getState().addNotification("warn", "DDMut job failed", { background: true });

    expect(messages()).toEqual(["DDMut job failed"]);
  });
});

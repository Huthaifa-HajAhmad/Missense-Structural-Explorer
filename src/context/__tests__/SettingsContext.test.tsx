// @vitest-environment jsdom
import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SettingsProvider, useSettings } from "../SettingsContext";
import { DEFAULT_USER_SETTINGS } from "../../components/settings/defaults";

function mockMatchMedia(matches: (query: string) => boolean) {
  const impl = (query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  });
  vi.stubGlobal("matchMedia", vi.fn(impl));
}

function renderProbe(onContext: (ctx: ReturnType<typeof useSettings>) => void) {
  function Probe() {
    onContext(useSettings());
    return null;
  }
  return render(
    <SettingsProvider>
      <Probe />
    </SettingsProvider>
  );
}

describe("SettingsContext (settings revamp)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    mockMatchMedia((query) => query.includes("prefers-color-scheme") && query.includes("dark"));
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
  });

  it("merges saved settings over defaults without losing new fields", () => {
    localStorage.setItem(
      "missenseUserSettings",
      JSON.stringify({ residueColor: "#10B981", maxHistoryItems: 20 })
    );
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));
    expect(ctx.settings.residueColor).toBe("#10B981");
    expect(ctx.settings.maxHistoryItems).toBe(20);
    expect(ctx.settings.biophysicsConditions).toEqual(DEFAULT_USER_SETTINGS.biophysicsConditions);
  });

  it("returns the theme to its default on reset, with the other preferences", () => {
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));
    act(() => ctx.setTheme("dark"));
    expect(ctx.theme).toBe("dark");

    act(() => ctx.resetSettingsToDefault());

    expect(ctx.theme).toBe("light");
  });

  it("never persists any credential to localStorage", () => {
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));

    act(() => {
      ctx.updateSetting("japanfoldApiKey", "jf_secret_456");
      ctx.updateSetting("appApiToken", "app-secret");
      ctx.updateSetting("geminiApiKey", "gem-secret");
      ctx.updateSetting("alphagenomeApiKey", "ag-secret-123");
      ctx.updateSetting("alphagenomeApiUrl", "https://custom.alphagenome/v1");
    });

    const persisted = JSON.parse(localStorage.getItem("missenseUserSettings") || "{}");
    expect(persisted.japanfoldApiKey).toBeUndefined();
    expect(persisted.appApiToken).toBeUndefined();
    expect(persisted.geminiApiKey).toBeUndefined();
    expect(persisted.alphagenomeApiKey).toBeUndefined();
    expect(persisted.alphagenomeApiUrl).toBeUndefined();

    // Survive only in transient sessionStorage.
    const transient = JSON.parse(sessionStorage.getItem("missenseTransientCredentials") || "{}");
    expect(transient.japanfoldApiKey).toBe("jf_secret_456");
    expect(transient.appApiToken).toBe("app-secret");
    expect(transient.alphagenomeApiKey).toBe("ag-secret-123");
    expect(transient.alphagenomeApiUrl).toBe("https://custom.alphagenome/v1");
  });

  it("scrubs legacy plaintext credentials and retired settings (GPN-MSA, Biohub, ESMFold, Tamarind) from localStorage on load", () => {
    localStorage.setItem(
      "missenseUserSettings",
      JSON.stringify({ gpnApiUrl: "leaked", hfToken: "leaked-too", biohubApiToken: "bio-leaked", tamarindApiKey: "tam-leaked", defaultStructureModel: "esmfold", maxHistoryItems: 10 })
    );
    renderProbe(() => {});
    const persisted = JSON.parse(localStorage.getItem("missenseUserSettings") || "{}");
    expect(persisted.gpnApiUrl).toBeUndefined();
    expect(persisted.hfToken).toBeUndefined();
    expect(persisted.biohubApiToken).toBeUndefined();
    expect(persisted.tamarindApiKey).toBeUndefined();
    expect(persisted.defaultStructureModel).toBeUndefined();
    expect(persisted.maxHistoryItems).toBe(10);
  });

  it("scrubs retired Biohub and Tamarind tokens that an older release left in session storage", () => {
    sessionStorage.setItem(
      "missenseTransientCredentials",
      JSON.stringify({ biohubApiToken: "bio-old", tamarindApiKey: "tam-old", japanfoldApiKey: "jf-keep" })
    );
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));
    expect(ctx.settings.japanfoldApiKey).toBe("jf-keep");
    expect((ctx.settings as unknown as Record<string, unknown>).tamarindApiKey).toBeUndefined();
    expect(sessionStorage.getItem("missenseTransientCredentials")).not.toContain("biohubApiToken");
    expect(sessionStorage.getItem("missenseTransientCredentials")).not.toContain("tamarindApiKey");
    // A later credential write must not bring them back.
    act(() => ctx.updateSetting("japanfoldApiKey", "jf-new"));
    const stored = JSON.parse(sessionStorage.getItem("missenseTransientCredentials") || "{}");
    expect(stored.biohubApiToken).toBeUndefined();
    expect(stored.tamarindApiKey).toBeUndefined();
    expect(stored.japanfoldApiKey).toBe("jf-new");
  });

  it("reset restores the full defaults object and wipes transient credentials", () => {
    localStorage.setItem("missenseUserSettings", JSON.stringify({ residueColor: "#101010" }));
    sessionStorage.setItem(
      "missenseTransientCredentials",
      JSON.stringify({ appApiToken: "app-secret" })
    );
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));

    act(() => {
      ctx.updateSetting("residueColor", "#EC4899");
      ctx.resetSettingsToDefault();
    });

    expect(ctx.settings).toEqual(DEFAULT_USER_SETTINGS);
    expect(sessionStorage.getItem("missenseTransientCredentials")).toBeNull();
    const persisted = JSON.parse(localStorage.getItem("missenseUserSettings") || "{}");
    expect(persisted.residueColor).toBe(DEFAULT_USER_SETTINGS.residueColor);
    expect(persisted.japanfoldApiKey).toBeUndefined();
  });

  it("lands on light for a first-time visitor, even when the OS prefers dark", () => {
    // The OS is mocked dark in this suite's beforeEach: first-run must still be light, because
    // a first impression gets persisted to `theme` on first render and would outlive the visit.
    expect(localStorage.getItem("theme")).toBeNull();
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));
    expect(ctx.theme).toBe("light");
    expect(ctx.isDark).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("keep a stored theme — an explicit choice always wins over the first-run default", () => {
    localStorage.setItem("theme", "dark");
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));
    expect(ctx.theme).toBe("dark");
    expect(ctx.isDark).toBe(true);
  });

  it("resolves theme=system against the OS color scheme", () => {
    mockMatchMedia((query) => query.includes("prefers-color-scheme") && query.includes("dark"));
    localStorage.setItem("theme", "system");
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));
    expect(ctx.theme).toBe("system");
    expect(ctx.isDark).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("resolves theme=system to light when the OS prefers light", () => {
    mockMatchMedia(() => false);
    localStorage.setItem("theme", "system");
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));
    expect(ctx.isDark).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("maps legacy tab ids to their redesigned sections", () => {
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));

    act(() => ctx.openSettingsTab("api"));
    expect(ctx.settingsTab).toBe("connections");
    expect(ctx.isSettingsOpen).toBe(true);

    act(() => ctx.setIsSettingsOpen(false));
    act(() => ctx.openSettingsTab("biophysics"));
    expect(ctx.settingsTab).toBe("analysis");
  });

  it("applySettings merges a partial import and strips credential injection", () => {
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));

    act(() => {
      ctx.applySettings({
        maxHistoryItems: 50,
        appApiToken: "injected-secret",
        biophysicsConditions: { ph: 8.0, temperature: 30, ionicStrength: 200 }
      });
    });

    expect(ctx.settings.maxHistoryItems).toBe(50);
    expect(ctx.settings.appApiToken).toBe("");
    expect(ctx.settings.biophysicsConditions.ph).toBe(8);
    const persisted = JSON.parse(localStorage.getItem("missenseUserSettings") || "{}");
    expect(persisted.appApiToken).toBeUndefined();
    expect(persisted.__autoZoomMigrated).toBe(true);
  });

  it("preserves imported autoZoomOnSelect and showAtomInteractions across remounts", () => {
    let ctx!: ReturnType<typeof useSettings>;
    const first = renderProbe((c) => (ctx = c));

    act(() => {
      ctx.applySettings({ autoZoomOnSelect: true, showAtomInteractions: false });
    });

    expect(ctx.settings.autoZoomOnSelect).toBe(true);
    expect(ctx.showPolarContacts).toBe(false);
    first.unmount();

    // Remount from persisted storage: imported autoZoomOnSelect must not be re-migrated back to false
    let remounted!: ReturnType<typeof useSettings>;
    const second = renderProbe((c) => (remounted = c));
    expect(remounted.settings.autoZoomOnSelect).toBe(true);
    expect(remounted.showPolarContacts).toBe(false);
    second.unmount();
  });

  it("migrates legacy autoZoomOnSelect once and strips internal migration marker from state", () => {
    localStorage.setItem("missenseUserSettings", JSON.stringify({ autoZoomOnSelect: true }));
    let ctx!: ReturnType<typeof useSettings>;
    const view = renderProbe((c) => (ctx = c));
    expect(ctx.settings.autoZoomOnSelect).toBe(false);
    expect((ctx.settings as unknown as Record<string, unknown>).__autoZoomMigrated).toBeUndefined();
    const persisted = JSON.parse(localStorage.getItem("missenseUserSettings") || "{}");
    expect(persisted.__autoZoomMigrated).toBe(true);
    expect(persisted.autoZoomOnSelect).toBe(false);
    view.unmount();
  });
});

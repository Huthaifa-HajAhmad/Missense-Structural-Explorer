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
  render(
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
    expect(ctx.settings.defaultPerturbationModel).toBe(DEFAULT_USER_SETTINGS.defaultPerturbationModel);
    expect(ctx.settings.biophysicsConditions).toEqual(DEFAULT_USER_SETTINGS.biophysicsConditions);
  });

  it("never persists any credential — including hf and gpnApiUrl — to localStorage", () => {
    let ctx!: ReturnType<typeof useSettings>;
    renderProbe((c) => (ctx = c));

    act(() => {
      ctx.updateSetting("gpnApiUrl", "https://custom.endpoint/predict");
      ctx.updateSetting("hfToken", "hf_secret_456");
      ctx.updateSetting("appApiToken", "app-secret");
      ctx.updateSetting("geminiApiKey", "gem-secret");
      ctx.updateSetting("biohubApiToken", "bio-secret");
    });

    const persisted = JSON.parse(localStorage.getItem("missenseUserSettings") || "{}");
    expect(persisted.gpnApiUrl).toBeUndefined();
    expect(persisted.hfToken).toBeUndefined();
    expect(persisted.appApiToken).toBeUndefined();
    expect(persisted.geminiApiKey).toBeUndefined();
    expect(persisted.biohubApiToken).toBeUndefined();

    // Survive only in transient sessionStorage.
    const transient = JSON.parse(sessionStorage.getItem("missenseTransientCredentials") || "{}");
    expect(transient.gpnApiUrl).toBe("https://custom.endpoint/predict");
    expect(transient.hfToken).toBe("hf_secret_456");
    expect(transient.appApiToken).toBe("app-secret");
  });

  it("scrubs legacy plaintext credentials from localStorage on load", () => {
    localStorage.setItem(
      "missenseUserSettings",
      JSON.stringify({ gpnApiUrl: "leaked", hfToken: "leaked-too", maxHistoryItems: 10 })
    );
    renderProbe(() => {});
    const persisted = JSON.parse(localStorage.getItem("missenseUserSettings") || "{}");
    expect(persisted.gpnApiUrl).toBeUndefined();
    expect(persisted.hfToken).toBeUndefined();
    expect(persisted.maxHistoryItems).toBe(10);
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
    expect(persisted.hfToken).toBeUndefined();
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
  });
});

// @vitest-environment jsdom
/**
 * Settings → Data & storage: the history row counts the live Recents list and clears it on screen,
 * and the lab-server purge is offered only to someone the server will let run it.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { account } = vi.hoisted(() => ({
  account: { accountsEnabled: false, user: null as null | { role: string } },
}));
vi.mock("../../../context/AccountContext", () => ({ useOptionalAccount: () => account }));
vi.mock("../../../lib/download", () => ({ downloadBlob: vi.fn() }));
vi.mock("../../../hooks/useDiagnostics", () => ({
  useDiagnostics: () => ({ diagnostics: null, loading: false, lastCheckFailed: false, refresh: () => {} }),
}));

import { DataStorageSection } from "../sections/DataStorageSection";
import { SettingsProvider } from "../../../context/SettingsContext";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";

const renderSection = () =>
  render(
    <SettingsProvider>
      <DataStorageSection />
    </SettingsProvider>
  );

beforeEach(() => {
  localStorage.clear();
  account.accountsEnabled = false;
  account.user = null;
  useVariantAnalysisStore.getState().clearHistory();
  useVariantAnalysisStore.getState().setHistoryPolicy({ save: false, limit: 5 });
});

describe("DataStorageSection", () => {
  it("counts the Recents on screen and empties them when cleared", () => {
    useVariantAnalysisStore.getState().addToHistory({ gene: "PAH", variant: "p.Arg408Trp", uniprotId: "" });
    renderSection();
    expect(screen.getByText(/1 recent search · kept until you reload/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear" }));

    expect(useVariantAnalysisStore.getState().history).toEqual([]);
    expect(screen.getByText(/0 recent searches/)).toBeTruthy();
  });

  it("hides the lab-server purge from a signed-in member", () => {
    account.accountsEnabled = true;
    account.user = { role: "member" };
    renderSection();
    expect(screen.queryByRole("button", { name: /purge server caches/i })).toBeNull();
  });

  it("offers the purge to an admin and names what it removes for everyone", () => {
    account.accountsEnabled = true;
    account.user = { role: "admin" };
    renderSection();
    expect(screen.getByRole("button", { name: /purge server caches/i })).toBeTruthy();
    expect(screen.getByText(/job list for every user/)).toBeTruthy();
  });

  it("marks a failed action as an error, not a success", async () => {
    account.accountsEnabled = true;
    account.user = { role: "admin" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) }));
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: /purge server caches/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm purge/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Forbidden");
    vi.unstubAllGlobals();
  });

  it("keeps an error on screen when an earlier success note's timer runs out", async () => {
    account.accountsEnabled = true;
    account.user = { role: "admin" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) }));
    vi.useFakeTimers();
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: /purge server caches/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm purge/i }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("alert").textContent).toContain("Forbidden");

    // The export note's 4-second timer must not clear the error that replaced it.
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole("alert").textContent).toContain("Forbidden");
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

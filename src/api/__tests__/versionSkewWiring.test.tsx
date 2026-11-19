// @vitest-environment jsdom
import React from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApiClient } from "../../apiClient";
import { SettingsProvider } from "../../context/SettingsContext";
import { appVersionWatch } from "../../lib/appVersionWatch";

/** The request wrapper reports every answered app request, so a refusal can be checked against the server's version. */
describe("fetchWithAuth reports answers to the version watch", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(SettingsProvider, null, children);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("passes the status of a same-origin answer", async () => {
    const note = vi.spyOn(appVersionWatch, "noteRejectedRequest").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 400 }))));
    const { result } = renderHook(() => useApiClient(), { wrapper });
    await result.current.fetchWithAuth("/api/v1/analyze-variant-narrative", { method: "POST", body: "{}" });
    expect(note).toHaveBeenCalledWith(400);
  });

  it("leaves a third-party answer alone", async () => {
    const note = vi.spyOn(appVersionWatch, "noteRejectedRequest").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 400 }))));
    const { result } = renderHook(() => useApiClient(), { wrapper });
    await result.current.fetchWithAuth("https://example.org/data");
    expect(note).not.toHaveBeenCalled();
  });
});

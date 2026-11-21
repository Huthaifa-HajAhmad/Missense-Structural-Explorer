// @vitest-environment jsdom
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApiConnections } from "../useApiConnections";
import { SettingsProvider, useSettings } from "../../context/SettingsContext";

const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
const useHarness = () => ({ ...useApiConnections(), ...useSettings() });
const reply = (body: unknown) => vi.fn().mockResolvedValue({ status: 200, text: async () => JSON.stringify(body) });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("useApiConnections", () => {
  it("shows the provider's own reason when a key is refused", async () => {
    vi.stubGlobal("fetch", reply({ valid: false, message: "Tamarind rejected this key (401)." }));
    const { result } = renderHook(useHarness, { wrapper });
    act(() => result.current.updateSetting("tamarindApiKey", "bad-key"));

    await act(() => result.current.runTest("tamarind"));

    expect(result.current.tests.tamarind.status).toEqual({ valid: false, message: "Tamarind rejected this key (401)." });
  });

  it("drops a result once the key it was about is edited", async () => {
    vi.stubGlobal("fetch", reply({ valid: true, message: "Token is valid." }));
    const { result } = renderHook(useHarness, { wrapper });
    act(() => result.current.updateSetting("biohubApiToken", "bh_one"));
    await act(() => result.current.runTest("biohub"));
    expect(result.current.tests.biohub.status?.valid).toBe(true);

    act(() => result.current.updateSetting("biohubApiToken", "bh_two"));

    await waitFor(() => expect(result.current.tests.biohub.status).toBeNull());
  });

  it("drops an AlphaGenome result once the endpoint it was about is edited", async () => {
    vi.stubGlobal("fetch", reply({ ok: true, latencyMs: 12 }));
    const { result } = renderHook(useHarness, { wrapper });
    act(() => {
      result.current.updateSetting("alphagenomeApiKey", "ag_key");
      result.current.updateSetting("alphagenomeApiUrl", "https://ag-one.example.org");
    });
    await act(() => result.current.runTest("alphagenome"));
    expect(result.current.tests.alphagenome.status?.valid).toBe(true);

    act(() => result.current.updateSetting("alphagenomeApiUrl", "https://ag-two.example.org"));

    await waitFor(() => expect(result.current.tests.alphagenome.status).toBeNull());
  });
});

// @vitest-environment jsdom
import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractErrorMessage, useApiClient } from "./apiClient";
import { SettingsProvider } from "./context/SettingsContext";

describe("extractErrorMessage Unit Tests", () => {
  it("extracts nested error.message from standardized backend JSON error", async () => {
    const res = new Response(
      JSON.stringify({
        error: {
          code: "BAD_GATEWAY",
          message: "Sequence length (875 aa) exceeds the public ESM Atlas limit of 400 aa. De novo folding for proteins > 400 aa requires an EvolutionaryScale/Biohub API token."
        }
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" }
      }
    );

    const msg = await extractErrorMessage(res, "Failed to run ESMFold");
    expect(msg).toBe("Sequence length (875 aa) exceeds the public ESM Atlas limit of 400 aa. De novo folding for proteins > 400 aa requires an EvolutionaryScale/Biohub API token.");
  });

  it("extracts top-level message field", async () => {
    const res = new Response(
      JSON.stringify({ message: "Sidecar model weight download timed out." }),
      {
        status: 504,
        headers: { "Content-Type": "application/json" }
      }
    );

    const msg = await extractErrorMessage(res, "Failed to run ESMFold");
    expect(msg).toBe("Sidecar model weight download timed out.");
  });

  it("extracts detail field from FastAPI style JSON", async () => {
    const res = new Response(
      JSON.stringify({ detail: "Unprocessable entity in coordinate file." }),
      {
        status: 422,
        headers: { "Content-Type": "application/json" }
      }
    );

    const msg = await extractErrorMessage(res, "Failed to align structures");
    expect(msg).toBe("Unprocessable entity in coordinate file.");
  });

  it("extracts string error field", async () => {
    const res = new Response(
      JSON.stringify({ error: "Invalid amino acid residue." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    );

    const msg = await extractErrorMessage(res, "Failed to translate variant");
    expect(msg).toBe("Invalid amino acid residue.");
  });

  it("extracts plain text response without JSON parsing crash", async () => {
    const res = new Response("upstream connect error or disconnect/reset before headers", {
      status: 503,
      headers: { "Content-Type": "text/plain" }
    });

    const msg = await extractErrorMessage(res, "Failed to run ESMFold");
    expect(msg).toBe("upstream connect error or disconnect/reset before headers");
  });

  it("provides clean HTTP status fallback without trailing colon when body is empty", async () => {
    const res = new Response("", {
      status: 502,
      statusText: ""
    });

    const msg = await extractErrorMessage(res, "Failed to run ESMFold");
    expect(msg).toBe("Failed to run ESMFold (HTTP 502)");
    expect(msg).not.toContain("Failed to run ESMFold:");
  });
});

describe("useApiClient getSidecarHealth", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(SettingsProvider, null, children);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls /api/v1/sidecar-health and parses successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reachable: true,
        baseUrl: "http://127.0.0.1:8000",
        latencyMs: 42,
        status: "healthy",
        modelLoaded: true,
        activeModels: 2
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiClient(), { wrapper });
    const health = await result.current.apiClient.getSidecarHealth();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/sidecar-health",
      expect.objectContaining({ timeout: 5000 })
    );
    expect(health.reachable).toBe(true);
    expect(health.status).toBe("healthy");
    expect(health.modelLoaded).toBe(true);
    expect(health.activeModels).toBe(2);
    expect(health.latencyMs).toBe(42);
  });

  it("returns reachable false with HTTP status on non-ok responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers({ "content-type": "text/plain" }),
      json: async () => { throw new Error("not json"); },
      text: async () => "Service Unavailable"
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiClient(), { wrapper });
    const health = await result.current.apiClient.getSidecarHealth();

    expect(health.reachable).toBe(false);
    expect(health.error).toBe("Health check failed with HTTP 503");
  });
});

describe("useApiClient Domain Methods & Delegation", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(SettingsProvider, null, children);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("findPocket delegates targetIndex and mutIndex parameters to detectPocket", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        pocketResidues: [],
        pocketScore: 0.88,
        pocketVolume: 450,
        likelyCofactor: "HEME",
        pocketDistance: 3.5,
        status: "success"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiClient(), { wrapper });
    const pocket = await result.current.apiClient.findPocket({
      pdbText: "ATOM...",
      mutIndex: 42,
      targetChain: "A"
    });

    expect(pocket.status).toBe("success");
    expect(pocket.pocketScore).toBe(0.88);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/pocket-detect",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"targetIndex":42')
      })
    );
  });

  it("fetchWithAuth attaches and removes signal abort listeners cleanly without leaking", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiClient(), { wrapper });
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    await result.current.fetchWithAuth("/api/v1/test-signal", {
      timeout: 5000,
      signal: controller.signal
    });

    expect(addSpy).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("does not attach internal auth tokens to protocol-relative URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiClient(), { wrapper });
    await result.current.fetchWithAuth("//attacker.com/api/probe");

    const calledHeaders = fetchMock.mock.calls[0][1]?.headers || {};
    expect(calledHeaders["Authorization"]).toBeUndefined();
    expect(calledHeaders["X-Gemini-Session-ID"]).toBeUndefined();
  });

  it("auto-renews expired session and immediately attaches X-Gemini-Session-ID to outgoing request", async () => {
    sessionStorage.setItem(
      "missenseTransientCredentials",
      JSON.stringify({
        geminiApiKey: "AIzaSyTestKey123",
        geminiSessionId: "old-expired-token",
        geminiSessionExpiresAt: Date.now() - 60000 // expired 1 minute ago
      })
    );

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/v1/session/keys") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sessionId: "fresh-renewed-session-token",
              expiresAt: Date.now() + 15 * 60 * 1000
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ analysis: "Valid analysis", insights: {} }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiClient(), { wrapper });

    await result.current.fetchWithAuth("/api/v1/analyze-variant-narrative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gene: "GZF1", variant: "p.Arg591Trp" })
    });

    // Should call /api/v1/session/keys to renew
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/session/keys",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ apiKey: "AIzaSyTestKey123" })
      })
    );

    // The actual narrative request MUST contain the fresh session token
    const narrativeCall = fetchMock.mock.calls.find((call: any[]) =>
      call[0] === "/api/v1/analyze-variant-narrative"
    );
    expect(narrativeCall).toBeDefined();
    const narrativeHeaders = narrativeCall?.[1]?.headers || {};
    expect(narrativeHeaders["X-Gemini-Session-ID"]).toBe("fresh-renewed-session-token");
  });
});


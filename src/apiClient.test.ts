// @vitest-environment jsdom
import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractErrorMessage, useApiClient } from "./apiClient";
import { SettingsProvider } from "./context/SettingsContext";
import { clearInvalidApiKey } from "./api/authSession";

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
    sessionStorage.clear();
    clearInvalidApiKey();
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

    // The 5s budget is enforced INSIDE fetchWithRetry (per-attempt timer + abort signal), so it
    // must NOT be forwarded into RequestInit — the previous assertion pinned exactly that leak.
    const sidecarCall = fetchMock.mock.calls.find(([url]) => url === "/api/v1/sidecar-health");
    expect(sidecarCall).toBeDefined();
    const init = sidecarCall![1] as RequestInit;
    expect(init).toBeDefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init).not.toHaveProperty("timeout");
    expect(init).not.toHaveProperty("deadlineAt");
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

  it("deduplicates concurrent proactive refresh calls within 60s of token expiry", async () => {
    const expiresSoon = Date.now() + 30000; // 30s to expiry (< 60s)
    sessionStorage.setItem(
      "missenseTransientCredentials",
      JSON.stringify({
        geminiApiKey: "AIzaSyTestKey123",
        geminiSessionId: "expiring-session-token",
        geminiSessionExpiresAt: expiresSoon
      })
    );

    let refreshCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/v1/session/refresh") {
        refreshCallCount++;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sessionId: "deduped-refreshed-token",
              expiresAt: Date.now() + 15 * 60 * 1000
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ analysis: "Analysis OK", insights: {} }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiClient(), { wrapper });

    // Fire 3 concurrent requests while token is near expiry
    await Promise.all([
      result.current.fetchWithAuth("/api/v1/analyze-variant-narrative"),
      result.current.fetchWithAuth("/api/v1/analyze-variant-narrative"),
      result.current.fetchWithAuth("/api/v1/analyze-variant-narrative")
    ]);

    // Proactive refresh must only be called ONCE despite 3 concurrent requests
    expect(refreshCallCount).toBe(1);
  });

  it("clearInvalidApiKey unblocks auto-authentication after a 403 rejection", async () => {
    sessionStorage.setItem(
      "missenseTransientCredentials",
      JSON.stringify({
        geminiApiKey: "RejectedKey123",
        geminiSessionId: "",
        geminiSessionExpiresAt: 0
      })
    );

    let sessionCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/v1/session/keys") {
        sessionCalls++;
        if (sessionCalls === 1) {
          return Promise.resolve(new Response(JSON.stringify({ error: "Invalid key" }), { status: 403 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ sessionId: "unblocked-session", expiresAt: Date.now() + 900000 }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiClient(), { wrapper });

    // First request triggers 403 and blacklists key
    await result.current.fetchWithAuth("/api/v1/analyze-variant-narrative");
    expect(sessionCalls).toBe(1);

    // Second request skipped because key is in invalidApiKeys
    await result.current.fetchWithAuth("/api/v1/analyze-variant-narrative");
    expect(sessionCalls).toBe(1);

    // User edits or relinks key, which clears blacklist
    clearInvalidApiKey("RejectedKey123");

    // Third request can now re-authenticate
    await result.current.fetchWithAuth("/api/v1/analyze-variant-narrative");
    expect(sessionCalls).toBe(2);
  });

  it("re-authenticates and retries on 401 for relative endpoints when appApiToken is unset", async () => {
    sessionStorage.setItem(
      "missenseTransientCredentials",
      JSON.stringify({
        geminiApiKey: "AIzaSyKey401",
        geminiSessionId: "expired-on-server",
        geminiSessionExpiresAt: Date.now() + 600000
      })
    );

    let attempt = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/v1/session/keys") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ sessionId: "recovered-session", expiresAt: Date.now() + 900000 }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (url === "/api/v1/custom-endpoint") {
        attempt++;
        if (attempt === 1) {
          return Promise.resolve(new Response("Unauthorized", { status: 401 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiClient(), { wrapper });
    const res = await result.current.fetchWithAuth("/api/v1/custom-endpoint");
    expect(res.status).toBe(200);
    expect(attempt).toBe(2);
  });

  it("normalizes options.headers when passed as a Headers instance", async () => {
    sessionStorage.setItem(
      "missenseTransientCredentials",
      JSON.stringify({
        geminiApiKey: "AIzaSyKeyHeader",
        geminiSessionId: "valid-session",
        geminiSessionExpiresAt: Date.now() + 600000
      })
    );

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useApiClient(), { wrapper });
    const customHeaders = new Headers();
    customHeaders.set("X-Custom-Client", "UnitTester");

    await result.current.fetchWithAuth("/api/v1/analyze-variant-narrative", {
      headers: customHeaders
    });

    const narrativeCall = fetchMock.mock.calls.find((call: any[]) =>
      call[0] === "/api/v1/analyze-variant-narrative"
    );
    expect(narrativeCall).toBeDefined();
    const calledHeaders = narrativeCall?.[1]?.headers || {};
    expect(calledHeaders["x-custom-client"]).toBe("UnitTester");
    expect(calledHeaders["X-Gemini-Session-ID"]).toBe("valid-session");
  });
});


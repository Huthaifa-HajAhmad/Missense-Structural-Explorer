// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDiagnostics, DIAGNOSTICS_POLL_MS } from "../useDiagnostics";
import { useAppVersion } from "../useAppVersion";

const healthy = { status: "ok", timestamp: "t", foldxReady: true, geminiReady: false, modelServerReady: true, serviceHealth: {} };
const jsonRes = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as any;

describe("the one health reading", () => {
  let calls: Record<string, number>;
  let answer: (url: string) => Promise<any>;

  const drain = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  beforeEach(() => {
    vi.useFakeTimers();
    calls = { diagnostics: 0, capabilities: 0, version: 0 };
    answer = async url => jsonRes(url.includes("diagnostics") ? healthy : { status: "ok", engines: [] });
    vi.stubGlobal("fetch", vi.fn((url: any) => {
      const u = String(url);
      for (const key of Object.keys(calls)) if (u.includes(key)) calls[key] += 1;
      return answer(u);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("makes one request however many components read it", async () => {
    renderHook(() => useDiagnostics());
    renderHook(() => useDiagnostics());
    await drain();
    expect(calls.diagnostics).toBe(1);
  });

  it("shows every reader the same refresh", async () => {
    const a = renderHook(() => useDiagnostics());
    const b = renderHook(() => useDiagnostics());
    await drain();
    answer = async url => jsonRes(url.includes("diagnostics") ? { ...healthy, foldxReady: false } : { engines: [] });
    await act(async () => { await a.result.current.refresh(); });
    expect(b.result.current.diagnostics?.foldxReady).toBe(false);
  });

  it("re-checks on a schedule while a live reader is mounted", async () => {
    renderHook(() => useDiagnostics({ live: true }));
    await drain();
    await drain(DIAGNOSTICS_POLL_MS);
    expect(calls.diagnostics).toBe(2);
  });

  it("does not poll for a reader that only needs one reading", async () => {
    renderHook(() => useDiagnostics());
    await drain();
    await drain(DIAGNOSTICS_POLL_MS * 3);
    expect(calls.diagnostics).toBe(1);
  });

  it("stops polling while the browser tab is hidden, and re-checks on return", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderHook(() => useDiagnostics({ live: true }));
    await drain();
    await drain(DIAGNOSTICS_POLL_MS * 2);
    expect(calls.diagnostics).toBe(1);

    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await drain();
    expect(calls.diagnostics).toBe(2);
    visibility.mockRestore();
  });

  it("says when the reading was taken", async () => {
    const { result } = renderHook(() => useDiagnostics());
    await drain();
    expect(result.current.checkedAt).toBe(Date.now());
    expect(result.current.lastCheckFailed).toBe(false);
  });

  it("marks the reading as failed when a re-check fails, and keeps it visible", async () => {
    const { result } = renderHook(() => useDiagnostics());
    await drain();
    const firstCheck = result.current.checkedAt;
    answer = async () => jsonRes({}, 502);
    await drain(5000);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.lastCheckFailed).toBe(true);
    expect(result.current.diagnostics).not.toBeNull();
    expect(result.current.checkedAt).toBe(firstCheck);
    expect(result.current.error).toMatch(/502/);
  });

  it("shows the health reading without waiting for the slower capabilities call", async () => {
    let finishCapabilities!: (r: unknown) => void;
    answer = url => url.includes("capabilities")
      ? new Promise(resolve => { finishCapabilities = resolve; })
      : Promise.resolve(jsonRes(healthy));
    const { result } = renderHook(() => useDiagnostics());
    await drain();
    expect(result.current.diagnostics).not.toBeNull();
    expect(result.current.loading).toBe(false);
    await act(async () => { finishCapabilities(jsonRes({ status: "ok", engines: [{ id: "x" }] })); });
    expect(result.current.capabilities?.engines).toHaveLength(1);
  });

  it("says the Ensembl fallback verdict is still pending while follow-ups remain", async () => {
    answer = async url => jsonRes(url.includes("diagnostics")
      ? { ...healthy, serviceHealth: { ensembl: { healthy: false, latencyMs: 1, message: "x", timestamp: "t" } } }
      : { engines: [] });
    const { result } = renderHook(() => useDiagnostics());
    await drain();
    expect(result.current.coveragePending).toBe(true);
    await drain(200_000);
    expect(result.current.coveragePending).toBe(false);
  });

  it("reads the version without running the health checks", async () => {
    answer = async () => jsonRes({ version: "2.0.0", env: "test" });
    const { result } = renderHook(() => useAppVersion());
    await drain();
    expect(calls.diagnostics).toBe(0);
    expect(calls.capabilities).toBe(0);
    expect(calls.version).toBe(1);
    expect(result.current).toEqual({ version: "2.0.0", env: "test" });
  });
});

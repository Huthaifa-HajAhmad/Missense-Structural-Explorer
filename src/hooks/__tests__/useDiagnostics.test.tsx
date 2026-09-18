// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDiagnostics } from "../useDiagnostics";

/**
 * The server reports fallback coverage from a probe it does not block /diagnostics on, so the
 * first payload after a primary outage carries no verdict. These tests cover the one bounded
 * follow-up fetch that collects it — and, just as importantly, that it stays bounded.
 */

const ensemblDown = { healthy: false, latencyMs: 3802, message: "timeout", timestamp: "t" };
const fallbackReady = {
  id: "variant-validator",
  name: "VariantValidator",
  healthy: true,
  latencyMs: 900,
  message: "Resolved MACO1 probe",
  timestamp: "t"
};

const diagPayload = (ensembl: Record<string, unknown>) => ({
  status: "ok",
  timestamp: "t",
  foldxReady: false,
  geminiReady: false,
  modelServerReady: false,
  serviceHealth: { ensembl }
});

const jsonRes = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as any;

describe("useDiagnostics — degraded coverage follow-up", () => {
  let diagCalls = 0;
  let ensemblPayer: () => Record<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    diagCalls = 0;
    ensemblPayer = () => ensemblDown;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes("/diagnostics")) {
          diagCalls += 1;
          return jsonRes(diagPayload(ensemblPayer()));
        }
        if (u.includes("/version")) return jsonRes({ version: "1.0.0", env: "test" });
        return jsonRes({ status: "ok", engines: [] });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("issues exactly one follow-up fetch, then stops", async () => {
    // First poll: primary down, verdict not known yet. Every later poll: verdict available.
    ensemblPayer = () => ensemblDown;
    const { result } = renderHook(() => useDiagnostics());

    await act(async () => {});
    expect(diagCalls).toBe(1);
    expect(result.current.diagnostics?.serviceHealth?.ensembl.fallback).toBeUndefined();

    ensemblPayer = () => ({ ...ensemblDown, fallback: fallbackReady });
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });

    expect(diagCalls).toBe(2);
    expect(result.current.diagnostics?.serviceHealth?.ensembl.fallback).toMatchObject({ healthy: true });

    // Must not become a polling loop.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(diagCalls).toBe(2);
  });

  it("does not follow up when the primary is healthy", async () => {
    ensemblPayer = () => ({ healthy: true, latencyMs: 16, message: "ok", timestamp: "t" });
    renderHook(() => useDiagnostics());

    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(diagCalls).toBe(1);
  });

  it("does not follow up when a verdict already arrived with the first payload", async () => {
    ensemblPayer = () => ({ ...ensemblDown, fallback: fallbackReady });
    renderHook(() => useDiagnostics());

    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(diagCalls).toBe(1);
  });

  it("stops after one attempt even if the verdict never arrives", async () => {
    ensemblPayer = () => ensemblDown;
    renderHook(() => useDiagnostics());

    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(diagCalls).toBe(2);

    // Second payload still has no verdict, but the guard is spent until coverage changes.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(diagCalls).toBe(2);
  });
});

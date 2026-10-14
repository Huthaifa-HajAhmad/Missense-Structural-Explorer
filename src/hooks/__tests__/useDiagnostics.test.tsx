// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDiagnostics } from "../useDiagnostics";

/**
 * The server reports fallback coverage from a probe it deliberately does not block /diagnostics
 * on, so the first payload after a primary outage carries no verdict. These tests cover the
 * escalating follow-up fetches that collect it — and, just as importantly, that they stay bounded.
 */

const ensemblDown = { healthy: false, latencyMs: 3802, message: "timeout", timestamp: "t" };
const fallbackReady = {
  id: "variant-validator",
  name: "VariantValidator",
  healthy: true,
  verdict: "ready",
  latencyMs: 900,
  message: "Resolved MACO1 probe",
  timestamp: "t",
  ageMs: 0,
  stale: false,
};

const diagPayload = (ensembl: Record<string, unknown>) => ({
  status: "ok",
  timestamp: "t",
  foldxReady: false,
  geminiReady: false,
  modelServerReady: false,
  serviceHealth: { ensembl },
});

const jsonRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as any;

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

  /**
   * Advances fake time AND drains the promise chain each timer starts.
   * `advanceTimersByTime` alone fires the timer but leaves the resulting fetch/schedule work
   * pending, so only the first follow-up ever appeared to run.
   */
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("keeps retrying on the escalating schedule until the verdict lands", async () => {
    // The one-shot 1.5s retry this replaces fired long before a 15s-budget probe could answer,
    // then latched — so the row stayed on the neutral "Offline" pill for the whole session, in
    // exactly the outage the feature exists for. Here coverage only resolves on the fourth poll,
    // which is past where the old single retry gave up.
    const { result } = renderHook(() => useDiagnostics());

    await act(async () => {});
    expect(diagCalls).toBe(1);
    expect(result.current.diagnostics?.serviceHealth?.ensembl.fallback).toBeUndefined();

    ensemblPayer = () => (diagCalls >= 4 ? { ...ensemblDown, fallback: fallbackReady } : ensemblDown);
    await advance(1500);
    expect(diagCalls).toBe(2);
    await advance(4000);
    expect(diagCalls).toBe(3);
    expect(result.current.diagnostics?.serviceHealth?.ensembl.fallback).toBeUndefined();
    await advance(8000);

    expect(diagCalls).toBe(4);
    expect(result.current.diagnostics?.serviceHealth?.ensembl.fallback).toMatchObject({ verdict: "ready" });
  });

  it("never becomes a polling loop", async () => {
    renderHook(() => useDiagnostics());

    await act(async () => {});
    // Walk well past the whole schedule in the worst case: no verdict ever arrives.
    await advance(200_000);

    // One initial fetch plus exactly the four scheduled follow-ups.
    expect(diagCalls).toBe(5);

    await advance(200_000);
    expect(diagCalls).toBe(5);
  });

  it("does not follow up when the primary is healthy", async () => {
    ensemblPayer = () => ({ healthy: true, latencyMs: 16, message: "ok", timestamp: "t" });
    renderHook(() => useDiagnostics());

    await act(async () => {});
    await advance(120_000);

    expect(diagCalls).toBe(1);
  });

  it("does not follow up when a verdict already arrived with the first payload", async () => {
    ensemblPayer = () => ({ ...ensemblDown, fallback: fallbackReady });
    renderHook(() => useDiagnostics());

    await act(async () => {});
    await advance(120_000);

    expect(diagCalls).toBe(1);
  });

  it("cancels the pending follow-up on unmount", async () => {
    const { unmount } = renderHook(() => useDiagnostics());

    await act(async () => {});
    expect(diagCalls).toBe(1);

    unmount();
    await advance(120_000);

    // A leaked timer would issue requests from a dead component.
    expect(diagCalls).toBe(1);
  });

  it("resets follow-up attempts when manually refreshed", async () => {
    const { result } = renderHook(() => useDiagnostics());

    await act(async () => {});
    // Exhaust all 4 follow-ups (5 calls total)
    await advance(200_000);
    expect(diagCalls).toBe(5);

    // Manual refresh should trigger call 6 and allow follow-ups again
    await act(async () => {
      await result.current.refresh();
    });
    expect(diagCalls).toBe(6);

    // Advance to schedule follow-up
    await advance(1500);
    expect(diagCalls).toBe(7);
  });

  it("safely combines signals when AbortSignal.any is not supported", async () => {
    const originalAny = AbortSignal.any;
    try {
      // Simulate environment without AbortSignal.any
      delete (AbortSignal as any).any;

      const { result } = renderHook(() => useDiagnostics());
      await act(async () => {});
      expect(diagCalls).toBe(1);

      const ext = new AbortController();
      await act(async () => {
        await result.current.refresh(ext.signal);
      });
      expect(diagCalls).toBe(2);
    } finally {
      AbortSignal.any = originalAny;
    }
  });
});

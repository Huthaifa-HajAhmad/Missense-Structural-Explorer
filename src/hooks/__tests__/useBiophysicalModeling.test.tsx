// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { useBiophysicalModeling } from "../useBiophysicalModeling";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { DevConsoleProvider } from "../../context/DevConsoleContext";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DevConsoleProvider>{children}</DevConsoleProvider>
);

describe("useBiophysicalModeling Hook State Binding", () => {
  beforeEach(() => {
    useVariantAnalysisStore.getState().resetVariantAnalysisState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("automatically initiates DynaMut2 polling when Zustand store receives job ID and status", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "DONE",
        prediction: -0.387,
        consensusVerdict: "Low Misfolding Risk"
      })
    });

    const addNotification = vi.fn();
    const apiClient = {};
    const settings = {} as any;

    renderHook(
      () => useBiophysicalModeling(settings, addNotification, apiClient, fetchWithAuth),
      { wrapper }
    );

    // Initially, no polling occurs
    expect(fetchWithAuth).not.toHaveBeenCalled();

    // Now variant analysis pipeline dispatches job ID and pending status into Zustand
    act(() => {
      useVariantAnalysisStore.getState().setDynamut2Status("pending");
      useVariantAnalysisStore.getState().setDynamut2JobId("178931919574");
    });

    // Advance timer for useJobPoller
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Poller should have called the endpoint
    expect(fetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/dynamut2-job/178931919574"), { signal: expect.any(AbortSignal) }
    );

    // Zustand store should be updated with the completed prediction!
    const state = useVariantAnalysisStore.getState();
    expect(state.dynamut2Status).toBe("done");
    expect(state.foldingEnergetics?.dynamut2).toBe(-0.387);
    // The verdict is RECOMPUTED from the merged values, not copied from the poll response (the route
    // no longer sends one, and a copied verdict froze at the FoldX commit). DynaMut2's native −0.387 is
    // canonical +0.387: below its moderate mark, and the only engine with a value.
    expect(state.foldingEnergetics?.consensusVerdict).toBe("No Destabilization (Single-Engine Estimate)");
    expect(state.foldingEnergetics?.consensusEnginesCounted).toBe(1);
  });

  it("automatically initiates DDMut polling when Zustand store receives job ID and status", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "DONE",
        prediction: -0.45
      })
    });

    const addNotification = vi.fn();
    const apiClient = {};
    const settings = {} as any;

    renderHook(
      () => useBiophysicalModeling(settings, addNotification, apiClient, fetchWithAuth),
      { wrapper }
    );

    act(() => {
      useVariantAnalysisStore.getState().setDdmutStatus("pending");
      useVariantAnalysisStore.getState().setDdmutJobId("17893192007005534");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(fetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/ddmut-job/17893192007005534"), { signal: expect.any(AbortSignal) }
    );

    const state = useVariantAnalysisStore.getState();
    expect(state.ddmutStatus).toBe("done");
    expect(state.foldingEnergetics?.ddmut).toBe(-0.45);
  });

  it("does not carry one job's 'still listening' flag onto a retried job", async () => {
    /**
     * Job 1 enters the slow "keep listening" mode (the provider answered UNAVAILABLE but retryable),
     * which sets `dynamut2Listening` on the run record. A retry swaps the job id WITHOUT first
     * ending the old poll, and the flag path used to survive it — the engine detail then read
     * "Still listening" over a freshly queued request. The flag must be cleared on the job-id
     * change; the new job sets it again only if IT goes silent.
     */
    const fetchWithAuth = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "UNAVAILABLE", retryable: true, error: "Provider did not answer." }),
    });
    const addNotification = vi.fn();
    const apiClient = {};
    const settings = {} as any;

    // A value on the record first, so `setFoldingEnergetics` merges instead of ignoring an empty run.
    useVariantAnalysisStore.getState().setFoldingEnergetics({ foldx: 2.5, foldxMean: 2.5 });

    renderHook(() => useBiophysicalModeling(settings, addNotification, apiClient, fetchWithAuth), { wrapper });

    act(() => {
      useVariantAnalysisStore.getState().setDynamut2Status("pending");
      useVariantAnalysisStore.getState().setDynamut2JobId("job-one");
    });

    // The transient failure turns the poll into listening mode and raises the flag.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(useVariantAnalysisStore.getState().foldingEnergetics?.dynamut2Listening).toBe(true);

    // A retry: fresh job id for the same engine.
    act(() => {
      useVariantAnalysisStore.getState().setDynamut2JobId("job-two");
    });
    expect(useVariantAnalysisStore.getState().foldingEnergetics?.dynamut2Listening).toBe(false);

    // The new job starts clean and may enter listening again — for itself.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(useVariantAnalysisStore.getState().dynamut2Status).toBe("pending");
    expect(fetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/dynamut2-job/job-two"),
      expect.anything()
    );
  });

  it("clears polling status and job ID when clearDynaMutPoll and clearDdmutPoll are invoked on abort", async () => {
    const fetchWithAuth = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "RUNNING", prediction: null })
    }));
    const addNotification = vi.fn();
    const apiClient = {};
    const settings = {} as any;

    const { result } = renderHook(
      () => useBiophysicalModeling(settings, addNotification, apiClient, fetchWithAuth),
      { wrapper }
    );

    act(() => {
      useVariantAnalysisStore.getState().setDynamut2Status("pending");
      useVariantAnalysisStore.getState().setDynamut2JobId("178931919574");
      useVariantAnalysisStore.getState().setDdmutStatus("pending");
      useVariantAnalysisStore.getState().setDdmutJobId("17893192007005534");
    });

    // Advance by 100ms so initial poll triggers
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const callsBeforeAbort = fetchWithAuth.mock.calls.length;
    expect(callsBeforeAbort).toBeGreaterThan(0);

    // Call cleanup functions as abortAllPendingRequests would
    act(() => {
      result.current.clearDynaMutPoll();
      result.current.clearDdmutPoll();
    });

    const state = useVariantAnalysisStore.getState();
    expect(state.dynamut2Status).toBeNull();
    expect(state.dynamut2JobId).toBeNull();
    expect(state.ddmutStatus).toBeNull();
    expect(state.ddmutJobId).toBeNull();

    // Advance timers - no further calls should be made since status was reset and poller aborted
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(fetchWithAuth.mock.calls.length).toBe(callsBeforeAbort);
  });
});

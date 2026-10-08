// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useJobPoller } from "../useJobPoller";

describe("useJobPoller Hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not poll if status is not pending or jobId is null", () => {
    const fetchMock = vi.fn();
    renderHook(() =>
      useJobPoller({
        jobId: null,
        status: null,
        endpoint: id => `/api/v1/job/${id}`,
        toolName: "DynaMut2",
        fetchWithAuth: fetchMock,
        onSuccess: vi.fn(),
        onStatusChange: vi.fn()
      })
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("polls and succeeds when job completes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "DONE", prediction: -1.25 })
    });

    const onSuccess = vi.fn();
    const onStatusChange = vi.fn();
    const notifyOnce = vi.fn();

    renderHook(() =>
      useJobPoller({
        jobId: "job-123",
        status: "pending",
        endpoint: id => `/api/v1/dynamut2-job/${id}`,
        toolName: "DynaMut2",
        fetchWithAuth: fetchMock,
        onSuccess,
        onStatusChange,
        notifyOnce
      })
    );

    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/dynamut2-job/job-123", { signal: expect.any(AbortSignal) });
    expect(onStatusChange).toHaveBeenCalledWith("done");
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ status: "DONE", prediction: -1.25 }));
    expect(notifyOnce).toHaveBeenCalledWith("DynaMut2_job-123_done", "success", expect.any(String));
  });

  it("handles HTTP 503 unavailability cleanly", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "Service unavailable" })
    });

    const onStatusChange = vi.fn();
    const onToolFailed = vi.fn();
    const notifyOnce = vi.fn();

    renderHook(() =>
      useJobPoller({
        jobId: "job-456",
        status: "pending",
        endpoint: id => `/api/v1/ddmut-job/${id}`,
        toolName: "DDMut",
        fetchWithAuth: fetchMock,
        onSuccess: vi.fn(),
        onStatusChange,
        onToolFailed,
        notifyOnce
      })
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);

    // Three transient failures no longer end the job: it keeps listening.
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(onToolFailed).not.toHaveBeenCalled();

    // The listening window closes at 5 minutes and only then is the engine unavailable.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(onStatusChange).toHaveBeenCalledWith("unavailable");
    expect(onToolFailed).toHaveBeenCalledWith("DDMut");
    expect(notifyOnce).toHaveBeenCalledWith("DDMut_job-456_unavailable", "error", expect.any(String));
  });

  it("handles real-time SSE stream job completion immediately", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {})); // hung request

    const instances: any[] = [];
    class MockEventSource {
      url: string;
      onmessage: ((e: any) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      close = vi.fn();
      constructor(url: string) {
        this.url = url;
        instances.push(this);
      }
    }
    (window as any).EventSource = MockEventSource;

    const onSuccess = vi.fn();
    const onStatusChange = vi.fn();

    renderHook(() =>
      useJobPoller({
        jobId: "sse-job-789",
        status: "pending",
        endpoint: id => `/api/v1/dynamut2-job/${id}`,
        toolName: "DynaMut2",
        fetchWithAuth: fetchMock,
        onSuccess,
        onStatusChange
      })
    );

    expect(instances.length).toBe(1);
    expect(instances[0].url).toBe("/api/v1/jobs/events?jobs=sse-job-789");

    // Simulate SSE broadcast
    if (instances[0].onmessage) {
      instances[0].onmessage({
        data: JSON.stringify({
          type: "job_update",
          jobId: "sse-job-789",
          status: "DONE",
          result: { prediction: -2.1 }
        })
      });
    }

    expect(onStatusChange).toHaveBeenCalledWith("done");
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ prediction: -2.1 }));
  });
});

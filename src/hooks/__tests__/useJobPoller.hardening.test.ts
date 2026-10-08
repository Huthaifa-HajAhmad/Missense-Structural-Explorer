// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useJobPoller } from "../useJobPoller";

const originalEventSource = window.EventSource;
const streams: any[] = [];
class TestEventSource {
  onmessage: ((event: any) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(_url: string) { streams.push(this); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
function config(fetchWithAuth: any) {
  return { jobId: "123", status: "pending", endpoint: (id: string) => "/jobs/" + id,
    toolName: "DynaMut2", fetchWithAuth, onSuccess: vi.fn(), onStatusChange: vi.fn(),
    onError: vi.fn(), onToolFailed: vi.fn(), maxElapsedMs: 10000 };
}
beforeEach(() => {
  vi.useFakeTimers();
  streams.length = 0;
  window.EventSource = TestEventSource as any;
});
afterEach(() => {
  window.EventSource = originalEventSource;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("remote job terminal-state safety", () => {
  it("terminates a hung HTTP request at the wall-clock deadline and closes SSE", async () => {
    const fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    const options = config(fetch);
    renderHook(() => useJobPoller(options));
    await vi.advanceTimersByTimeAsync(10000);
    expect(options.onStatusChange).toHaveBeenCalledExactlyOnceWith("unavailable");
    expect(options.onError).toHaveBeenCalledWith(expect.stringContaining("timed out"));
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(streams[0].close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60000);
    expect(options.onStatusChange).toHaveBeenCalledOnce();
  });
  it("settles SSE UNAVAILABLE immediately and ignores the late HTTP response", async () => {
    const response = deferred<any>();
    const options = config(vi.fn().mockReturnValue(response.promise));
    renderHook(() => useJobPoller(options));
    streams[0].onmessage({ data: JSON.stringify({ type: "job_update", jobId: "123", status: "UNAVAILABLE", error: "Provider still queued after 5 minutes" }) });
    response.resolve({ ok: true, status: 200, json: async () => ({ status: "DONE", prediction: 1 }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onStatusChange).toHaveBeenCalledExactlyOnceWith("unavailable");
    expect(options.onError).toHaveBeenCalledWith("Provider still queued after 5 minutes");
    expect(options.onSuccess).not.toHaveBeenCalled();
  });
  it("keeps listening after a retryable UNAVAILABLE and adopts a later DONE", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "UNAVAILABLE", retryable: true, reason: "transient", error: "upstream down" }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "DONE", prediction: -1.5 }) });
    const options = { ...config(fetch), onListening: vi.fn(), maxElapsedMs: 600000 };
    renderHook(() => useJobPoller(options));
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onListening).toHaveBeenCalledOnce();
    expect(options.onStatusChange).not.toHaveBeenCalled();
    expect(streams[0].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(45000);
    expect(options.onStatusChange).toHaveBeenCalledExactlyOnceWith("done");
    expect(options.onSuccess).toHaveBeenCalledWith(expect.objectContaining({ prediction: -1.5 }));
  });
  it("treats a stale UNAVAILABLE as terminal even if marked retryable", async () => {
    const options = config(vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "UNAVAILABLE", reason: "stale", retryable: false, error: "5-minute window" }) }));
    renderHook(() => useJobPoller(options));
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onStatusChange).toHaveBeenCalledExactlyOnceWith("unavailable");
  });
  it("listens on an SSE retryable UNAVAILABLE and stops at the listening window", async () => {
    const options = { ...config(vi.fn().mockReturnValue(new Promise(() => {}))), onListening: vi.fn(), maxElapsedMs: 600000 };
    renderHook(() => useJobPoller(options));
    streams[0].onmessage({ data: JSON.stringify({ type: "job_update", jobId: "123", status: "UNAVAILABLE", retryable: true, error: "blip" }) });
    expect(options.onListening).toHaveBeenCalledOnce();
    expect(options.onStatusChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(options.onStatusChange).toHaveBeenCalledExactlyOnceWith("unavailable");
  });
  it("does not apply a decoded old-job response after switching jobs", async () => {
    const body = deferred<any>();
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => body.promise })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "DONE", prediction: 2 }) });
    const options = config(fetch);
    const { rerender } = renderHook(({ jobId }) => useJobPoller({ ...options, jobId }), { initialProps: { jobId: "123" } });
    await vi.advanceTimersByTimeAsync(0);
    rerender({ jobId: "456" });
    body.resolve({ status: "DONE", prediction: 99 });
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onSuccess).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ prediction: 2 }));
  });
  it.each([null, undefined, NaN, Infinity])("rejects a completed job without a finite prediction (%s)", async prediction => {
    const options = config(vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "DONE", prediction }) }));
    renderHook(() => useJobPoller(options));
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onStatusChange).toHaveBeenCalledExactlyOnceWith("error");
    expect(options.onError).toHaveBeenCalledWith(expect.stringContaining("finite prediction"));
    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(streams[0].close).toHaveBeenCalledOnce();
  });
  it("preserves a measured zero and closes polling immediately", async () => {
    const options = config(vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "DONE", prediction: 0 }) }));
    renderHook(() => useJobPoller(options));
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onSuccess).toHaveBeenCalledWith(expect.objectContaining({ prediction: 0 }));
    expect(streams[0].close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10000);
    expect(options.onStatusChange).toHaveBeenCalledExactlyOnceWith("done");
  });
  it("reports an expired job ID as an error rather than polling forever", async () => {
    const options = config(vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    renderHook(() => useJobPoller(options));
    await vi.advanceTimersByTimeAsync(10000);
    expect(options.onStatusChange).toHaveBeenCalledExactlyOnceWith("error");
    expect(options.onError).toHaveBeenCalledWith(expect.stringContaining("HTTP 404"));
    expect(options.fetchWithAuth).toHaveBeenCalledOnce();
  });
  it("does not write or notify after unmounting a pending request", async () => {
    const response = deferred<any>();
    const options = config(vi.fn().mockReturnValue(response.promise));
    const { unmount } = renderHook(() => useJobPoller(options));
    unmount();
    response.resolve({ ok: true, status: 200, json: async () => ({ status: "DONE", prediction: 1 }) });
    await vi.advanceTimersByTimeAsync(20000);
    expect(options.onStatusChange).not.toHaveBeenCalled();
    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(options.fetchWithAuth.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

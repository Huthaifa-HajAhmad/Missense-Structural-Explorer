import { useEffect, useRef } from "react";

export interface JobPollerConfig<TData = any, TStatus = string> {
  jobId: string | null;
  status: TStatus | null;
  endpoint: (jobId: string) => string;
  toolName: string;
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  buildQueryParams?: () => URLSearchParams | undefined;
  onSuccess: (data: TData) => void;
  onStatusChange: (status: any) => void;
  onError?: (errMessage: string) => void;
  onToolFailed?: (toolName: string) => void;
  /** Fired once when a transient failure turns the poll into slow "keep listening" mode. */
  onListening?: (message: string) => void;
  notifyOnce?: (key: string, type: "warn" | "error" | "success" | "info", message: string) => void;
  maxAttempts?: number;
  maxElapsedMs?: number;
  /** Longest a job is listened for after a transient failure — mirrors the server's staleness window. */
  listenWindowMs?: number;
  listenIntervalMs?: number;
}

export function useJobPoller<TData = any>({
  jobId,
  status,
  endpoint,
  toolName,
  fetchWithAuth,
  buildQueryParams,
  onSuccess,
  onStatusChange,
  onError,
  onToolFailed,
  onListening,
  notifyOnce,
  maxAttempts = 60,
  maxElapsedMs = 10 * 60 * 1000,
  listenWindowMs = 5 * 60 * 1000,
  listenIntervalMs = 45 * 1000
}: JobPollerConfig<TData>) {
  const endpointRef = useRef(endpoint);
  endpointRef.current = endpoint;
  const fetchWithAuthRef = useRef(fetchWithAuth);
  fetchWithAuthRef.current = fetchWithAuth;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onToolFailedRef = useRef(onToolFailed);
  onToolFailedRef.current = onToolFailed;
  const onListeningRef = useRef(onListening);
  onListeningRef.current = onListening;
  const notifyOnceRef = useRef(notifyOnce);
  notifyOnceRef.current = notifyOnce;
  const buildQueryParamsRef = useRef(buildQueryParams);
  buildQueryParamsRef.current = buildQueryParams;
  const currentJobRef = useRef(jobId);
  currentJobRef.current = jobId;
  const currentStatusRef = useRef(status);
  currentStatusRef.current = status;

  useEffect(() => {
    if (status !== "pending" || !jobId) return;

    let attempt = 0;
    let stopped = false;
    let consecutiveTransientErrors = 0;
    let listening = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let deadlineId: ReturnType<typeof setTimeout> | undefined;
    let eventSource: EventSource | null = null;
    const controller = new AbortController();
    const pollStart = Date.now();

    const stop = () => {
      stopped = true;
      clearTimeout(timeoutId);
      clearTimeout(deadlineId);
      eventSource?.close();
      controller.abort();
    };
    const finish = (nextStatus: "done" | "error" | "unavailable", error?: string) => {
      if (stopped) return false;
      if (currentJobRef.current !== jobId || currentStatusRef.current !== "pending") {
        stop();
        return false;
      }
      stop();
      if (error) {
        console.warn(`[useJobPoller] ${error}`);
        onErrorRef.current?.(error);
      }
      onStatusChangeRef.current(nextStatus);
      if (nextStatus !== "done") onToolFailedRef.current?.(toolName);
      notifyOnceRef.current?.(`${toolName}_${jobId}_${nextStatus === "done" ? "done" : nextStatus === "unavailable" ? "unavailable" : "failed"}`, nextStatus === "done" ? "success" : "error",
        nextStatus === "done" ? `${toolName} prediction completed.` : `${toolName} prediction failed: ${error || "No result returned"}`);
      return true;
    };
    /**
     * A transient failure (one upstream poll that did not answer, or three failed HTTP polls) does not
     * end the job: it may still be running upstream. Keep the stream open and poll slowly until the
     * server calls it stale or the listening window closes. Returns true when it ended the poll instead.
     */
    const enterListening = (reason: string): boolean => {
      if (stopped) return true;
      if (listening) return false;
      const remaining = Math.min(maxElapsedMs, listenWindowMs) - (Date.now() - pollStart);
      if (remaining <= 0) {
        finish("unavailable", `${toolName} did not recover: ${reason}`);
        return true;
      }
      listening = true;
      consecutiveTransientErrors = 0;
      clearTimeout(deadlineId);
      deadlineId = setTimeout(() => finish("unavailable", `${toolName} did not recover within the listening window: ${reason}`), remaining);
      onListeningRef.current?.(reason);
      notifyOnceRef.current?.(`${toolName}_${jobId}_listening`, "info",
        `${toolName} did not answer in time — still listening; the value will appear if it arrives.`);
      return false;
    };
    const consume = (data: any): boolean => {
      const normStatus = typeof data?.status === "string" ? data.status.toUpperCase() : "";
      if (["DONE", "SUCCESS", "COMPLETED"].includes(normStatus)) {
        const result = data.result ?? data;
        if (typeof result?.prediction !== "number" || !Number.isFinite(result.prediction)) {
          finish("error", `${toolName} reported completion without a finite prediction`);
        } else if (finish("done")) {
          onSuccessRef.current(result);
        }
        return true;
      }
      if (normStatus === "UNAVAILABLE" && data.retryable === true && data.reason !== "stale") {
        return enterListening(data.error || `${toolName} provider did not answer.`);
      }
      if (["ERROR", "FAILED", "UNAVAILABLE"].includes(normStatus)) {
        finish(normStatus === "UNAVAILABLE" ? "unavailable" : "error",
          data.error || data.result?.error || `${toolName} provider reported ${normStatus} without diagnostics`);
        return true;
      }
      return false;
    };
    deadlineId = setTimeout(() => finish("unavailable", `${toolName} prediction timed out after ${Math.round(maxElapsedMs / 1000)} seconds`), maxElapsedMs);

    if (typeof window !== "undefined" && typeof window.EventSource !== "undefined") {
      try {
        eventSource = new EventSource(`/api/v1/jobs/events?jobs=${encodeURIComponent(jobId)}`);
        eventSource.onmessage = event => {
          if (stopped) return;
          let data: any;
          try { data = JSON.parse(event.data); } catch { return; }
          if (data.type === "job_update" && data.jobId === jobId) consume(data);
        };
        eventSource.onerror = () => {
          eventSource?.close();
          eventSource = null;
        };
      } catch {
        eventSource = null;
      }
    }

    const getBackoffDelay = (attempts: number) => listening ? listenIntervalMs : attempts < 5 ? 3000 : attempts < 15 ? 5000 : 10000;
    const poll = async () => {
      if (stopped) return;
      if ((!listening && attempt >= maxAttempts) || Date.now() - pollStart >= maxElapsedMs) {
        finish("unavailable", `${toolName} prediction timed out (poll limit reached)`);
        return;
      }
      try {
        const query = buildQueryParamsRef.current?.()?.toString();
        const url = endpointRef.current(jobId) + (query ? "?" + query : "");
        const response = await fetchWithAuthRef.current(url, { signal: controller.signal });
        if (stopped) return;
        if ([429, 502, 503, 504].includes(response.status)) {
          if (++consecutiveTransientErrors >= 3 && enterListening(`${toolName} predictor is currently unavailable (HTTP ${response.status}).`)) return;
        } else if (!response.ok) {
          finish("error", `${toolName} job lookup failed (HTTP ${response.status})`);
          return;
        } else {
          const data = await response.json();
          if (stopped) return;
          consecutiveTransientErrors = 0;
          if (consume(data)) return;
          const state = typeof data?.status === "string" ? data.status.toUpperCase() : "";
          // UNAVAILABLE only survives consume() when it was a retryable answer, i.e. we are listening.
          if (!["PENDING", "QUEUED", "RUNNING", "PROCESSING", "UNAVAILABLE"].includes(state)) {
            finish("error", `${toolName} returned an invalid job status: ${state || "missing"}`);
            return;
          }
        }
      } catch (error: any) {
        if (stopped) return;
        if (++consecutiveTransientErrors >= 3 && enterListening(`${toolName} job polling failed: ${error?.message || "Network error"}.`)) return;
      }
      if (!stopped) timeoutId = setTimeout(poll, getBackoffDelay(++attempt));
    };
    void poll();
    return stop;
  }, [jobId, status, toolName, maxAttempts, maxElapsedMs, listenWindowMs, listenIntervalMs]);
}

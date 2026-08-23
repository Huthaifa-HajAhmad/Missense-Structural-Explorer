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
  notifyOnce?: (key: string, type: "warn" | "error" | "success" | "info", message: string) => void;
  maxAttempts?: number;
  maxElapsedMs?: number;
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
  notifyOnce,
  maxAttempts = 60,
  maxElapsedMs = 10 * 60 * 1000
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
  const notifyOnceRef = useRef(notifyOnce);
  notifyOnceRef.current = notifyOnce;
  const buildQueryParamsRef = useRef(buildQueryParams);
  buildQueryParamsRef.current = buildQueryParams;

  useEffect(() => {
    if (status !== "pending" || !jobId) return;

    let attempt = 0;
    let isAborted = false;
    let timeoutId: any = null;
    let eventSource: EventSource | null = null;
    const pollStart = Date.now();

    // 1. Real-time SSE stream for instant push updates (B5 / N2)
    if (typeof window !== "undefined" && typeof window.EventSource !== "undefined") {
      try {
        eventSource = new EventSource(`/api/v1/jobs/events?jobs=${encodeURIComponent(jobId)}`);
        eventSource.onmessage = (event) => {
          if (isAborted) return;
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.type === "job_update" && parsed.jobId === jobId) {
              const normStatus = (parsed.status || "").toUpperCase();
              if (normStatus === "DONE" || normStatus === "SUCCESS" || normStatus === "COMPLETED") {
                isAborted = true;
                if (timeoutId) clearTimeout(timeoutId);
                if (eventSource) eventSource.close();
                onStatusChangeRef.current("done");
                onSuccessRef.current(parsed.result || parsed);
                if (notifyOnceRef.current) {
                  notifyOnceRef.current(`${toolName}_${jobId}_done`, "success", `${toolName} prediction completed.`);
                }
              } else if (normStatus === "ERROR" || normStatus === "FAILED") {
                isAborted = true;
                if (timeoutId) clearTimeout(timeoutId);
                if (eventSource) eventSource.close();
                onStatusChangeRef.current(toolName === "ThermoMPNN" ? "error" : "unavailable");
                if (onErrorRef.current && parsed.error) onErrorRef.current(parsed.error);
                if (onToolFailedRef.current) onToolFailedRef.current(toolName);
                if (notifyOnceRef.current) {
                  notifyOnceRef.current(`${toolName}_${jobId}_failed`, "error", `${toolName} prediction failed${parsed.error ? `: ${parsed.error}` : "."}`);
                }
              }
            }
          } catch {
            // Ignore non-JSON SSE frames (e.g. heartbeat pings)
          }
        };
        eventSource.onerror = () => {
          // Graceful fallback to HTTP backoff poller if SSE disconnects
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
        };
      } catch {
        // EventSource unavailable, fallback to HTTP polling
      }
    }

    const getBackoffDelay = (att: number) => {
      if (att < 5) return 3000;
      if (att < 15) return 5000;
      return 10000;
    };

    let consecutiveTransientErrors = 0;
    const MAX_CONSECUTIVE_TRANSIENT_ERRORS = 3;

    const poll = async () => {
      if (isAborted) return;

      if (attempt >= maxAttempts || Date.now() - pollStart > maxElapsedMs) {
        onStatusChangeRef.current("unavailable");
        if (onToolFailedRef.current) onToolFailedRef.current(toolName);
        if (notifyOnceRef.current) {
          notifyOnceRef.current(`${toolName}_${jobId}_timeout`, "warn", `${toolName} prediction timed out (max poll attempts reached).`);
        }
        return;
      }

      try {
        const queryParams = buildQueryParamsRef.current ? buildQueryParamsRef.current() : undefined;
        const qStr = queryParams && queryParams.toString() ? `?${queryParams.toString()}` : "";
        const url = `${endpointRef.current(jobId)}${qStr}`;

        const res = await fetchWithAuthRef.current(url);
        if (isAborted) return;

        if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
          consecutiveTransientErrors++;
          if (consecutiveTransientErrors >= MAX_CONSECUTIVE_TRANSIENT_ERRORS) {
            onStatusChangeRef.current("unavailable");
            if (onToolFailedRef.current) onToolFailedRef.current(toolName);
            if (notifyOnceRef.current) {
              notifyOnceRef.current(`${toolName}_${jobId}_unavailable`, "error", `${toolName} predictor is currently unavailable (HTTP ${res.status}).`);
            }
            return;
          }
          // Allow retry with backoff for transient gateway/overload responses
          attempt++;
          timeoutId = setTimeout(poll, getBackoffDelay(attempt));
          return;
        }

        consecutiveTransientErrors = 0;

        if (res.ok) {
          const data = await res.json();
          const normStatus = (data.status || "").toUpperCase();

          if (normStatus === "DONE" || normStatus === "SUCCESS" || normStatus === "COMPLETED") {
            onStatusChangeRef.current("done");
            onSuccessRef.current(data);
            if (notifyOnceRef.current) {
              notifyOnceRef.current(`${toolName}_${jobId}_done`, "success", `${toolName} prediction completed.`);
            }
            return;
          } else if (normStatus === "UNAVAILABLE") {
            onStatusChangeRef.current("unavailable");
            if (onErrorRef.current && data.error) onErrorRef.current(data.error);
            if (onToolFailedRef.current) onToolFailedRef.current(toolName);
            return;
          } else if (normStatus === "ERROR" || normStatus === "FAILED") {
            onStatusChangeRef.current(toolName === "ThermoMPNN" ? "error" : "unavailable");
            if (onErrorRef.current && data.error) onErrorRef.current(data.error);
            if (onToolFailedRef.current) onToolFailedRef.current(toolName);
            if (notifyOnceRef.current) {
              notifyOnceRef.current(`${toolName}_${jobId}_failed`, "error", `${toolName} prediction failed${data.error ? `: ${data.error}` : "."}`);
            }
            return;
          }
        }
      } catch (err: any) {
        if (!isAborted && err.name !== "AbortError") {
          console.warn(`[useJobPoller] Polling ${toolName} encountered error:`, err.message || err);
        }
      }

      if (!isAborted) {
        attempt++;
        timeoutId = setTimeout(poll, getBackoffDelay(attempt));
      }
    };

    poll();

    return () => {
      isAborted = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (eventSource) eventSource.close();
    };
  }, [jobId, status, toolName, maxAttempts, maxElapsedMs]);
}

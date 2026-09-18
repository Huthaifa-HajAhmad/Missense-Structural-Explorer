import React, { useCallback, useEffect, useRef, useState } from "react";

export interface CacheDiagnostic {
  size: number;
  max: number;
  ttl: string;
}

/**
 * Health of the tier that takes over when a primary service fails.
 *
 * Present only for services on a provider ladder (coordinate translation), and only when
 * the server found the primary unhealthy — its absence means "not applicable", not
 * "fallback is down".
 */
export interface FallbackHealthItem {
  id: string;
  name: string;
  healthy: boolean;
  latencyMs: number;
  message: string;
  timestamp: string;
}

export interface ServiceHealthItem {
  healthy: boolean;
  latencyMs: number;
  message: string;
  timestamp: string;
  fallback?: FallbackHealthItem;
}

export interface DiagnosticsData {
  status: string;
  timestamp: string;
  foldxReady: boolean;
  geminiReady: boolean;
  geminiModel?: string;
  modelServerReady: boolean;
  p2rankReady?: boolean;
  p2rankStatus?: "ready" | "standby" | "unavailable";
  p2rankJavaCompatible?: boolean;
  p2rankJavaVersion?: string | null;
  auditLogFailures?: number;
  cacheDiagnostics?: Record<string, CacheDiagnostic>;
  serviceHealth?: Record<string, ServiceHealthItem>;
}

export interface CapabilitiesData {
  status: string;
  timestamp: string;
  system?: {
    platform: string;
    arch: string;
    nodeVersion: string;
    sidecarReachable: boolean;
    sidecarLatencyMs: number;
  };
  engines?: Array<{
    id: string;
    name: string;
    category: string;
    status: "ready" | "warming_up" | "standby" | "unavailable";
    details: Record<string, any>;
  }>;
}

export interface VersionData {
  version: string;
  env: string;
}

/**
 * Fetches the server diagnostics, capabilities, and version payloads.
 * Exposes readiness, serviceHealth latency probes, and deep engine capabilities.
 */
export function useDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesData | null>(null);
  const [version, setVersion] = useState<VersionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const followUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards the degraded-coverage follow-up so it can fire at most once per episode.
  const followUpUsedRef = useRef(false);
  const refreshRef = useRef<(() => void) | null>(null);

  const clearFollowUp = useCallback(() => {
    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current);
      followUpTimerRef.current = null;
    }
  }, []);

  const refresh = useCallback(async (externalSignal?: AbortSignal) => {
    if (activeControllerRef.current) {
      activeControllerRef.current.abort();
    }
    clearFollowUp();
    const controller = new AbortController();
    activeControllerRef.current = controller;

    const signal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal;

    setLoading(true);
    setError(null);
    try {
      const [diagRes, versionRes, capRes] = await Promise.all([
        fetch("/api/v1/diagnostics", { signal }).catch((err) => {
          if (err?.name === "AbortError") throw err;
          return null;
        }),
        fetch("/api/v1/version", { signal }).catch((err) => {
          if (err?.name === "AbortError") throw err;
          return null;
        }),
        fetch("/api/v1/capabilities", { signal }).catch((err) => {
          if (err?.name === "AbortError") throw err;
          return null;
        })
      ]);

      if (signal.aborted) return;

      if (diagRes && diagRes.ok) {
        const payload = (await diagRes.json()) as DiagnosticsData;
        setDiagnostics(payload);

        /**
         * The server reports fallback coverage from a probe it deliberately does not block the
         * response on — waiting on it made /diagnostics slow in exactly the outage it describes.
         * So the first payload after a primary failure carries no verdict yet: schedule one
         * follow-up fetch to collect it. Bounded by `followUpUsedRef`, which only clears once a
         * verdict arrives or the primary recovers, so this cannot become a polling loop.
         */
        const ensembl = payload?.serviceHealth?.ensembl;
        if (ensembl && !ensembl.healthy && !ensembl.fallback) {
          if (!followUpUsedRef.current) {
            followUpUsedRef.current = true;
            followUpTimerRef.current = setTimeout(() => {
              followUpTimerRef.current = null;
              refreshRef.current?.();
            }, 1500);
          }
        } else {
          followUpUsedRef.current = false;
        }
      } else {
        setError(`Diagnostics unavailable${diagRes ? ` (HTTP ${diagRes.status})` : ""}.`);
      }

      if (versionRes && versionRes.ok) {
        setVersion(await versionRes.json());
      }
      if (capRes && capRes.ok) {
        setCapabilities(await capRes.json());
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to reach server.");
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }, [clearFollowUp]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => {
      controller.abort();
      clearFollowUp();
    };
  }, [refresh, clearFollowUp]);

  return { diagnostics, capabilities, version, loading, error, refresh };
}

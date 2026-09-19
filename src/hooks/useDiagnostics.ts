import React, { useCallback, useEffect, useRef, useState } from "react";

export interface CacheDiagnostic {
  size: number;
  max: number;
  ttl: string;
}

/** How a fallback tier is doing. Three states, because "could not tell" is not an outage. */
export type FallbackVerdictKind = "ready" | "unavailable" | "unknown";

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
  /** Absent on a payload from an older server; callers fall back to `healthy`. */
  verdict?: FallbackVerdictKind;
  latencyMs: number;
  message: string;
  timestamp: string;
  /** Age of the verdict when it was served, and whether it is past its refresh window. */
  ageMs?: number;
  stale?: boolean;
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
 * Bounded retry schedule for the degraded-coverage follow-up, in milliseconds.
 *
 * A single 1.5s retry was not enough: the server consults the verdict only after its ~10-service
 * health fan-out, and the probe behind it is allowed a 15s transport budget, so the verdict is
 * routinely absent on the first follow-up. The guard then latched and nothing else polled —
 * the row stayed on the neutral "Offline" pill for the whole session, i.e. in exactly the
 * outage the fallback reporting exists for. These delays span ~30s, which covers the probe's
 * whole budget, and the count is fixed so this still cannot become a polling loop.
 */
const FALLBACK_FOLLOW_UP_DELAYS_MS = [1500, 4000, 8000, 16000];

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
  /** How many follow-ups this episode has spent; reset whenever coverage is actually answered. */
  const followUpAttemptsRef = useRef(0);
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
         * response on, so the first payload after a primary failure carries no verdict yet.
         * Walk a fixed, escalating schedule of follow-up fetches until a verdict arrives.
         * Bounded by the schedule's length, so it can never become a polling loop.
         */
        const ensembl = payload?.serviceHealth?.ensembl;
        if (ensembl && !ensembl.healthy && !ensembl.fallback) {
          const attempt = followUpAttemptsRef.current;
          if (attempt < FALLBACK_FOLLOW_UP_DELAYS_MS.length) {
            followUpAttemptsRef.current = attempt + 1;
            followUpTimerRef.current = setTimeout(() => {
              followUpTimerRef.current = null;
              refreshRef.current?.();
            }, FALLBACK_FOLLOW_UP_DELAYS_MS[attempt]);
          }
        } else {
          // Coverage was actually answered (or the primary recovered): a later outage gets the
          // full schedule again rather than inheriting this episode's spent attempts.
          followUpAttemptsRef.current = 0;
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

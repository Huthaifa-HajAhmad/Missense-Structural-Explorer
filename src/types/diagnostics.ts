/** The shapes of the server's health and capability responses. */
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
  /**
   * Up-but-not-yet-serving. Present only for a producer that draws the distinction; absent means
   * "unknown", which a consumer must never render as an outage — or as readiness.
   */
  state?: "ready" | "warming_up";
  fallback?: FallbackHealthItem;
  /** AlphaGenome only: where its key comes from. `none` + a browser key still counts as ready. */
  keySource?: "server" | "none";
}

export interface DiagnosticsData {
  status: string;
  timestamp: string;
  foldxReady: boolean;
  /** What a not-ready FoldX is missing. Absent from servers that predate it. */
  foldxDetail?: {
    binaryFound: boolean;
    rotabasePresent: boolean;
    box64Required: boolean;
    box64Present: boolean;
  };
  /** The local dbNSFP store (optional; MyVariant.info serves the same scores without it). */
  dbnsfp?: {
    path: string;
    present: boolean;
    sizeBytes: number;
    enabled: boolean;
    usable: boolean;
    reason?: string;
    version?: string | null;
    rowCount?: number | null;
  };
  geminiReady: boolean;
  geminiModel?: string;
  modelServerReady: boolean;
  /**
   * Whether the ML sidecar can actually serve, as opposed to merely running.
   *
   * The sidecar answers `/health` with `status: "healthy"` the instant uvicorn binds — up to ~180 s
   * before the weights it was spawned to load are usable. `modelServerReady` alone could not tell
   * "warming" from "up" or "down", so the rail reported a green light over engines that would
   * refuse the next request. `offline` is the default, so a payload from a server that predates
   * this field reads as "no information" rather than "warming".
   */
  modelServerState?: "ready" | "warming_up" | "offline";
  p2rankReady?: boolean;
  p2rankStatus?: "ready" | "standby" | "unavailable";
  p2rankJavaVersion?: string | null;
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

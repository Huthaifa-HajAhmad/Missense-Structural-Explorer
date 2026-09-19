/**
 * server/services/adapters/types.ts — Interfaces for External Service Adapters.
 *
 * Provides a standardized contract for upstream APIs and local tool sidecars:
 * - Version tracking for cache key invalidation
 * - Uniform health probe contracts
 * - Rate limiting metadata
 */

/**
 * Health of the tier that takes over when a primary service fails.
 *
 * Only populated for services that sit at the top of a provider ladder — currently just
 * coordinate translation (Ensembl VEP -> VariantValidator) — and only once the primary has
 * already been found unhealthy, because probing a fallback on the healthy path buys an
 * answer nobody is waiting for at the cost of real latency.
 */
export interface FallbackHealthStatus {
  id: string;
  name: string;
  healthy: boolean;
  /**
   * How the tier is doing, when the probe could tell.
   *
   * Three states rather than a boolean because "I could not tell" and "I asked and it cannot"
   * warrant different advice: an unreachable or slow provider must not render as a definite
   * outage, which would tell a clinician to abandon coordinate notation for no reason.
   * Optional, so a payload from an older producer stays readable.
   */
  verdict?: "ready" | "unavailable" | "unknown";
  latencyMs: number;
  message: string;
  timestamp: string;
  /** Age of this verdict at the moment it was served. */
  ageMs?: number;
  /** True once the verdict is older than the refresh window: displayable, but no longer current. */
  stale?: boolean;
}

export interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  message?: string;
  timestamp: string;
  fallback?: FallbackHealthStatus;
}

export interface ExternalServiceAdapter<TInput = any, TOutput = any> {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly rateLimitPerSecond?: number;

  fetch(input: TInput, signal?: AbortSignal): Promise<TOutput>;
  healthCheck(signal?: AbortSignal): Promise<HealthStatus>;
  cacheKey(input: TInput): string;
}

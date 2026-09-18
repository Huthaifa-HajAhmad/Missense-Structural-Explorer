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
  latencyMs: number;
  message: string;
  timestamp: string;
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

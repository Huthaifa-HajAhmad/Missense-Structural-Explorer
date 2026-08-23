/**
 * server/services/adapters/types.ts — Interfaces for External Service Adapters.
 *
 * Provides a standardized contract for upstream APIs and local tool sidecars:
 * - Version tracking for cache key invalidation
 * - Uniform health probe contracts
 * - Rate limiting metadata
 */

export interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  message?: string;
  timestamp: string;
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

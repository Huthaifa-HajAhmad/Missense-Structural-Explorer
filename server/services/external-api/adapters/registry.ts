/**
 * server/services/adapters/registry.ts — Central registry for External Service Adapters.
 */

import type { ExternalServiceAdapter, HealthStatus } from "./types.ts";

export class AdapterRegistry {
  private static instance: AdapterRegistry;
  private adapters = new Map<string, ExternalServiceAdapter>();

  public static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  public register(adapter: ExternalServiceAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  public get<TInput = any, TOutput = any>(id: string): ExternalServiceAdapter<TInput, TOutput> | undefined {
    return this.adapters.get(id);
  }

  public getAll(): ExternalServiceAdapter[] {
    return Array.from(this.adapters.values());
  }

  private cachedHealth: { results: Record<string, HealthStatus>; timestamp: number } | null = null;
  private inFlightCheck: Promise<Record<string, HealthStatus>> | null = null;

  public async checkAllHealth(signal?: AbortSignal, force = false): Promise<Record<string, HealthStatus>> {
    const now = Date.now();
    if (!force && this.cachedHealth && now - this.cachedHealth.timestamp < 15_000) {
      return this.cachedHealth.results;
    }

    if (this.inFlightCheck) {
      return this.inFlightCheck;
    }

    this.inFlightCheck = (async () => {
      const results: Record<string, HealthStatus> = {};
      const adapters = this.getAll();

      await Promise.all(
        adapters.map(async (adapter) => {
          const start = performance.now();
          try {
            results[adapter.id] = await adapter.healthCheck(signal);
          } catch (err: any) {
            results[adapter.id] = {
              healthy: false,
              latencyMs: Math.round(performance.now() - start),
              message: err.message || "Health check failed",
              timestamp: new Date().toISOString()
            };
          }
        })
      );

      this.cachedHealth = { results, timestamp: Date.now() };
      return results;
    })().finally(() => {
      this.inFlightCheck = null;
    });

    return this.inFlightCheck;
  }
}

export const adapterRegistry = AdapterRegistry.getInstance();

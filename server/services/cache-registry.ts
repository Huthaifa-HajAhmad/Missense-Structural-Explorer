import { LRUCache } from "lru-cache";
import type { GnomadVariantFrequency, GnomadGeneConstraint } from "./gnomad.ts";
import type { UniprotFeaturesResult } from "./uniprot.ts";
import type { LandscapePositionData } from "./landscape.ts";
import { AnalysisDatabase } from "./analysis-db.ts";

export interface CachedFetchOptions<T> {
  key: string;
  source: string;
  l1Cache?: LRUCache<string, any>;
  ttlSeconds?: number;
  fetcher: () => Promise<T>;
  bypassSqlite?: boolean;
  shouldCache?: (result: T) => boolean;
}

export interface CacheDescriptor {
  size: number;
  max?: number;
  ttl: string;
}

export interface CustomCacheMetadata {
  cache: LRUCache<any, any>;
  ttlDesc: string;
}

export class CacheRegistry {
  public readonly pdbCache: LRUCache<string, string>;
  public readonly bestPdbCache: LRUCache<string, any>;
  public readonly uniprotCache: LRUCache<string, string>;
  public readonly clinvarCache: LRUCache<string, any>;
  public readonly afUrlCache: LRUCache<string, string>;
  public readonly predictorCache: LRUCache<string, any>;
  public readonly conservationCache: LRUCache<string, any>;
  public readonly stringCache: LRUCache<string, any>;
  public readonly popEVECache: LRUCache<string, any>;
  public readonly popEveOnlineCache: LRUCache<string, any>;
  public readonly refseqCache: LRUCache<string, any>;
  public readonly gnomadFreqCache: LRUCache<string, GnomadVariantFrequency>;
  public readonly gnomadConstraintCache: LRUCache<string, GnomadGeneConstraint>;
  public readonly uniprotFeaturesCache: LRUCache<string, UniprotFeaturesResult>;
  public readonly landscapeCache: LRUCache<string, LandscapePositionData[]>;
  public readonly narrativeCache: LRUCache<string, any>;

  private readonly inFlightPromises = new Map<string, Promise<any>>();
  private readonly customCaches = new Map<string, CustomCacheMetadata>();
  private readonly clearHooks: Array<() => void> = [];

  constructor() {
    this.pdbCache = new LRUCache<string, string>({
      max: 100,
      maxSize: 100 * 1024 * 1024,
      sizeCalculation: (value) => value.length
    });

    this.bestPdbCache = new LRUCache<string, any>({
      max: 1000,
      ttl: 1000 * 60 * 60 * 24
    });

    this.uniprotCache = new LRUCache<string, string>({
      max: 1000
    });

    this.clinvarCache = new LRUCache<string, any>({
      max: 500,
      ttl: 60 * 60 * 1000
    });

    this.afUrlCache = new LRUCache<string, string>({
      max: 1000,
      ttl: 24 * 60 * 60 * 1000
    });

    this.predictorCache = new LRUCache<string, any>({
      max: 500,
      ttl: 60 * 60 * 1000
    });

    this.conservationCache = new LRUCache<string, any>({
      max: 500,
      ttl: 60 * 60 * 1000
    });

    this.stringCache = new LRUCache<string, any>({
      max: 500,
      ttl: 60 * 60 * 1000
    });

    this.popEVECache = new LRUCache<string, any>({
      max: 500,
      ttl: 60 * 60 * 1000
    });

    this.popEveOnlineCache = new LRUCache<string, any>({
      max: 500,
      ttl: 1000 * 60 * 60 * 24
    });

    this.refseqCache = new LRUCache<string, any>({
      max: 1000,
      ttl: 1000 * 60 * 60 * 24 * 7
    });

    this.gnomadFreqCache = new LRUCache<string, GnomadVariantFrequency>({
      max: 500,
      ttl: 1000 * 60 * 60 * 24
    });

    this.gnomadConstraintCache = new LRUCache<string, GnomadGeneConstraint>({
      max: 1000,
      ttl: 1000 * 60 * 60 * 24 * 7
    });

    this.uniprotFeaturesCache = new LRUCache<string, UniprotFeaturesResult>({
      max: 500,
      ttl: 1000 * 60 * 60 * 24 * 3
    });

    this.landscapeCache = new LRUCache<string, LandscapePositionData[]>({
      max: 100,
      ttl: 1000 * 60 * 60 * 24
    });

    this.narrativeCache = new LRUCache<string, any>({
      max: 200,
      ttl: 1000 * 60 * 60 * 24
    });
  }

  /**
   * Dynamically registers an external domain cache into this registry for unified
   * clearing and telemetry inspection.
   */
  public registerCache(name: string, cache: LRUCache<any, any>, meta?: { ttlDesc?: string }): void {
    this.customCaches.set(name, {
      cache,
      ttlDesc: meta?.ttlDesc ?? "none"
    });
  }

  /**
   * Registers a cleanup callback invoked whenever clearAll() is called on this registry.
   */
  public onClear(hook: () => void): void {
    this.clearHooks.push(hook);
  }

  /**
   * Coalesces concurrent calls for the exact same key into a single in-flight Promise,
   * scoped to this registry instance.
   */
  public async singleFlight<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.inFlightPromises.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = fetcher().finally(() => {
      this.inFlightPromises.delete(key);
    });
    this.inFlightPromises.set(key, promise);
    return promise;
  }

  /**
   * 2-Tier Caching Helper:
   * 1. Checks in-memory L1 LRUCache.
   * 2. Checks persistent L2 SQLite external_cache table.
   * 3. On miss, runs singleFlight(key, fetcher) and writes result to both L1 and L2 upon resolution.
   */
  public async getCachedOrFetch<T>(options: CachedFetchOptions<T>): Promise<T> {
    const { key, source, l1Cache, ttlSeconds, fetcher, bypassSqlite, shouldCache } = options;

    // 1. Check L1 Memory Cache
    if (l1Cache && l1Cache.has(key)) {
      const memVal = l1Cache.get(key);
      if (memVal !== undefined) return memVal;
    }

    // 2. Check L2 Persistent SQLite Cache
    if (!bypassSqlite) {
      try {
        const db = AnalysisDatabase.getInstance();
        const sqliteEntry = await db.getExternalCacheAsync<T>(key);
        if (sqliteEntry && sqliteEntry.data !== undefined) {
          if (l1Cache) {
            l1Cache.set(key, sqliteEntry.data);
          }
          return sqliteEntry.data;
        }
      } catch (dbErr: any) {
        console.warn(`[L2 Cache Read Warning] Failed reading external_cache for ${key}:`, dbErr.message);
      }
    }

    // 3. Execute Fetcher with Instance-Scoped Single-Flight Promise Deduplication
    return this.singleFlight(key, async () => {
      const result = await fetcher();

      // Check if result is cacheable
      const isCacheable = shouldCache ? shouldCache(result) : result !== null && result !== undefined;
      if (isCacheable) {
        if (l1Cache) {
          l1Cache.set(key, result);
        }
        if (!bypassSqlite) {
          try {
            const db = AnalysisDatabase.getInstance();
            await db.saveExternalCacheAsync(key, result, source, ttlSeconds);
          } catch (dbErr: any) {
            console.warn(`[L2 Cache Write Warning] Failed saving external_cache for ${key}:`, dbErr.message);
          }
        }
      }
      return result;
    });
  }

  /**
   * Generates live telemetry diagnostics across all core and dynamically registered caches.
   */
  public getDiagnostics(): Record<string, CacheDescriptor> {
    const diagnostics: Record<string, CacheDescriptor> = {
      pdbCache: { size: this.pdbCache.size, max: this.pdbCache.max, ttl: "none" },
      bestPdbCache: { size: this.bestPdbCache.size, max: this.bestPdbCache.max, ttl: "24h" },
      uniprotCache: { size: this.uniprotCache.size, max: this.uniprotCache.max, ttl: "none" },
      clinvarCache: { size: this.clinvarCache.size, max: this.clinvarCache.max, ttl: "1h" },
      afUrlCache: { size: this.afUrlCache.size, max: this.afUrlCache.max, ttl: "24h" },
      predictorCache: { size: this.predictorCache.size, max: this.predictorCache.max, ttl: "1h" },
      conservationCache: { size: this.conservationCache.size, max: this.conservationCache.max, ttl: "1h" },
      stringCache: { size: this.stringCache.size, max: this.stringCache.max, ttl: "1h" },
      popEVECache: { size: this.popEVECache.size, max: this.popEVECache.max, ttl: "1h" },
      popEveOnlineCache: { size: this.popEveOnlineCache.size, max: this.popEveOnlineCache.max, ttl: "24h" },
      refseqCache: { size: this.refseqCache.size, max: this.refseqCache.max, ttl: "7d" },
      gnomadFreqCache: { size: this.gnomadFreqCache.size, max: this.gnomadFreqCache.max, ttl: "24h" },
      gnomadConstraintCache: { size: this.gnomadConstraintCache.size, max: this.gnomadConstraintCache.max, ttl: "7d" },
      uniprotFeaturesCache: { size: this.uniprotFeaturesCache.size, max: this.uniprotFeaturesCache.max, ttl: "3d" },
      landscapeCache: { size: this.landscapeCache.size, max: this.landscapeCache.max, ttl: "24h" },
      narrativeCache: { size: this.narrativeCache.size, max: this.narrativeCache.max, ttl: "24h" },
      geminiCache: { size: this.narrativeCache.size, max: this.narrativeCache.max, ttl: "24h" }
    };

    for (const [name, meta] of this.customCaches.entries()) {
      diagnostics[name] = {
        size: meta.cache.size,
        max: meta.cache.max,
        ttl: meta.ttlDesc
      };
    }

    return diagnostics;
  }

  /**
   * Flushes 100% of registered in-memory caches, in-flight promises, and optionally L2 SQLite.
   */
  public clearAll(includeSqlite = false): void {
    this.pdbCache.clear();
    this.bestPdbCache.clear();
    this.uniprotCache.clear();
    this.clinvarCache.clear();
    this.afUrlCache.clear();
    this.predictorCache.clear();
    this.conservationCache.clear();
    this.stringCache.clear();
    this.popEVECache.clear();
    this.popEveOnlineCache.clear();
    this.refseqCache.clear();
    this.gnomadFreqCache.clear();
    this.gnomadConstraintCache.clear();
    this.uniprotFeaturesCache.clear();
    this.landscapeCache.clear();
    this.narrativeCache.clear();
    this.inFlightPromises.clear();

    for (const { cache } of this.customCaches.values()) {
      cache.clear();
    }

    for (const hook of this.clearHooks) {
      try {
        hook();
      } catch {}
    }

    if (includeSqlite) {
      try {
        AnalysisDatabase.getInstance().clearAll();
      } catch {}
    }
  }
}

export function createCacheRegistry(): CacheRegistry {
  return new CacheRegistry();
}

export const defaultCacheRegistry = new CacheRegistry();

import { LRUCache } from "lru-cache";
import type { GnomadVariantFrequency, GnomadGeneConstraint } from "../external-api/gnomad.ts";
import type { UniprotFeaturesResult } from "../external-api/uniprot.ts";
import type { LandscapeResult } from "../prediction/landscape.ts";
import { AnalysisDatabase } from "./analysis-db.ts";

export interface CachedFetchOptions<T> {
  key: string;
  source: string;
  l1Cache?: LRUCache<string, any>;
  ttlSeconds?: number;
  fetcher: () => Promise<T>;
  bypassSqlite?: boolean;
  shouldCache?: (result: T) => boolean;
  /**
   * Read-side gate: an entry for which this returns false is treated as a MISS, so the fetcher
   * runs again (and, if `shouldCache` allows, replaces it).
   *
   * Needed because entry SEMANTICS can change without the key changing: coordinate translations
   * are cached under a 10-year TTL, and a payload written before protein numbering was verified
   * is no longer trustworthy even though it is byte-identical in shape. Without this gate the
   * only alternatives were serving it (silently) or bumping the global schema version, which
   * would evict every other source's warm cache to fix one.
   */
  isUsable?: (cached: T) => boolean;
}

export interface CacheDescriptor {
  size: number;
  max?: number;
  ttl: string;
  calculatedSizeBytes?: number;
  estimatedEntryBytes?: number;
}

export interface CacheMemoryReport {
  caches: Record<string, CacheDescriptor>;
  totalEntries: number;
  totalEstimatedBytes: number;
  budgetWarning: boolean;
  budgetLimitBytes: number;
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
  public readonly landscapeCache: LRUCache<string, LandscapeResult>;
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

    this.landscapeCache = new LRUCache<string, LandscapeResult>({
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
    const { key, source, l1Cache, ttlSeconds, fetcher, bypassSqlite, shouldCache, isUsable } = options;

    // 1. Check L1 Memory Cache
    if (l1Cache && l1Cache.has(key)) {
      const memVal = l1Cache.get(key);
      if (memVal !== undefined && (!isUsable || isUsable(memVal))) return memVal;
    }

    // 2. Check L2 Persistent SQLite Cache
    if (!bypassSqlite) {
      try {
        const db = AnalysisDatabase.getInstance();
        const sqliteEntry = await db.getExternalCacheAsync<T>(key);
        if (sqliteEntry && sqliteEntry.data !== undefined) {
          // An entry this caller cannot use is left in place (it may still serve another
          // caller) but is NOT promoted or returned: the fetcher below decides the outcome.
          if (!isUsable || isUsable(sqliteEntry.data)) {
            if (l1Cache) {
              l1Cache.set(key, sqliteEntry.data);
            }
            return sqliteEntry.data;
          }
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
   * Generates a comprehensive memory report with byte estimations and budget telemetry.
   */
  public getMemoryReport(): CacheMemoryReport {
    const BUDGET_LIMIT_BYTES = 512 * 1024 * 1024; // 512 MB memory budget
    const cacheMap: Array<{ name: string; cache: LRUCache<any, any>; ttl: string }> = [
      { name: "pdbCache", cache: this.pdbCache, ttl: "none" },
      { name: "bestPdbCache", cache: this.bestPdbCache, ttl: "24h" },
      { name: "uniprotCache", cache: this.uniprotCache, ttl: "none" },
      { name: "clinvarCache", cache: this.clinvarCache, ttl: "1h" },
      { name: "afUrlCache", cache: this.afUrlCache, ttl: "24h" },
      { name: "predictorCache", cache: this.predictorCache, ttl: "1h" },
      { name: "conservationCache", cache: this.conservationCache, ttl: "1h" },
      { name: "stringCache", cache: this.stringCache, ttl: "1h" },
      { name: "popEVECache", cache: this.popEVECache, ttl: "1h" },
      { name: "popEveOnlineCache", cache: this.popEveOnlineCache, ttl: "24h" },
      { name: "refseqCache", cache: this.refseqCache, ttl: "7d" },
      { name: "gnomadFreqCache", cache: this.gnomadFreqCache, ttl: "24h" },
      { name: "gnomadConstraintCache", cache: this.gnomadConstraintCache, ttl: "7d" },
      { name: "uniprotFeaturesCache", cache: this.uniprotFeaturesCache, ttl: "3d" },
      { name: "landscapeCache", cache: this.landscapeCache, ttl: "24h" },
      { name: "narrativeCache", cache: this.narrativeCache, ttl: "24h" }
    ];

    const caches: Record<string, CacheDescriptor> = {};
    let totalEntries = 0;
    let totalEstimatedBytes = 0;

    for (const item of cacheMap) {
      const hasCalc = typeof (item.cache as any).maxSize === "number" && (item.cache as any).maxSize > 0;
      const calcSize = hasCalc ? (item.cache as any).calculatedSize ?? 0 : undefined;
      const estimatedBytes = calcSize !== undefined ? calcSize : item.cache.size * 1024;

      caches[item.name] = {
        size: item.cache.size,
        max: item.cache.max,
        ttl: item.ttl,
        calculatedSizeBytes: calcSize,
        estimatedEntryBytes: estimatedBytes
      };

      totalEntries += item.cache.size;
      totalEstimatedBytes += estimatedBytes;
    }

    // geminiCache alias for backward compatibility
    caches.geminiCache = { ...caches.narrativeCache };

    for (const [name, meta] of this.customCaches.entries()) {
      const hasCalc = typeof (meta.cache as any).maxSize === "number" && (meta.cache as any).maxSize > 0;
      const calcSize = hasCalc ? (meta.cache as any).calculatedSize ?? 0 : undefined;
      const estimatedBytes = calcSize !== undefined ? calcSize : meta.cache.size * 1024;

      caches[name] = {
        size: meta.cache.size,
        max: meta.cache.max,
        ttl: meta.ttlDesc,
        calculatedSizeBytes: calcSize,
        estimatedEntryBytes: estimatedBytes
      };

      totalEntries += meta.cache.size;
      totalEstimatedBytes += estimatedBytes;
    }

    return {
      caches,
      totalEntries,
      totalEstimatedBytes,
      budgetWarning: totalEstimatedBytes > BUDGET_LIMIT_BYTES,
      budgetLimitBytes: BUDGET_LIMIT_BYTES
    };
  }

  /**
   * Generates live telemetry diagnostics across all core and dynamically registered caches.
   */
  public getDiagnostics(): Record<string, CacheDescriptor> {
    return this.getMemoryReport().caches;
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

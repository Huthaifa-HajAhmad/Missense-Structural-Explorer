import { LRUCache } from "lru-cache";
import type { GnomadVariantFrequency, GnomadGeneConstraint } from "./gnomad.ts";
import type { UniprotFeaturesResult } from "./uniprot.ts";
import type { LandscapePositionData } from "./landscape.ts";

// Caching storage (P-1) (CRIT-3)
export const pdbCache = new LRUCache<string, string>({
  max: 100, // Maximum of 100 structures
  maxSize: 100 * 1024 * 1024, // Maximum of 100MB of PDB content
  sizeCalculation: (value) => value.length
});

export const uniprotCache = new LRUCache<string, string>({
  max: 1000 // Maximum of 1000 resolved gene-to-uniprot mappings
});

export const clinvarCache = new LRUCache<string, any>({
  max: 500,
  ttl: 60 * 60 * 1000 // 1 hour TTL
});

export const afUrlCache = new LRUCache<string, string>({
  max: 1000,
  ttl: 24 * 60 * 60 * 1000 // 24 hour TTL (M-3)
});

export const predictorCache = new LRUCache<string, any>({
  max: 500,
  ttl: 60 * 60 * 1000 // 1 hour TTL
});

export const conservationCache = new LRUCache<string, any>({
  max: 500,
  ttl: 60 * 60 * 1000 // 1 hour TTL
});

export const stringCache = new LRUCache<string, any>({
  max: 500,
  ttl: 60 * 60 * 1000 // 1 hour TTL
});

export const popEVECache = new LRUCache<string, any>({ max: 500, ttl: 60 * 60 * 1000 });
export const popEveOnlineCache = new LRUCache<string, any>({ max: 500, ttl: 1000 * 60 * 60 * 24 });
export const refseqCache = new LRUCache<string, any>({ max: 1000, ttl: 1000 * 60 * 60 * 24 * 7 });

export const gnomadFreqCache = new LRUCache<string, GnomadVariantFrequency>({
  max: 500,
  ttl: 1000 * 60 * 60 * 24, // 24-hour TTL
});

export const gnomadConstraintCache = new LRUCache<string, GnomadGeneConstraint>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 7, // 7-day TTL (gene constraint is stable)
});

export const uniprotFeaturesCache = new LRUCache<string, UniprotFeaturesResult>({
  max: 500,
  ttl: 1000 * 60 * 60 * 24 * 3, // 3-day TTL
});

export const landscapeCache = new LRUCache<string, LandscapePositionData[]>({
  max: 100,
  ttl: 1000 * 60 * 60 * 24, // 1-day TTL
});

export const narrativeCache = new LRUCache<string, any>({
  max: 200,
  ttl: 1000 * 60 * 60 * 24, // 24-hour TTL
});

import { AnalysisDatabase } from "./analysis-db.ts";

export const bestPdbCache = new LRUCache<string, any>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 // 24-hour TTL
});

const inFlightPromises = new Map<string, Promise<any>>();

/**
 * Coalesces concurrent calls for the exact same key into a single in-flight Promise.
 */
export async function singleFlight<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlightPromises.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = fetcher().finally(() => {
    inFlightPromises.delete(key);
  });
  inFlightPromises.set(key, promise);
  return promise;
}

export interface CachedFetchOptions<T> {
  key: string;
  source: string;
  l1Cache?: LRUCache<string, any>;
  ttlSeconds?: number;
  fetcher: () => Promise<T>;
  bypassSqlite?: boolean;
  shouldCache?: (result: T) => boolean;
}

/**
 * 2-Tier Caching Helper:
 * 1. Checks in-memory L1 LRUCache.
 * 2. Checks persistent L2 SQLite external_cache table.
 * 3. On miss, runs singleFlight(key, fetcher) and writes result to both L1 and L2 upon resolution.
 */
export async function getCachedOrFetch<T>(options: CachedFetchOptions<T>): Promise<T> {
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
      const sqliteEntry = db.getExternalCache<T>(key);
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

  // 3. Execute Fetcher with Single-Flight Promise Deduplication
  return singleFlight(key, async () => {
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
          db.saveExternalCache(key, result, source, ttlSeconds);
        } catch (dbErr: any) {
          console.warn(`[L2 Cache Write Warning] Failed saving external_cache for ${key}:`, dbErr.message);
        }
      }
    }
    return result;
  });
}

export function clearAllCaches(includeSqlite = false) {
  pdbCache.clear();
  bestPdbCache.clear();
  uniprotCache.clear();
  clinvarCache.clear();
  predictorCache.clear();
  conservationCache.clear();
  stringCache.clear();
  gnomadFreqCache.clear();
  gnomadConstraintCache.clear();
  uniprotFeaturesCache.clear();
  landscapeCache.clear();
  narrativeCache.clear();
  inFlightPromises.clear();

  if (includeSqlite) {
    try {
      AnalysisDatabase.getInstance().clearAll();
    } catch {}
  }
}

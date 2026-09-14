/**
 * cache.ts — Backward-compatible facade for the central CacheRegistry.
 * 
 * Exposes canonical singleton LRU caches, 2-tier caching helper, single-flight
 * request deduplication, and cache purging methods. All instances delegate to
 * defaultCacheRegistry to support isolated dependency injection in tests.
 */

import {
  CacheRegistry,
  createCacheRegistry,
  defaultCacheRegistry,
  type CachedFetchOptions,
  type CacheDescriptor,
  type CacheMemoryReport
} from "./cache-registry.ts";

export { CacheRegistry, createCacheRegistry, defaultCacheRegistry };
export type { CachedFetchOptions, CacheDescriptor, CacheMemoryReport };

// ---------------------------------------------------------------------------
// Canonical L1 Memory Caches (Delegated to defaultCacheRegistry)
// ---------------------------------------------------------------------------
export const pdbCache = defaultCacheRegistry.pdbCache;
export const bestPdbCache = defaultCacheRegistry.bestPdbCache;
export const uniprotCache = defaultCacheRegistry.uniprotCache;
export const clinvarCache = defaultCacheRegistry.clinvarCache;
export const afUrlCache = defaultCacheRegistry.afUrlCache;
export const predictorCache = defaultCacheRegistry.predictorCache;
export const conservationCache = defaultCacheRegistry.conservationCache;
export const stringCache = defaultCacheRegistry.stringCache;
export const popEVECache = defaultCacheRegistry.popEVECache;
export const popEveOnlineCache = defaultCacheRegistry.popEveOnlineCache;
export const refseqCache = defaultCacheRegistry.refseqCache;
export const gnomadFreqCache = defaultCacheRegistry.gnomadFreqCache;
export const gnomadConstraintCache = defaultCacheRegistry.gnomadConstraintCache;
export const uniprotFeaturesCache = defaultCacheRegistry.uniprotFeaturesCache;
export const landscapeCache = defaultCacheRegistry.landscapeCache;
export const narrativeCache = defaultCacheRegistry.narrativeCache;

// ---------------------------------------------------------------------------
// Request Deduplication & 2-Tier Caching Helpers
// ---------------------------------------------------------------------------

/**
 * Coalesces concurrent calls for the exact same key into a single in-flight Promise.
 */
export async function singleFlight<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  return defaultCacheRegistry.singleFlight(key, fetcher);
}

/**
 * 2-Tier Caching Helper:
 * 1. Checks in-memory L1 LRUCache.
 * 2. Checks persistent L2 SQLite external_cache table.
 * 3. On miss, runs singleFlight(key, fetcher) and writes result to both L1 and L2 upon resolution.
 */
export async function getCachedOrFetch<T>(options: CachedFetchOptions<T>): Promise<T> {
  return defaultCacheRegistry.getCachedOrFetch(options);
}

/**
 * Flushes all registered in-memory caches, in-flight promises, and optionally L2 SQLite.
 */
export function clearAllCaches(includeSqlite = false): void {
  defaultCacheRegistry.clearAll(includeSqlite);
}

/**
 * Returns comprehensive memory usage telemetry across all registered caches.
 */
export function getCacheMemoryReport(): CacheMemoryReport {
  return defaultCacheRegistry.getMemoryReport();
}

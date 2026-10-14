import { LRUCache } from "lru-cache";
import type { GnomadVariantFrequency, GnomadGeneConstraint } from "../external-api/gnomad.ts";
import type { UniprotFeaturesResult } from "../external-api/uniprot.ts";
import type { LandscapeResult } from "../prediction/landscape.ts";
import { AnalysisDatabase } from "./analysis-db.ts";
import {
  type CacheScope,
  type SharedRun,
  type StaleServe,
  joinShared,
  mergeIntoCurrentScope,
  newCacheScope,
  runInCacheScope,
  startShared,
} from "./cache-scope.ts";
import { egressGovernorMode } from "./provider-pause.ts";

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
  /**
   * Serve the expired entry when the fetch fails, or returns nothing cacheable, while a provider is
   * limiting requests (WP-I2). Default true; `false` for an answer that must never be served out of
   * date. Acts under `EGRESS_GOVERNOR=on` only; `shadow` counts what it would have served.
   */
  serveStale?: boolean;
}

/** What one shared cache fill produced, with what its fetcher saw (copied into each caller's scope). */
type FillOutcome<T> =
  | { ok: true; value: T; scope: CacheScope }
  | { ok: false; error: unknown; scope: CacheScope };

/** Stale serves since start, by cache source. `wouldServe` is the `shadow` count. */
export interface StaleServeCounts {
  served: number;
  wouldServe: number;
}

const STALE_LOG_INTERVAL_MS = 60_000;

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

  private readonly inFlightPromises = new Map<string, SharedRun<any>>();
  /** Cache fills in flight, by key; separate from `inFlightPromises` because they resolve to an outcome. */
  private readonly inFlightFills = new Map<string, Promise<FillOutcome<any>>>();
  private readonly staleCounts = new Map<string, StaleServeCounts>();
  private readonly staleLoggedAt = new Map<string, number>();
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
    const existing = this.inFlightPromises.get(key) as SharedRun<T> | undefined;
    if (existing) {
      return joinShared(existing);
    }
    // In a scope of its own, so every caller (not only the first) learns of a rate limit or a stale
    // serve inside it (WP-I2).
    const run = startShared(fetcher);
    this.inFlightPromises.set(key, run);
    const forget = () => {
      if (this.inFlightPromises.get(key) === run) this.inFlightPromises.delete(key);
    };
    run.promise.then(forget, forget);
    return joinShared(run);
  }

  /**
   * 2-Tier Caching Helper:
   * 1. Checks in-memory L1 LRUCache.
   * 2. Checks persistent L2 SQLite external_cache table.
   * 3. On miss, runs the fetcher once for all concurrent callers of the key and writes a cacheable
   *    result to both L1 and L2.
   *
   * When the fetch fails or comes back empty because a provider is limiting requests, an expired
   * entry is served instead (`serveStale`), and a result built from such an entry is not cached.
   */
  public async getCachedOrFetch<T>(options: CachedFetchOptions<T>): Promise<T> {
    const { key, l1Cache, bypassSqlite, isUsable } = options;

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

    // 3. One fill per key for every concurrent caller (any user). Each caller takes the fill's
    // notes (rate limits seen, stale entries served) into its own scope, so a joiner's response
    // is marked stale exactly like the leader's.
    // A caller that refuses stale data does not join a fill that may serve it.
    const flightKey = options.serveStale === false ? `${key}\u0000fresh-only` : key;
    let fill = this.inFlightFills.get(flightKey) as Promise<FillOutcome<T>> | undefined;
    if (!fill) {
      const started = this.fill(options);
      fill = started;
      this.inFlightFills.set(flightKey, started);
      // Only this fill's own entry: `clearAll` may have let a newer fill take the key meanwhile.
      const forget = () => {
        if (this.inFlightFills.get(flightKey) === started) this.inFlightFills.delete(flightKey);
      };
      started.then(forget, forget);
    }
    const outcome = await fill;
    mergeIntoCurrentScope(outcome.scope);
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  private async fill<T>(options: CachedFetchOptions<T>): Promise<FillOutcome<T>> {
    const { key, source, l1Cache, ttlSeconds, fetcher, bypassSqlite, shouldCache } = options;
    const scope = newCacheScope();
    let result: T | undefined;
    try {
      result = await runInCacheScope(scope, fetcher);
    } catch (error) {
      const stale = await this.staleInstead(options, scope);
      return stale !== undefined ? { ok: true, value: stale, scope } : { ok: false, error, scope };
    }

    const isCacheable = shouldCache ? shouldCache(result as T) : result !== null && result !== undefined;
    if (!isCacheable) {
      const stale = await this.staleInstead(options, scope);
      return { ok: true, value: stale !== undefined ? stale : (result as T), scope };
    }
    // Built from an expired entry somewhere below: correct to return, wrong to store as fresh.
    if (scope.stale.length > 0) return { ok: true, value: result as T, scope };

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
    return { ok: true, value: result as T, scope };
  }

  /**
   * The expired entry to serve because a provider limited this fill's calls, or undefined. Under
   * `shadow` it is only counted. Recorded in `scope` so the caller's response says it is stale.
   */
  private async staleInstead<T>(options: CachedFetchOptions<T>, scope: CacheScope): Promise<T | undefined> {
    if (options.serveStale === false) return undefined;
    // Provider refusals first; a turn that did not come in time at a busy provider also counts.
    const limited = [...scope.rateLimitedHosts];
    const hosts = limited.length > 0 ? limited : [...scope.busyHosts];
    if (hosts.length === 0) return undefined;
    const mode = egressGovernorMode();
    if (mode === "off") return undefined;
    const found = await this.readExpired(options);
    if (!found) return undefined;

    const serve: StaleServe = {
      source: options.source,
      hosts,
      busy: limited.length === 0,
      ageSec: Math.max(0, Math.round((Date.now() - found.fetchedAtMs) / 1000)),
    };
    const counts = this.staleCounts.get(serve.source) ?? { served: 0, wouldServe: 0 };
    this.staleCounts.set(serve.source, counts);
    if (mode === "on") counts.served++;
    else counts.wouldServe++;

    const now = Date.now();
    if (now - (this.staleLoggedAt.get(serve.source) ?? 0) > STALE_LOG_INTERVAL_MS) {
      this.staleLoggedAt.set(serve.source, now);
      console.warn(
        `[egress:${mode}] ${serve.hosts.join(", ")} ${serve.busy ? "busy" : "limiting requests"}; ` +
          `${mode === "on" ? "serving" : "would serve"} a ${serve.ageSec} s old ${serve.source} entry ` +
          `(${mode === "on" ? counts.served : counts.wouldServe} so far).`
      );
    }
    if (mode !== "on") return undefined;
    scope.stale.push(serve);
    return found.value;
  }

  /** The newest expired entry for the key, L2 first (it records when it was fetched), then L1. */
  private async readExpired<T>(options: CachedFetchOptions<T>): Promise<{ value: T; fetchedAtMs: number } | null> {
    const { key, l1Cache, bypassSqlite, isUsable } = options;
    const usable = (v: T | undefined | null): v is T => v !== undefined && v !== null && (!isUsable || isUsable(v));
    if (!bypassSqlite) {
      try {
        const row = await AnalysisDatabase.getInstance().getExternalCacheAsync<T>(key, true);
        const fetchedAtMs = row ? Date.parse(row.fetchedAt) : NaN;
        if (row && usable(row.data) && Number.isFinite(fetchedAtMs)) return { value: row.data, fetchedAtMs };
      } catch (dbErr: any) {
        console.warn(`[L2 Cache Read Warning] Failed reading an expired entry for ${key}:`, dbErr.message);
      }
    }
    // An expired L1 entry stays readable through `info` until it is evicted or overwritten. `info`
    // reports `start` as now and `ttl` as the time left (negative once expired), so the entry expired
    // at `start + ttl`; it was stored the cache's TTL before that. An entry stored with its own TTL
    // reads as younger than it is, never older.
    const entry = l1Cache?.info(key);
    if (entry && usable(entry.value) && typeof entry.start === "number" && typeof entry.ttl === "number") {
      const expiredAtMs = entry.start + entry.ttl;
      const cacheTtl = typeof l1Cache?.ttl === "number" ? l1Cache.ttl : 0;
      return { value: entry.value, fetchedAtMs: expiredAtMs - cacheTtl };
    }
    return null;
  }

  /** Stale serves by cache source since start (`/capabilities`). */
  public staleServeCounts(): Record<string, StaleServeCounts> {
    return Object.fromEntries([...this.staleCounts].map(([source, c]) => [source, { ...c }]));
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
    this.inFlightFills.clear();
    this.staleCounts.clear();
    this.staleLoggedAt.clear();

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

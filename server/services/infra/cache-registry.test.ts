import { describe, it, expect } from "vitest";
import { LRUCache } from "lru-cache";
import { CacheRegistry, createCacheRegistry } from "./cache-registry.ts";

describe("CacheRegistry & Dependency Injection Isolation", () => {
  it("maintains strict memory isolation between independent registry instances", () => {
    const reg1 = createCacheRegistry();
    const reg2 = createCacheRegistry();

    reg1.clinvarCache.set("KEY_ISOLATION", { classification: "Pathogenic" });

    expect(reg1.clinvarCache.get("KEY_ISOLATION")).toEqual({ classification: "Pathogenic" });
    expect(reg2.clinvarCache.get("KEY_ISOLATION")).toBeUndefined();
  });

  it("scopes singleFlight promise deduplication per registry instance", async () => {
    const reg1 = createCacheRegistry();
    const reg2 = createCacheRegistry();

    let reg1Calls = 0;
    let reg2Calls = 0;

    const fetcher1 = async () => {
      reg1Calls++;
      await new Promise(r => setTimeout(r, 25));
      return { val: "reg1" };
    };

    const fetcher2 = async () => {
      reg2Calls++;
      await new Promise(r => setTimeout(r, 25));
      return { val: "reg2" };
    };

    // Concurrent calls within reg1 should coalesce to 1 call
    const [r1a, r1b] = await Promise.all([
      reg1.singleFlight("shared_key", fetcher1),
      reg1.singleFlight("shared_key", fetcher1)
    ]);

    expect(reg1Calls).toBe(1);
    expect(r1a).toEqual({ val: "reg1" });
    expect(r1b).toEqual({ val: "reg1" });

    // Same key in reg2 is completely independent and should execute fetcher2
    const r2 = await reg2.singleFlight("shared_key", fetcher2);
    expect(reg2Calls).toBe(1);
    expect(r2).toEqual({ val: "reg2" });
  });

  it("generates comprehensive telemetry diagnostics for all registered caches", () => {
    const registry = createCacheRegistry();
    registry.pdbCache.set("P00439", "MOCK_PDB");
    registry.clinvarCache.set("TEST_VAR", { clinvarId: "123" });

    const diag = registry.getDiagnostics();

    expect(diag).toHaveProperty("pdbCache");
    expect(diag.pdbCache.size).toBe(1);
    expect(diag).toHaveProperty("clinvarCache");
    expect(diag.clinvarCache.size).toBe(1);
    expect(diag.clinvarCache.ttl).toBe("1h");

    // Confirms omitted caches from audit are included
    expect(diag).toHaveProperty("afUrlCache");
    expect(diag).toHaveProperty("popEVECache");
    expect(diag).toHaveProperty("popEveOnlineCache");
    expect(diag).toHaveProperty("refseqCache");
  });

  it("allows dynamic registration of secondary domain caches for universal telemetry and clearing", () => {
    const registry = createCacheRegistry();
    const customServiceCache = new LRUCache<string, any>({ max: 50, ttl: 1000 * 60 * 10 });

    registry.registerCache("customServiceCache", customServiceCache, { ttlDesc: "10m" });
    customServiceCache.set("KEY_CUSTOM", { ok: true });

    const diag = registry.getDiagnostics();
    expect(diag).toHaveProperty("customServiceCache");
    expect(diag.customServiceCache.size).toBe(1);
    expect(diag.customServiceCache.max).toBe(50);
    expect(diag.customServiceCache.ttl).toBe("10m");

    registry.clearAll();
    expect(customServiceCache.size).toBe(0);
  });

  it("clears 100% of all registered in-memory caches upon clearAll()", () => {
    const registry = createCacheRegistry();

    // Populate standard caches plus audit-omitted caches
    registry.pdbCache.set("P1", "PDB");
    registry.afUrlCache.set("AF1", "URL");
    registry.popEVECache.set("EVE1", { score: 0.8 });
    registry.refseqCache.set("RS1", { id: "NM_001" });
    registry.landscapeCache.set("LS1", { positions: [], meta: {} as any });

    expect(registry.pdbCache.size).toBe(1);
    expect(registry.afUrlCache.size).toBe(1);
    expect(registry.popEVECache.size).toBe(1);
    expect(registry.refseqCache.size).toBe(1);
    expect(registry.landscapeCache.size).toBe(1);

    registry.clearAll();

    expect(registry.pdbCache.size).toBe(0);
    expect(registry.afUrlCache.size).toBe(0);
    expect(registry.popEVECache.size).toBe(0);
    expect(registry.refseqCache.size).toBe(0);
    expect(registry.landscapeCache.size).toBe(0);
  });

  it("triggers registered onClear hooks when clearAll() is invoked", () => {
    const registry = createCacheRegistry();
    let hookExecuted = false;

    registry.onClear(() => {
      hookExecuted = true;
    });

    expect(hookExecuted).toBe(false);
    registry.clearAll();
    expect(hookExecuted).toBe(true);
  });

  it("supports isolated cache dependency injection into resolveGeneToUniprot without mutating defaultCacheRegistry", async () => {
    const { resolveGeneToUniprot } = await import("../uniprot.ts");
    const { defaultCacheRegistry } = await import("./cache.ts");

    const isolatedCache = new LRUCache<string, any>({ max: 10 });
    defaultCacheRegistry.uniprotCache.clear();

    const uniprotId = await resolveGeneToUniprot("PAH", { l1Cache: isolatedCache });

    expect(uniprotId).toBe("P00439");
    expect(isolatedCache.get("PAH")).toBe("P00439");
    // Global defaultCacheRegistry was NOT contaminated by this call
    expect(defaultCacheRegistry.uniprotCache.get("PAH")).toBeUndefined();
  });

  it("calculates memory metrics, byte estimates, and budget warnings in getMemoryReport()", () => {
    const registry = createCacheRegistry();
    const pdbContent = "ATOM      1  N   MET A   1      27.340  24.430   2.614  1.00 20.00           N";
    registry.pdbCache.set("1ABC", pdbContent);
    registry.clinvarCache.set("VAR1", { clinvarId: "100" });
    registry.afUrlCache.set("P00439", "https://alphafold.ebi.ac.uk/files/AF-P00439-F1-model_v4.pdb");

    const report = registry.getMemoryReport();

    expect(report.totalEntries).toBe(3);
    expect(report.caches.pdbCache.calculatedSizeBytes).toBe(pdbContent.length);
    expect(report.caches.clinvarCache.estimatedEntryBytes).toBe(1024);
    expect(report.caches.afUrlCache.estimatedEntryBytes).toBe(1024);
    expect(report.totalEstimatedBytes).toBe(pdbContent.length + 1024 + 1024);
    expect(report.budgetLimitBytes).toBe(512 * 1024 * 1024);
    expect(report.budgetWarning).toBe(false);
  });

  it("triggers budgetWarning when total cache size exceeds 512MB limit", () => {
    const registry = createCacheRegistry();
    const hugeCustomCache = new LRUCache<string, string>({
      max: 10,
      maxSize: 600 * 1024 * 1024,
      sizeCalculation: () => 550 * 1024 * 1024
    });

    registry.registerCache("hugeCache", hugeCustomCache, { ttlDesc: "none" });
    hugeCustomCache.set("HUGE_KEY", "mock");

    const report = registry.getMemoryReport();
    expect(report.caches.hugeCache.calculatedSizeBytes).toBe(550 * 1024 * 1024);
    expect(report.budgetWarning).toBe(true);
  });
});

/**
 * Read-side cache gate.
 *
 * Entry SEMANTICS can change without the key changing: coordinate translations carry a 10-year
 * TTL, and a payload written before protein numbering was verified is no longer trustworthy even
 * though its shape is unchanged. `isUsable` lets such an entry be treated as a miss (and, when
 * `shouldCache` allows, replaced) instead of being served silently — the alternative was bumping
 * the global schema version, which evicts every other source's warm cache to fix one.
 */
describe("getCachedOrFetch — isUsable read gate", () => {
  const makeCache = () => new LRUCache<string, any>({ max: 10, ttl: 60_000 });

  it("treats an unusable entry as a miss and re-fetches", async () => {
    const registry = createCacheRegistry();
    const l1Cache = makeCache();
    const key = "isusable-unusable-entry";
    l1Cache.set(key, { verified: false });
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { verified: true };
    };

    const result = await registry.getCachedOrFetch({
      key,
      source: "test",
      l1Cache,
      ttlSeconds: 60,
      bypassSqlite: true,
      fetcher,
      isUsable: (cached: any) => cached.verified === true,
    });

    expect(calls).toBe(1);
    expect(result).toEqual({ verified: true });
  });

  it("serves a usable entry without calling the fetcher", async () => {
    const registry = createCacheRegistry();
    const l1Cache = makeCache();
    const key = "isusable-usable-entry";
    l1Cache.set(key, { verified: true });
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { verified: false };
    };

    const result = await registry.getCachedOrFetch({
      key,
      source: "test",
      l1Cache,
      ttlSeconds: 60,
      bypassSqlite: true,
      fetcher,
      isUsable: (cached: any) => cached.verified === true,
    });

    expect(calls).toBe(0);
    expect(result).toEqual({ verified: true });
  });

  it("keeps prior behaviour when no gate is supplied", async () => {
    const registry = createCacheRegistry();
    const l1Cache = makeCache();
    const key = "isusable-no-gate";
    l1Cache.set(key, { any: "value" });
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { any: "fresh" };
    };

    const result = await registry.getCachedOrFetch({
      key,
      source: "test",
      l1Cache,
      ttlSeconds: 60,
      bypassSqlite: true,
      fetcher,
    });

    expect(calls).toBe(0);
    expect(result).toEqual({ any: "value" });
  });
});

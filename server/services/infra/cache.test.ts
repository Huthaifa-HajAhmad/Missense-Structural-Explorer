import { describe, it, expect, vi, beforeEach } from "vitest";
import { pdbCache, bestPdbCache, uniprotCache, clinvarCache, clearAllCaches, getCachedOrFetch, singleFlight } from "./cache.ts";
import { AnalysisDatabase } from "./analysis-db.ts";

describe("LRU Cache", () => {
  const mockL2Store = new Map<string, { data: any; source: string; fetchedAt: string; etag: string | null }>();

  beforeEach(() => {
    mockL2Store.clear();
    vi.spyOn(AnalysisDatabase, "getInstance").mockReturnValue({
      getExternalCacheAsync: vi.fn(async (key: string) => {
        return mockL2Store.get(key) ?? null;
      }),
      saveExternalCacheAsync: vi.fn(async (key: string, data: any, source: string) => {
        mockL2Store.set(key, { data, source, fetchedAt: new Date().toISOString(), etag: null });
      }),
      getExternalCache: vi.fn((key: string) => {
        return mockL2Store.get(key) ?? null;
      }),
      saveExternalCache: vi.fn((key: string, data: any, source: string) => {
        mockL2Store.set(key, { data, source, fetchedAt: new Date().toISOString(), etag: null });
      }),
    } as any);
  });
  it("should allow setting and getting cached PDB structures", () => {
    pdbCache.set("P00439", "MOCK_PDB_CONTENT");
    expect(pdbCache.get("P00439")).toBe("MOCK_PDB_CONTENT");
    expect(pdbCache.has("P00439")).toBe(true);
    pdbCache.delete("P00439");
    expect(pdbCache.get("P00439")).toBeUndefined();
  });

  it("should allow setting and getting cached PDBe best structure mappings", () => {
    const mockMapping = { pdbId: "1pah", chainId: "A", shift: 0, unpStart: 1, structStart: 1 };
    bestPdbCache.set("P00439:408", mockMapping);
    expect(bestPdbCache.get("P00439:408")).toEqual(mockMapping);
    bestPdbCache.delete("P00439:408");
    expect(bestPdbCache.get("P00439:408")).toBeUndefined();
  });

  it("should allow setting and getting cached UniProt mappings", () => {
    uniprotCache.set("PAH", "P00439");
    expect(uniprotCache.get("PAH")).toBe("P00439");
    uniprotCache.delete("PAH");
    expect(uniprotCache.get("PAH")).toBeUndefined();
  });

  it("should clear all caches when clearAllCaches is called", () => {
    pdbCache.set("KEY1", "VAL1");
    bestPdbCache.set("KEY1_PDB", { pdbId: "1abc" });
    uniprotCache.set("KEY2", "VAL2");
    clinvarCache.set("KEY3", "VAL3");
    
    clearAllCaches();
    
    expect(pdbCache.get("KEY1")).toBeUndefined();
    expect(bestPdbCache.get("KEY1_PDB")).toBeUndefined();
    expect(uniprotCache.get("KEY2")).toBeUndefined();
    expect(clinvarCache.get("KEY3")).toBeUndefined();
  });

  it("coalesces concurrent requests using singleFlight", async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 20));
      return { data: "test_val" };
    };

    const [res1, res2, res3] = await Promise.all([
      singleFlight("test_single_flight", fetcher),
      singleFlight("test_single_flight", fetcher),
      singleFlight("test_single_flight", fetcher)
    ]);

    expect(callCount).toBe(1);
    expect(res1).toEqual({ data: "test_val" });
    expect(res2).toEqual({ data: "test_val" });
    expect(res3).toEqual({ data: "test_val" });
  });

  it("reads from L1 and L2 via getCachedOrFetch", async () => {
    let fetchCount = 0;
    const testKey = `test_2tier_key_${Date.now()}_${Math.random()}`;
    const fetcher = async () => {
      fetchCount++;
      return { score: 0.95 };
    };

    // First call: executes fetcher, saves to L1 & L2
    const res1 = await getCachedOrFetch({
      key: testKey,
      source: "UnitTest",
      l1Cache: clinvarCache,
      ttlSeconds: 60,
      fetcher
    });
    expect(fetchCount).toBe(1);
    expect(res1).toEqual({ score: 0.95 });

    // Second call: hits L1 memory cache
    const res2 = await getCachedOrFetch({
      key: testKey,
      source: "UnitTest",
      l1Cache: clinvarCache,
      ttlSeconds: 60,
      fetcher
    });
    expect(fetchCount).toBe(1);
    expect(res2).toEqual({ score: 0.95 });

    // Allow async L2 SQLite write to persist before clearing L1 memory
    await new Promise((r) => setTimeout(r, 50));
    clinvarCache.delete(testKey);
    const res3 = await getCachedOrFetch({
      key: testKey,
      source: "UnitTest",
      l1Cache: clinvarCache,
      ttlSeconds: 60,
      fetcher
    });
    expect(fetchCount).toBe(1);
    expect(res3).toEqual({ score: 0.95 });
    // And verifies L1 was re-warmed
    expect(clinvarCache.get(testKey)).toEqual({ score: 0.95 });
  });
});


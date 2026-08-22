import { describe, it, expect, vi } from "vitest";
import { pdbCache, bestPdbCache, uniprotCache, clinvarCache, clearAllCaches, getCachedOrFetch, singleFlight } from "./cache.ts";

describe("LRU Cache", () => {
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
    const fetcher = async () => {
      fetchCount++;
      return { score: 0.95 };
    };

    // First call: executes fetcher, saves to L1 & L2
    const res1 = await getCachedOrFetch({
      key: "test_2tier_key",
      source: "UnitTest",
      l1Cache: clinvarCache,
      ttlSeconds: 60,
      fetcher
    });
    expect(fetchCount).toBe(1);
    expect(res1).toEqual({ score: 0.95 });

    // Second call: hits L1 memory cache
    const res2 = await getCachedOrFetch({
      key: "test_2tier_key",
      source: "UnitTest",
      l1Cache: clinvarCache,
      ttlSeconds: 60,
      fetcher
    });
    expect(fetchCount).toBe(1);
    expect(res2).toEqual({ score: 0.95 });

    // Clear L1 memory: third call hits L2 SQLite
    clinvarCache.delete("test_2tier_key");
    const res3 = await getCachedOrFetch({
      key: "test_2tier_key",
      source: "UnitTest",
      l1Cache: clinvarCache,
      ttlSeconds: 60,
      fetcher
    });
    expect(fetchCount).toBe(1);
    expect(res3).toEqual({ score: 0.95 });
    // And verifies L1 was re-warmed
    expect(clinvarCache.get("test_2tier_key")).toEqual({ score: 0.95 });
  });
});


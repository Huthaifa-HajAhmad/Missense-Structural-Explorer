import { describe, it, expect } from "vitest";
import { pdbCache, uniprotCache, clinvarCache, clearAllCaches } from "./cache.ts";

describe("LRU Cache", () => {
  it("should allow setting and getting cached PDB structures", () => {
    pdbCache.set("P00439", "MOCK_PDB_CONTENT");
    expect(pdbCache.get("P00439")).toBe("MOCK_PDB_CONTENT");
    expect(pdbCache.has("P00439")).toBe(true);
    pdbCache.delete("P00439");
    expect(pdbCache.get("P00439")).toBeUndefined();
  });

  it("should allow setting and getting cached UniProt mappings", () => {
    uniprotCache.set("PAH", "P00439");
    expect(uniprotCache.get("PAH")).toBe("P00439");
    uniprotCache.delete("PAH");
    expect(uniprotCache.get("PAH")).toBeUndefined();
  });

  it("should clear all caches when clearAllCaches is called", () => {
    pdbCache.set("KEY1", "VAL1");
    uniprotCache.set("KEY2", "VAL2");
    clinvarCache.set("KEY3", "VAL3");
    
    clearAllCaches();
    
    expect(pdbCache.get("KEY1")).toBeUndefined();
    expect(uniprotCache.get("KEY2")).toBeUndefined();
    expect(clinvarCache.get("KEY3")).toBeUndefined();
  });
});

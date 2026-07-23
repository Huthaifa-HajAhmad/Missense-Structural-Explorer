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

export function clearAllCaches() {
  pdbCache.clear();
  uniprotCache.clear();
  clinvarCache.clear();
  predictorCache.clear();
  conservationCache.clear();
  stringCache.clear();
  gnomadFreqCache.clear();
  gnomadConstraintCache.clear();
  uniprotFeaturesCache.clear();
  landscapeCache.clear();
}

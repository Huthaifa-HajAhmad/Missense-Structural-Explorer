import type { LRUCache } from "lru-cache";
import { normalizeGeneSymbol, fetchWithRetry } from "../infra/http-client.ts";
import { stringCache, getCachedOrFetch } from "../infra/cache.ts";
import { buildStringKey } from "../infra/cache-keys.ts";

export interface FetchStringOptions {
  l1Cache?: LRUCache<string, any>;
  bypassSqlite?: boolean;
}

export interface StringInteraction {
  partner: string;
  score: number;
}

export async function fetchStringInteractions(
  gene: string,
  options?: FetchStringOptions
): Promise<StringInteraction[]> {
  const normGene = normalizeGeneSymbol(gene);
  const cacheKey = buildStringKey(normGene);

  return getCachedOrFetch({
    key: cacheKey,
    source: "STRING-DB Network API",
    l1Cache: options?.l1Cache ?? stringCache,
    ttlSeconds: 14 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    shouldCache: (result: StringInteraction[]) => Array.isArray(result) && result.length > 0,
    fetcher: async () => {
      const url = `https://string-db.org/api/json/network?identifiers=${encodeURIComponent(normGene)}&species=9606`;
      
      try {
        const res = await fetchWithRetry(url, { timeout: 15000 });
        if (res.ok) {
          const data = await res.json() as any;
          if (Array.isArray(data)) {
            const partnersMap = new Map<string, number>();
            const targetUpper = normGene.toUpperCase();
            for (const item of data) {
              const nameA = (item.preferredName_A || "").toUpperCase();
              const nameB = (item.preferredName_B || "").toUpperCase();
              const score = item.score !== undefined ? parseFloat(item.score) : 0.4;
              
              if (nameA === targetUpper && nameB !== targetUpper) {
                partnersMap.set(nameB, Math.max(partnersMap.get(nameB) || 0, score));
              } else if (nameB === targetUpper && nameA !== targetUpper) {
                partnersMap.set(nameA, Math.max(partnersMap.get(nameA) || 0, score));
              }
            }
            const parsed = Array.from(partnersMap.entries()).map(([partner, score]) => ({ partner, score }));
            parsed.sort((a, b) => b.score - a.score);
            const sliced = parsed.slice(0, 5);
            if (sliced.length === 0) {
              (options?.l1Cache ?? stringCache).set(cacheKey, [], { ttl: 5 * 60 * 1000 });
            }
            return sliced;
          }
        }
      } catch (err: any) {
        console.warn(`[STRING Network Fetch Error] Failed to fetch STRING network: ${err.message}`);
      }

      (options?.l1Cache ?? stringCache).set(cacheKey, [], { ttl: 5 * 60 * 1000 });
      return [];
    }
  });
}

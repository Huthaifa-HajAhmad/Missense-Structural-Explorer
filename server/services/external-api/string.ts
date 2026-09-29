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

/**
 * A STRING lookup's outcome alongside its rows.
 *
 * `status: "failed"` is the whole point of this type: the fetcher used to catch
 * its own error and return `[]`, so a dead endpoint and a gene with no known
 * partners were the same value. The PPI tab rendered that `[]` as "STRING-db
 * returns no association for <gene> at or above its lowest confidence band",
 * which is a claim about the protein that a failed HTTP call cannot support.
 *
 * An empty `partners` with `status: "ok"` IS such a claim, and is what STRING
 * actually answered.
 */
export interface StringInteractionsResult {
  partners: StringInteraction[];
  status: "ok" | "failed";
}

/** Negative-cache TTL for a failed or empty lookup, as before. */
const NEGATIVE_TTL_MS = 5 * 60 * 1000;

/**
 * Resolves STRING-db functional partners for `gene`, reporting whether the
 * lookup succeeded.
 *
 * The cached value shape changed from `StringInteraction[]` to
 * `StringInteractionsResult` so the status survives every cache path — including
 * the L2 SQLite tier, which only ever holds successful answers (see `shouldCache`)
 * and therefore could not have carried the distinction on its own.
 */
export async function fetchStringInteractionsWithStatus(
  gene: string,
  options?: FetchStringOptions
): Promise<StringInteractionsResult> {
  const normGene = normalizeGeneSymbol(gene);
  const cacheKey = buildStringKey(normGene);
  const l1Cache = options?.l1Cache ?? stringCache;

  const raw = await getCachedOrFetch<StringInteractionsResult | StringInteraction[]>({
    key: cacheKey,
    source: "STRING-DB Network API",
    l1Cache,
    ttlSeconds: 14 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    // Only a real, non-empty answer earns the 14-day TTL. An empty answer and a
    // failure are both written to L1 alone by the fetcher below, for 5 minutes.
    shouldCache: (result) =>
      !Array.isArray(result) && result.status === "ok" && result.partners.length > 0,
    fetcher: async () => {
      // `caller_identity` is how STRING asks API clients to identify themselves (string-db.org/help/api).
      const url = `https://string-db.org/api/json/network?identifiers=${encodeURIComponent(normGene)}&species=9606&caller_identity=missense-structural-explorer`;

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
              // A row without a score is skipped, not given one: this used to default to 0.4, the floor of
              // STRING's "medium" band, so a missing value was reported as medium-confidence evidence.
              const score = item.score !== undefined ? parseFloat(item.score) : NaN;
              if (!Number.isFinite(score)) continue;

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
              l1Cache.set(cacheKey, { partners: [], status: "ok" }, { ttl: NEGATIVE_TTL_MS });
            }
            return { partners: sliced, status: "ok" } as StringInteractionsResult;
          }
        }
      } catch (err: any) {
        console.warn(`[STRING Network Fetch Error] Failed to fetch STRING network: ${err.message}`);
      }

      // Unreachable is not the same as empty: this answer carries the failure.
      l1Cache.set(cacheKey, { partners: [], status: "failed" }, { ttl: NEGATIVE_TTL_MS });
      return { partners: [], status: "failed" } as StringInteractionsResult;
    }
  });

  // A cache entry written before this change is a bare array, and the old
  // `shouldCache` only ever stored non-empty ones, so it can only be a
  // successful answer.
  return Array.isArray(raw) ? { partners: raw, status: "ok" } : raw;
}

/**
 * Backward-compatible rows-only accessor. Callers that cannot act on a failure
 * (the analysis pipeline's own STRING stage) keep the old shape.
 */
export async function fetchStringInteractions(
  gene: string,
  options?: FetchStringOptions
): Promise<StringInteraction[]> {
  return (await fetchStringInteractionsWithStatus(gene, options)).partners;
}

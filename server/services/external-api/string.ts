import type { LRUCache } from "lru-cache";
import { LRUCache as LRUCacheImpl } from "lru-cache";
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

/**
 * STRING partner lists for the Interfaces & PPI tab: the PHYSICAL sub-network (evidence that the two
 * proteins bind or sit in one complex) and the FUNCTIONAL network (any association: co-expression,
 * text mining, pathways), each down to STRING's lowest band (0.15).
 *
 * Why not `fetchStringInteractions`: it returns the functional top five, so for every partner a
 * curator or an IntAct screen named, the screen could only say "not in STRING's top five" — STRING
 * was never actually asked about it. Here each list goes to `STRING_PARTNER_LIMIT` rows; a partner
 * absent from a list shorter than that has no association at or above 0.15 in that network.
 *
 * Endpoint: https://string-db.org/api/json/interaction_partners (network_type, required_score in
 * thousandths, limit). Version from /api/json/version. Only a successful answer is cached.
 */
export const STRING_PARTNER_LIMIT = 500;
export const STRING_MIN_SCORE = 0.15;

export interface StringPartnerLists {
  physical: StringInteraction[] | null;
  functional: StringInteraction[] | null;
  version: string | null;
  limit: number;
  minScore: number;
}

const partnerListCache = new LRUCacheImpl<string, StringPartnerLists>({ max: 500, ttl: 14 * 24 * 60 * 60 * 1000 });

async function partnersOf(gene: string, networkType: "physical" | "functional"): Promise<StringInteraction[] | null> {
  const url =
    `https://string-db.org/api/json/interaction_partners?identifiers=${encodeURIComponent(gene)}&species=9606` +
    `&network_type=${networkType}&required_score=${Math.round(STRING_MIN_SCORE * 1000)}&limit=${STRING_PARTNER_LIMIT}` +
    `&caller_identity=missense-structural-explorer`;
  try {
    const res = await fetchWithRetry(url, { timeout: 15000 });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!Array.isArray(data)) return null;
    const target = gene.toUpperCase();
    const best = new Map<string, number>();
    for (const row of data) {
      const a = String(row.preferredName_A ?? "").toUpperCase();
      const b = String(row.preferredName_B ?? "").toUpperCase();
      const score = Number(row.score);
      if (!Number.isFinite(score)) continue;
      const partner = a === target ? b : b === target ? a : b;
      if (!partner || partner === target) continue;
      best.set(partner, Math.max(best.get(partner) ?? 0, score));
    }
    return [...best].map(([partner, score]) => ({ partner, score })).sort((x, y) => y.score - x.score);
  } catch (err: any) {
    console.warn(`[STRING] ${networkType} partners failed for ${gene}: ${err?.message}`);
    return null;
  }
}

async function stringVersion(): Promise<string | null> {
  try {
    const res = await fetchWithRetry("https://string-db.org/api/json/version", { timeout: 10000 });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const v = Array.isArray(data) ? data[0]?.string_version : data?.string_version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function fetchStringPartnerLists(gene: string): Promise<StringPartnerLists> {
  const normGene = normalizeGeneSymbol(gene);
  const hit = partnerListCache.get(normGene);
  if (hit) return hit;
  const [physical, functional, version] = await Promise.all([
    partnersOf(normGene, "physical"),
    partnersOf(normGene, "functional"),
    stringVersion(),
  ]);
  const lists: StringPartnerLists = { physical, functional, version, limit: STRING_PARTNER_LIMIT, minScore: STRING_MIN_SCORE };
  if (physical && functional) partnerListCache.set(normGene, lists);
  return lists;
}

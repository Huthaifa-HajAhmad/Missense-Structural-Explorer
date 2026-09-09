import crypto from "crypto";
import { LRUCache } from "lru-cache";

export interface EvolutionaryScaleResult {
  score: number | null;
  status: "live" | "token_required" | "unavailable";
  message?: string;
}

const evo2Cache = new LRUCache<string, EvolutionaryScaleResult>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 14 // 14 days
});

const gpnCache = new LRUCache<string, EvolutionaryScaleResult>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 14 // 14 days
});

export function clearEvo2Cache(): void {
  evo2Cache.clear();
}

export function clearGpnCache(): void {
  gpnCache.clear();
}

interface QueryModelOptions {
  model: string;
  sequence: string;
  pos: number;
  wt: string;
  mut: string;
  token?: string | null;
  cache: LRUCache<string, EvolutionaryScaleResult>;
  endpoint: string;
  label: string;
}

async function queryEvolutionaryScaleModel(options: QueryModelOptions): Promise<EvolutionaryScaleResult> {
  const { model, sequence, pos, wt, mut, token, cache, endpoint, label } = options;
  const tokenToUse = token || process.env.BIOHUB_API_TOKEN || process.env.EVO2_API_KEY || null;
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex").slice(0, 16);
  const cacheKey = `${seqHash}:${pos}:${wt.toUpperCase()}:${mut.toUpperCase()}`;

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (!tokenToUse) {
    return {
      score: null,
      status: "token_required",
      message: `Requires EvolutionaryScale / Biohub API key for ${label}`
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tokenToUse}`
      },
      body: JSON.stringify({
        model,
        sequence,
        position: pos,
        wt: wt.toUpperCase(),
        mut: mut.toUpperCase()
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (response.status === 401 || response.status === 403) {
      // Do not cache auth errors in the shared variant cache to avoid cross-user pollution
      return {
        score: null,
        status: "token_required",
        message: `EvolutionaryScale token invalid or unauthorized for ${label}`
      };
    }

    if (!response.ok) {
      return {
        score: null,
        status: "unavailable",
        message: `Upstream error ${response.status}: ${response.statusText}`
      };
    }

    const data = (await response.json()) as any;
    const scoreVal = typeof data.score === "number" 
      ? data.score 
      : (typeof data.delta_llr === "number" 
          ? data.delta_llr 
          : (typeof data.llr === "number" ? data.llr : null));

    if (scoreVal !== null) {
      const res: EvolutionaryScaleResult = {
        score: scoreVal,
        status: "live"
      };
      cache.set(cacheKey, res);
      return res;
    }

    return {
      score: null,
      status: "unavailable",
      message: `No score returned by upstream ${label} API`
    };
  } catch (err: any) {
    const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");
    return {
      score: null,
      status: "unavailable",
      message: isTimeout ? `${label} API timed out (25s limit)` : (err.message || "Network error")
    };
  }
}

/**
 * Queries EvolutionaryScale API endpoint for Evo 2 foundation model delta LLR score.
 * Endpoint: https://api.evolutionaryscale.ai/v1/evo2 (or EVO2_API_URL)
 */
export async function fetchEvo2Score(
  sequence: string,
  pos: number,
  wt: string,
  mut: string,
  token?: string | null
): Promise<EvolutionaryScaleResult> {
  const endpoint = process.env.EVO2_API_URL || "https://api.evolutionaryscale.ai/v1/evo2";
  return queryEvolutionaryScaleModel({
    model: "evo2-40b",
    sequence,
    pos,
    wt,
    mut,
    token,
    cache: evo2Cache,
    endpoint,
    label: "Evo 2"
  });
}

/**
 * Queries EvolutionaryScale API endpoint for GPN-Star protein-specific zero-shot likelihood score.
 * Endpoint: https://api.evolutionaryscale.ai/v1/evo2 (or GPN_API_URL / EVO2_API_URL)
 */
export async function fetchGpnStarScore(
  sequence: string,
  pos: number,
  wt: string,
  mut: string,
  token?: string | null
): Promise<EvolutionaryScaleResult> {
  const endpoint = process.env.GPN_API_URL || process.env.EVO2_API_URL || "https://api.evolutionaryscale.ai/v1/evo2";
  return queryEvolutionaryScaleModel({
    model: "gpn-star",
    sequence,
    pos,
    wt,
    mut,
    token,
    cache: gpnCache,
    endpoint,
    label: "GPN-Star"
  });
}

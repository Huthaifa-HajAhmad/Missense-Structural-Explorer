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

export function clearEvo2Cache(): void {
  evo2Cache.clear();
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
  const tokenToUse = token || process.env.BIOHUB_API_TOKEN || process.env.EVO2_API_KEY || null;
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex").slice(0, 16);
  const cacheKey = `${seqHash}:${pos}:${wt.toUpperCase()}:${mut.toUpperCase()}`;

  const cached = evo2Cache.get(cacheKey);
  if (cached) return cached;

  if (!tokenToUse) {
    const res: EvolutionaryScaleResult = {
      score: null,
      status: "token_required",
      message: "Requires EvolutionaryScale / Biohub API key"
    };
    return res;
  }

  const endpoint = process.env.EVO2_API_URL || "https://api.evolutionaryscale.ai/v1/evo2";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tokenToUse}`
      },
      body: JSON.stringify({
        model: "evo2-40b",
        sequence,
        position: pos,
        wt: wt.toUpperCase(),
        mut: mut.toUpperCase()
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (response.status === 401 || response.status === 403) {
      const res: EvolutionaryScaleResult = {
        score: null,
        status: "token_required",
        message: "EvolutionaryScale token invalid or unauthorized"
      };
      evo2Cache.set(cacheKey, res, { ttl: 60 * 1000 });
      return res;
    }

    if (!response.ok) {
      const res: EvolutionaryScaleResult = {
        score: null,
        status: "unavailable",
        message: `Upstream error ${response.status}: ${response.statusText}`
      };
      return res;
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
      evo2Cache.set(cacheKey, res);
      return res;
    }

    return {
      score: null,
      status: "unavailable",
      message: "No score returned by upstream Evo 2 API"
    };
  } catch (err: any) {
    const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");
    return {
      score: null,
      status: "unavailable",
      message: isTimeout ? "Evo 2 API timed out (5s limit)" : (err.message || "Network error")
    };
  }
}

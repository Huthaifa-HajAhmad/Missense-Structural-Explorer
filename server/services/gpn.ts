import crypto from "crypto";
import { LRUCache } from "lru-cache";
import type { ModelInferenceResult } from "./evo2.ts";

export type { ModelInferenceResult };

// 14-day LRU cache for Song Lab GPN-Star predictions
const gpnCache = new LRUCache<string, ModelInferenceResult>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 14 // 14 days
});

export function clearGpnCache(): void {
  gpnCache.clear();
}

/**
 * Queries Song Lab GPN-Star (vertebrate MSA alignment / sapiens model) via
 * local GPN sidecar (GPN_API_URL) or Hugging Face Inference API.
 */
export async function fetchGpnStarScore(
  sequence: string,
  pos: number,
  wt: string,
  mut: string,
  token?: string | null,
  signal?: AbortSignal
): Promise<ModelInferenceResult> {
  if (!sequence || typeof pos !== "number" || pos < 1 || !wt || !mut) {
    return {
      score: null,
      status: "unavailable",
      message: "Invalid sequence or mutation coordinates for GPN-Star"
    };
  }

  const tokenToUse =
    token ||
    process.env.HF_TOKEN ||
    process.env.HUGGINGFACE_API_KEY ||
    null;

  const endpoint =
    process.env.GPN_API_URL ||
    (tokenToUse
      ? "https://router.huggingface.co/hf-inference/models/songlab/gpn-msa-sapiens"
      : null);

  const wtUpper = wt.toUpperCase();
  const mutUpper = mut.toUpperCase();
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex").slice(0, 16);
  const cacheKey = `${seqHash}:${pos}:${wtUpper}:${mutUpper}`;

  const cached = gpnCache.get(cacheKey);
  if (cached) return cached;

  if (!endpoint) {
    return {
      score: null,
      status: "token_required",
      message: "Song Lab GPN-Star requires Hugging Face token (songlab/gpn-msa-sapiens) or local GPN sidecar (GPN_API_URL)"
    };
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (tokenToUse) {
      headers["Authorization"] = `Bearer ${tokenToUse}`;
    }

    const payload = {
      model: "songlab/gpn-msa-sapiens",
      sequence,
      position: pos,
      wt: wtUpper,
      mut: mutUpper,
      inputs: `${sequence}:${pos}:${wtUpper}>${mutUpper}`
    };

    const combinedSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
      : AbortSignal.timeout(25000);

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: combinedSignal
    });

    if (response.status === 401 || response.status === 403) {
      return {
        score: null,
        status: "token_required",
        message: "Hugging Face inference token invalid or unauthorized for songlab/gpn-msa-sapiens"
      };
    }

    if (response.status === 429) {
      return {
        score: null,
        status: "unavailable",
        message: "Hugging Face / GPN rate limit reached; please retry shortly"
      };
    }

    if (response.status === 503) {
      // Model loading / cold start on Hugging Face
      return {
        score: null,
        status: "unavailable",
        message: "Song Lab GPN model is warming up on Hugging Face; please retry in ~20s"
      };
    }

    if (!response.ok) {
      return {
        score: null,
        status: "unavailable",
        message: `Upstream GPN error ${response.status}: ${response.statusText}`
      };
    }

    const data = (await response.json()) as any;
    const rawVal =
      typeof data.score === "number"
        ? data.score
        : typeof data.delta_llr === "number"
        ? data.delta_llr
        : typeof data.llr === "number"
        ? data.llr
        : typeof data.log_likelihood_ratio === "number"
        ? data.log_likelihood_ratio
        : Array.isArray(data) && typeof data[0]?.score === "number"
        ? data[0].score
        : null;

    const scoreVal = rawVal !== null && Number.isFinite(rawVal) ? rawVal : null;

    if (scoreVal !== null) {
      const res: ModelInferenceResult = {
        score: scoreVal,
        status: "live"
      };
      gpnCache.set(cacheKey, res);
      return res;
    }

    return {
      score: null,
      status: "unavailable",
      message: "No valid finite score returned by upstream GPN API"
    };
  } catch (err: any) {
    const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");
    return {
      score: null,
      status: "unavailable",
      message: isTimeout ? "GPN API timed out (25s limit)" : (err.message || "Network error")
    };
  }
}

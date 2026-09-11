import crypto from "crypto";
import { LRUCache } from "lru-cache";

export interface ModelInferenceResult {
  score: number | null;
  status: "live" | "token_required" | "unavailable";
  message?: string;
}

// 14-day LRU cache for Evo 2 model predictions
const evo2Cache = new LRUCache<string, ModelInferenceResult>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 14 // 14 days
});

export function clearEvo2Cache(): void {
  evo2Cache.clear();
}

/**
 * Queries Arc Institute Evo 2 (40B) foundation model via NVIDIA BioNeMo NIM or custom endpoint.
 * Default NIM Endpoint: https://integrate.api.nvidia.com/v1/biology/arc/evo2-40b
 */
export async function fetchEvo2Score(
  sequence: string,
  pos: number,
  wt: string,
  mut: string,
  token?: string | null,
  signal?: AbortSignal,
  customEndpoint?: string | null
): Promise<ModelInferenceResult> {
  if (!sequence || typeof pos !== "number" || pos < 1 || !wt || !mut) {
    return {
      score: null,
      status: "unavailable",
      message: "Invalid sequence or mutation coordinates for Evo 2"
    };
  }

  const isCustomUrl = Boolean(customEndpoint);
  // Security Mandate: Never forward server-level environment secrets to client-supplied custom endpoints (prevent SSRF token exfiltration)
  const tokenToUse = isCustomUrl
    ? (token || null)
    : (token || process.env.NVIDIA_API_KEY || process.env.EVO2_API_KEY || null);

  const rawEndpoint =
    customEndpoint ||
    process.env.EVO2_API_URL ||
    "https://integrate.api.nvidia.com/v1/biology/arc/evo2-40b";
  const endpoint = rawEndpoint.replace(/\/+$/, "");

  const wtUpper = wt.toUpperCase();
  const mutUpper = mut.toUpperCase();
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex").slice(0, 16);
  const cacheKey = `${seqHash}:${pos}:${wtUpper}:${mutUpper}:${endpoint}`;

  const cached = evo2Cache.get(cacheKey);
  if (cached) return cached;

  if (!tokenToUse && !customEndpoint && !process.env.EVO2_API_URL) {
    return {
      score: null,
      status: "token_required",
      message: "Requires NVIDIA BioNeMo or Evo 2 API key (Arc Institute)"
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
      model: "arc/evo2-40b",
      sequence,
      position: pos,
      wt: wtUpper,
      mut: mutUpper,
      sequences: [sequence],
      mutations: [`${wtUpper}${pos}${mutUpper}`]
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
        message: "NVIDIA BioNeMo / Evo 2 API key invalid or unauthorized (HTTP 401/403)"
      };
    }

    if (response.status === 429) {
      return {
        score: null,
        status: "unavailable",
        message: "NVIDIA BioNeMo rate limit reached; please retry shortly (HTTP 429)"
      };
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      const detail = errBody?.detail || errBody?.message || errBody?.error?.message || response.statusText;
      return {
        score: null,
        status: "unavailable",
        message: `Upstream Evo 2 error ${response.status}: ${detail}`
      };
    }

    const data = (await response.json()) as any;
    const rawVal =
      typeof data.score === "number"
        ? data.score
        : typeof data.delta_score === "number"
        ? data.delta_score
        : typeof data.delta_llr === "number"
        ? data.delta_llr
        : typeof data.log_likelihood_ratio === "number"
        ? data.log_likelihood_ratio
        : typeof data.llr === "number"
        ? data.llr
        : Array.isArray(data.predictions) && typeof (data.predictions[0]?.delta_llr ?? data.predictions[0]?.score) === "number"
        ? (data.predictions[0].delta_llr ?? data.predictions[0].score)
        : null;

    const scoreVal = rawVal !== null && Number.isFinite(rawVal) ? rawVal : null;

    if (scoreVal !== null) {
      const res: ModelInferenceResult = {
        score: scoreVal,
        status: "live"
      };
      evo2Cache.set(cacheKey, res);
      return res;
    }

    return {
      score: null,
      status: "unavailable",
      message: "No valid finite score returned by upstream Evo 2 API"
    };
  } catch (err: any) {
    const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");
    return {
      score: null,
      status: "unavailable",
      message: isTimeout ? "Evo 2 API timed out (25s limit)" : (err.message || "Network error")
    };
  }
}

import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { anySignal } from "../../utils.ts";

export type JapanFoldModel = "esmfold2-fast" | "esmfold2" | "boltz2" | "openfold3";

export interface JapanFoldPredictionResponse {
  id?: string;
  status: "pending" | "running" | "completed" | "failed";
  output?: {
    pdb?: string;
    plddt?: number[];
    ptm?: number;
  };
  error?: string;
}

const JAPANFOLD_BASE_URL = process.env.JAPANFOLD_API_URL || "https://api.japanfold.aiand.com/v1/predictions";
const japanfoldCache = new LRUCache<string, any>({ max: 200, ttl: 12 * 60 * 60 * 1000 });

/**
 * Executes or polls a keyless structural folding job via the JapanFold sovereign platform.
 */
export async function runJapanFoldInference(
  model: JapanFoldModel = "esmfold2-fast",
  payload: {
    sequence: string;
  },
  signal?: AbortSignal
): Promise<{ success: boolean; data?: any; error?: string }> {
  const seqHash = crypto.createHash("sha256").update(payload.sequence).digest("hex").slice(0, 16);
  const cacheKey = `${model}:${seqHash}`;
  const cached = japanfoldCache.get(cacheKey);
  if (cached) {
    return { success: true, data: cached };
  }

  const apiKey = process.env.JAPANFOLD_API_KEY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Missense-Structural-Explorer/1.0"
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const fetchSignal = signal
      ? signal
      : AbortSignal.timeout(30000);

    const submitRes = await fetch(JAPANFOLD_BASE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        sequence: payload.sequence
      }),
      signal: fetchSignal
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      return { success: false, error: `JapanFold API HTTP ${submitRes.status}: ${errText.slice(0, 150)}` };
    }

    const resJson = await submitRes.json() as JapanFoldPredictionResponse;

    // If synchronous completion
    if (resJson.status === "completed" && resJson.output) {
      japanfoldCache.set(cacheKey, resJson.output);
      return { success: true, data: resJson.output };
    }

    // If asynchronous job ID returned, poll briefly (up to 12s)
    if (resJson.id && (resJson.status === "pending" || resJson.status === "running")) {
      const pollStart = Date.now();
      while (Date.now() - pollStart < 12000) {
        await new Promise(r => setTimeout(r, 1500));
        if (signal?.aborted) break;

        const pollSignal = signal ? anySignal([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
        const pollRes = await fetch(`${JAPANFOLD_BASE_URL}/${resJson.id}`, { headers, signal: pollSignal });
        if (pollRes.ok) {
          const pollData = await pollRes.json() as JapanFoldPredictionResponse;
          if (pollData.status === "completed" && pollData.output) {
            japanfoldCache.set(cacheKey, pollData.output);
            return { success: true, data: pollData.output };
          }
          if (pollData.status === "failed") {
            return { success: false, error: pollData.error || "JapanFold execution failed" };
          }
        }
      }
    }

    return { success: false, error: "JapanFold inference timed out or returned pending state" };
  } catch (err: any) {
    return { success: false, error: `JapanFold network error: ${err.message}` };
  }
}

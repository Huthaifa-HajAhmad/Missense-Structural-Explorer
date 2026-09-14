/**
 * evaluator.ts — ESM2 / VESM variant effect evaluation.
 */
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { LRUCache } from "lru-cache";
import { CONFIG } from "../../../config.ts";
import { defaultCacheRegistry } from "../../infra/cache-registry.ts";

const execFileAsync = promisify(execFile);

export const esm2Cache = new LRUCache<string, { llr: number; verdict: string }>({
  max: 200
});
defaultCacheRegistry.registerCache("esm2Cache", esm2Cache, { ttlDesc: "session" });

export async function runEsm2Eval(
  seq: string,
  pos: number,
  wt: string,
  mut: string
): Promise<{ llr: number; verdict: string } | null> {
  const seqHash = crypto.createHash("sha256").update(seq).digest("hex").slice(0, 16);
  const cacheKey = `${seqHash}_${pos}_${wt}_${mut}`;
  const cached = esm2Cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Try HTTP first
  try {
    const res = await fetch(`${CONFIG.services.sidecarBaseUrl}/predict/vesm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sidecar-Secret": process.env.SIDECAR_SECRET || ""
      },
      body: JSON.stringify({ sequence: seq, position: pos, wt, mut }),
      signal: AbortSignal.timeout(15000)
    });
    if (res.ok) {
      const parsed = await res.json();
      if (parsed.status === "success" && typeof parsed.llr === "number") {
        const result = { llr: parsed.llr, verdict: parsed.verdict !== undefined ? parsed.verdict : "raw score" };
        esm2Cache.set(cacheKey, result);
        return result;
      }
    }
  } catch (err: any) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[ESM2-Eval] Model server is offline or error: ${err.message}. Falling back to CLI subprocess.`);
    }
  }

  const pythonScript = path.join(process.cwd(), "tools", "esm2_eval.py");
  if (!fs.existsSync(pythonScript)) {
    console.warn(`[ESM2-Eval] Python sidecar not found at: ${pythonScript}.`);
    return null;
  }
  try {
    const { stdout } = await execFileAsync("python", ["-m", "uv", "run", pythonScript, seq, pos.toString(), wt, mut], { timeout: 30000 });
    const parsed = JSON.parse(stdout.trim());
    if (parsed.status === "success" && typeof parsed.llr === "number") {
      const result = { llr: parsed.llr, verdict: parsed.verdict };
      esm2Cache.set(cacheKey, result);
      return result;
    }
    console.warn(`[ESM2-Eval] Predictor returned error or invalid format:`, parsed);
    return null;
  } catch (err: any) {
    console.warn(`[ESM2-Eval] Process execution failed:`, err.message);
    return null;
  }
}

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
import { SIDECAR_BUDGET_HEADER } from "../../infra/sidecar-budget.ts";
import { toolsVenvPython } from "../../infra/tools-python.ts";

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

  // Try HTTP first with fast triage settings (skip unused unmasked embedding passes).
  // Dynamically allocate budget for long sequences (>500 residues).
  const httpTimeoutMs = seq.length > 500 ? 25000 : 15000;
  try {
    const res = await fetch(`${CONFIG.services.sidecarBaseUrl}/predict/vesm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sidecar-Secret": process.env.SIDECAR_SECRET || "",
        [SIDECAR_BUDGET_HEADER]: String(httpTimeoutMs)
      },
      body: JSON.stringify({ sequence: seq, position: pos, wt, mut, includeEmbeddings: false }),
      signal: AbortSignal.timeout(httpTimeoutMs)
    });
    if (res.ok) {
      const parsed = await res.json();
      if (parsed.status === "success" && typeof parsed.llr === "number") {
        const result = { llr: parsed.llr, verdict: parsed.verdict !== undefined ? parsed.verdict : "raw score" };
        esm2Cache.set(cacheKey, result);
        return result;
      }
    }
    /**
     * A refused pass (`503`, the CPU gate turning away a caller whose deadline had passed) means the
     * model server ANSWERED and was too busy to start one. The CLI fallback starts a second copy of the
     * model on the same CPUs — exactly what this function already refuses to do after a timeout — so it
     * must not run here either, or a busy server gets slower by being asked twice.
     */
    if (res.status === 503) {
      console.warn("[ESM2-Eval] The model server was too busy to start this pass; not starting a second model process.");
      return null;
    }
  } catch (err: any) {
    /**
     * A TIMEOUT means the model server is alive and busy. Loading a second copy of the model in a new
     * process on the same two CPUs only makes it slower, and on the production VM that process could
     * not even start (`python -m uv` does not exist in the container's virtual environment). Every
     * other failure (nothing listening, a refused connection) still falls back to the command line.
     */
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      console.warn(`[ESM2-Eval] The model server did not answer within ${httpTimeoutMs / 1000}s; not starting a second model process.`);
      return null;
    }
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
    // The tools environment's own interpreter first; `uv run` only when that environment is absent.
    const venvPython = toolsVenvPython();
    const [command, args] = venvPython
      ? [venvPython, [pythonScript, seq, pos.toString(), wt, mut]]
      : ["uv", ["run", "--no-project", pythonScript, seq, pos.toString(), wt, mut]];
    const { stdout } = await execFileAsync(command, args, { timeout: 30000 });
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

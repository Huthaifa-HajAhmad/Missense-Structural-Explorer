import { LRUCache } from "lru-cache";
import crypto from "crypto";
import { CONFIG } from "../config.ts";

export const esmfoldCache = new LRUCache<string, string>({
  max: 100,
  maxSize: 100 * 1024 * 1024, // 100MB limit
  sizeCalculation: (value) => value.length
});

export async function foldSequence(
  sequence: string,
  biohubToken?: string | null
): Promise<string> {
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex");
  const cacheKey = `esmfold:seq:${seqHash}`;
  const cached = esmfoldCache.get(cacheKey);
  if (cached) {
    console.log(`[ESMFold] Cache hit for sequence hash ${seqHash}`);
    return cached;
  }
  
  const pdbText = await foldSequenceInternal(sequence, biohubToken);
  esmfoldCache.set(cacheKey, pdbText);
  return pdbText;
}

async function foldSequenceInternal(
  sequence: string,
  biohubToken?: string | null
): Promise<string> {
  // 1. If Biohub token is available, attempt to query the official Biohub ESMFold2 model via Python sidecar
  if (biohubToken) {
    try {
      const sidecarSecret = process.env.SIDECAR_SECRET || "";
      const response = await fetch(`${CONFIG.services.sidecarBaseUrl}/predict/esmfold`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sidecar-Secret": sidecarSecret
        },
        body: JSON.stringify({
          sequence: sequence,
          biohubToken: biohubToken
        }),
        signal: AbortSignal.timeout(30000) // Folding is computationally heavy; give it 30 seconds
      });

      if (response.ok) {
        const data = await response.json() as any;
        if (data && data.status === "success" && data.pdb) {
          return data.pdb;
        }
      } else {
        const errText = await response.text();
        console.warn(`[Biohub API ESMFold Error] status ${response.status}: ${errText}`);
      }
    } catch (apiErr: any) {
      console.warn(`[Biohub API ESMFold Warning] Sidecar call failed: ${apiErr.message}. Trying public ESM Atlas fallback...`);
    }
  }

  // 2. Free Public ESM Atlas Folding Fallback
  try {
    const atlasRes = await fetch("https://api.esmatlas.com/foldSequence/v1/pdb/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: sequence,
      signal: AbortSignal.timeout(15000)
    });

    if (atlasRes.ok) {
      const pdbText = await atlasRes.text();
      if (pdbText && pdbText.includes("ATOM")) {
        return pdbText;
      }
    }
    if (atlasRes.status === 413 || atlasRes.status === 422 || sequence.length > 400) {
      throw new Error(`Sequence length (${sequence.length} aa) exceeds the public ESM Atlas limit of 400 aa. De novo folding for proteins > 400 aa requires an EvolutionaryScale/Biohub API token or local GPU execution.`);
    }
    throw new Error(`ESM Atlas returned HTTP ${atlasRes.status}${atlasRes.statusText ? ` (${atlasRes.statusText})` : ""}.`);
  } catch (atlasErr: any) {
    throw new Error(atlasErr.message?.startsWith("Sequence length") ? atlasErr.message : `Protein folding failed: ${atlasErr.message}`);
  }
}

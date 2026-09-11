import { LRUCache } from "lru-cache";
import crypto from "crypto";
import { CONFIG } from "../config.ts";
import { queryEsmfold2 } from "./japanfold-client.ts";

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
  const seqLen = sequence.length;

  // Fail fast immediately if sequence exceeds max Tier-1 limit (1,024 aa) and no Biohub token exists
  if (seqLen > 1024 && !biohubToken) {
    throw new Error(`Sequence length (${seqLen} aa) exceeds the de novo folding limits (1,024 aa for Tier-1 JapanFold ESMFold-2, and 400 aa for public ESM Atlas). De novo folding for proteins > 1,024 aa requires an EvolutionaryScale/Biohub API token or local GPU execution.`);
  }

  // 1. Attempt Tier-1: JapanFold ESMFold-2 (Up to 1,024 residues, Tenstorrent hardware)
  try {
    const jfPdb = await queryEsmfold2(sequence);
    if (jfPdb && jfPdb.includes("ATOM")) {
      console.log(`[ESMFold] Successfully folded ${seqLen} aa sequence via Tier-1 JapanFold ESMFold-2`);
      return jfPdb;
    }
  } catch (jfErr: any) {
    console.warn(`[ESMFold] Tier-1 JapanFold call failed: ${jfErr.message}. Proceeding to local sidecar fallback...`);
  }

  // 2. Fallback: If Biohub token is available, query official Biohub ESMFold2 via Python sidecar
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

  // 3. Free Public ESM Atlas Folding Fallback (strictly <= 400 aa)
  if (seqLen > 400) {
    throw new Error(`Sequence length (${seqLen} aa) exceeds the public ESM Atlas folding limit (400 aa). Tier-1 JapanFold ESMFold-2 was unavailable. De novo folding for proteins > 400 aa requires an EvolutionaryScale/Biohub API token or local GPU execution.`);
  }

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
      throw new Error(`Sequence length (${sequence.length} aa) exceeds the de novo folding limits (1,024 aa for Tier-1 JapanFold ESMFold-2, and 400 aa for public ESM Atlas). De novo folding for proteins > 1,024 aa requires an EvolutionaryScale/Biohub API token or local GPU execution.`);
    }
    throw new Error(`ESM Atlas returned HTTP ${atlasRes.status}${atlasRes.statusText ? ` (${atlasRes.statusText})` : ""}.`);
  } catch (atlasErr: any) {
    throw new Error(atlasErr.message?.startsWith("Sequence length") ? atlasErr.message : `Protein folding failed: ${atlasErr.message}`);
  }
}

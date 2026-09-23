export interface EsmcPreference {
  aa: string;
  prob: number;
}

export interface EsmcLocalShift {
  position: number;
  residue: string;
  shift: number;
}

export interface SaprotEvalResult {
  wtProbability?: number;
  mutProbability?: number;
  llr?: number;
  preferences?: EsmcPreference[];
  mutRank?: number;
  positionalEntropy?: number;
  embeddingShift?: number;
  localEmbeddingShift?: number;
  localShiftMap?: EsmcLocalShift[];
  klDivergence?: number | null;
  conformationState?: string | null;
  provenance?: string;
  hfError?: string | null;
  error?: string;
  status?: "offline" | "timeout" | "error" | "invalid_input" | string;
}

import { CONFIG } from "../../config.ts";
import { querySaProt } from "./japanfold-client.ts";

export type ModelEvalError = {
  error: string;
  status: "offline" | "timeout" | "error" | "invalid_input" | string;
};

export async function runSaprotAnalysis(
  gene: string,
  variant: string,
  uniprotId: string,
  sequence: string,
  hfToken?: string | null,
  wtPdb?: string | null,
  modelName: string = "westlake-repl/SaProt_650M_AF2",
  saprotEngine?: string
): Promise<SaprotEvalResult | null> {
  const mutMatch = variant.match(/([a-zA-Z]{3}|[a-zA-Z])\s*(\d+)\s*([a-zA-Z]{3}|[a-zA-Z])/);
  if (!mutMatch) return null;

  const rawWt = mutMatch[1];
  const pos = parseInt(mutMatch[2], 10);
  const rawMut = mutMatch[3];

  const wtRes = rawWt.length === 3 
    ? normalizeThreeLetterToSingle(rawWt) 
    : (["A", "R", "N", "D", "C", "Q", "E", "G", "H", "I", "L", "K", "M", "F", "P", "S", "T", "W", "Y", "V"].includes(rawWt.toUpperCase()) ? rawWt.toUpperCase() : null);

  const mutRes = rawMut.length === 3 
    ? normalizeThreeLetterToSingle(rawMut) 
    : (["A", "R", "N", "D", "C", "Q", "E", "G", "H", "I", "L", "K", "M", "F", "P", "S", "T", "W", "Y", "V"].includes(rawMut.toUpperCase()) ? rawMut.toUpperCase() : null);

  if (!wtRes || !mutRes) {
    return null;
  }

  // 1. Attempt Tier-1: JapanFold SaProt (Tenstorrent Galaxy Superclusters)
  try {
    const jfResult = await querySaProt(sequence, pos, wtRes, mutRes, wtPdb);
    if (jfResult && jfResult.status === "success") {
      const localShiftMap: EsmcLocalShift[] = jfResult.localShiftMap || [];
      let localEmbeddingShift = 0.0;
      if (localShiftMap.length > 0) {
        const sumShift = localShiftMap.reduce((acc: number, curr: any) => acc + (curr.shift || 0.0), 0.0);
        localEmbeddingShift = sumShift / localShiftMap.length;
      }
      return {
        wtProbability: jfResult.wtProbability,
        mutProbability: jfResult.mutProbability,
        llr: jfResult.llr,
        preferences: jfResult.preferences || [],
        mutRank: jfResult.mutRank,
        positionalEntropy: jfResult.positionalEntropy,
        embeddingShift: jfResult.embeddingShift,
        localEmbeddingShift,
        localShiftMap,
        klDivergence: jfResult.klDivergence,
        conformationState: jfResult.conformationState,
        provenance: jfResult.provenance
      };
    }
  } catch (jfErr: any) {
    console.warn(`[JapanFold SaProt] Tier-1 call failed: ${jfErr.message}. Falling back to local sidecar...`);
  }

  // 2. Fallback to Local Sidecar (runs on CPU on OCI 2 OCPU / 8GB RAM with SaProt_35M_AF2)
  const sidecarSecret = process.env.SIDECAR_SECRET || "";
  const sidecarUrl = `${CONFIG.services.sidecarBaseUrl}/predict/saprot`;
  try {
    const sidecarRes = await fetch(sidecarUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sidecar-Secret": sidecarSecret
      },
      body: JSON.stringify({
        sequence: sequence,
        position: pos,
        wt: wtRes,
        mut: mutRes,
        wtPdb: wtPdb || null,
        hfToken: hfToken || null,
        modelName: modelName,
        preferRemote: saprotEngine === "remote-hf" || (Boolean(hfToken) && saprotEngine !== "saprot-35m"),
        engine: saprotEngine || null
      }),
      signal: AbortSignal.timeout(120000) // CPU inference + model load can take 1-2 min
    });

    if (sidecarRes.ok) {
      const data = await sidecarRes.json() as any;
      if (data && data.status === "success" && typeof data.llr === "number") {
        const llr = data.llr;
        const wtProb = typeof data.wtProbability === "number" ? data.wtProbability : 0.0;
        const mutProb = typeof data.mutProbability === "number" ? data.mutProbability : 0.0;
        const mutRank = typeof data.mutRank === "number" ? data.mutRank : 1;
        const positionalEntropy = typeof data.positionalEntropy === "number" ? data.positionalEntropy : 0.0;
        const preferences = Array.isArray(data.preferences) ? data.preferences : [];
        /**
         * Absence is preserved, never coerced to 0. The sidecar reports null when its engine
         * could not produce an embedding (the serverless filler API has no feature-extraction
         * route for SaProt's 3Di tokens), and `0.000` on the card is indistinguishable from a
         * measured zero shift. The same applies to KL divergence, which the 3Di remote path
         * deliberately declines to fabricate.
         */
        const embeddingShift = typeof data.embeddingShift === "number" ? data.embeddingShift : undefined;
        const localShiftMap: EsmcLocalShift[] = Array.isArray(data.localShiftMap) ? data.localShiftMap : [];
        const klDivergence = typeof data.klDivergence === "number" ? data.klDivergence : null;
        const conformationState = typeof data.conformationState === "string" ? data.conformationState : "#";

        let localEmbeddingShift = 0.0;
        if (localShiftMap.length > 0) {
          const sumShift = localShiftMap.reduce((acc: number, curr: any) => acc + (curr.shift || 0.0), 0.0);
          localEmbeddingShift = sumShift / localShiftMap.length;
        }

        const modelFriendlyName = modelName.split('/').pop() || "SaProt_650M_AF2";
        const provenance = typeof data.provenance === "string" ? data.provenance : `SaProt (${modelFriendlyName})`;

        return {
          wtProbability: wtProb,
          mutProbability: mutProb,
          llr,
          preferences,
          mutRank,
          positionalEntropy,
          embeddingShift,
          localEmbeddingShift,
          localShiftMap,
          klDivergence,
          conformationState,
          provenance,
          hfError: data.hfError || undefined
        };
      }
      return { error: `SaProt sidecar returned unexpected response format`, status: "error" };
    }

    return { error: `SaProt sidecar returned HTTP ${sidecarRes.status}`, status: sidecarRes.status === 401 ? "error" : "offline" };
  } catch (err: any) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError" || /timeout/i.test(err.message);
    const status = isTimeout ? "timeout" : "offline";
    console.warn(`[Local SaProt Analysis Warning] Failed to query local SaProt sidecar: ${err.message}.`);
    return { error: `SaProt inference in standby (local sidecar warming up or offline)`, status };
  }
}

function normalizeThreeLetterToSingle(three: string): string | null {
  const map: Record<string, string> = {
    ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C",
    GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
    LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P",
    SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V"
  };
  return map[three.toUpperCase()] || null;
}

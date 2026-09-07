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

import { CONFIG } from "../config.ts";
import { runJapanFoldInference } from "./japanfold.ts";

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
        preferRemote: saprotEngine === "remote-hf",
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
        const embeddingShift = typeof data.embeddingShift === "number" ? data.embeddingShift : 0.0;
        const localShiftMap: EsmcLocalShift[] = Array.isArray(data.localShiftMap) ? data.localShiftMap : [];
        const klDivergence = typeof data.klDivergence === "number" ? data.klDivergence : 0.0;
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

    console.warn(`[Local SaProt Analysis Warning] Local sidecar returned HTTP ${sidecarRes.status}. Attempting keyless JapanFold fallback...`);
    const jfResult = await runJapanFoldInference("saprot", {
      sequence,
      position: pos,
      wt: wtRes,
      mut: mutRes,
      structure: wtPdb || undefined
    });
    if (jfResult.success && jfResult.data) {
      return {
        wtProbability: jfResult.data.wtProbability ?? 0,
        mutProbability: jfResult.data.mutProbability ?? 0,
        llr: jfResult.data.llr ?? 0,
        preferences: jfResult.data.preferences ?? [],
        mutRank: jfResult.data.mutRank ?? 1,
        positionalEntropy: jfResult.data.positionalEntropy ?? 0,
        embeddingShift: jfResult.data.embeddingShift ?? 0,
        localEmbeddingShift: jfResult.data.embeddingShift ?? 0,
        localShiftMap: jfResult.data.localShiftMap ?? [],
        provenance: "JapanFold (Cloud)"
      };
    }
    return { error: `SaProt sidecar initializing or unavailable`, status: "offline" };
  } catch (err: any) {
    console.warn(`[Local SaProt Analysis Warning] Local sidecar unavailable (${err.message}). Attempting keyless JapanFold fallback...`);
    try {
      const jfResult = await runJapanFoldInference("saprot", {
        sequence,
        position: pos,
        wt: wtRes,
        mut: mutRes,
        structure: wtPdb || undefined
      });
      if (jfResult.success && jfResult.data) {
        return {
          wtProbability: jfResult.data.wtProbability ?? 0,
          mutProbability: jfResult.data.mutProbability ?? 0,
          llr: jfResult.data.llr ?? 0,
          preferences: jfResult.data.preferences ?? [],
          mutRank: jfResult.data.mutRank ?? 1,
          positionalEntropy: jfResult.data.positionalEntropy ?? 0,
          embeddingShift: jfResult.data.embeddingShift ?? 0,
          localEmbeddingShift: jfResult.data.embeddingShift ?? 0,
          localShiftMap: jfResult.data.localShiftMap ?? [],
          provenance: "JapanFold (Cloud)"
        };
      }
    } catch (_) {}
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError" || /timeout/i.test(err.message);
    const status = isTimeout ? "timeout" : "offline";
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

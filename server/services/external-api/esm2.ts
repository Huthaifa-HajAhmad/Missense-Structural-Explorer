export interface EsmcPreference {
  aa: string;
  prob: number;
}

export interface EsmcLocalShift {
  position: number;
  residue: string;
  shift: number;
}

export interface EsmcEvalResult {
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
  provenance?: string;
  error?: string;
  status?: "offline" | "timeout" | "error" | "invalid_input" | string;
}

import { CONFIG } from "../../config.ts";

export type ModelEvalError = {
  error: string;
  status: "offline" | "timeout" | "error" | "invalid_input" | string;
};

export async function runEsm2Analysis(
  gene: string,
  variant: string,
  uniprotId: string,
  sequence: string,
  hfToken?: string | null,
  modelName: string = "facebook/esm2_t33_650M_UR50D"
): Promise<EsmcEvalResult | null> {
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
  const sidecarUrl = `${CONFIG.services.sidecarBaseUrl}/predict/esm2_3b`;
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
        hfToken: hfToken || null,
        modelName: modelName
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

        let localEmbeddingShift = 0.0;
        if (localShiftMap.length > 0) {
          const sumShift = localShiftMap.reduce((acc: number, curr: any) => acc + (curr.shift || 0.0), 0.0);
          localEmbeddingShift = sumShift / localShiftMap.length;
        }

        const modelFriendlyName = modelName.split('/').pop() || "esm2_t33_650M_UR50D";
        const provenance = typeof data.provenance === "string" ? data.provenance : `ESM-2 (${modelFriendlyName})`;

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
          provenance
        };
      }
      return { error: `ESM-2 sidecar returned unexpected response format`, status: "error" };
    }
    return { error: `ESM-2 sidecar returned HTTP ${sidecarRes.status}`, status: sidecarRes.status === 401 ? "error" : "offline" };
  } catch (err: any) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError" || /timeout/i.test(err.message);
    const status = isTimeout ? "timeout" : "offline";
    console.warn(`[Local ESM-2 Analysis Warning] Failed to query local ESM-2 sidecar: ${err.message}.`);
    return { error: `ESM-2 inference in standby (local sidecar warming up or offline)`, status };
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

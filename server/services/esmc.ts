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
  provenance?: string;
  error?: string;
  status?: "offline" | "timeout" | "error" | "invalid_input" | string;
}

const VOCAB: Record<string, number> = {
  "<cls>": 0, "<pad>": 1, "<eos>": 2, "<unk>": 3,
  "L": 4, "A": 5, "G": 6, "V": 7, "S": 8, "E": 9,
  "R": 10, "T": 11, "I": 12, "D": 13, "P": 14, "F": 15,
  "K": 16, "N": 17, "Q": 18, "Y": 19, "M": 20, "H": 21,
  "W": 22, "C": 23, "X": 24, "B": 25, "U": 26, "Z": 27,
  "O": 28, ".": 29, "-": 30, "<null_1>": 31, "<mask>": 32
};

function tokenize(sequence: string): number[] {
  const tokens = [0];
  for (const char of sequence.toUpperCase()) {
    tokens.push(VOCAB[char] !== undefined ? VOCAB[char] : 3);
  }
  tokens.push(2);
  return tokens;
}

const AA_LIST = ["L", "A", "G", "V", "S", "E", "R", "T", "I", "D", "P", "F", "K", "N", "Q", "Y", "M", "H", "W", "C"];
const AA_TOKENS = AA_LIST.map(aa => VOCAB[aa]);

import { CONFIG } from "../config.ts";

export type ModelEvalError = {
  error: string;
  status: "offline" | "timeout" | "error" | "invalid_input" | string;
};

export async function runEsmcAnalysis(
  gene: string,
  variant: string,
  uniprotId: string,
  sequence: string,
  biohubToken?: string | null
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
  const sidecarUrl = `${CONFIG.services.sidecarBaseUrl}/predict/vesm`;
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
        biohubToken: biohubToken || null
      }),
      signal: AbortSignal.timeout(60000) // VESM-150M needs up to 60s for first-run model load
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

        // Retrieve real embedding shifts from sidecar response
        const embeddingShift = typeof data.embeddingShift === "number" ? data.embeddingShift : 0.0;
        const localShiftMap: EsmcLocalShift[] = Array.isArray(data.localShiftMap) ? data.localShiftMap : [];
        let localEmbeddingShift = 0.0;
        if (localShiftMap.length > 0) {
          const sumShift = localShiftMap.reduce((acc: number, curr: any) => acc + (curr.shift || 0.0), 0.0);
          localEmbeddingShift = sumShift / localShiftMap.length;
        }

        const provenance = typeof data.provenance === "string" ? data.provenance : "ESMC-6B (Remote)";

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
          provenance
        };
      }
      return { error: `VESM sidecar returned unexpected response format`, status: "error" };
    }
    return { error: `VESM sidecar returned HTTP ${sidecarRes.status}`, status: sidecarRes.status === 401 ? "error" : "offline" };
  } catch (err: any) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError" || /timeout/i.test(err.message);
    const status = isTimeout ? "timeout" : "offline";
    console.warn(`[Local VESM Fallback Warning] Failed to fetch local VESM prediction from ${sidecarUrl}: ${err.message}.`);
    return { error: `VESM-150M prediction failed: ${err.message} (${sidecarUrl})`, status };
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


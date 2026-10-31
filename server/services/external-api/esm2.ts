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
  /** Hub id of the checkpoint that produced the numbers ("facebook/esm2_t30_150M_UR50D"). */
  checkpoint?: string;
  /** "masked-marginal" on every current path; absent on results from before it was recorded. */
  scoringMethod?: string;
  /** Why the shift trace is absent while the score is present (skipped to stay within the time budget). */
  embeddingNote?: string;
  /** Why the remote engine produced no score, and why the local candidates failed. */
  remoteEngineNote?: string | null;
  /** The remote refusal as a code the UI can act on, not prose to parse. */
  remoteFailure?: RemoteFailure | null;
  fallbackReason?: string | null;
  error?: string;
  status?: "offline" | "timeout" | "error" | "invalid_input" | string;
}

import { parseRemoteFailure, type RemoteFailure } from "./remoteFailure.ts";
import { CONFIG } from "../../config.ts";
import { governedForCredential, resolveCredential } from "../infra/credentials.ts";
import { parseShiftWindow } from "./lmShiftWindow.ts";

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
  // With a token the sidecar uses Hugging Face inference, so the call is governed and counted as such (WP-I4).
  const token = resolveCredential("huggingface", hfToken).token;
  try {
    const sidecarRes = await governedForCredential("huggingface", token, () => fetch(sidecarUrl, {
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
        hfToken: token,
        modelName: modelName
      }),
      signal: AbortSignal.timeout(120000) // CPU inference + model load can take 1-2 min
    }), { deadlineAt: Date.now() + 120000 });

    if (sidecarRes.ok) {
      const data = await sidecarRes.json() as any;
      if (data && data.status === "success" && typeof data.llr === "number") {
        const llr = data.llr;
        const wtProb = typeof data.wtProbability === "number" ? data.wtProbability : undefined;
        const mutProb = typeof data.mutProbability === "number" ? data.mutProbability : undefined;
        const mutRank = typeof data.mutRank === "number" ? data.mutRank : undefined;
        const positionalEntropy = typeof data.positionalEntropy === "number" ? data.positionalEntropy : undefined;
        const preferences = Array.isArray(data.preferences) ? data.preferences : [];
        /**
         * Absence is preserved, never coerced to 0 — the serverless filler API exposes no
         * per-residue feature extraction, and `0.000` on the card cannot be told apart from a
         * measured zero shift. Every current path reports KL divergence as absent.
         */
        const embeddingShift = typeof data.embeddingShift === "number" ? data.embeddingShift : undefined;
        const { localShiftMap, localEmbeddingShift } = parseShiftWindow(data.localShiftMap);
        const klDivergence = typeof data.klDivergence === "number" ? data.klDivergence : null;

        // No default: a payload that names no model is reported as "model not named", never as the requested one.
        const provenance = typeof data.provenance === "string" ? data.provenance : undefined;

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
          provenance,
          checkpoint: typeof data.checkpoint === "string" ? data.checkpoint : undefined,
          scoringMethod: typeof data.scoringMethod === "string" ? data.scoringMethod : undefined,
          embeddingNote: typeof data.embeddingNote === "string" ? data.embeddingNote : undefined,
          remoteEngineNote: typeof data.remoteEngineNote === "string" ? data.remoteEngineNote : undefined,
          remoteFailure: parseRemoteFailure(data.remoteFailure),
          fallbackReason: typeof data.fallbackReason === "string" ? data.fallbackReason : undefined
        };
      }
      return { error: `ESM-2 sidecar returned unexpected response format`, status: "error" };
    }
    return { error: `ESM-2 sidecar returned HTTP ${sidecarRes.status}`, status: [401, 403].includes(sidecarRes.status) ? "unauthorized" : "offline" };
  } catch (err: any) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError" || /timeout/i.test(err.message);
    const status = isTimeout ? "timeout" : "offline";
    console.warn(`[Local ESM-2 Analysis Warning] Failed to query local ESM-2 sidecar: ${err.message}.`);
    return { error: isTimeout ? "ESM-2 timed out waiting for the model server" : `ESM-2 inference in standby (local sidecar warming up or offline)`, status };
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

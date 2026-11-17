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
  /** "masked-marginal", or "wild-type-marginal" when VESM stands in; absent on results from before it was recorded. */
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

import { type RemoteFailure } from "./remoteFailure.ts";
import { CONFIG } from "../../config.ts";
import { resolveCredential } from "../infra/credentials.ts";
import { sidecarFailure } from "../infra/sidecar-budget.ts";
import {
  isSidecarEvalSuccess,
  parseSidecarEvalPayload,
  parseSubstitution,
  postSidecarPredict,
  sidecarStandbyError
} from "./lmSidecar.ts";

export type { ModelEvalError } from "./lmSidecar.ts";

export async function runEsm2Analysis(
  gene: string,
  variant: string,
  uniprotId: string,
  sequence: string,
  hfToken?: string | null,
  modelName: string = "facebook/esm2_t33_650M_UR50D"
): Promise<EsmcEvalResult | null> {
  const sub = parseSubstitution(variant);
  if (!sub) return null;
  const { pos, wt: wtRes, mut: mutRes } = sub;

  // With a token the sidecar uses Hugging Face inference, so the call is governed and counted as such (WP-I4).
  const token = resolveCredential("huggingface", hfToken).token;
  // One knob for the whole structural stage: the same number the route races this model against, so
  // the call and the race can never be edited apart (see `server/tests/structural-timeout-budget.test.ts`).
  const budgetMs = CONFIG.timeouts.structuralModelsMs;
  try {
    const sidecarRes = await postSidecarPredict("esm2_3b", {
      sequence: sequence,
      position: pos,
      wt: wtRes,
      mut: mutRes,
      hfToken: token,
      modelName: modelName
    }, { kind: "huggingface", token, budgetMs });

    if (sidecarRes.ok) {
      const data = await sidecarRes.json() as any;
      if (isSidecarEvalSuccess(data)) {
        return {
          ...parseSidecarEvalPayload(data),
          klDivergence: typeof data.klDivergence === "number" ? data.klDivergence : null,
          embeddingNote: typeof data.embeddingNote === "string" ? data.embeddingNote : undefined,
          fallbackReason: typeof data.fallbackReason === "string" ? data.fallbackReason : undefined
        };
      }
      return { error: `ESM-2 sidecar returned unexpected response format`, status: "error" };
    }
    return sidecarFailure("ESM-2", sidecarRes.status);
  } catch (err: any) {
    return sidecarStandbyError("ESM-2", err);
  }
}

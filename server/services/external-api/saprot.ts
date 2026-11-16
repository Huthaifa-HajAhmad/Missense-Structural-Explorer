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
  /** Hub id of the checkpoint that produced the numbers, and how the site was scored. */
  checkpoint?: string;
  scoringMethod?: string;
  hfError?: string | null;
  /** Why the remote tier produced no score (labelled by tier in the UI). */
  remoteEngineNote?: string | null;
  remoteFailure?: RemoteFailure | null;
  /** Why every local SaProt candidate failed — the reason this response is VESM's numbers. */
  fallbackReason?: string | null;
  error?: string;
  status?: "offline" | "timeout" | "error" | "invalid_input" | string;
}

import { type RemoteFailure } from "./remoteFailure.ts";
import { CONFIG } from "../../config.ts";
import { querySaProt } from "./japanfold-client.ts";
import { resolveCredential } from "../infra/credentials.ts";
import { sidecarFailure } from "../infra/sidecar-budget.ts";
import {
  isSidecarEvalSuccess,
  mapJapanFoldZeroShot,
  parseSidecarEvalPayload,
  parseSubstitution,
  postSidecarPredict,
  sidecarStandbyError,
  tryJapanFoldZeroShot
} from "./lmSidecar.ts";

export type { ModelEvalError } from "./lmSidecar.ts";

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
  const sub = parseSubstitution(variant);
  if (!sub) return null;
  const { pos, wt: wtRes, mut: mutRes } = sub;

  // 1. Attempt Tier-1: JapanFold SaProt (Tenstorrent Galaxy Superclusters)
  const jfResult = await tryJapanFoldZeroShot("SaProt", () => querySaProt(sequence, pos, wtRes, mutRes, wtPdb));
  if (jfResult) {
    return {
      ...mapJapanFoldZeroShot(jfResult),
      klDivergence: jfResult.klDivergence,
      conformationState: jfResult.conformationState
    };
  }

  // 2. Fallback to Local Sidecar (runs on CPU on OCI 2 OCPU / 8GB RAM with SaProt_35M_AF2)
  return runSaprotSidecar({ sequence, pos, wtRes, mutRes, hfToken, wtPdb, modelName, saprotEngine });
}

interface SaprotSidecarRequest {
  sequence: string;
  pos: number;
  wtRes: string;
  mutRes: string;
  hfToken?: string | null;
  wtPdb?: string | null;
  modelName: string;
  saprotEngine?: string;
}

async function runSaprotSidecar(req: SaprotSidecarRequest): Promise<SaprotEvalResult> {
  const { sequence, pos, wtRes, mutRes, hfToken, wtPdb, modelName, saprotEngine } = req;
  const token = resolveCredential("huggingface", hfToken).token;
  const preferRemote = saprotEngine === "remote-hf" || (Boolean(token) && saprotEngine !== "saprot-35m");
  // Only a remote run reaches Hugging Face; a local SaProt run spends no one's allowance (WP-I4).
  // A local run downloads public weights: it gets no token.
  const sidecarToken = preferRemote ? token : null;
  try {
    const sidecarRes = await postSidecarPredict("saprot", {
      sequence,
      position: pos,
      wt: wtRes,
      mut: mutRes,
      wtPdb: wtPdb || null,
      hfToken: sidecarToken,
      modelName,
      preferRemote,
      engine: saprotEngine || null
    }, {
      kind: "huggingface",
      token: sidecarToken,
      // The same number the route races this model against (see `esm2.ts`).
      budgetMs: CONFIG.timeouts.structuralModelsMs,
      noteRefusal: saprotEngine !== "saprot-35m"
    });

    if (!sidecarRes.ok) return sidecarFailure("SaProt", sidecarRes.status);
    const data = await sidecarRes.json() as any;
    if (!isSidecarEvalSuccess(data)) return { error: `SaProt sidecar returned unexpected response format`, status: "error" };
    return saprotResultFromSidecar(data);
  } catch (err: any) {
    return sidecarStandbyError("SaProt", err);
  }
}

function saprotResultFromSidecar(data: any): SaprotEvalResult {
  return {
    ...parseSidecarEvalPayload(data),
    /**
     * Absence is preserved, never coerced to 0. The sidecar reports null when its engine
     * could not produce an embedding (the serverless filler API has no feature-extraction
     * route for SaProt's 3Di tokens), and `0.000` on the card is indistinguishable from a
     * measured zero shift. The same applies to KL divergence, which the 3Di remote path
     * deliberately declines to fabricate.
     */
    klDivergence: typeof data.klDivergence === "number" ? data.klDivergence : null,
    conformationState: typeof data.conformationState === "string" ? data.conformationState : null,
    hfError: data.hfError || undefined,
    /**
     * Both tier reasons are carried verbatim and labelled by tier in the UI, so the card no
     * longer presents the remote engine's failure as the reason the SaProt result is missing
     * when it was the local candidates that actually failed.
     */
    fallbackReason: typeof data.fallbackReason === "string" ? data.fallbackReason : undefined
  };
}

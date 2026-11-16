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
  /** Hub id of the checkpoint that produced the numbers, and how the site was scored. */
  checkpoint?: string;
  scoringMethod?: string;
  /** Why the remote Biohub tier did not answer, when the local VESM fallback served this result. */
  remoteEngineNote?: string | null;
  remoteFailure?: RemoteFailure | null;
  error?: string;
  status?: "offline" | "timeout" | "error" | "invalid_input" | string;
}

import { type RemoteFailure } from "./remoteFailure.ts";
import { queryEsmc } from "./japanfold-client.ts";
import { resolveCredential } from "../infra/credentials.ts";
import { sidecarFailure } from "../infra/sidecar-budget.ts";
import {
  isSidecarEvalSuccess,
  mapJapanFoldZeroShot,
  parseSidecarEvalPayload,
  parseSubstitution,
  postSidecarPredict,
  sidecarStandbyError,
  tryJapanFoldZeroShot,
  type ModelEvalError
} from "./lmSidecar.ts";

/** How long the sidecar's VESM-150M call may take (first-run model load included). */
const ESMC_SIDECAR_BUDGET_MS = 60000;

export type { ModelEvalError } from "./lmSidecar.ts";

export async function runEsmcAnalysis(
  gene: string,
  variant: string,
  uniprotId: string,
  sequence: string,
  biohubToken?: string | null
): Promise<EsmcEvalResult | ModelEvalError | null> {
  const sub = parseSubstitution(variant);
  if (!sub) return null;
  const { pos, wt: wtRes, mut: mutRes } = sub;

  // 1. Attempt Tier-1: JapanFold ESMC (Tenstorrent Galaxy Superclusters)
  const jfResult = await tryJapanFoldZeroShot("ESMC", () => queryEsmc(sequence, pos, wtRes, mutRes));
  if (jfResult) return mapJapanFoldZeroShot(jfResult);

  // 2. Fallback to Local Sidecar (VESM-150M on CPU / Biohub remote)
  // With a token the sidecar asks Biohub's ESM-C, so the call is governed and counted as Biohub (WP-I4).
  const token = resolveCredential("biohub", biohubToken).token;
  try {
    const sidecarRes = await postSidecarPredict("vesm", {
      sequence: sequence,
      position: pos,
      wt: wtRes,
      mut: mutRes,
      biohubToken: token
    }, { kind: "biohub", token, budgetMs: ESMC_SIDECAR_BUDGET_MS });

    if (!sidecarRes.ok) {
      return sidecarFailure("VESM", sidecarRes.status);
    }

    const data = await sidecarRes.json() as any;
    if (isSidecarEvalSuccess(data)) {
      return parseSidecarEvalPayload(data);
    }
    return { error: `VESM sidecar returned unexpected response format`, status: "error" };
  } catch (err: any) {
    return sidecarStandbyError("VESM", err);
  }
}


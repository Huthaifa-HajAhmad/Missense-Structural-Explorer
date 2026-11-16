/**
 * Shared plumbing for the language-model sidecar clients (ESM-2, ESMC/VESM, SaProt).
 *
 * The three clients differ only in endpoint, credential kind and the extra payload fields each
 * engine reports. Substitution parsing, the governed sidecar POST, payload mapping and failure
 * classification live here once so the copies cannot drift apart.
 */
import { AMINO_ACID_1_TO_3, AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";
import type { CredentialKind } from "../../../src/shared/credentials.ts";
import { CONFIG } from "../../config.ts";
import { governedForCredential } from "../infra/credentials.ts";
import { SIDECAR_BUDGET_HEADER } from "../infra/sidecar-budget.ts";
import { parseRemoteFailure, type RemoteFailure } from "./remoteFailure.ts";
import { parseShiftWindow } from "./lmShiftWindow.ts";
import type { JapanFoldZeroShotResult } from "./japanfold-client.ts";

export type ModelEvalError = {
  error: string;
  status: "offline" | "timeout" | "error" | "invalid_input" | string;
};

/** Fields every language-model engine reports; each client adds its own extras on top. */
export interface LmEvalBase {
  wtProbability?: number;
  mutProbability?: number;
  llr: number;
  preferences: Array<{ aa: string; prob: number }>;
  mutRank?: number;
  positionalEntropy?: number;
  embeddingShift?: number;
  localEmbeddingShift?: number;
  localShiftMap: Array<{ position: number; residue: string; shift: number }>;
  provenance?: string;
  checkpoint?: string;
  scoringMethod?: string;
  remoteEngineNote?: string;
  remoteFailure?: RemoteFailure | null;
}

/**
 * Parses a substitution notation ("p.Arg408Trp", "R408W", "arg408trp") into 1-letter residues
 * and a position. Returns null when the notation does not match or a residue is not standard.
 */
export function parseSubstitution(variant: string): { pos: number; wt: string; mut: string } | null {
  const mutMatch = variant.match(/([a-zA-Z]{3}|[a-zA-Z])\s*(\d+)\s*([a-zA-Z]{3}|[a-zA-Z])/);
  if (!mutMatch) return null;

  const wt = normalizeResidue(mutMatch[1]);
  const mut = normalizeResidue(mutMatch[3]);
  if (!wt || !mut) return null;

  return { pos: parseInt(mutMatch[2], 10), wt, mut };
}

function normalizeResidue(raw: string): string | null {
  if (raw.length === 3) return AMINO_ACID_3_TO_1[raw.toUpperCase()] || null;
  const upper = raw.toUpperCase();
  return AMINO_ACID_1_TO_3[upper] ? upper : null;
}

/**
 * POSTs to a sidecar `/predict/<path>` endpoint under the credential's egress governance.
 * With a token the sidecar calls the remote provider, so the call is governed and counted as
 * such (WP-I4); without one it stays local. `noteRefusal: false` marks calls that would not
 * have used a token even if one were available.
 */
export function postSidecarPredict(
  predictPath: string,
  body: Record<string, unknown>,
  opts: { kind: CredentialKind; token: string | null; budgetMs: number; noteRefusal?: boolean }
): Promise<Response> {
  const sidecarSecret = process.env.SIDECAR_SECRET || "";
  const sidecarUrl = `${CONFIG.services.sidecarBaseUrl}/predict/${predictPath}`;
  return governedForCredential(opts.kind, opts.token, () => fetch(sidecarUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sidecar-Secret": sidecarSecret,
      [SIDECAR_BUDGET_HEADER]: String(opts.budgetMs)
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.budgetMs) // CPU inference + model load can take 1-2 min
  }), { deadlineAt: Date.now() + opts.budgetMs, noteRefusal: opts.noteRefusal });
}

/** The sidecar answered with a usable score (not merely HTTP 200). */
export function isSidecarEvalSuccess(data: any): boolean {
  return Boolean(data && data.status === "success" && typeof data.llr === "number");
}

/**
 * Maps a successful sidecar payload to the fields every engine reports.
 *
 * Absence is preserved, never coerced to 0 — the serverless filler APIs expose no per-residue
 * feature extraction, and `0.000` on the card cannot be told apart from a measured zero shift.
 * No provenance default either: a payload that names no model is reported as "model not named",
 * never as the requested one.
 */
export function parseSidecarEvalPayload(data: any): LmEvalBase {
  const { localShiftMap, localEmbeddingShift } = parseShiftWindow(data.localShiftMap);
  return {
    wtProbability: typeof data.wtProbability === "number" ? data.wtProbability : undefined,
    mutProbability: typeof data.mutProbability === "number" ? data.mutProbability : undefined,
    llr: data.llr,
    preferences: Array.isArray(data.preferences) ? data.preferences : [],
    mutRank: typeof data.mutRank === "number" ? data.mutRank : undefined,
    positionalEntropy: typeof data.positionalEntropy === "number" ? data.positionalEntropy : undefined,
    embeddingShift: typeof data.embeddingShift === "number" ? data.embeddingShift : undefined,
    localEmbeddingShift,
    localShiftMap,
    provenance: typeof data.provenance === "string" ? data.provenance : undefined,
    checkpoint: typeof data.checkpoint === "string" ? data.checkpoint : undefined,
    scoringMethod: typeof data.scoringMethod === "string" ? data.scoringMethod : undefined,
    remoteEngineNote: typeof data.remoteEngineNote === "string" ? data.remoteEngineNote : undefined,
    remoteFailure: parseRemoteFailure(data.remoteFailure)
  };
}

/**
 * Classifies a sidecar call that threw: a timeout while the model server was reachable, or the
 * sidecar being in standby (warming up or offline). `label` names the engine ("ESM-2", "VESM",
 * "SaProt") in both the warning and the user-facing error.
 */
export function sidecarStandbyError(label: string, err: any): ModelEvalError {
  const isTimeout = err.name === "TimeoutError" || err.name === "AbortError" || /timeout/i.test(err.message);
  const status = isTimeout ? "timeout" : "offline";
  console.warn(`[Local ${label} Analysis Warning] Failed to query local ${label} sidecar: ${err.message}.`);
  return { error: isTimeout ? `${label} timed out waiting for the model server` : `${label} inference in standby (local sidecar warming up or offline)`, status };
}

/**
 * Attempts the Tier-1 JapanFold zero-shot call, returning the result only on success.
 * A failed or unreachable tier is logged and reported as null so the caller falls back
 * to the local sidecar.
 */
export async function tryJapanFoldZeroShot(
  label: string,
  query: () => Promise<JapanFoldZeroShotResult | null>
): Promise<JapanFoldZeroShotResult | null> {
  try {
    const jfResult = await query();
    return jfResult && jfResult.status === "success" ? jfResult : null;
  } catch (jfErr: any) {
    console.warn(`[JapanFold ${label}] Tier-1 call failed: ${jfErr.message}. Falling back to local sidecar...`);
    return null;
  }
}

/** Maps a successful JapanFold zero-shot result to the common evaluation fields. */
export function mapJapanFoldZeroShot(jfResult: JapanFoldZeroShotResult): LmEvalBase {
  const { localShiftMap, localEmbeddingShift } = parseShiftWindow(jfResult.localShiftMap);
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
    provenance: jfResult.provenance
  };
}

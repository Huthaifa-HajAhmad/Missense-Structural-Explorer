import { LRUCache } from "lru-cache";
import crypto from "crypto";
import { CONFIG } from "../../config.ts";
import { queryEsmfold2WithOutcome, type Esmfold2Outcome } from "../external-api/japanfold-client.ts";
import {
  ESM_ATLAS_PUBLIC_MAX_AA,
  JAPANFOLD_ESMFOLD2_MAX_AA,
  deNovoFoldingLimitExceededMessage,
  esmAtlasFallbackExceededMessage,
} from "../../../src/shared/foldingLimits.ts";
import { governedFetch } from "../infra/http-client.ts";
import { governedForCredential, noteRefusal, resolveCredential } from "../infra/credentials.ts";
import { SIDECAR_BUDGET_HEADER } from "../infra/sidecar-budget.ts";

/**
 * Which engine answered. The three tiers are three different models — ESMFold2-Fast (JapanFold),
 * ESMFold2-Fast (EvolutionaryScale Forge, via the sidecar) and ESMFold v1 (the public ESM Atlas, which
 * also writes pLDDT on a 0–1 scale) — and the route used to return bare PDB text, so the viewer named
 * every structure "ESMFold-2 (Lin et al. 2023)" whichever one ran. The ids are the ones
 * `src/shared/structure3dEvidence.ts` describes.
 */
export type DeNovoEngineId = "japanfold-esmfold2-fast" | "forge-esmfold2-fast" | "esm-atlas-esmfold";

export interface FoldedStructure {
  pdb: string;
  engine: DeNovoEngineId;
}

export const esmfoldCache = new LRUCache<string, FoldedStructure>({
  max: 100,
  maxSize: 100 * 1024 * 1024, // 100MB limit
  sizeCalculation: (value) => value.pdb.length + value.engine.length
});

/** Folds a sequence and names the engine that produced the coordinates. */
export async function foldSequenceWithProvenance(
  sequence: string,
  biohubToken?: string | null,
  japanfoldApiKey?: string | null
): Promise<FoldedStructure> {
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex");
  const cacheKey = `esmfold:seq:${seqHash}`;
  const cached = esmfoldCache.get(cacheKey);
  if (cached) {
    console.log(`[ESMFold] Cache hit for sequence hash ${seqHash}`);
    return cached;
  }

  const folded = await foldSequenceInternal(sequence, biohubToken, japanfoldApiKey);
  esmfoldCache.set(cacheKey, folded);
  return folded;
}

/** PDB text only, for callers that do not report provenance (the stability pipeline's engine). */
export async function foldSequence(
  sequence: string,
  biohubToken?: string | null,
  japanfoldApiKey?: string | null
): Promise<string> {
  return (await foldSequenceWithProvenance(sequence, biohubToken, japanfoldApiKey)).pdb;
}

function summarizeSidecarError(raw: string, status: number): string {
  const trimmed = raw.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      const detail = parsed?.detail ?? parsed?.error ?? parsed?.message;
      if (typeof detail === "string" && detail.trim()) {
        return `HTTP ${status}: ${detail.trim().slice(0, 200)}`;
      }
    } catch {
      return `HTTP ${status}: ${trimmed.slice(0, 200)}`;
    }
  }
  return `HTTP ${status}`;
}

function summarizeTier1Failure(outcome: Extract<Esmfold2Outcome, { status: "failed" }> | null, hadKey: boolean): string {
  if (!outcome) return "unavailable";
  if (outcome.kind === "auth") {
    return hadKey
      ? `rejected the JapanFold API key (HTTP ${outcome.httpStatus ?? 401})`
      : "requires a JapanFold API key (HTTP 401)";
  }
  if (outcome.kind === "timeout") return "timed out";
  if (outcome.httpStatus) return `returned HTTP ${outcome.httpStatus}`;
  return outcome.detail || "unavailable";
}

async function foldSequenceInternal(
  sequence: string,
  biohubToken?: string | null,
  japanfoldApiKey?: string | null
): Promise<FoldedStructure> {
  const seqLen = sequence.length;
  const resolvedBiohub = resolveCredential("biohub", biohubToken).token;
  const resolvedJapanFoldCred = resolveCredential("japanfold", japanfoldApiKey);
  const resolvedJapanFold = resolvedJapanFoldCred.token;

  // Fail fast immediately if sequence exceeds max Tier-1 limit (JAPANFOLD_ESMFOLD2_MAX_AA) and no Biohub token exists
  if (seqLen > JAPANFOLD_ESMFOLD2_MAX_AA && !resolvedBiohub) {
    noteRefusal("biohub");
    throw new Error(deNovoFoldingLimitExceededMessage(seqLen));
  }

  // 1. Attempt Tier-1: JapanFold ESMFold-2 (up to JAPANFOLD_ESMFOLD2_MAX_AA residues, Tenstorrent hardware)
  let tier1Failure: Extract<Esmfold2Outcome, { status: "failed" }> | null = null;
  if (seqLen <= JAPANFOLD_ESMFOLD2_MAX_AA) {
    if (!resolvedJapanFold) noteRefusal("japanfold");
    const jfOutcome = await queryEsmfold2WithOutcome(sequence, undefined, resolvedJapanFold);
    if (jfOutcome.status === "done" && jfOutcome.pdb.includes("ATOM")) {
      console.log(`[ESMFold] Successfully folded ${seqLen} aa sequence via Tier-1 JapanFold ESMFold-2`);
      return { pdb: jfOutcome.pdb, engine: "japanfold-esmfold2-fast" };
    }
    if (jfOutcome.status === "failed") {
      tier1Failure = jfOutcome;
      console.warn(`[ESMFold] Tier-1 JapanFold call failed (${jfOutcome.kind}${jfOutcome.httpStatus ? ` HTTP ${jfOutcome.httpStatus}` : ""}): ${jfOutcome.detail || "no detail"}. Proceeding to Biohub Forge fallback...`);
    }
  }

  // 2. Fallback: If a Biohub token is available (the caller's, this person's saved one, or the team's
  // under the lending policy), query official Biohub ESMFold2 via Python sidecar (WP-I4).
  const token = resolvedBiohub;
  if (!token) noteRefusal("biohub");
  let tier2Failure: { kind: "timeout" | "http" | "network"; status?: number; detail: string } | null = null;
  if (token) {
    try {
      const sidecarSecret = process.env.SIDECAR_SECRET || "";
      const response = await governedForCredential("biohub", token, () => governedFetch(`${CONFIG.services.sidecarBaseUrl}/predict/esmfold`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sidecar-Secret": sidecarSecret,
          [SIDECAR_BUDGET_HEADER]: String(CONFIG.timeouts.esmfoldSidecarMs),
        },
        body: JSON.stringify({
          sequence: sequence,
          biohubToken: token
        }),
        signal: AbortSignal.timeout(CONFIG.timeouts.esmfoldSidecarMs) // Folding is computationally heavy; give it the configured sidecar budget
      }), { lane: "compute", deadlineAt: Date.now() + CONFIG.timeouts.esmfoldSidecarMs });

      if (response.ok) {
        const data = await response.json() as any;
        if (data && data.status === "success" && data.pdb) {
          return { pdb: data.pdb, engine: "forge-esmfold2-fast" };
        }
        tier2Failure = { kind: "http", status: response.status, detail: "Sidecar returned an empty structure." };
      } else {
        const errText = await response.text();
        const detail = summarizeSidecarError(errText, response.status);
        tier2Failure = {
          kind: response.status === 504 ? "timeout" : "http",
          status: response.status,
          detail,
        };
        console.warn(`[Biohub API ESMFold Error] ${detail}`);
      }
    } catch (apiErr: any) {
      const isTimeout = apiErr?.name === "TimeoutError" || apiErr?.name === "AbortError" || /timed out/i.test(String(apiErr?.message ?? ""));
      tier2Failure = {
        kind: isTimeout ? "timeout" : "network",
        detail: isTimeout
          ? `timed out after ${Math.round(CONFIG.timeouts.esmfoldSidecarMs / 1000)}s`
          : (apiErr?.message || "Sidecar unreachable"),
      };
      console.warn(`[Biohub API ESMFold Warning] Sidecar call failed: ${tier2Failure.detail}.`);
    }
  }

  // 3. Free Public ESM Atlas Folding Fallback (strictly <= ESM_ATLAS_PUBLIC_MAX_AA)
  if (seqLen > ESM_ATLAS_PUBLIC_MAX_AA) {
    // Never blame a missing Biohub token when the caller DID supply one and Tier-2 actually ran and failed.
    if (tier2Failure) {
      const t1 = summarizeTier1Failure(tier1Failure, Boolean(resolvedJapanFold));
      if (tier2Failure.kind === "timeout") {
        throw new Error(
          `ESMFold2 via Biohub Forge timed out (${tier2Failure.detail}) for this ${seqLen} aa sequence; Tier-1 JapanFold ${t1}.`
        );
      }
      throw new Error(
        `ESMFold2 via Biohub Forge failed (${tier2Failure.detail}); Tier-1 JapanFold ${t1}. Public ESM Atlas only folds sequences up to ${ESM_ATLAS_PUBLIC_MAX_AA} aa.`
      );
    }
    if (tier1Failure?.kind === "auth") {
      const status = tier1Failure.httpStatus ?? 401;
      throw new Error(
        resolvedJapanFold
          ? resolvedJapanFoldCred.source === "team"
            ? `Tier-1 JapanFold rejected the server's JAPANFOLD_API_KEY (HTTP ${status}), and no Biohub token is set. Add your own JapanFold API key or an EvolutionaryScale (Forge) token in Settings → Connections (public ESM Atlas only folds sequences up to ${ESM_ATLAS_PUBLIC_MAX_AA} aa).`
            : `Tier-1 JapanFold rejected your API key (HTTP ${status}), and no Biohub token is set. Check your JapanFold API key or add an EvolutionaryScale (Forge) token in Settings → Connections (public ESM Atlas only folds sequences up to ${ESM_ATLAS_PUBLIC_MAX_AA} aa).`
          : `Tier-1 JapanFold requires an API key (HTTP ${status}), and no Biohub token is set. Add a JapanFold API key or an EvolutionaryScale (Forge) token in Settings → Connections to fold sequences longer than ${ESM_ATLAS_PUBLIC_MAX_AA} aa.`
      );
    }
    throw new Error(esmAtlasFallbackExceededMessage(seqLen));
  }

  try {
    const atlasRes = await governedFetch("https://api.esmatlas.com/foldSequence/v1/pdb/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: sequence,
      signal: AbortSignal.timeout(CONFIG.timeouts.esmAtlasMs)
    });

    if (atlasRes.ok) {
      const pdbText = await atlasRes.text();
      if (pdbText && pdbText.includes("ATOM")) {
        return { pdb: pdbText, engine: "esm-atlas-esmfold" };
      }
    }
    if (atlasRes.status === 413 || atlasRes.status === 422 || sequence.length > ESM_ATLAS_PUBLIC_MAX_AA) {
      throw new Error(deNovoFoldingLimitExceededMessage(sequence.length));
    }
    throw new Error(`ESM Atlas returned HTTP ${atlasRes.status}${atlasRes.statusText ? ` (${atlasRes.statusText})` : ""}.`);
  } catch (atlasErr: any) {
    throw new Error(atlasErr.message?.startsWith("Sequence length") ? atlasErr.message : `Protein folding failed: ${atlasErr.message}`);
  }
}

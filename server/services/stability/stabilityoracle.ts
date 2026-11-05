import { CONFIG } from "../../config.ts";
import { SIDECAR_BUDGET_HEADER, sidecarFailure } from "../infra/sidecar-budget.ts";

/** How long the caller waits for one prediction. The model server is told, so it does not start work nobody will read. */
const STABILITY_ORACLE_BUDGET_MS = 60000;

export interface StabilityOracleEvalResult {
  ddG: number;
  isStabilizing: boolean;
  contactsAnalyzed: number;
  provenance: string;
}

const AA_SINGLE = ["A", "R", "N", "D", "C", "Q", "E", "G", "H", "I", "L", "K", "M", "F", "P", "S", "T", "W", "Y", "V"];

function normalizeThreeLetterToSingle(three: string): string | null {
  const map: Record<string, string> = {
    ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C",
    GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
    LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P",
    SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V"
  };
  return map[three.toUpperCase()] || null;
}

/**
 * What one StabilityOracle call resolved to, told apart at the source.
 *
 * The legacy `runStabilityOracleAnalysis` collapsed three different outcomes into `null`: the
 * sidecar not being reachable at all, and a live sidecar REJECTING this query (shape, wild-type
 * mismatch, inference failure). Collapsed, both rendered as "Not available here" — so a variant
 * the engine refused carried the same caption as an engine this deployment lacks, and the real
 * message (e.g. "wild-type residue mismatch") was discarded. The detailed result keeps the two
 * apart; the legacy wrapper keeps returning null for every non-value outcome so its callers,
 * including the test seams, behave exactly as before.
 */
export type StabilityOracleOutcome =
  | { kind: "value"; result: StabilityOracleEvalResult }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

export async function runStabilityOracleAnalysis(
  gene: string,
  variant: string,
  uniprotId: string,
  sequence: string,
  wtPdb?: string | null,
  chain?: string | null
): Promise<StabilityOracleEvalResult | null> {
  const outcome = await runStabilityOracleAnalysisDetailed(gene, variant, uniprotId, sequence, wtPdb, chain);
  return outcome.kind === "value" ? outcome.result : null;
}

export async function runStabilityOracleAnalysisDetailed(
  gene: string,
  variant: string,
  uniprotId: string,
  sequence: string,
  wtPdb?: string | null,
  chain?: string | null
): Promise<StabilityOracleOutcome> {
  const cleanVariant = variant.replace(/^p\./i, "").trim();
  const foldxMatch = cleanVariant.match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$/);
  let rawWt: string;
  let pos: number;
  let rawMut: string;
  let resolvedChain: string | undefined = chain?.trim() || undefined;

  if (foldxMatch) {
    rawWt = foldxMatch[1];
    if (!resolvedChain) resolvedChain = foldxMatch[2].toUpperCase();
    pos = parseInt(foldxMatch[3], 10);
    rawMut = foldxMatch[4];
  } else {
    const mutMatch = cleanVariant.match(/^([a-zA-Z]{3}|[a-zA-Z])\s*(\d+)\s*([a-zA-Z]{3}|[a-zA-Z])$/) ||
      variant.match(/([a-zA-Z]{3}|[a-zA-Z])\s*(\d+)\s*([a-zA-Z]{3}|[a-zA-Z])/);
    if (!mutMatch) {
      return { kind: "error", message: `Variant code format not recognised by StabilityOracle: '${variant}'` };
    }
    rawWt = mutMatch[1];
    pos = parseInt(mutMatch[2], 10);
    rawMut = mutMatch[3];
  }

  const wtRes = rawWt.length === 3
    ? normalizeThreeLetterToSingle(rawWt)
    : (AA_SINGLE.includes(rawWt.toUpperCase()) ? rawWt.toUpperCase() : null);

  const mutRes = rawMut.length === 3
    ? normalizeThreeLetterToSingle(rawMut)
    : (AA_SINGLE.includes(rawMut.toUpperCase()) ? rawMut.toUpperCase() : null);

  if (!wtRes || !mutRes) {
    return { kind: "error", message: `Amino-acid letters not recognised by StabilityOracle in variant: '${variant}'` };
  }

  const sidecarSecret = process.env.SIDECAR_SECRET || "";
  try {
    const payload: Record<string, unknown> = {
      sequence,
      position: pos,
      wt: wtRes,
      mut: mutRes,
      wtPdb: wtPdb || null,
    };
    if (resolvedChain) {
      payload.chain = resolvedChain;
    }

    const sidecarRes = await fetch(`${CONFIG.services.sidecarBaseUrl}/predict/stabilityoracle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sidecar-Secret": sidecarSecret,
        [SIDECAR_BUDGET_HEADER]: String(STABILITY_ORACLE_BUDGET_MS)
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(STABILITY_ORACLE_BUDGET_MS)
    });

    if (sidecarRes.ok) {
      const data = await sidecarRes.json() as any;
      if (data && data.status === "success" && typeof data.ddG === "number") {
        return {
          kind: "value",
          result: {
            ddG: data.ddG,
            isStabilizing: !!data.isStabilizing,
            contactsAnalyzed: typeof data.contactsAnalyzed === "number" ? data.contactsAnalyzed : 0,
            provenance: typeof data.provenance === "string" ? data.provenance : "StabilityOracle (PyTorch 3D Graph-Transformer)"
          }
        };
      }
      return {
        kind: "error",
        message: `StabilityOracle sidecar did not return a usable result: ${JSON.stringify(data)?.slice(0, 200) || "empty body"}`
      };
    } else {
      let detail = "";
      try {
        const errJson = await sidecarRes.json();
        detail = errJson?.detail ?? "";
      } catch {}
      console.warn(`[StabilityOracle Warning] Sidecar rejected the request with status: ${sidecarRes.status}${detail ? ` (${typeof detail === "string" ? detail : ""})` : ""}`);
      return {
        kind: "error",
        message: typeof detail === "string" && detail
          ? `StabilityOracle rejected this query: ${detail}`
          : sidecarFailure("StabilityOracle", sidecarRes.status).error
      };
    }
  } catch (err: any) {
    console.warn("[StabilityOracle Warning] Sidecar connection not available. In accordance with No-Heuristics Policy, no synthetic fallbacks are used:", err.message);
    return { kind: "unavailable", reason: err?.message ?? "StabilityOracle sidecar is not reachable" };
  }

  return { kind: "unavailable", reason: "StabilityOracle sidecar is not reachable" };
}

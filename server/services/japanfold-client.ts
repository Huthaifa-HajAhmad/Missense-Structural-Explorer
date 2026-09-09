/**
 * server/services/japanfold-client.ts — Unified API client for JapanFold sovereign drug discovery platform.
 *
 * Provides Tier-1 primary execution on Tenstorrent Galaxy™ superclusters:
 * - ESMC: Zero-shot variant fitness, positional entropy, embedding shifts
 * - ESMFold-2: De novo 3D coordinate generation (up to 1,024 residues)
 * - SaProt: Structure-aware language modeling with 3Di token conditioning
 * - Boltz-2 / OpenFold3: Quaternary multimer complex modeling
 * - OpenBind-0: Interface binding affinity shifts (ΔΔG_bind)
 */

import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { CONFIG } from "../config.ts";
import { anySignal } from "../utils/signals.ts";

export interface JapanFoldZeroShotResult {
  status: "success" | "failed";
  llr: number;
  wtProbability: number;
  mutProbability: number;
  mutRank?: number;
  positionalEntropy: number;
  embeddingShift: number;
  preferences?: Array<{ aa: string; prob: number }>;
  localShiftMap?: Array<{ position: number; residue: string; shift: number }>;
  conformationState?: string;
  klDivergence?: number;
  provenance: string;
}

export interface JapanFoldMultimerResult {
  status: "success" | "failed";
  complexPdb: string;
  ipTm: number | null;
  pTm: number | null;
  interfaceContacts: Array<{ resA: number; resB: number; distance: number }>;
  provenance: string;
}

export interface JapanFoldBindingResult {
  status: "success" | "failed";
  ddgBind: number;
  unit: "kcal/mol" | "kJ/mol";
  classification: "INTERFACE_DISRUPTIVE" | "ALLOSTERIC_PERTURBATION" | "SURFACE_NEUTRAL";
  provenance: string;
}

const japanFoldCache = new LRUCache<string, any>({
  max: 500,
  maxSize: 50 * 1024 * 1024, // 50MB memory ceiling
  sizeCalculation: (val) => {
    if (typeof val === "string") return val.length;
    if (val && typeof val.complexPdb === "string") return val.complexPdb.length + 512;
    if (val && typeof val.pdbText === "string") return val.pdbText.length + 512;
    return 1024;
  },
  ttl: 1000 * 60 * 60 * 24 * 14 // 14 days
});

export function clearJapanFoldCache(): void {
  japanFoldCache.clear();
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (CONFIG.services.japanfoldApiKey) {
    headers["Authorization"] = `Bearer ${CONFIG.services.japanfoldApiKey}`;
    headers["X-API-Key"] = CONFIG.services.japanfoldApiKey;
  }
  return headers;
}

/**
 * Tier-1: Query JapanFold ESMC for zero-shot variant fitness and latent embedding shifts.
 */
export async function queryEsmc(
  sequence: string,
  pos: number,
  wt: string,
  mut: string,
  signal?: AbortSignal
): Promise<JapanFoldZeroShotResult | null> {
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex").slice(0, 16);
  const cacheKey = `japanfold:esmc:${seqHash}:${pos}:${wt}:${mut}`;
  const cached = japanFoldCache.get(cacheKey);
  if (cached) return cached;

  const timeoutMs = CONFIG.timeouts.japanfoldZeroShotMs || 3500;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const effectiveSignal = anySignal([signal, timeoutSignal]);

  try {
    const url = `${CONFIG.services.japanfoldBaseUrl}/v1/predictions`;
    const response = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        model: "esmc",
        sequence,
        position: pos,
        wt: wt.toUpperCase(),
        mut: mut.toUpperCase()
      }),
      signal: effectiveSignal
    });

    if (!response.ok) {
      console.warn(`[JapanFold Client] ESMC query failed with HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as any;
    if (data && (Number.isFinite(data.llr) || Number.isFinite(data.score))) {
      const rawLlr = Number.isFinite(data.llr) ? data.llr : data.score;
      const result: JapanFoldZeroShotResult = {
        status: "success",
        llr: rawLlr,
        wtProbability: Number.isFinite(data.wtProbability) ? data.wtProbability : 0,
        mutProbability: Number.isFinite(data.mutProbability) ? data.mutProbability : 0,
        mutRank: Number.isFinite(data.mutRank) ? data.mutRank : undefined,
        positionalEntropy: Number.isFinite(data.positionalEntropy) ? data.positionalEntropy : 0,
        embeddingShift: Number.isFinite(data.embeddingShift) ? data.embeddingShift : 0,
        preferences: Array.isArray(data.preferences) ? data.preferences : [],
        localShiftMap: Array.isArray(data.localShiftMap) ? data.localShiftMap : [],
        provenance: "JapanFold ESMC (Tier 1)"
      };
      japanFoldCache.set(cacheKey, result);
      return result;
    }
  } catch (err: any) {
    console.warn(`[JapanFold Client] ESMC invocation error: ${err.message}`);
  }

  return null;
}

/**
 * Tier-1: Query JapanFold ESMFold-2 for de novo 3D structure generation.
 */
export async function queryEsmfold2(
  sequence: string,
  signal?: AbortSignal
): Promise<string | null> {
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex").slice(0, 16);
  const cacheKey = `japanfold:esmfold2:${seqHash}`;
  const cached = japanFoldCache.get(cacheKey);
  if (cached) return cached;

  const timeoutMs = CONFIG.timeouts.japanfoldFoldingMs || 15000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const effectiveSignal = anySignal([signal, timeoutSignal]);

  try {
    const url = `${CONFIG.services.japanfoldBaseUrl}/v1/predictions`;
    const response = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        model: "esmfold-2",
        sequence
      }),
      signal: effectiveSignal
    });

    if (!response.ok) {
      console.warn(`[JapanFold Client] ESMFold-2 query failed with HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as any;
    const pdb = data?.pdb || (typeof data === "string" && data.includes("ATOM") ? data : null);
    if (pdb) {
      japanFoldCache.set(cacheKey, pdb);
      return pdb;
    }
  } catch (err: any) {
    console.warn(`[JapanFold Client] ESMFold-2 invocation error: ${err.message}`);
  }

  return null;
}

/**
 * Tier-1: Query JapanFold SaProt for structure-conditioned fitness and 3Di conformations.
 */
export async function querySaProt(
  sequence: string,
  pos: number,
  wt: string,
  mut: string,
  wtPdb?: string | null,
  signal?: AbortSignal
): Promise<JapanFoldZeroShotResult | null> {
  const seqHash = crypto.createHash("sha256").update(sequence).digest("hex").slice(0, 16);
  const cacheKey = `japanfold:saprot:${seqHash}:${pos}:${wt}:${mut}`;
  const cached = japanFoldCache.get(cacheKey);
  if (cached) return cached;

  const timeoutMs = CONFIG.timeouts.japanfoldZeroShotMs || 3500;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const effectiveSignal = anySignal([signal, timeoutSignal]);

  try {
    const url = `${CONFIG.services.japanfoldBaseUrl}/v1/predictions`;
    const response = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        model: "saprot",
        sequence,
        position: pos,
        wt: wt.toUpperCase(),
        mut: mut.toUpperCase(),
        wtPdb: wtPdb || null
      }),
      signal: effectiveSignal
    });

    if (!response.ok) {
      console.warn(`[JapanFold Client] SaProt query failed with HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as any;
    if (data && (Number.isFinite(data.llr) || Number.isFinite(data.score))) {
      const rawLlr = Number.isFinite(data.llr) ? data.llr : data.score;
      const result: JapanFoldZeroShotResult = {
        status: "success",
        llr: rawLlr,
        wtProbability: Number.isFinite(data.wtProbability) ? data.wtProbability : 0,
        mutProbability: Number.isFinite(data.mutProbability) ? data.mutProbability : 0,
        mutRank: Number.isFinite(data.mutRank) ? data.mutRank : undefined,
        positionalEntropy: Number.isFinite(data.positionalEntropy) ? data.positionalEntropy : 0,
        embeddingShift: Number.isFinite(data.embeddingShift) ? data.embeddingShift : 0,
        preferences: Array.isArray(data.preferences) ? data.preferences : [],
        localShiftMap: Array.isArray(data.localShiftMap) ? data.localShiftMap : [],
        conformationState: data.conformationState,
        klDivergence: Number.isFinite(data.klDivergence) ? data.klDivergence : undefined,
        provenance: "JapanFold SaProt (Tier 1)"
      };
      japanFoldCache.set(cacheKey, result);
      return result;
    }
  } catch (err: any) {
    console.warn(`[JapanFold Client] SaProt invocation error: ${err.message}`);
  }

  return null;
}

/**
 * Tier-1: Query JapanFold Boltz-2 / OpenFold3 for quaternary multimer assemblies.
 */
export async function queryBoltz2Multimer(
  chains: Array<{ chainId: string; sequence: string }>,
  signal?: AbortSignal
): Promise<JapanFoldMultimerResult | null> {
  const chainHash = crypto.createHash("sha256").update(JSON.stringify(chains)).digest("hex").slice(0, 16);
  const cacheKey = `japanfold:boltz2:${chainHash}`;
  const cached = japanFoldCache.get(cacheKey);
  if (cached) return cached;

  const timeoutMs = CONFIG.timeouts.japanfoldFoldingMs || 15000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const effectiveSignal = anySignal([signal, timeoutSignal]);

  try {
    const url = `${CONFIG.services.japanfoldBaseUrl}/v1/predictions`;
    const response = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        model: "boltz-2",
        chains
      }),
      signal: effectiveSignal
    });

    if (!response.ok) {
      console.warn(`[JapanFold Client] Boltz-2 query failed with HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as any;
    if (data && typeof data.complexPdb === "string") {
      const result: JapanFoldMultimerResult = {
        status: "success",
        complexPdb: data.complexPdb,
        ipTm: Number.isFinite(data.ipTm) ? data.ipTm : null,
        pTm: Number.isFinite(data.pTm) ? data.pTm : null,
        interfaceContacts: Array.isArray(data.interfaceContacts)
          ? data.interfaceContacts.filter((c: any) =>
              c && Number.isFinite(c.resA) && Number.isFinite(c.resB) && Number.isFinite(c.distance)
            )
          : [],
        provenance: "JapanFold Boltz-2 (Tier 1)"
      };
      japanFoldCache.set(cacheKey, result);
      return result;
    }
  } catch (err: any) {
    console.warn(`[JapanFold Client] Boltz-2 invocation error: ${err.message}`);
  }

  return null;
}

/**
 * Tier-1: Query JapanFold OpenBind-0 for interface binding affinity shifts (ΔΔG_bind).
 */
export async function queryOpenBind(
  wtPdb: string,
  mutPdb: string,
  chainA: string,
  chainB: string,
  signal?: AbortSignal
): Promise<JapanFoldBindingResult | null> {
  const wtHash = crypto.createHash("sha256").update(wtPdb).digest("hex").slice(0, 16);
  const mutHash = crypto.createHash("sha256").update(mutPdb).digest("hex").slice(0, 16);
  const cacheKey = `japanfold:openbind:${wtHash}:${mutHash}:${chainA}:${chainB}`;
  const cached = japanFoldCache.get(cacheKey);
  if (cached) return cached;

  const timeoutMs = CONFIG.timeouts.japanfoldZeroShotMs || 3500;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const effectiveSignal = anySignal([signal, timeoutSignal]);

  try {
    const url = `${CONFIG.services.japanfoldBaseUrl}/v1/predictions`;
    const response = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        model: "openbind-0",
        wtPdb,
        mutPdb,
        chainA,
        chainB
      }),
      signal: effectiveSignal
    });

    if (!response.ok) {
      console.warn(`[JapanFold Client] OpenBind-0 query failed with HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as any;
    if (data && Number.isFinite(data.ddgBind)) {
      const ddg = data.ddgBind;
      const classification: "INTERFACE_DISRUPTIVE" | "ALLOSTERIC_PERTURBATION" | "SURFACE_NEUTRAL" =
        data.classification || (ddg >= 1.5 ? "INTERFACE_DISRUPTIVE" : ddg >= 0.5 ? "ALLOSTERIC_PERTURBATION" : "SURFACE_NEUTRAL");

      const result: JapanFoldBindingResult = {
        status: "success",
        ddgBind: ddg,
        unit: data.unit || "kcal/mol",
        classification,
        provenance: "JapanFold OpenBind-0 (Tier 1)"
      };
      japanFoldCache.set(cacheKey, result);
      return result;
    }
  } catch (err: any) {
    console.warn(`[JapanFold Client] OpenBind-0 invocation error: ${err.message}`);
  }

  return null;
}

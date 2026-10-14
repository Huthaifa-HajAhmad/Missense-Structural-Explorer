/**
 * structure-resolver.ts — Authoritative 3-tier structure resolution.
 *
 * Tier 1: PDBe direct UniProt→PDB mapping   (experimental, gold standard)
 * Tier 2: EBI AlphaFold DB                  (predicted, full coverage)
 * Tier 3: RCSB sequence homolog (BLAST)     (experimental, covers mutation pos, ≥30% identity)
 *
 * Results from Tier 1 and Tier 2 are LRU-cached by the individual fetchers.
 * Tier 3 uses the pos-aware fetchPdbHomologs which also caches the unfiltered list.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TIER CHOICE IS REMEMBERED (read before removing the memo below)
 * ─────────────────────────────────────────────────────────────────────────────
 * The ladder is ordered, but its outcome is decided by the network: a Tier 1 lookup that times out
 * once falls through to AlphaFold, and the NEXT run — network recovered — picks the experimental
 * structure instead. Downstream that is not a cosmetic difference:
 *
 *   structure                  RepairPDB   BuildModel ×5   total
 *   experimental, 305 residues 205.4 s     2.2 s           208 s
 *   AlphaFold, 875 residues    skipped     5.1 s           5.1 s
 *
 * (measured on this repository's own leftover job dirs, same mutation and position — the size guard
 * skips repair past 400 residues, so the flip changes the wall clock by a factor of forty). It also
 * changes the FoldX cache key, which hashes the PDB TEXT, so each flip was a full cache miss: the
 * two `logs/foldx_cache` entries left for one mutation are exactly this.
 *
 * The CHOICE is therefore memoised — in L1 plus the persistent L2 `external_cache`, so it survives a
 * restart — for `STRUCTURE_RESOLUTION_TTL_S`. Only a small descriptor record is persisted; the
 * coordinates still come from the existing cached fetchers, which is also why the memo-hit path
 * costs at most an L1 `pdbCache` read.
 */

import { LRUCache } from "lru-cache";
import {
  fetchBestPdbStructure,
  fetchAlphafoldPdb,
  fetchPdbFromRcsb,
  fetchPdbHomologs,
  fetchVerifiedExperimentalChain,
  getResolvedAlphafoldVersion,
} from "./structure-fetcher.ts";
import { defaultCacheRegistry, getCachedOrFetch } from "../infra/cache.ts";
import { type CacheScope, currentCacheScope, newCacheScope, runInCacheScope } from "../infra/cache-scope.ts";

/** Whether calls in `scope` were refused, held back, or answered from stale data (WP-I2). */
function scopeWasHeldBack(scope: CacheScope | null): boolean {
  return Boolean(scope && (scope.rateLimitedHosts.size > 0 || scope.busyHosts.size > 0 || scope.stale.length > 0));
}
import { AnalysisDatabase } from "../infra/analysis-db.ts";
import type { StructureProvenance } from "../../../src/shared/contracts.ts";

export interface ResolvedStructure {
  pdbText: string;
  provenance: StructureProvenance;
}

const STRUCTURE_RESOLUTION_TTL_S = 6 * 60 * 60; // 6 h

/**
 * Which tier answered, in a form small enough to persist.
 *
 * Deliberately NOT the PDB text: `pdbCache` already holds coordinates by PDB id, and duplicating
 * half a megabyte per accession into the L2 table to save a cache read would be a poor trade.
 */
type ChosenStructure =
  | { tier: 1; pdbId: string; chainId: string; unpStart: number | null; structStart: number | null }
  | { tier: 2; afdbVersion: string | undefined }
  | { tier: 3; pdbId: string; chainId: string; resolution: number | null; method: string | null; identity: number; organism?: string };

interface ProbedStructure {
  choice: ChosenStructure;
  pdbText: string;
  provenance: StructureProvenance;
}

/**
 * L1 for the tier choice, with the SAME bound as the persistent tier.
 *
 * `ttl` is not decoration: without it `registerCache(..., { ttlDesc: "6h" })` labelled a cache that
 * never expired, so a choice made during a one-off PDBe outage could keep winning for the life of
 * the process — the 40× wall-clock difference this memo exists to prevent, pinned by accident.
 */
const structureResolutionCache = new LRUCache<string, ChosenStructure>({
  max: 2_000,
  ttl: STRUCTURE_RESOLUTION_TTL_S * 1000
});
defaultCacheRegistry.registerCache("structureResolution", structureResolutionCache, { ttlDesc: "6h" });

/**
 * Walks the ladder ONCE and returns the choice together with the coordinates it was made from.
 *
 * Returning both is what keeps a memo MISS to a single fetch per tier: the text is handed straight
 * to the caller instead of being re-requested after the choice is recorded.
 */
async function probeStructure(uniprotId: string, pos?: number): Promise<ProbedStructure | null> {
  // ─── Tier 1: PDBe best experimental structure (direct UniProt mapping) ────────
  try {
    const pdbMapping = await fetchBestPdbStructure(uniprotId, pos);
    if (pdbMapping) {
      /**
       * The chain is offered only after residue-by-residue verification against the UniProt sequence.
       *
       * The PDBe mapping is a segment pair (`unp_start`/`start`), so the one-shift form used here
       * numbered a construct correctly only until its first insertion or deletion — past one, every
       * residue carried a neighbour's UniProt number while the response still claimed `experimental`.
       * `fetchVerifiedExperimentalChain` renumbers through PDBe's per-residue map (SIFTS) or the
       * sequence alignment, and refuses when the wild-type residue at the site does not match; a
       * refusal falls through to the predicted tiers rather than serving mis-numbered coordinates.
       */
      const verified = await fetchVerifiedExperimentalChain(
        pdbMapping.pdbId,
        pdbMapping.chainId,
        uniprotId,
        pos,
        pdbMapping.unpStart,
        pdbMapping.structStart
      );
      if (verified) {
        console.log(`[resolveStructure] Tier 1 hit: PDB ${pdbMapping.pdbId.toUpperCase()} chain ${pdbMapping.chainId}`);
        return {
          choice: {
            tier: 1,
            pdbId: pdbMapping.pdbId,
            chainId: pdbMapping.chainId,
            unpStart: pdbMapping.unpStart ?? null,
            structStart: pdbMapping.structStart ?? null
          },
          pdbText: verified.pdbText,
          provenance: {
            source: "experimental",
            pdbId: pdbMapping.pdbId.toUpperCase(),
            chainId: pdbMapping.chainId
          }
        };
      }
      console.warn(
        `[resolveStructure] Tier 1 mapping for PDB ${pdbMapping.pdbId.toUpperCase()} chain ` +
        `${pdbMapping.chainId} did not verify residue-by-residue against ${uniprotId}; ` +
        `not serving it as UniProt-numbered experimental.`
      );
    }
  } catch (err: any) {
    console.warn("[resolveStructure] Tier 1 (PDBe direct) failed:", err.message);
  }

  // ─── Tier 2: EBI AlphaFold predicted structure ────────────────────────────────
  try {
    const afData = await fetchAlphafoldPdb(uniprotId);
    if (afData) {
      /**
       * Only a version the resolved URL actually names is reported. The old `|| "v4"` (and the
       * route's `|| "v6"`) stamped a version on provenance that the bytes need not carry — a claim
       * that looks like verification and cannot be checked downstream.
       */
      const afdbVersion = getResolvedAlphafoldVersion(uniprotId);
      console.log(`[resolveStructure] Tier 2 hit: AlphaFold${afdbVersion ? ` (${afdbVersion})` : ""} for ${uniprotId}`);
      return {
        choice: { tier: 2, afdbVersion },
        pdbText: afData,
        provenance: { source: "alphafold", afdbVersion }
      };
    }
  } catch (err: any) {
    console.warn("[resolveStructure] Tier 2 (AlphaFold) failed:", err.message);
  }

  // ─── Tier 3: RCSB sequence homolog covering mutation position ─────────────────
  try {
    const homologs = await fetchPdbHomologs(uniprotId, pos);

    // Rank by resolution (ascending — lower Å is better), then identity (descending)
    // The tier's own contract: ≥30% identity AND covering the mutation position. Coverage was not
    // checked, and "identity" used to be the search's relevance score.
    // `chainId` is the matched polymer entity's author chain, not the entry's default chain.
    const ranked = homologs
      .filter(h => h.identity !== null && h.identity >= 30 && (pos === undefined || h.coversPosition === true))
      .sort((a, b) => {
        const resA = a.resolution ?? 99;
        const resB = b.resolution ?? 99;
        if (resA !== resB) return resA - resB;
        return (b.identity ?? 0) - (a.identity ?? 0);
      });

    // The search matched an ENTITY, not a chain: load the entity's own chain, and refuse the
    // candidate when no entity -> chain mapping is known rather than defaulting to chain A (which is
    // routinely a partner, a nanobody or a second copy — a different molecule's coordinates).
    for (const best of ranked) {
      if (!best.chainId) {
        console.warn(`[resolveStructure] Tier 3: ${best.pdbId.toUpperCase()} has no resolved entity→chain mapping; refusing to assume chain A.`);
        continue;
      }
      const pdbText = await fetchPdbFromRcsb(best.pdbId, best.chainId);
      if (!pdbText) continue;
      console.log(
        `[resolveStructure] Tier 3 hit: homolog ${best.pdbId} chain ${best.chainId} ` +
        `(${best.identity}% identity, ${best.resolution ?? "?"}Å, ${best.organism})`
      );
      return {
        choice: {
          tier: 3,
          pdbId: best.pdbId,
          chainId: best.chainId,
          resolution: best.resolution ?? null,
          method: best.method ?? null,
          identity: best.identity!,
          organism: best.organism
        },
        pdbText,
        provenance: {
          source: "homolog",
          pdbId: best.pdbId,
          chainId: best.chainId,
          resolution: best.resolution,
          method: best.method,
          identity: best.identity!
        }
      };
    }
  } catch (err: any) {
    console.warn("[resolveStructure] Tier 3 (RCSB homolog) failed:", err.message);
  }

  return null;
}

/** Re-materialises a memoised choice. The coordinates come from the fetchers' own L1 caches. */
async function materialise(
  uniprotId: string,
  pos: number | undefined,
  choice: ChosenStructure
): Promise<ResolvedStructure | null> {
  if (choice.tier === 1) {
    // Re-verify on the way back out: the memo records which entry and chain, not coordinates, and
    // the fetch is the same residue-by-residue gate the probe used.
    const verified = await fetchVerifiedExperimentalChain(
      choice.pdbId,
      choice.chainId,
      uniprotId,
      pos,
      choice.unpStart ?? undefined,
      choice.structStart ?? undefined
    );
    return verified
      ? {
          pdbText: verified.pdbText,
          provenance: { source: "experimental", pdbId: choice.pdbId.toUpperCase(), chainId: choice.chainId }
        }
      : null;
  }

  if (choice.tier === 2) {
    const pdbText = await fetchAlphafoldPdb(uniprotId);
    if (!pdbText) return null;
    // The version travels with the bytes re-materialised NOW, not with the six-hour-old memo: a
    // release since the choice was recorded would otherwise be reported under the old label, while
    // the coordinates come from the new release. The memo's value is the fallback for a fetch whose
    // URL names no version.
    const afdbVersion = getResolvedAlphafoldVersion(uniprotId) ?? choice.afdbVersion;
    return { pdbText, provenance: { source: "alphafold", afdbVersion } };
  }

  const pdbText = await fetchPdbFromRcsb(choice.pdbId, choice.chainId);
  return pdbText
    ? {
        pdbText,
        provenance: {
          source: "homolog",
          pdbId: choice.pdbId,
          chainId: choice.chainId,
          resolution: choice.resolution,
          method: choice.method ?? undefined,
          identity: choice.identity
        }
      }
    : null;
}

/**
 * Resolve the best available structure for a given UniProt accession.
 *
 * @param uniprotId - Validated UniProt accession
 * @param pos       - 1-indexed mutation position (used for coverage gating in Tier 1 & 3)
 * @returns ResolvedStructure or null if all tiers fail
 */
export async function resolveStructure(
  uniprotId: string,
  pos?: number
): Promise<ResolvedStructure | null> {
  const memoKey = `structure-resolution:${uniprotId}:${pos ?? "na"}`;

  /**
   * The coordinates the probe just fetched, captured per CALL rather than per module.
   *
   * A module-level handoff would be clobbered by any concurrent resolution (two browsers asking for
   * two genes), which would serve one variant's structure for another's. A closure cannot be.
   */
  let freshlyProbed: ProbedStructure | null = null;

  /** Set when the probe's calls were refused or held back: its choice may be a fallback tier (WP-I2). */
  let probeDegraded = false;

  let chosen: ChosenStructure | null = null;
  try {
    chosen = await getCachedOrFetch<ChosenStructure | null>({
      key: memoKey,
      source: "structure-resolution",
      l1Cache: structureResolutionCache as any,
      ttlSeconds: STRUCTURE_RESOLUTION_TTL_S,
      fetcher: async () => {
        const probed = await probeStructure(uniprotId, pos);
        probeDegraded = scopeWasHeldBack(currentCacheScope());
        if (!probed) return null;
        freshlyProbed = probed;
        return probed.choice;
      },
      // A total failure is not a decision: it must be retried, not remembered for six hours. Nor is a
      // choice made while a provider refused or held back calls: PDBe answering 429 makes the probe
      // fall to a lower tier, which must not be remembered as this protein's structure.
      shouldCache: (result) => result !== null && !probeDegraded
    });
  } catch (err: any) {
    console.warn("[resolveStructure] Tier memoisation failed, resolving directly:", err.message);
    freshlyProbed = await probeStructure(uniprotId, pos);
    chosen = freshlyProbed?.choice ?? null;
  }

  if (!chosen) {
    console.warn(`[resolveStructure] All tiers failed for ${uniprotId} (pos=${pos ?? "unspecified"})`);
    return null;
  }

  // Fast path: this call probed the ladder itself, so the coordinates are already in hand.
  if (freshlyProbed && freshlyProbed.choice === chosen) {
    return { pdbText: freshlyProbed.pdbText, provenance: freshlyProbed.provenance };
  }

  const materialised = await materialise(uniprotId, pos, chosen).catch((err: any) => {
    console.warn("[resolveStructure] Re-materialising the memoised tier failed:", err.message);
    return null;
  });
  if (materialised) return materialised;

  /**
   * The memoised tier could not be materialised — its coordinates are genuinely gone (a PDB id that
   * no longer serves, an AlphaFold entry withdrawn). Re-choose, and record the corrected choice in
   * BOTH tiers: dropping only the L1 entry left the stale choice in the persistent cache, so every
   * later L1 miss re-read it, failed to materialise it again, and re-probed the network — correct,
   * but a wasted round trip on every call until the six-hour row expired.
   */
  try {
    structureResolutionCache.delete(memoKey);
  } catch {}
  const probeScope = newCacheScope(currentCacheScope());
  const reProbed = await runInCacheScope(probeScope, () => probeStructure(uniprotId, pos));
  if (!reProbed) return null;
  if (scopeWasHeldBack(probeScope)) return { pdbText: reProbed.pdbText, provenance: reProbed.provenance };
  try {
    structureResolutionCache.set(memoKey, reProbed.choice);
    await AnalysisDatabase.getInstance()
      .saveExternalCacheAsync(memoKey, reProbed.choice, "structure-resolution", STRUCTURE_RESOLUTION_TTL_S)
      .catch(() => {});
  } catch {}
  return { pdbText: reProbed.pdbText, provenance: reProbed.provenance };
}

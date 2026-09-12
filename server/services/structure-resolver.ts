/**
 * structure-resolver.ts — Authoritative 3-tier structure resolution.
 *
 * Tier 1: PDBe direct UniProt→PDB mapping   (experimental, gold standard)
 * Tier 2: EBI AlphaFold DB                  (predicted, full coverage)
 * Tier 3: RCSB sequence homolog (BLAST)     (experimental, covers mutation pos, ≥30% identity)
 *
 * Results from Tier 1 and Tier 2 are LRU-cached by the individual fetchers.
 * Tier 3 uses the pos-aware fetchPdbHomologs which also caches the unfiltered list.
 */

import {
  fetchBestPdbStructure,
  fetchAlphafoldPdb,
  fetchPdbFromRcsb,
  fetchPdbHomologs,
  getResolvedAlphafoldVersion,
} from "./structure-fetcher.ts";
import type { StructureProvenance } from "../../src/shared/contracts.ts";

export interface ResolvedStructure {
  pdbText: string;
  provenance: StructureProvenance;
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

  // ─── Tier 1: PDBe best experimental structure (direct UniProt mapping) ────────
  try {
    const pdbMapping = await fetchBestPdbStructure(uniprotId, pos);
    if (pdbMapping) {
      const pdbData = await fetchPdbFromRcsb(
        pdbMapping.pdbId,
        pdbMapping.chainId,
        pdbMapping.unpStart,
        pdbMapping.structStart
      );
      if (pdbData) {
        console.log(`[resolveStructure] Tier 1 hit: PDB ${pdbMapping.pdbId.toUpperCase()} chain ${pdbMapping.chainId}`);
        return {
          pdbText: pdbData,
          provenance: {
            source: "experimental",
            pdbId: pdbMapping.pdbId.toUpperCase(),
            chainId: pdbMapping.chainId,
          },
        };
      }
    }
  } catch (err: any) {
    console.warn("[resolveStructure] Tier 1 (PDBe direct) failed:", err.message);
  }

  // ─── Tier 2: EBI AlphaFold predicted structure ────────────────────────────────
  try {
    const afData = await fetchAlphafoldPdb(uniprotId);
    if (afData) {
      const afdbVersion = getResolvedAlphafoldVersion(uniprotId) || "v4";
      console.log(`[resolveStructure] Tier 2 hit: AlphaFold (${afdbVersion}) for ${uniprotId}`);
      return {
        pdbText: afData,
        provenance: {
          source: "alphafold",
          afdbVersion
        },
      };
    }
  } catch (err: any) {
    console.warn("[resolveStructure] Tier 2 (AlphaFold) failed:", err.message);
  }

  // ─── Tier 3: RCSB sequence homolog covering mutation position ─────────────────
  try {
    const homologs = await fetchPdbHomologs(uniprotId, pos);

    // Rank by resolution (ascending — lower Å is better), then identity (descending)
    const ranked = homologs
      .filter(h => h.identity >= 30)
      .sort((a, b) => {
        const resA = a.resolution ?? 99;
        const resB = b.resolution ?? 99;
        if (resA !== resB) return resA - resB;
        return b.identity - a.identity;
      });

    if (ranked.length > 0) {
      const best = ranked[0];
      const pdbData = await fetchPdbFromRcsb(best.pdbId);
      if (pdbData) {
        console.log(
          `[resolveStructure] Tier 3 hit: homolog ${best.pdbId} ` +
          `(${best.identity}% identity, ${best.resolution ?? "?"}Å, ${best.organism})`
        );
        return {
          pdbText: pdbData,
          provenance: {
            source: "homolog",
            pdbId: best.pdbId,
            resolution: best.resolution,
            method: best.method,
            identity: best.identity,
          },
        };
      }
    }
  } catch (err: any) {
    console.warn("[resolveStructure] Tier 3 (RCSB homolog) failed:", err.message);
  }

  console.warn(`[resolveStructure] All tiers failed for ${uniprotId} (pos=${pos ?? "unspecified"})`);
  return null;
}

/**
 * variantCache.ts — High-fidelity client-side cache for complete variant analysis snapshots.
 * Caches 3D structures (WT + Mutant), FoldX energetics, ACMG, predictions, pockets, and homologs.
 * Includes strict cache versioning and legacy storage migration/cleanup.
 */

import { isFallbackNarrative as sharedIsFallbackNarrative } from "../../shared/narrativeFallback";

/**
 * Client-side snapshot cache, versioned so a schema change to what a bundle MEANS invalidates it.
 *
 * v3.7 — invalidated because `analysisResult` became build-aware on the server.
 *
 * This cache is keyed on protein notation (`GENE_variant`), which is canonically
 * build-independent: the same amino-acid substitution is the same substitution whichever build the
 * coordinates came from, and the rest of the bundle (PDB text, FoldER energetics, pockets,
 * homologs) carries no coordinates at all. What DOES depend on the build is the embedded
 * `analysisResult`, because the server assembles it from coordinate-consuming sources.
 *
 * The server side is now build-scoped (its cache keys carry the build and the schema version was
 * bumped), so the residual hazard is narrow but real: whichever build requested a protein variant
 * FIRST leaves a snapshot here for 24 h, and a later request for the same protein variant from the
 * other build is served that snapshot without contacting the server. Bumping the version discards
 * the entries written before the server became build-aware; closing the remaining window needs the
 * build in this key, which requires threading it through every one of the ~20 call sites — most of
 * which only ever hold protein notation and therefore have no build to thread.
 */
export const CACHE_VERSION = "v3.7";
const CACHE_PREFIX = `mrx_bundle_${CACHE_VERSION}_`;
const MAX_CACHE_ENTRIES = 25;

export interface CachedVariantBundle {
  version?: string;
  gene: string;
  variant: string;
  uniprotId: string;
  analysisResult?: any | null;
  pdbText?: string | null;
  mutantPdb?: string | null;
  foldedResidueIndex?: number | null;
  foldingDdG?: number | null;
  foldingEnergetics?: any | null;
  foldingStatus?: string | null;
  dynamut2JobId?: string | null;
  dynamut2Status?: string | null;
  ddmutJobId?: string | null;
  ddmutStatus?: string | null;
  thermompnnJobId?: string | null;
  thermompnnStatus?: string | null;
  thermompnnError?: string | null;
  computedPocket?: any | null;
  homologs?: any[] | null;
  disruptionPredictor?: any | null;
  /**
   * When the biophysics pipeline was last dispatched for this variant.
   *
   * Dedicated to this purpose on purpose: `timestamp` below is a whole-bundle marker refreshed by
   * ANY write (landscape, multimer, pockets), so using it as a retry clock would let an unrelated
   * update silently re-arm — or suppress — a multi-minute FoldX re-run.
   */
  biophysicsAttemptedAt?: number;
  timestamp: number;
}

const memoryVariantCache = new Map<string, CachedVariantBundle>();

// Clean up legacy or mismatched cache keys from older application releases
function purgeLegacyCaches() {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith("mre_analysis_") || (k.startsWith("mrx_") && !k.startsWith(CACHE_PREFIX)))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => sessionStorage.removeItem(k));
  } catch (_) {}
}

purgeLegacyCaches();

function getCacheKey(gene: string, variant: string): string {
  return `${gene.trim().toUpperCase()}_${variant.trim().toLowerCase()}`;
}

export function getCachedVariant(gene: string, variant: string): CachedVariantBundle | null {
  if (!gene || !variant) return null;
  const key = getCacheKey(gene, variant);

  // 1. In-memory lookup (fastest, 0ms)
  if (memoryVariantCache.has(key)) {
    const entry = memoryVariantCache.get(key)!;
    if (Date.now() - entry.timestamp < 24 * 60 * 60 * 1000) {
      return entry;
    }
    memoryVariantCache.delete(key);
  }

  // 2. Session storage fallback
  try {
    const stored = sessionStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (stored) {
      const parsed: CachedVariantBundle = JSON.parse(stored);
      if (parsed && parsed.version === CACHE_VERSION && Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
        memoryVariantCache.set(key, parsed);
        return parsed;
      }
      sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
    }
  } catch (_) {}

  return null;
}

export function setCachedVariant(
  gene: string,
  variant: string,
  uniprotId: string,
  bundle: Partial<CachedVariantBundle>,
  /**
   * Persist `biophysicsAttemptedAt` even for a bundle the guard below refuses to store.
   *
   * The retry cooldown is written at exactly the moment the guard fires — the previous attempt
   * either failed or is still partial — so the timestamp reached memory only. A reload (or a tab
   * crash) then restored a snapshot with no record of the attempt, `retryCooldownElapsed` read
   * `undefined` as "elapsed", and the full multi-minute FoldX run was dispatched again: the compute
   * burn the cooldown exists to prevent, reachable by pressing F5.
   *
   * This writes ONLY the cooldown metadata, never the failed biophysics payload the guard protects
   * the user from.
   */
  options?: { persistAttemptTimestamp?: boolean }
): void {
  if (!gene || !variant) return;
  const key = getCacheKey(gene, variant);

  const existing = memoryVariantCache.get(key) || {
    version: CACHE_VERSION,
    gene: gene.trim().toUpperCase(),
    variant: variant.trim(),
    uniprotId: (uniprotId || "").trim(),
    timestamp: Date.now()
  };

  const updated: CachedVariantBundle = {
    ...existing,
    ...bundle,
    version: CACHE_VERSION,
    gene: gene.trim().toUpperCase(),
    variant: variant.trim(),
    uniprotId: (uniprotId || existing.uniprotId || "").trim(),
    timestamp: Date.now()
  };

  memoryVariantCache.set(key, updated);

  // Do not persist preliminary, failed/errored, or fallback narrative evaluations into long-term sessionStorage
  const isPreliminary = updated.foldingEnergetics?.evidenceComplete === false ||
    Boolean(updated.foldingEnergetics?.pendingTools && updated.foldingEnergetics.pendingTools.length > 0);
  const isFallback = isFallbackNarrative(
    updated.analysisResult?.analysis,
    updated.analysisResult?.isFallback,
    updated.analysisResult?.fallbackReason
  );

  if (isFallback) {
    /**
     * Drop the degraded narrative from the IN-MEMORY entry as well.
     *
     * Previously only sessionStorage was guarded, and `memoryVariantCache.set` above had
     * already stored the fallback. `getCachedVariant` reads memory first and returns for 24h,
     * so within a session a single transient provider 503 permanently pinned the fallback for
     * that variant: every later re-analysis served the stale offline report and never retried
     * the model. That is what made the outage look permanent rather than transient.
     *
     * Biophysical artefacts (structures, energetics, pockets) are still cached — only the
     * narrative is discarded so the next lookup re-attempts synthesis.
     */
    updated.analysisResult = undefined;
    memoryVariantCache.set(key, updated);

    try {
      const hasBiophysicalData = Boolean(
        updated.pdbText ||
        updated.mutantPdb ||
        updated.foldingDdG !== undefined ||
        updated.foldingEnergetics ||
        updated.computedPocket
      );
      if (hasBiophysicalData) {
        const storageCopy = { ...updated, analysisResult: undefined };
        if (storageCopy.pdbText && storageCopy.pdbText.length > 2 * 1024 * 1024) {
          delete storageCopy.pdbText;
        }
        if (storageCopy.mutantPdb && storageCopy.mutantPdb.length > 2 * 1024 * 1024) {
          delete storageCopy.mutantPdb;
        }
        sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(storageCopy));
      } else {
        sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
      }
    } catch (_) {}
    return;
  }

  if (updated.foldingStatus === "failed" || (updated.foldingEnergetics as any)?.foldxError || isPreliminary) {
    if (options?.persistAttemptTimestamp && updated.biophysicsAttemptedAt !== undefined) {
      try {
        const storageKey = `${CACHE_PREFIX}${key}`;
        const onDisk = sessionStorage.getItem(storageKey);
        const base = onDisk ? JSON.parse(onDisk) : {};
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            ...base,
            version: CACHE_VERSION,
            gene: updated.gene,
            variant: updated.variant,
            uniprotId: updated.uniprotId,
            // `getCachedVariant` refuses a record without a fresh timestamp (and expires it after
            // 24h), so a cooldown written without one would be discarded on the very reload it
            // exists to survive.
            timestamp: updated.timestamp,
            biophysicsAttemptedAt: updated.biophysicsAttemptedAt
          })
        );
      } catch (_) {
        // Storage full or unavailable: the in-memory cooldown still applies to this session.
      }
    }
    return;
  }

  // Enforce LRU bounds in memory
  if (memoryVariantCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = memoryVariantCache.keys().next().value;
    if (oldestKey) memoryVariantCache.delete(oldestKey);
  }

  // Persist to sessionStorage (excluding overly large raw PDB strings if storage is constrained)
  try {
    const storageCopy = { ...updated };
    if (storageCopy.pdbText && storageCopy.pdbText.length > 2 * 1024 * 1024) {
      delete storageCopy.pdbText;
    }
    if (storageCopy.mutantPdb && storageCopy.mutantPdb.length > 2 * 1024 * 1024) {
      delete storageCopy.mutantPdb;
    }
    sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(storageCopy));
  } catch (_) {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX) && k !== `${CACHE_PREFIX}${key}`) {
          sessionStorage.removeItem(k);
          break;
        }
      }
    } catch (_) {}
  }
}

export function isFallbackNarrative(
  analysis?: string | null,
  isFallback?: boolean,
  fallbackReason?: string | null
): boolean {
  // Structured signal first; prose sniffing is a compatibility shim for payloads cached
  // before the server emitted `fallbackReason`. See src/shared/narrativeFallback.ts.
  return sharedIsFallbackNarrative(analysis, isFallback, fallbackReason);
}

export function purgeFallbackNarratives(): void {
  for (const [, entry] of memoryVariantCache.entries()) {
    if (isFallbackNarrative(entry.analysisResult?.analysis, entry.analysisResult?.isFallback, entry.analysisResult?.fallbackReason)) {
      entry.analysisResult = undefined;
    }
  }

  // Also purge fallback narrative payload directly from sessionStorage, preserving biophysical data
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) {
          const raw = sessionStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (isFallbackNarrative(parsed?.analysisResult?.analysis, parsed?.analysisResult?.isFallback, parsed?.analysisResult?.fallbackReason)) {
              parsed.analysisResult = undefined;
              sessionStorage.setItem(k, JSON.stringify(parsed));
            }
          }
        }
      }
    } catch (_) {}
  }
}

export function clearClientVariantCache(): void {
  memoryVariantCache.clear();
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("mrx_")) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => sessionStorage.removeItem(k));
  } catch (_) {}
}


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
 *
 * v3.8: discards bundles written before the unmapping-defect fixes — they carry no
 * `assemblyRefusals`, no lifted coordinates, and pre-fix splice geometry. The surfaces degrade
 * honestly on such payloads, but replaying one would hide the fix for up to 24 h on a
 * recently-viewed variant (external review UI#7).
 *
 * v3.9: discards bundles whose burial word was computed under the retired 5%/25% RSA cutoffs.
 * A payload carrying `rsa: 0.30, burialStatus: "surface"` would otherwise render a "Surface"
 * badge beside a "30.0% · BOUNDARY" measure for up to 24 h. The panel now detects that
 * contradiction and says so, but the honest bundle is the one that was never written under the
 * old definition (external review §cache).
 *
 * v4.0: discards bundles carrying a narrative written by the previous prompt. That prompt omitted
 * ClinVar entirely for a variant ClinVar does not hold, so the model supplied a classification from
 * its own priors — for CNNM2 p.Ser489Cys the plausibility paragraph asserted a ClinVar VUS while the
 * Population panel printed "ClinVar holds no classification for this variant". The prompt and its
 * cache key were both fixed (`NARRATIVE_PROMPT_SCHEMA_VERSION`), but THIS cache is the one that
 * short-circuits the server, so a variant viewed before the change would have replayed the invented
 * classification for up to a day without the fixed prompt ever running. The server-side bump cannot
 * reach here: this is sessionStorage on the client, and `workflowOrchestrator` replays it verbatim.
 */
export const CACHE_VERSION = "v4.0";
const CACHE_PREFIX = `mrx_bundle_${CACHE_VERSION}_`;
const MAX_CACHE_ENTRIES = 25;

/**
 * Biophysics attempt timestamps live under their OWN key, deliberately not inside a cached bundle.
 *
 * They were briefly written as a payload-free bundle record, which failed twice over, both measured
 * by review:
 *   • the only reader of `biophysicsAttemptedAt` sits INSIDE the cached-bundle branch, and a record
 *     with no `analysisResult` can never reach it — so the cooldown was written and then ignored,
 *     and the multi-minute FoldX re-run it exists to prevent still happened;
 *   • `getCachedVariant` returned that record as a truthy "cached variant", so the four call sites
 *     guarding on `if (!cached) resetViewerState()` skipped their reset and left the PREVIOUS
 *     variant's structure on screen.
 *
 * A timestamp is not a bundle. Keeping it in its own store means it cannot be mistaken for one.
 */
const ATTEMPT_PREFIX = `mrx_attempt_${CACHE_VERSION}_`;
const memoryAttempts = new Map<string, number>();

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
      /**
       * Spare the cooldown store.
       *
       * This purge deletes every `mrx_*` key that is not a bundle, and it runs at module scope on
       * EVERY page load — so `mrx_attempt_<…>` was being deleted on the reload it exists to survive,
       * which is precisely the F5 compute burn the cooldown was added to prevent. A reviewer
       * reproduced it: record an attempt, reload, and `getBiophysicsAttemptedAt` returns null.
       */
      const isBundle = Boolean(k && k.startsWith(CACHE_PREFIX));
      const isAttempt = Boolean(k && k.startsWith(ATTEMPT_PREFIX));
      if (k && (k.startsWith("mre_analysis_") || (k.startsWith("mrx_") && !isBundle && !isAttempt))) {
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
  bundle: Partial<CachedVariantBundle>
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
    // No cooldown write here any more — `recordBiophysicsAttempt` owns that, under its own key.
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

/**
 * Records that a biophysics attempt was made for this variant, in memory and in sessionStorage.
 *
 * Written BEFORE dispatch so an abort or a crash still starts the cooldown. Independent of
 * `setCachedVariant` and its persistence guard by design: the cooldown is recorded at exactly the
 * moment that guard refuses to store a bundle (the previous attempt failed or is still partial), so
 * routing it through the bundle was always going to be fragile.
 */
export function recordBiophysicsAttempt(gene: string, variant: string, _uniprotId?: string | null): void {
  if (!gene || !variant) return;
  const key = getCacheKey(gene, variant);
  const at = Date.now();
  memoryAttempts.set(key, at);
  try {
    sessionStorage.setItem(`${ATTEMPT_PREFIX}${key}`, String(at));
  } catch (_) {
    // Storage full or unavailable: the in-memory cooldown still applies to this session.
  }
}

/**
 * The last recorded attempt time for this variant, or null.
 *
 * Falls back to a bundle field so a timestamp written by the previous release is still honoured —
 * but prefers the dedicated store, which is the one that survives a reload for failed and
 * preliminary bundles alike.
 */
export function getBiophysicsAttemptedAt(gene: string, variant: string): number | null {
  if (!gene || !variant) return null;
  const key = getCacheKey(gene, variant);

  const inMemory = memoryAttempts.get(key);
  if (typeof inMemory === "number") return inMemory;

  try {
    const stored = sessionStorage.getItem(`${ATTEMPT_PREFIX}${key}`);
    if (stored) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        memoryAttempts.set(key, parsed);
        return parsed;
      }
    }
  } catch (_) {}

  // Backwards compatibility with a bundle that carries the field.
  const fromBundle = getCachedVariant(gene, variant)?.biophysicsAttemptedAt;
  return typeof fromBundle === "number" ? fromBundle : null;
}

export function clearClientVariantCache(): void {
  memoryVariantCache.clear();
  memoryAttempts.clear();
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


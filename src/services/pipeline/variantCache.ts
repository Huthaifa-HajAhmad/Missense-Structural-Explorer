/**
 * variantCache.ts — High-fidelity client-side cache for complete variant analysis snapshots.
 * Caches 3D structures (WT + Mutant), FoldX energetics, ACMG, predictions, pockets, and homologs.
 * Includes strict cache versioning and legacy storage migration/cleanup.
 */

import { isFallbackNarrative as sharedIsFallbackNarrative } from "../../shared/narrativeFallback";
import { analysisContextMatches, type AnalysisCacheContext } from "./analysisContext";

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
 *
 * v4.1: discards bundles whose embedded analysis result was built against a non-canonical reference.
 * The key is build-free by design (protein notation), so a coordinate that could not be lifted at the
 * time kept replaying an older coordinate, an older target build and withheld population evidence —
 * observed as "PM2 withheld: this coordinate's build is not one gnomAD r4 serves" for a variant that
 * scores PM2 on a fresh run, reached by clicking the same variant in Recents. `isBuildDegradedResult`
 * now refuses to SERVE such a bundle (and `hasCompleteAnalysis` refuses to short-circuit on it); this
 * bump also drops the ones already stored whose build signal is missing or predates the lift record.
 *
 * v4.2: a stored bundle replays the verdict the engine computed at the time. The combining rule for
 * PVS1 + supporting evidence (Richards 2015 Table 5 (i)(c)/(d)), the ClinVar "Conflicting" reading
 * (PS1 and the conservative-weighting gate) and the narrative prompt (schema v4) all changed, so a
 * bundle stored under the old rules would keep showing a verdict the current engine no longer gives.
 *
 * v4.3: PM2 is weighed at Supporting (ClinGen SVI 2020) and PVS1 + 1 Supporting is Likely pathogenic,
 * which re-tiers stored verdicts the same way.
 */
// v4.4 separates context-scoped interpretation from reusable protein artifacts.
// v4.6 invalidates narratives produced before screening-selected literature context.
export const CACHE_VERSION = "v4.6";
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
  /** FoldX's paired wild type. Held in memory only: a second structure per entry would crowd sessionStorage. */
  foldxWtPdb?: string | null;
  foldedResidueIndex?: number | null;
  foldingDdG?: number | null;
  foldingEnergetics?: any | null;
  /** Conditions actually submitted for these cached solver artifacts. */
  biophysicsContext?: string;
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

/** Reads reusable artifacts separately from context-dependent interpretation. */
export function getCachedVariant(gene: string, variant: string, expected?: AnalysisCacheContext): CachedVariantBundle | null {
  const compatible = (entry: CachedVariantBundle): CachedVariantBundle | null => {
    if (!expected) return entry;
    // A missing reference is not permission to reuse another isoform's coordinates or mutation.
    if (!expected.uniprotId || (entry.uniprotId || "").toUpperCase() !== expected.uniprotId) return null;
    const copy = { ...entry };
    if (!analysisContextMatches(entry.analysisResult?.metadata?.pipelineContext, expected)) copy.analysisResult = undefined;
    if (copy.analysisResult?.metadata?.pipelineStages) {
      const stages = { ...copy.analysisResult.metadata.pipelineStages };
      let hasRunning = false;
      for (const [k, v] of Object.entries(stages)) {
        if (v === "running") {
          stages[k] = "complete";
          hasRunning = true;
        } 
      }
      if (hasRunning) {
        copy.analysisResult = {
          ...copy.analysisResult,
          metadata: { ...copy.analysisResult.metadata, pipelineStages: stages }
        };
      }
    }
    if (entry.biophysicsContext !== expected.simulationConditions) {
      // Coordinates remain reusable. Energetics, mutants and remote jobs do not cross conditions.
      for (const key of ["mutantPdb", "foldxWtPdb", "foldedResidueIndex", "foldingDdG", "foldingEnergetics", "foldingStatus", "dynamut2JobId", "dynamut2Status", "ddmutJobId", "ddmutStatus", "thermompnnJobId", "thermompnnStatus", "thermompnnError", "biophysicsAttemptedAt"] as const) delete copy[key];
    }
    return copy;
  };
  if (!gene || !variant) return null;
  const key = getCacheKey(gene, variant);

  // 1. In-memory lookup (fastest, 0ms)
  if (memoryVariantCache.has(key)) {
    const entry = memoryVariantCache.get(key)!;
    if (Date.now() - entry.timestamp < 24 * 60 * 60 * 1000) {
      memoryVariantCache.delete(key);
      memoryVariantCache.set(key, entry);
      return compatible(entry);
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
        return compatible(parsed);
      }
      sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
    }
  } catch (_) {}

  return null;
}

/** Discard failed optional prose, never the independently completed scientific evidence. */
function withoutDegradedNarrative(result: any): any {
  if (result?.metadata?.pipelineStages?.core !== "complete") return undefined;
  return {
    ...result, analysis: "", insights: null, modelUsed: null,
    metadata: { ...result.metadata, narrativeEvidence: undefined, insightsSource: undefined,
      pipelineStages: { ...result.metadata.pipelineStages, narrative: "degraded" } }
  };
}

let cacheWriteFailureReported = false;

/**
 * A failed sessionStorage write (quota, private mode) used to vanish. The cost is real — the variant's
 * FoldX result is not kept, so the next visit re-runs a multi-minute job — so it is reported, once per
 * session, rather than on every write.
 */
function noteCacheWriteFailure(err: unknown): void {
  if (cacheWriteFailureReported) return;
  cacheWriteFailureReported = true;
  console.warn(
    "[Cache] Could not save this variant's results to the browser cache; revisiting it will recompute them:",
    err instanceof Error ? err.message : err
  );
}

/**
 * Drop one variant's bundle, so the next run of it is computed rather than restored.
 *
 * Used by an explicit "Re-run analysis": the reader is asking for a fresh answer because the stored
 * one is incomplete (a provider timed out, or the locus lookup fell back), and restoring the bundle
 * would hand the same incomplete answer straight back.
 */
export function invalidateCachedVariant(gene: string, variant: string): void {
  if (!gene || !variant) return;
  const key = getCacheKey(gene, variant);
  memoryVariantCache.delete(key);
  try {
    sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
  } catch (_) {}
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

  if (updated.analysisResult?.metadata?.pipelineStages) {
    const stages = { ...updated.analysisResult.metadata.pipelineStages };
    let hasRunning = false;
    for (const [k, v] of Object.entries(stages)) {
      if (v === "running") {
        stages[k] = "complete";
        hasRunning = true;
      }
    }
    if (hasRunning) {
      updated.analysisResult = {
        ...updated.analysisResult,
        metadata: { ...updated.analysisResult.metadata, pipelineStages: stages }
      };
    }
  }

  memoryVariantCache.delete(key);
  memoryVariantCache.set(key, updated);
  // Every entry counts toward the bound, including fallback/failed/preliminary writes.
  if (memoryVariantCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = memoryVariantCache.keys().next().value;
    if (oldestKey) memoryVariantCache.delete(oldestKey);
  }

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
    updated.analysisResult = withoutDegradedNarrative(updated.analysisResult);
    memoryVariantCache.set(key, updated);

    try {
      const hasBiophysicalData = Boolean(
        updated.analysisResult || updated.pdbText ||
        updated.mutantPdb ||
        updated.foldingDdG !== undefined ||
        updated.foldingEnergetics ||
        updated.computedPocket
      );
      if (hasBiophysicalData) {
        const storageCopy = { ...updated };
        if (storageCopy.pdbText && storageCopy.pdbText.length > 2 * 1024 * 1024) {
          delete storageCopy.pdbText;
        }
        if (storageCopy.mutantPdb && storageCopy.mutantPdb.length > 2 * 1024 * 1024) {
          delete storageCopy.mutantPdb;
        }
        delete storageCopy.foldxWtPdb;
        sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(storageCopy));
      } else {
        sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
      }
    } catch (err) {
      noteCacheWriteFailure(err);
    }
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
    delete storageCopy.foldxWtPdb;
    sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(storageCopy));
  } catch (err) {
    // This entry is not persisted (the eviction below frees room for the NEXT write, it does not
    // retry this one), so the session keeps it in memory only.
    noteCacheWriteFailure(err);
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
      entry.analysisResult = withoutDegradedNarrative(entry.analysisResult);
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
              parsed.analysisResult = withoutDegradedNarrative(parsed.analysisResult);
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

/**
 * variantCache.ts — High-fidelity client-side cache for complete variant analysis snapshots.
 * Caches 3D structures (WT + Mutant), FoldX energetics, ACMG, predictions, pockets, and homologs.
 * Includes strict cache versioning and legacy storage migration/cleanup.
 */

export const CACHE_VERSION = "v3.5";
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
  const isFallback = isFallbackNarrative(updated.analysisResult?.analysis, updated.analysisResult?.isFallback);

  if (isFallback) {
    try {
      sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
    } catch (_) {}
    return;
  }

  if (updated.foldingStatus === "failed" || (updated.foldingEnergetics as any)?.foldxError || isPreliminary) {
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

export function isFallbackNarrative(analysis?: string | null, isFallback?: boolean): boolean {
  if (isFallback === true) return true;
  if (!analysis || typeof analysis !== "string") return false;
  return (
    analysis.includes("Gemini API Key Not Configured") ||
    analysis.includes("AI Explanation Service Offline") ||
    analysis.includes("AI Service Offline") ||
    analysis.includes("Fallback Report Loaded") ||
    analysis.includes("Key Config Required") ||
    analysis.includes("Narrative Generation Failed")
  );
}

export function purgeFallbackNarratives(): void {
  const keysToPurge: string[] = [];
  for (const [key, entry] of memoryVariantCache.entries()) {
    if (isFallbackNarrative(entry.analysisResult?.analysis, entry.analysisResult?.isFallback)) {
      keysToPurge.push(key);
    }
  }
  for (const key of keysToPurge) {
    memoryVariantCache.delete(key);
  }

  // Also purge unhydrated fallback entries directly from sessionStorage
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      const storageKeysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) {
          const raw = sessionStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (isFallbackNarrative(parsed?.analysisResult?.analysis, parsed?.analysisResult?.isFallback)) {
              storageKeysToRemove.push(k);
            }
          }
        }
      }
      storageKeysToRemove.forEach(k => sessionStorage.removeItem(k));
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


import { useState, useCallback, useEffect, useRef } from "react";
import { StructuralMetrics } from "../types";
import { getErrorMessage } from "../variantAnalysisUtils";
import {
  JAPANFOLD_ESMFOLD2_MAX_AA,
  deNovoFoldingLimitExceededMessage,
} from "../shared/foldingLimits";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";

type DeNovoEngines = { wildType: string | null; variant: string | null } | null;

interface EsmFoldCacheEntry {
  wtPdb: string;
  mutPdb: string;
  alignedPdb: string;
  metrics: StructuralMetrics | null;
  engines: DeNovoEngines;
}

const MAX_ESMFOLD_CACHE_ENTRIES = 12;
const esmFoldGlobalCache = new Map<string, EsmFoldCacheEntry>();

function readEsmFoldCache(key: string): EsmFoldCacheEntry | undefined {
  const hit = esmFoldGlobalCache.get(key);
  if (!hit) return undefined;
  // Refresh LRU recency.
  esmFoldGlobalCache.delete(key);
  esmFoldGlobalCache.set(key, hit);
  return hit;
}

function writeEsmFoldCache(key: string, entry: EsmFoldCacheEntry): void {
  if (esmFoldGlobalCache.has(key)) {
    esmFoldGlobalCache.delete(key);
  } else if (esmFoldGlobalCache.size >= MAX_ESMFOLD_CACHE_ENTRIES) {
    const oldest = esmFoldGlobalCache.keys().next().value;
    if (oldest !== undefined) esmFoldGlobalCache.delete(oldest);
  }
  esmFoldGlobalCache.set(key, entry);
}

export interface UseStructuralFoldingOptions {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  addNotification: (type: "success" | "info" | "error" | "warn", message: string) => void;
  uniprotId?: string;
  analysisState?: any;
}

export interface StructuralFoldingSink {
  setEsmFoldWtPdb?: (pdb: string | null) => void;
  setEsmFoldMutPdb?: (pdb: string | null) => void;
  setEsmFoldAlignedPdb?: (pdb: string | null) => void;
  setEsmFoldMetrics?: (metrics: StructuralMetrics | null) => void;
  setFoldxMetrics?: (metrics: StructuralMetrics | null) => void;
  setIsEsmFolding?: (loading: boolean) => void;
  setEsmFoldingError?: (error: string | null) => void;
  setActive3dModelTab?: (tab: "alphafold2" | "esm3") => void;
  resetEsmFoldState?: () => void;
  /** Which engine folded each structure; null when the server did not say. */
  setEsmFoldEngines?: (engines: DeNovoEngines) => void;
  /** The server returned ONE structure, so there is no variant model. */
  setEsmFoldSingleStructure?: (single: boolean) => void;
}

export function useStructuralFolding(sink?: StructuralFoldingSink) {
  const [esmFoldWtPdb, setEsmFoldWtPdb] = useState<string | null>(null);
  const [esmFoldMutPdb, setEsmFoldMutPdb] = useState<string | null>(null);
  const [esmFoldAlignedPdb, setEsmFoldAlignedPdb] = useState<string | null>(null);
  const [esmFoldMetrics, setEsmFoldMetrics] = useState<StructuralMetrics | null>(null);
  const [foldxMetrics, setFoldxMetrics] = useState<StructuralMetrics | null>(null);
  const [isEsmFolding, setIsEsmFolding] = useState<boolean>(false);
  const [esmFoldingError, setEsmFoldingError] = useState<string | null>(null);
  const [active3dModelTab, setActive3dModelTab] = useState<"alphafold2" | "esmfold2" | "esm3">("alphafold2");
  const activeControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1;
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
    };
  }, []);

  const resetEsmFoldState = useCallback(() => {
    requestSeqRef.current += 1;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    setEsmFoldWtPdb(null);
    setEsmFoldMutPdb(null);
    setEsmFoldAlignedPdb(null);
    setEsmFoldMetrics(null);
    setFoldxMetrics(null);
    setIsEsmFolding(false);
    setEsmFoldingError(null);
    if (sink?.resetEsmFoldState) {
      sink.resetEsmFoldState();
    } else {
      sink?.setEsmFoldWtPdb?.(null);
      sink?.setEsmFoldMutPdb?.(null);
      sink?.setEsmFoldAlignedPdb?.(null);
      sink?.setEsmFoldMetrics?.(null);
      sink?.setFoldxMetrics?.(null);
      sink?.setIsEsmFolding?.(false);
      sink?.setEsmFoldingError?.(null);
    }
  }, [sink]);

  const fetchEsmFold = useCallback(async (
    apiClient: any,
    addNotification: (type: "success" | "info" | "error" | "warn", message: string) => void,
    uniprotIdArg?: string,
    variantArg?: string,
    wtSeq?: string,
    mutSeq?: string
  ) => {
    if (!uniprotIdArg || !variantArg) {
      addNotification("warn", "ESMFold requires a valid UniProt ID and mutant variant.");
      return;
    }

    const alignmentScope = useVariantAnalysisStore.getState().esmAlignmentScope ?? "local";
    const cacheKey = `${uniprotIdArg}_${variantArg}_${alignmentScope}`;

    const cached = readEsmFoldCache(cacheKey);
    if (cached) {
      requestSeqRef.current += 1;
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
      setEsmFoldWtPdb(cached.wtPdb);
      setEsmFoldMutPdb(cached.mutPdb);
      setEsmFoldAlignedPdb(cached.alignedPdb);
      setEsmFoldMetrics(cached.metrics);
      setIsEsmFolding(false);
      setEsmFoldingError(null);
      sink?.setEsmFoldEngines?.(cached.engines);
      sink?.setEsmFoldSingleStructure?.(false);
      sink?.setEsmFoldWtPdb?.(cached.wtPdb);
      sink?.setEsmFoldMutPdb?.(cached.mutPdb);
      sink?.setEsmFoldAlignedPdb?.(cached.alignedPdb);
      sink?.setEsmFoldMetrics?.(cached.metrics);
      sink?.setIsEsmFolding?.(false);
      sink?.setEsmFoldingError?.(null);
      return;
    }

    const seqLen = wtSeq?.length || 0;
    const hasToken = Boolean(apiClient?.settings?.biohubApiToken);
    if (seqLen > JAPANFOLD_ESMFOLD2_MAX_AA && !hasToken) {
      const cleanMessage = deNovoFoldingLimitExceededMessage(seqLen);
      console.warn("[ESMFold] De novo folding limit notice:", cleanMessage);
      setEsmFoldingError(cleanMessage);
      sink?.setEsmFoldingError?.(cleanMessage);
      setIsEsmFolding(false);
      sink?.setIsEsmFolding?.(false);
      return;
    }

    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const requestSeq = ++requestSeqRef.current;
    const isStale = () => controller.signal.aborted || requestSeqRef.current !== requestSeq;

    setIsEsmFolding(true);
    setEsmFoldingError(null);
    sink?.setIsEsmFolding?.(true);
    sink?.setEsmFoldingError?.(null);

    try {
      const foldData = await apiClient.foldSequence({
        uniprotId: uniprotIdArg,
        variant: variantArg,
        wtSeq,
        mutSeq
      }, controller.signal);
      if (isStale()) return;

      const engines: DeNovoEngines = foldData.engines
        ? { wildType: foldData.engines.wildType ?? null, variant: foldData.engines.variant ?? null }
        : null;
      sink?.setEsmFoldEngines?.(engines);

      if (!foldData.wtPdb || !foldData.mutPdb) {
        if (foldData.pdb) {
          /**
           * ONE structure: the wild type only. It used to be copied into the variant and aligned
           * slots too, which enabled "Mutant" and "Superposition" over two identical copies and
           * reported a zero change the substitution never had a chance to make.
           */
          setEsmFoldWtPdb(foldData.pdb);
          setEsmFoldMutPdb(null);
          setEsmFoldAlignedPdb(null);
          setEsmFoldMetrics(null);
          sink?.setEsmFoldSingleStructure?.(true);
          sink?.setEsmFoldWtPdb?.(foldData.pdb);
          sink?.setEsmFoldMutPdb?.(null);
          sink?.setEsmFoldAlignedPdb?.(null);
          sink?.setEsmFoldMetrics?.(null);
          return;
        }
        throw new Error("ESMFold endpoint did not return valid WT and mutant PDB structures.");
      }

      sink?.setEsmFoldSingleStructure?.(false);
      setEsmFoldWtPdb(foldData.wtPdb);
      setEsmFoldMutPdb(foldData.mutPdb);

      const posMatch = variantArg.match(/\d+/);
      const position = posMatch ? parseInt(posMatch[0], 10) : 1;

      const alignData = await apiClient.structuralAlign({
        pdb1: foldData.wtPdb,
        pdb2: foldData.mutPdb,
        targetIndex: position,
        // The scope the toolbar shows, so the first superposition matches the toggle's state.
        alignmentScope
      }, controller.signal);
      if (isStale()) return;

      if (alignData.alignedPdb) {
        setEsmFoldAlignedPdb(alignData.alignedPdb);
        setEsmFoldMetrics(alignData.metrics);
        sink?.setEsmFoldWtPdb?.(foldData.wtPdb);
        sink?.setEsmFoldMutPdb?.(foldData.mutPdb);
        sink?.setEsmFoldAlignedPdb?.(alignData.alignedPdb);
        sink?.setEsmFoldMetrics?.(alignData.metrics);
        writeEsmFoldCache(cacheKey, {
          wtPdb: foldData.wtPdb,
          mutPdb: foldData.mutPdb,
          alignedPdb: alignData.alignedPdb,
          metrics: alignData.metrics,
          engines
        });
      } else {
        throw new Error("Alignment service did not return aligned structure.");
      }
    } catch (err: any) {
      if (isStale() || err?.name === "AbortError") return;
      const rawMessage = err?.message || "Failed to fold/align protein sequence.";
      const cleanMessage = rawMessage.replace(/^Failed to run ESMFold:\s*/i, "").trim() || rawMessage;
      console.warn("[ESMFold] De novo folding unavailable:", cleanMessage);
      setEsmFoldingError(cleanMessage);
      sink?.setEsmFoldingError?.(cleanMessage);
      // Suppress popup toast notification: status is displayed directly as an in-viewer message
    } finally {
      if (requestSeqRef.current === requestSeq) {
        setIsEsmFolding(false);
        sink?.setIsEsmFolding?.(false);
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
      }
    }
  }, [sink]);

  return {
    esmFoldWtPdb, setEsmFoldWtPdb,
    esmFoldMutPdb, setEsmFoldMutPdb,
    esmFoldAlignedPdb, setEsmFoldAlignedPdb,
    esmFoldMetrics, setEsmFoldMetrics,
    foldxMetrics, setFoldxMetrics,
    isEsmFolding, setIsEsmFolding,
    esmFoldingError, setEsmFoldingError,
    active3dModelTab, setActive3dModelTab,
    resetEsmFoldState,
    fetchEsmFold
  };
}

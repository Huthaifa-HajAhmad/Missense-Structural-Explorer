import { useState, useCallback, useEffect } from "react";
import { StructuralDiffResult, PocketResult } from "../types";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { getCachedVariant, setCachedVariant } from "../services/pipeline/variantCache";

export function useBiophysicalModeling(apiClient: any) {
  const [mutantPdb, setMutantPdb] = useState<string | null>(null);
  const [foldedResidueIndex, setFoldedResidueIndex] = useState<number | null>(null);
  const [isFolding, setIsFolding] = useState(false);
  const [foldingError, setFoldingError] = useState<string | null>(null);

  // Synchronize biophysical energetics and sidecar states directly with global Zustand store
  const foldingEnergetics = useVariantAnalysisStore(s => s.foldingEnergetics);

  const thermompnnStatus = useVariantAnalysisStore(s => s.thermompnnStatus) as ("pending" | "unavailable" | "done" | "error" | "busy" | null);
  const thermompnnError = useVariantAnalysisStore(s => s.thermompnnError);

  const setFoldingEnergetics = useCallback((val: any) => useVariantAnalysisStore.getState().setFoldingEnergetics(val), []);

  const setThermompnnStatus = useCallback((val: any) => useVariantAnalysisStore.getState().setThermompnnStatus(val), []);
  const setThermompnnError = useCallback((val: any) => useVariantAnalysisStore.getState().setThermompnnError(val), []);

  const [structuralDiff, setStructuralDiff] = useState<StructuralDiffResult | null>(null);

  const [computedPocket, setComputedPocket] = useState<PocketResult | null>(null);
  const [isPocketLoading, setIsPocketLoading] = useState(false);
  const [pocketError, setPocketError] = useState<string | null>(null);

  useEffect(() => {
    const result = useVariantAnalysisStore.getState().analysisState.result;
    const metadata = result?.metadata;
    if (!metadata?.gene || !metadata.variant || !metadata.uniprotId || !metadata.pipelineRunId) return;
    const cached = getCachedVariant(metadata.gene, metadata.variant);
    if (!cached || cached.uniprotId !== metadata.uniprotId) return;
    // An interrupted predictor bundle deliberately omits `analysisResult` so the core is re-run;
    // biophysics statuses must still be persisted while that happens, or a run completed during
    // the refresh is lost and recomputed on the next reload.
    if (cached.analysisResult && cached.analysisResult.metadata?.pipelineRunId !== metadata.pipelineRunId) return;
    setCachedVariant(metadata.gene, metadata.variant, metadata.uniprotId, {
      foldingEnergetics, thermompnnStatus, thermompnnError
    });
  }, [foldingEnergetics, thermompnnStatus, thermompnnError]);

  const fetchPocketInfo = useCallback(async (pdbText: string, activeChain: string, activeResSeq: number, uniprotId?: string, signal?: AbortSignal) => {
    setIsPocketLoading(true);
    setPocketError(null);
    useVariantAnalysisStore.getState().setIsPocketLoading(true);
    useVariantAnalysisStore.getState().setPocketError(null);
    try {
      const pocketData = await apiClient.detectPocket({
        pdbText: pdbText || undefined,
        uniprotId: uniprotId || undefined,
        pdbRef: uniprotId || undefined,
        targetIndex: activeResSeq,
        targetChain: activeChain
      }, signal);
      setComputedPocket(pocketData);
      useVariantAnalysisStore.getState().setComputedPocket(pocketData);
    } catch (err: any) {
      if (signal?.aborted) return;
      console.error("[Pocket Detection Error]:", err);
      const msg = err.message || String(err);
      setPocketError(msg);
      useVariantAnalysisStore.getState().setPocketError(msg);
    } finally {
      if (!signal?.aborted) {
        setIsPocketLoading(false);
        useVariantAnalysisStore.getState().setIsPocketLoading(false);
      }
    }
  }, [apiClient]);

  /*
   * The primary variant's diff/superposition effect lived here and never ran: it watched this hook's
   * LOCAL `foldingStatus`/`mutantPdb` (the pipeline writes the store's) and a `pdbText` argument no
   * caller passes. Its only live branch was the "else", which cleared the store's `foldxMetrics` and
   * `structuralDiff` (and a compare-variant model nothing produced) whenever `apiClient` changed identity. With it dead, the
   * 3D superposition fell back to the RAW FoldX variant. The job now belongs to `useFoldxSuperposition`,
   * which pairs the variant with the template FoldX actually used.
   */

  return {
    mutantPdb,
    setMutantPdb,
    foldedResidueIndex,
    setFoldedResidueIndex,
    isFolding,
    setIsFolding,
    foldingError,
    setFoldingError,
    foldingEnergetics,
    setFoldingEnergetics,
    thermompnnStatus,
    setThermompnnStatus,
    thermompnnError,
    setThermompnnError,
    structuralDiff,
    setStructuralDiff,
    computedPocket,
    setComputedPocket,
    isPocketLoading,
    setIsPocketLoading,
    pocketError,
    setPocketError,
    fetchPocketInfo
  };
}

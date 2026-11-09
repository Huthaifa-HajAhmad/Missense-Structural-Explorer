import { useEffect, useRef } from "react";
import { MasterView } from "../components/MasterSidebar";
import { AMINO_ACID_3_TO_1 } from "../aminoAcids";
import { getBiophysicsAttemptedAt, getCachedVariant } from "../services/pipeline/variantCache";
import { createAnalysisCacheContext, narrativeModeOf } from "../services/pipeline/analysisContext";
import { reloadMayPaint, restoreStoredArtifacts } from "../services/pipeline/storedAnalysis";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";

interface UseAppEffectsParams {
  state?: any;
  actions?: any;
  masterView: MasterView;
  setMasterView: (view: MasterView) => void;
  setActiveEvidenceTab: (tab: string) => void;
  setIsOffline: (offline: boolean) => void;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  consoleDispatch: (action: any) => void;
  executeAnalysis?: (g: string, v: string, u?: string, signal?: AbortSignal) => void;
  settings?: any;
  fetchEsmFold?: (uniprotIdArg?: string, variantArg?: string, wtSeq?: string, mutSeq?: string) => void;
}

export function useAppEffects({
  state,
  actions,
  masterView,
  setMasterView,
  setActiveEvidenceTab,
  setIsOffline,
  fetchWithAuth,
  consoleDispatch,
  executeAnalysis: propsExecuteAnalysis,
  settings,
  fetchEsmFold: propsFetchEsmFold
}: UseAppEffectsParams) {
  // Fine-grained Zustand store subscriptions
  const storeGene = useVariantAnalysisStore(s => s.gene);
  const storeVariant = useVariantAnalysisStore(s => s.variant);
  const storeUniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const storeEsmFoldWtPdb = useVariantAnalysisStore(s => s.esmFoldWtPdb);
  const storeIsEsmFolding = useVariantAnalysisStore(s => s.isEsmFolding);
  const storeEsmFoldingError = useVariantAnalysisStore(s => s.esmFoldingError);
  const storeAnalysisState = useVariantAnalysisStore(s => s.analysisState);
  const storeCustomPdbUrl = useVariantAnalysisStore(s => s.customPdbUrl);

  const gene = state?.gene ?? storeGene;
  const variant = state?.variant ?? storeVariant;
  const uniprotId = state?.uniprotId ?? storeUniprotId;
  const esmFoldWtPdb = state?.esmFoldWtPdb ?? storeEsmFoldWtPdb;
  const isEsmFolding = state?.isEsmFolding ?? storeIsEsmFolding;
  const esmFoldingError = state?.esmFoldingError ?? storeEsmFoldingError;
  const analysisState = state?.analysisState ?? storeAnalysisState;
  const customPdbUrl = state?.customPdbUrl ?? storeCustomPdbUrl;

  const fetchEsmFold = propsFetchEsmFold || actions?.fetchEsmFold;
  const executeAnalysis = propsExecuteAnalysis || actions?.executeAnalysis;

  // Stable refs for actions and callbacks called inside effects to prevent dependency cycles
  const fetchWithAuthRef = useRef(fetchWithAuth);
  const fetchEsmFoldRef = useRef(fetchEsmFold);
  const executeAnalysisRef = useRef(executeAnalysis);

  useEffect(() => {
    fetchWithAuthRef.current = fetchWithAuth;
    fetchEsmFoldRef.current = fetchEsmFold;
    executeAnalysisRef.current = executeAnalysis;
  }, [fetchWithAuth, fetchEsmFold, executeAnalysis]);

  const lastFoldedKeyRef = useRef<string>("");
  const hasInitializedFromUrlRef = useRef(false);

  // Auto-restore or auto-trigger analysis when landing with URL parameters (F5)
  useEffect(() => {
    if (hasInitializedFromUrlRef.current) return;
    hasInitializedFromUrlRef.current = true;

    if (gene && variant && !analysisState.result && !analysisState.isLoading) {
      const cached = getCachedVariant(gene, variant);
      const context = createAnalysisCacheContext(uniprotId || "", settings ?? {});
      const attemptedAt = getBiophysicsAttemptedAt(gene, variant, context.simulationConditions);
      const store = useVariantAnalysisStore.getState();
      /**
       * Painting without a run is safe only when a run would have nothing to do. Anything else (a changed
       * setting, a failed stage, FoldX still owed) goes through the run, which paints the same saved
       * result and repairs only what is missing.
       */
      if (cached && reloadMayPaint(cached, context, attemptedAt, narrativeModeOf(settings))) {
        store.setAnalysisState({ result: cached.analysisResult, isLoading: false, error: null });
        restoreStoredArtifacts(cached, store, store);
        return;
      }

      // The URL holds the resolved notation. Replaying the submission keeps a coordinate on its own build.
      const prior = store.history.find(h => h.gene === gene && (h.variant === variant || h.query === variant));
      executeAnalysisRef.current?.(gene, prior?.query ?? variant, uniprotId);
    }
  }, [gene, variant, uniprotId, analysisState.result, analysisState.isLoading]);

  // Synchronize active 3D model tab
  useEffect(() => {
    useVariantAnalysisStore.getState().setActive3dModelTab(masterView === "structure_esmfold" ? "esm3" : "alphafold2");
  }, [masterView]);

  // Trigger ESMFold folding when masterView is "structure_esmfold"
  useEffect(() => {
    if (masterView === "structure_esmfold") {
      const metadata = analysisState.result?.metadata;
      if (!metadata) return;

      const pos = metadata.residueIndex;
      const mutRes = metadata.mutant;
      const activeUniprot = uniprotId || metadata.uniprotId;
      const foldKey = `${activeUniprot}_${pos}_${mutRes}`;

      // Prevent redundant fetches / folding routines if we already fold this variant
      if (lastFoldedKeyRef.current === foldKey) return;

      if (customPdbUrl !== null) {
        useVariantAnalysisStore.getState().setCustomPdbUrl(null);
      }

      if (esmFoldWtPdb || isEsmFolding || esmFoldingError) {
        return;
      }

      const runFolding = async () => {
        lastFoldedKeyRef.current = foldKey;
        let mutSeq = metadata.mutatedSequence;
        let wtSeq = metadata.sequence || "";

        if (!wtSeq && activeUniprot) {
          try {
            const res = await fetchWithAuthRef.current(`/api/v1/sequence/${activeUniprot}`);
            if (res.ok) {
              const data = await res.json();
              wtSeq = data.sequence;
            }
          } catch (err) {
            console.error("[ESMFold] Failed to resolve mutated sequence:", err);
          }
        }

        if (wtSeq && pos && mutRes && !mutSeq) {
          const mutUpper = mutRes.toUpperCase();
          const mut1 = AMINO_ACID_3_TO_1[mutRes] || AMINO_ACID_3_TO_1[mutUpper] || (mutRes.length === 1 ? mutUpper : "A");
          mutSeq = wtSeq.substring(0, pos - 1) + mut1 + wtSeq.substring(pos);
        }

        if (wtSeq && mutSeq && pos && !esmFoldWtPdb && !isEsmFolding && !esmFoldingError) {
          const variantString = metadata.variant || variant || `p.${metadata.wildType}${pos}${metadata.mutant}`;
          if (fetchEsmFoldRef.current) {
            fetchEsmFoldRef.current(activeUniprot, variantString, wtSeq, mutSeq);
          }
        }
      };

      runFolding();
    }
  }, [
    masterView,
    analysisState.result?.metadata,
    esmFoldWtPdb,
    isEsmFolding,
    esmFoldingError,
    uniprotId,
    customPdbUrl,
    variant
  ]);

  // Monitor network status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setIsOffline]);

  // Mark console messages as read when viewing Developer Console
  useEffect(() => {
    if (masterView === "console") {
      consoleDispatch({ type: "MARK_READ", stream: "error" });
    }
  }, [masterView, consoleDispatch]);
}

import { useEffect, useRef } from "react";
import { MasterView } from "../components/MasterSidebar";
import { AMINO_ACID_3_TO_1 } from "../aminoAcids";
import { getBiophysicsAttemptedAt, getCachedVariant } from "../services/pipeline/variantCache";
import { createAnalysisCacheContext, narrativeModeOf } from "../services/pipeline/analysisContext";
import { reloadMayPaint, restoreStoredArtifacts } from "../services/pipeline/storedAnalysis";
import { readUrlAlleleNotation } from "../shared/shareLink";
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
  settings
}: UseAppEffectsParams) {
  // Fine-grained Zustand store subscriptions
  const storeGene = useVariantAnalysisStore(s => s.gene);
  const storeVariant = useVariantAnalysisStore(s => s.variant);
  const storeUniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const storeAnalysisState = useVariantAnalysisStore(s => s.analysisState);

  const gene = state?.gene ?? storeGene;
  const variant = state?.variant ?? storeVariant;
  const uniprotId = state?.uniprotId ?? storeUniprotId;
  const analysisState = state?.analysisState ?? storeAnalysisState;

  const executeAnalysis = propsExecuteAnalysis || actions?.executeAnalysis;

  // Stable refs for actions and callbacks called inside effects to prevent dependency cycles
  const fetchWithAuthRef = useRef(fetchWithAuth);
  const executeAnalysisRef = useRef(executeAnalysis);

  useEffect(() => {
    fetchWithAuthRef.current = fetchWithAuth;
    executeAnalysisRef.current = executeAnalysis;
  }, [fetchWithAuth, executeAnalysis]);

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
      const urlAllele = readUrlAlleleNotation(typeof window !== "undefined" ? window.location.search : "");
      const cachedMatchesUrlAllele = !urlAllele.allele ||
        cached?.analysisResult?.predictorData?.gnomadVariantId === urlAllele.allele ||
        cached?.analysisResult?.liftedGenomicCoordinates === urlAllele.allele ||
        cached?.analysisResult?.coordinateLift?.submittedCoordinates === urlAllele.allele;
      if (cached && cachedMatchesUrlAllele && reloadMayPaint(cached, context, attemptedAt, narrativeModeOf(settings))) {
        store.setAnalysisState({ result: cached.analysisResult, isLoading: false, error: null });
        restoreStoredArtifacts(cached, store, store);
        return;
      }

      // The URL holds the resolved notation (and exact allele when resolved). Replaying the allele or submission keeps a coordinate on its own build.
      const prior = store.history.find(h => h.gene === gene && (h.variant === variant || h.query === variant));
      executeAnalysisRef.current?.(gene, urlAllele.notation ?? prior?.query ?? variant, uniprotId);
    }
  }, [gene, variant, uniprotId, analysisState.result, analysisState.isLoading]);



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

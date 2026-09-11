import { useEffect, useRef } from "react";
import { MasterView } from "../components/MasterSidebar";
import { AMINO_ACID_3_TO_1 } from "../aminoAcids";
import { getCachedVariant } from "../services/pipeline/variantCache";
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
      if (cached?.analysisResult) {
        const store = useVariantAnalysisStore.getState();
        store.setAnalysisState({
          result: cached.analysisResult,
          isLoading: false,
          error: null
        });
        if (cached.pdbText) {
          store.setPdbText(cached.pdbText);
        }
        if (cached.mutantPdb) {
          store.setMutantPdb(cached.mutantPdb);
        }
        if (cached.foldingDdG != null) {
          store.setFoldingDdG(cached.foldingDdG);
        }
        if (cached.foldingEnergetics) {
          store.setFoldingEnergetics(cached.foldingEnergetics);
        }
        if (cached.computedPocket) {
          store.setComputedPocket(cached.computedPocket);
        }
        return;
      }

      // Otherwise trigger analysis automatically without forcing tab switch
      if (executeAnalysisRef.current) {
        executeAnalysisRef.current(gene, variant, uniprotId);
      }
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
            console.error("Failed to resolve mutated sequence for ESMFold:", err);
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

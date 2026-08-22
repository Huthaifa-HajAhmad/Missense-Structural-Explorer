import { useEffect, useRef } from "react";
import { MasterView } from "../components/MasterSidebar";
import { AMINO_ACID_3_TO_1 } from "../aminoAcids";
import { getCachedVariant } from "../services/pipeline/variantCache";

interface UseAppEffectsParams {
  state: any;
  actions: any;
  masterView: MasterView;
  setMasterView: (view: MasterView) => void;
  setActiveEvidenceTab: (tab: string) => void;
  setIsOffline: (offline: boolean) => void;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  consoleDispatch: (action: any) => void;
}

export function useAppEffects({
  state,
  actions,
  masterView,
  setMasterView,
  setActiveEvidenceTab,
  setIsOffline,
  fetchWithAuth,
  consoleDispatch
}: UseAppEffectsParams) {
  const {
    uniprotId,
    variant,
    esmFoldWtPdb,
    isEsmFolding,
    esmFoldingError
  } = state;

  const {
    fetchEsmFold,
    setActive3dModelTab,
    setCustomPdbUrl
  } = actions;

  // Stable refs for actions and callbacks called inside effects to prevent dependency cycles
  const fetchWithAuthRef = useRef(fetchWithAuth);
  const fetchEsmFoldRef = useRef(fetchEsmFold);
  const setCustomPdbUrlRef = useRef(setCustomPdbUrl);

  useEffect(() => {
    fetchWithAuthRef.current = fetchWithAuth;
    fetchEsmFoldRef.current = fetchEsmFold;
    setCustomPdbUrlRef.current = setCustomPdbUrl;
  }, [fetchWithAuth, fetchEsmFold, setCustomPdbUrl]);

  const lastFoldedKeyRef = useRef<string>("");
  const hasInitializedFromUrlRef = useRef(false);

  // Auto-restore or auto-trigger analysis when landing with URL parameters (F5)
  useEffect(() => {
    if (hasInitializedFromUrlRef.current) return;
    hasInitializedFromUrlRef.current = true;

    if (state.gene && state.variant && !state.analysisState.result && !state.analysisState.isLoading) {
      const cached = getCachedVariant(state.gene, state.variant);
      if (cached?.analysisResult) {
        actions.setAnalysisState({
          result: cached.analysisResult,
          isLoading: false,
          error: null
        });
        if (cached.pdbText && actions.setPdbText) {
          actions.setPdbText(cached.pdbText);
        }
        if (cached.mutantPdb && actions.setMutantPdb) {
          actions.setMutantPdb(cached.mutantPdb);
        }
        if (cached.foldingDdG != null && actions.setFoldingDdG) {
          actions.setFoldingDdG(cached.foldingDdG);
        }
        if (cached.foldingEnergetics && actions.setFoldingEnergetics) {
          actions.setFoldingEnergetics(cached.foldingEnergetics);
        }
        if (cached.computedPocket && actions.setComputedPocket) {
          actions.setComputedPocket(cached.computedPocket);
        }
        return;
      }

      // Otherwise trigger analysis automatically without forcing tab switch
      actions.executeAnalysis(state.gene, state.variant, state.uniprotId);
    }
  }, [state.gene, state.variant, state.uniprotId, state.analysisState.result, state.analysisState.isLoading, actions]);

  // Synchronize active 3D model tab
  useEffect(() => {
    setActive3dModelTab(masterView === "structure_esmfold" ? "esm3" : "alphafold2");
  }, [masterView, setActive3dModelTab]);

  // Trigger ESMFold folding when masterView is "structure_esmfold"
  useEffect(() => {
    if (masterView === "structure_esmfold") {
      const metadata = state.analysisState.result?.metadata;
      if (!metadata) return;

      const pos = metadata.residueIndex;
      const mutRes = metadata.mutant;
      const activeUniprot = uniprotId || metadata.uniprotId;
      const foldKey = `${activeUniprot}_${pos}_${mutRes}`;

      // Prevent redundant fetches / folding routines if we already fold this variant
      if (lastFoldedKeyRef.current === foldKey) return;

      if (state.customPdbUrl !== null) {
        setCustomPdbUrlRef.current(null);
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
          fetchEsmFoldRef.current(activeUniprot, variantString, wtSeq, mutSeq);
        }
      };

      runFolding();
    }
  }, [
    masterView,
    state.analysisState.result?.metadata,
    esmFoldWtPdb,
    isEsmFolding,
    esmFoldingError,
    uniprotId,
    state.customPdbUrl
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

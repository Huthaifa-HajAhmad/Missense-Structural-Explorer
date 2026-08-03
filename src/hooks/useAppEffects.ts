import { useEffect, useRef } from "react";
import { MasterView } from "../components/MasterSidebar";

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
    esmFoldPdb,
    isEsmFolding,
    esmFoldingError
  } = state;

  const {
    fetchEsmFold,
    setActive3dModelTab,
    setCustomPdbUrl
  } = actions;

  // Auto-navigate to Evidence view when analysis completes
  const prevIsLoadingRef = useRef(state.analysisState.isLoading);
  useEffect(() => {
    if (prevIsLoadingRef.current && !state.analysisState.isLoading && state.analysisState.result) {
      if (masterView === "search") {
        setMasterView("evidence");
        setActiveEvidenceTab("clinical");
      }
    }
    prevIsLoadingRef.current = state.analysisState.isLoading;
  }, [state.analysisState.isLoading, state.analysisState.result, masterView, setMasterView, setActiveEvidenceTab]);

  // Synchronize active 3D model tab
  useEffect(() => {
    setActive3dModelTab(masterView === "structure_esmfold" ? "esm3" : "alphafold2");
  }, [masterView, setActive3dModelTab]);

  // Trigger ESMFold folding when masterView is "structure_esmfold"
  useEffect(() => {
    if (masterView === "structure_esmfold") {
      if (state.customPdbUrl !== null) {
        setCustomPdbUrl(null);
      }
      const metadata = state.analysisState.result?.metadata;
      if (!metadata) return;

      const runFolding = async () => {
        let mutSeq = metadata.mutatedSequence;
        let wtSeq = "";
        const pos = metadata.residueIndex;
        const mutRes = metadata.mutant;
        const activeUniprot = uniprotId || metadata.uniprotId;

        if (activeUniprot) {
          try {
            const res = await fetchWithAuth(`/api/v1/sequence/${activeUniprot}`);
            if (res.ok) {
              const data = await res.json();
              wtSeq = data.sequence;
              if (wtSeq && pos && mutRes && !mutSeq) {
                const mut1 = mutRes.length === 3 ? (mutRes === "Ala" ? "A" : mutRes === "Arg" ? "R" : mutRes) : mutRes;
                mutSeq = wtSeq.substring(0, pos - 1) + mut1 + wtSeq.substring(pos);
              }
            }
          } catch (err) {
            console.error("Failed to resolve mutated sequence for ESMFold:", err);
          }
        }
        if (wtSeq && mutSeq && pos && !esmFoldPdb && !isEsmFolding && !esmFoldingError) {
          fetchEsmFold(wtSeq, mutSeq, pos, "A");
        }
      };

      runFolding();
    }
  }, [
    masterView,
    state.analysisState.result?.metadata,
    esmFoldPdb,
    isEsmFolding,
    esmFoldingError,
    fetchEsmFold,
    uniprotId,
    setCustomPdbUrl,
    fetchWithAuth,
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

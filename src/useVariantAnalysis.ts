import { useCallback, useMemo } from "react";
export * from "./variantAnalysisUtils";
import { VariantPreset } from "./types";
import { useSettings } from "./context/SettingsContext";
import { useApiClient } from "./apiClient";
import { useBiophysicalModeling } from "./hooks/useBiophysicalModeling";
import { useStructuralFolding } from "./hooks/useStructuralFolding";
import { useAnalysisPipeline } from "./hooks/useAnalysisPipeline";
import { getVariantStyles } from "./shared/variantStyles";
import { useVariantAnalysisStore } from "./stores/useVariantAnalysisStore";
import { fetchProgressiveStructuralAssessments } from "./services/pipeline/biophysicalService";

/**
 * useVariantAnalysis — Backward-compatible adapter facade.
 * Slices are canonically managed by Zustand (src/stores/useVariantAnalysisStore.ts).
 * This facade avoids full-store subscription to prevent cascading re-renders.
 */
export default function useVariantAnalysis() {
  const {
    theme,
    isDark,
    setTheme,
    toggleTheme,
    settings,
    setSettings,
    updateSetting,
    resetSettingsToDefault,
    showPolarContacts,
    setShowPolarContacts,
    isSettingsOpen,
    setIsSettingsOpen
  } = useSettings();

  const { fetchWithAuth, apiClient } = useApiClient();
  // Subscribe strictly to pdbText for biophysical modeling instead of entire store
  const pdbText = useVariantAnalysisStore(s => s.pdbText);

  // Subsystem execution hooks
  const biophysical = useBiophysicalModeling(
    settings,
    useVariantAnalysisStore.getState().addNotification,
    apiClient,
    fetchWithAuth,
    pdbText
  );
  const structuralFolding = useStructuralFolding({
    setEsmFoldWtPdb: useVariantAnalysisStore.getState().setEsmFoldWtPdb,
    setEsmFoldMutPdb: useVariantAnalysisStore.getState().setEsmFoldMutPdb,
    setEsmFoldAlignedPdb: useVariantAnalysisStore.getState().setEsmFoldAlignedPdb,
    setEsmFoldMetrics: useVariantAnalysisStore.getState().setEsmFoldMetrics,
    setFoldxMetrics: useVariantAnalysisStore.getState().setFoldxMetrics,
    setIsEsmFolding: useVariantAnalysisStore.getState().setIsEsmFolding,
    setEsmFoldingError: useVariantAnalysisStore.getState().setEsmFoldingError,
    setActive3dModelTab: useVariantAnalysisStore.getState().setActive3dModelTab,
    resetEsmFoldState: useVariantAnalysisStore.getState().resetEsmFoldState
  });
  const pipeline = useAnalysisPipeline();

  const variantStyles = getVariantStyles(isDark);

  const resetViewerState = useCallback(() => {
    biophysical.clearDynaMutPoll();
    biophysical.clearDynaMutComparePoll();
    biophysical.clearDdmutPoll();
    biophysical.clearDdmutComparePoll();
    biophysical.clearThermoMpnnPoll();
    biophysical.clearThermoMpnnComparePoll();
    structuralFolding.resetEsmFoldState();
    useVariantAnalysisStore.getState().resetViewerState();
  }, [biophysical, structuralFolding]);

  const executeAnalysisWrapper = useCallback(
    (targetGene: string, targetVariant: string, targetUniprot?: string, providedSignal?: AbortSignal) => {
      const currentStore = useVariantAnalysisStore.getState();
      return pipeline.executeAnalysis(targetGene, targetVariant, targetUniprot, providedSignal, {
        fetchWithAuth,
        apiClient,
        settings,
        userDirections: currentStore.userDirections,
        sinks: {
          search: {
            setGene: currentStore.setGene,
            setVariant: currentStore.setVariant,
            setUniprotId: currentStore.setUniprotId,
            setSearchVal: currentStore.setSearchVal,
            setCustomGene: currentStore.setCustomGene,
            setCustomVariant: currentStore.setCustomVariant,
            setCustomUniprot: currentStore.setCustomUniprot,
            setSelectedResidueIndex: currentStore.setSelectedResidueIndex,
            addToHistory: (gene: string, variant: string, uniprotId: string) =>
              currentStore.addToHistory({ gene, variant, uniprotId })
          },
          analysis: {
            setAnalysisState: currentStore.setAnalysisState,
            setLoadingStep: currentStore.setLoadingStep,
            setIsBiophysicalLoading: currentStore.setIsBiophysicalLoading,
            setIsClinicalLoading: currentStore.setIsClinicalLoading,
            setIsNarrativeLoading: currentStore.setIsNarrativeLoading
          },
          biophysical: {
            setIsFolding: currentStore.setIsFolding,
            setFoldingError: currentStore.setFoldingError,
            setFoldingStatus: currentStore.setFoldingStatus,
            setMutantPdb: currentStore.setMutantPdb,
            setFoldedResidueIndex: currentStore.setFoldedResidueIndex,
            setFoldingDdG: currentStore.setFoldingDdG,
            setFoldingEnergetics: currentStore.setFoldingEnergetics,
            setDynamut2JobId: currentStore.setDynamut2JobId,
            setDynamut2Status: currentStore.setDynamut2Status,
            setDdmutJobId: currentStore.setDdmutJobId,
            setDdmutStatus: currentStore.setDdmutStatus,
            setThermompnnJobId: currentStore.setThermompnnJobId,
            setThermompnnStatus: currentStore.setThermompnnStatus,
            setThermompnnError: currentStore.setThermompnnError,
            lastFetchedFoldRef: biophysical.lastFetchedFoldRef
          },
          structure: {
            setPdbText: currentStore.setPdbText,
            setComputedPocket: currentStore.setComputedPocket,
            setIsPocketLoading: currentStore.setIsPocketLoading,
            setPocketError: currentStore.setPocketError,
            setHomologs: currentStore.setHomologs,
            setIsHomologsLoading: currentStore.setIsHomologsLoading,
            setComputedResiduesCache: currentStore.setComputedResiduesCache,
            setDisruptionPredictor: currentStore.setDisruptionPredictor,
            resetViewerState,
            clearDynaMutPoll: biophysical.clearDynaMutPoll,
            clearDynaMutComparePoll: biophysical.clearDynaMutComparePoll
          }
        }
      });
    },
    [pipeline, fetchWithAuth, apiClient, settings, biophysical, resetViewerState]
  );

  const handleSelectHistoryItem = useCallback(
    (item: { gene: string; variant: string; uniprotId: string }) => {
      const currentStore = useVariantAnalysisStore.getState();
      currentStore.handleSelectHistoryItem(item, {
        abortAllPendingRequests: () =>
          pipeline.abortAllPendingRequests(biophysical.clearDynaMutPoll, biophysical.clearDynaMutComparePoll),
        resetViewerState,
        executeAnalysis: (g, v, u, signal) => executeAnalysisWrapper(g, v, u, signal),
        setAnalysisState: currentStore.setAnalysisState
      });
    },
    [pipeline, biophysical, resetViewerState, executeAnalysisWrapper]
  );

  const handleSelectPreset = useCallback(
    (preset: VariantPreset) => {
      const currentStore = useVariantAnalysisStore.getState();
      currentStore.handleSelectPreset(preset, {
        abortAllPendingRequests: () =>
          pipeline.abortAllPendingRequests(biophysical.clearDynaMutPoll, biophysical.clearDynaMutComparePoll),
        resetViewerState,
        executeAnalysis: (g, v, u, signal) => executeAnalysisWrapper(g, v, u, signal),
        setAnalysisState: currentStore.setAnalysisState
      });
    },
    [pipeline, biophysical, resetViewerState, executeAnalysisWrapper]
  );

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      const currentStore = useVariantAnalysisStore.getState();
      currentStore.handleSearchSubmit(e, (g, v, u) => executeAnalysisWrapper(g, v, u));
    },
    [executeAnalysisWrapper]
  );

  const handleCopyReport = useCallback(async () => {
    const currentStore = useVariantAnalysisStore.getState();
    await currentStore.handleCopyReport(currentStore.analysisState.result);
  }, []);

  const translateVariantNotationWrapper = useCallback(
    (notation: string, signal: AbortSignal) => {
      const currentStore = useVariantAnalysisStore.getState();
      return pipeline.translateVariantNotation(notation, signal, {
        apiClient,
        setAnalysisState: currentStore.setAnalysisState,
        setLoadingStep: currentStore.setLoadingStep
      });
    },
    [pipeline, apiClient]
  );

  const fetchHomologsWrapper = useCallback(
    (targetUniprot: string, signal?: AbortSignal, pos?: number) => {
      const currentStore = useVariantAnalysisStore.getState();
      return pipeline.fetchHomologs(targetUniprot, apiClient, signal, pos, {
        setHomologs: currentStore.setHomologs,
        setIsHomologsLoading: currentStore.setIsHomologsLoading
      });
    },
    [pipeline, apiClient]
  );

  const fetchNearestResiduesWrapper = useCallback(
    (targetUniprot: string, targetVariant: string, residueIndex: number, pdbStr: string, signal?: AbortSignal) => {
      const currentStore = useVariantAnalysisStore.getState();
      return pipeline.fetchNearestResidues(targetUniprot, targetVariant, residueIndex, pdbStr, apiClient, signal, {
        setComputedResiduesCache: currentStore.setComputedResiduesCache
      });
    },
    [pipeline, apiClient]
  );

  const fetchEsmFoldWrapper = useCallback(
    (uniprotIdArg?: string, variantArg?: string, wtSeq?: string, mutSeq?: string) => {
      const { uniprotId, variant, addNotification } = useVariantAnalysisStore.getState();
      return structuralFolding.fetchEsmFold(
        apiClient,
        addNotification,
        uniprotIdArg || uniprotId,
        variantArg || variant,
        wtSeq,
        mutSeq
      );
    },
    [structuralFolding, apiClient]
  );

  const formatEnergyString = useCallback(
    (text: string | null | undefined): string => {
      if (!text) return "";
      if (settings.energyUnit === "kcal/mol") return text;
      return text.replace(/([-+]?\d+(?:\.\d+)?)\s*kcal\/mol(?!\s*\[~[^\]]*kJ\/mol\])/gi, (match, valStr) => {
        if (valStr) {
          const kcal = parseFloat(valStr);
          const kj = kcal * 4.184;
          return `${match} [~${kj.toFixed(1)} kJ/mol]`;
        }
        return match;
      });
    },
    [settings.energyUnit]
  );

  const retryStructuralAnalysisWrapper = useCallback(async () => {
    const currentStore = useVariantAnalysisStore.getState();
    const gene = currentStore.gene || currentStore.analysisState.result?.metadata?.gene;
    const variant = currentStore.variant || currentStore.analysisState.result?.metadata?.variant;
    const uniprotId = currentStore.uniprotId || currentStore.analysisState.result?.metadata?.uniprotId;
    if (!gene || !variant || !uniprotId) return;

    // Immediately dispatch optimistic loading state so the UI responds instantly
    currentStore.setAnalysisState((prev: any) => {
      if (!prev?.result) return prev;
      return {
        ...prev,
        result: {
          ...prev.result,
          esm2Eval: { loading: true },
          saprotEval: { loading: true },
          esmcEval: { loading: true },
          esm3Eval: { loading: true }
        }
      };
    });

    const acmgWeighting = settings.acmgWeighting;
    const requestId = ++pipeline.activeRequestIdRef.current;
    return await fetchProgressiveStructuralAssessments(
      {
        gene,
        variant,
        uniprotId,
        acmgWeighting,
        saprotEngine: settings.saprotEngine
      },
      apiClient,
      new AbortController().signal,
      currentStore.setAnalysisState,
      requestId,
      () => pipeline.activeRequestIdRef.current
    );
  }, [settings.acmgWeighting, settings.saprotEngine, apiClient, pipeline.activeRequestIdRef]);

  // Backward-compatible state proxy that avoids establishing 50+ store subscriptions
  const state = useMemo(() => {
    return new Proxy({} as any, {
      get(_target, prop: string | symbol) {
        if (typeof prop !== "string") return undefined;
        if (prop === "theme") return theme;
        if (prop === "isDark") return isDark;
        if (prop === "settings") return settings;
        if (prop === "showPolarContacts") return showPolarContacts;
        if (prop === "isSettingsOpen") return isSettingsOpen;
        if (prop in variantStyles) return (variantStyles as any)[prop];
        return (useVariantAnalysisStore.getState() as any)[prop];
      }
    });
  }, [theme, isDark, settings, showPolarContacts, isSettingsOpen, variantStyles]);

  const actions = useMemo(() => ({
    setTheme,
    toggleTheme,
    setSettings,
    updateSetting,
    resetSettingsToDefault,
    setShowPolarContacts,
    setIsSettingsOpen,
    handleSelectHistoryItem,
    handleSelectPreset,
    handleSearchSubmit,
    handleCopyReport,
    retryStructuralAnalysis: retryStructuralAnalysisWrapper,
    executeAnalysis: executeAnalysisWrapper,
    translateVariantNotation: translateVariantNotationWrapper,
    fetchHomologs: fetchHomologsWrapper,
    fetchNearestResidues: fetchNearestResiduesWrapper,
    fetchPocketInfo: biophysical.fetchPocketInfo,
    fetchEsmFold: fetchEsmFoldWrapper,
    resetViewerState,
    formatEnergyString,
    // Stable Zustand store action bindings
    setGene: useVariantAnalysisStore.getState().setGene,
    setVariant: useVariantAnalysisStore.getState().setVariant,
    setUniprotId: useVariantAnalysisStore.getState().setUniprotId,
    setSelectedResidueIndex: useVariantAnalysisStore.getState().setSelectedResidueIndex,
    setHoveredResidueIndex: useVariantAnalysisStore.getState().setHoveredResidueIndex,
    setSearchVal: useVariantAnalysisStore.getState().setSearchVal,
    setCustomGene: useVariantAnalysisStore.getState().setCustomGene,
    setCustomVariant: useVariantAnalysisStore.getState().setCustomVariant,
    setCustomUniprot: useVariantAnalysisStore.getState().setCustomUniprot,
    setCustomGenomic: useVariantAnalysisStore.getState().setCustomGenomic,
    setShowCustomInputs: useVariantAnalysisStore.getState().setShowCustomInputs,
    setCopied: useVariantAnalysisStore.getState().setCopied,
    setCustomPdbUrl: useVariantAnalysisStore.getState().setCustomPdbUrl,
    setUserDirections: useVariantAnalysisStore.getState().setUserDirections,
    setHomologs: useVariantAnalysisStore.getState().setHomologs,
    setViewMode: useVariantAnalysisStore.getState().setViewMode,
    setDisruptionPredictor: useVariantAnalysisStore.getState().setDisruptionPredictor,
    addNotification: useVariantAnalysisStore.getState().addNotification,
    removeNotification: useVariantAnalysisStore.getState().removeNotification,
    setEsmFoldWtPdb: useVariantAnalysisStore.getState().setEsmFoldWtPdb,
    setEsmFoldMutPdb: useVariantAnalysisStore.getState().setEsmFoldMutPdb,
    setEsmFoldAlignedPdb: useVariantAnalysisStore.getState().setEsmFoldAlignedPdb,
    setEsmFoldMetrics: useVariantAnalysisStore.getState().setEsmFoldMetrics,
    setFoldxMetrics: useVariantAnalysisStore.getState().setFoldxMetrics,
    setIsEsmFolding: useVariantAnalysisStore.getState().setIsEsmFolding,
    setEsmFoldingError: useVariantAnalysisStore.getState().setEsmFoldingError,
    setActive3dModelTab: useVariantAnalysisStore.getState().setActive3dModelTab,
    addToHistory: useVariantAnalysisStore.getState().addToHistory,
    clearHistory: useVariantAnalysisStore.getState().clearHistory,
    setAnalysisState: useVariantAnalysisStore.getState().setAnalysisState,
    setIsHowToInspectOpen: useVariantAnalysisStore.getState().setIsHowToInspectOpen,
    setIsLegendOpen: useVariantAnalysisStore.getState().setIsLegendOpen,
    setPdbText: useVariantAnalysisStore.getState().setPdbText,
    setTriageOverride: useVariantAnalysisStore.getState().setTriageOverride,
    setMutantPdb: useVariantAnalysisStore.getState().setMutantPdb,
    setFoldedResidueIndex: useVariantAnalysisStore.getState().setFoldedResidueIndex,
    setIsFolding: useVariantAnalysisStore.getState().setIsFolding,
    setFoldingError: useVariantAnalysisStore.getState().setFoldingError,
    setFoldingStatus: useVariantAnalysisStore.getState().setFoldingStatus,
    setFoldingDdG: useVariantAnalysisStore.getState().setFoldingDdG,
    setFoldingEnergetics: useVariantAnalysisStore.getState().setFoldingEnergetics,
    setCompareMode: useVariantAnalysisStore.getState().setCompareMode,
    setCompareVariant: useVariantAnalysisStore.getState().setCompareVariant,
    setCompareMutantPdb: useVariantAnalysisStore.getState().setCompareMutantPdb,
    setCompareFoldedResidueIndex: useVariantAnalysisStore.getState().setCompareFoldedResidueIndex,
    setIsFoldingCompare: useVariantAnalysisStore.getState().setIsFoldingCompare,
    setFoldingCompareError: useVariantAnalysisStore.getState().setFoldingCompareError,
    setCompareFoldingStatus: useVariantAnalysisStore.getState().setCompareFoldingStatus,
    setCompareFoldingDdG: useVariantAnalysisStore.getState().setCompareFoldingDdG,
    setCompareFoldingEnergetics: useVariantAnalysisStore.getState().setCompareFoldingEnergetics,
    setComparisonLayout: useVariantAnalysisStore.getState().setComparisonLayout,
    setDynamut2Status: useVariantAnalysisStore.getState().setDynamut2Status,
    setCompareDynamut2Status: useVariantAnalysisStore.getState().setCompareDynamut2Status,
    setDdmutStatus: useVariantAnalysisStore.getState().setDdmutStatus,
    setCompareDdmutStatus: useVariantAnalysisStore.getState().setCompareDdmutStatus,
    setThermompnnStatus: useVariantAnalysisStore.getState().setThermompnnStatus,
    setCompareThermompnnStatus: useVariantAnalysisStore.getState().setCompareThermompnnStatus,
    setThermompnnError: useVariantAnalysisStore.getState().setThermompnnError,
    setCompareThermompnnError: useVariantAnalysisStore.getState().setCompareThermompnnError,
    setDynamut2JobId: useVariantAnalysisStore.getState().setDynamut2JobId,
    setCompareDynamut2JobId: useVariantAnalysisStore.getState().setCompareDynamut2JobId,
    setDdmutJobId: useVariantAnalysisStore.getState().setDdmutJobId,
    setCompareDdmutJobId: useVariantAnalysisStore.getState().setCompareDdmutJobId,
    setThermompnnJobId: useVariantAnalysisStore.getState().setThermompnnJobId,
    setCompareThermompnnJobId: useVariantAnalysisStore.getState().setCompareThermompnnJobId,
    setStructuralDiff: useVariantAnalysisStore.getState().setStructuralDiff,
    setCompareStructuralDiff: useVariantAnalysisStore.getState().setCompareStructuralDiff,
    setComputedPocket: useVariantAnalysisStore.getState().setComputedPocket,
    setIsPocketLoading: useVariantAnalysisStore.getState().setIsPocketLoading,
    setPocketError: useVariantAnalysisStore.getState().setPocketError
  }), [
    setTheme,
    toggleTheme,
    setSettings,
    updateSetting,
    resetSettingsToDefault,
    setShowPolarContacts,
    setIsSettingsOpen,
    handleSelectHistoryItem,
    handleSelectPreset,
    handleSearchSubmit,
    handleCopyReport,
    retryStructuralAnalysisWrapper,
    executeAnalysisWrapper,
    translateVariantNotationWrapper,
    fetchHomologsWrapper,
    fetchNearestResiduesWrapper,
    biophysical.fetchPocketInfo,
    fetchEsmFoldWrapper,
    resetViewerState,
    formatEnergyString
  ]);

  return { state, actions, ...state, ...actions };
}

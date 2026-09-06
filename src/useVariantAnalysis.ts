import { useCallback } from "react";
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
  const store = useVariantAnalysisStore();

  // Subsystem execution hooks
  const biophysical = useBiophysicalModeling(
    settings,
    store.addNotification,
    apiClient,
    fetchWithAuth,
    store.pdbText
  );
  const structuralFolding = useStructuralFolding({
    setEsmFoldWtPdb: store.setEsmFoldWtPdb,
    setEsmFoldMutPdb: store.setEsmFoldMutPdb,
    setEsmFoldAlignedPdb: store.setEsmFoldAlignedPdb,
    setEsmFoldMetrics: store.setEsmFoldMetrics,
    setFoldxMetrics: store.setFoldxMetrics,
    setIsEsmFolding: store.setIsEsmFolding,
    setEsmFoldingError: store.setEsmFoldingError,
    setActive3dModelTab: store.setActive3dModelTab,
    resetEsmFoldState: store.resetEsmFoldState
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
    store.resetViewerState();
  }, [biophysical, structuralFolding, store]);

  const executeAnalysisWrapper = useCallback(
    (targetGene: string, targetVariant: string, targetUniprot?: string, providedSignal?: AbortSignal) => {
      return pipeline.executeAnalysis(targetGene, targetVariant, targetUniprot, providedSignal, {
        fetchWithAuth,
        apiClient,
        settings,
        userDirections: store.userDirections,
        sinks: {
          search: {
            setGene: store.setGene,
            setVariant: store.setVariant,
            setUniprotId: store.setUniprotId,
            setSearchVal: store.setSearchVal,
            setCustomGene: store.setCustomGene,
            setCustomVariant: store.setCustomVariant,
            setCustomUniprot: store.setCustomUniprot,
            setSelectedResidueIndex: store.setSelectedResidueIndex,
            addToHistory: (gene: string, variant: string, uniprotId: string) =>
              store.addToHistory({ gene, variant, uniprotId })
          },
          analysis: {
            setAnalysisState: store.setAnalysisState,
            setLoadingStep: store.setLoadingStep,
            setIsBiophysicalLoading: store.setIsBiophysicalLoading,
            setIsClinicalLoading: store.setIsClinicalLoading,
            setIsNarrativeLoading: store.setIsNarrativeLoading
          },
          biophysical: {
            setIsFolding: store.setIsFolding,
            setFoldingError: store.setFoldingError,
            setFoldingStatus: store.setFoldingStatus,
            setMutantPdb: store.setMutantPdb,
            setFoldedResidueIndex: store.setFoldedResidueIndex,
            setFoldingDdG: store.setFoldingDdG,
            setFoldingEnergetics: store.setFoldingEnergetics,
            setDynamut2JobId: store.setDynamut2JobId,
            setDynamut2Status: store.setDynamut2Status,
            setDdmutJobId: store.setDdmutJobId,
            setDdmutStatus: store.setDdmutStatus,
            setThermompnnJobId: store.setThermompnnJobId,
            setThermompnnStatus: store.setThermompnnStatus,
            setThermompnnError: store.setThermompnnError,
            lastFetchedFoldRef: biophysical.lastFetchedFoldRef
          },
          structure: {
            setPdbText: store.setPdbText,
            setComputedPocket: store.setComputedPocket,
            setIsPocketLoading: store.setIsPocketLoading,
            setPocketError: store.setPocketError,
            setHomologs: store.setHomologs,
            setIsHomologsLoading: store.setIsHomologsLoading,
            setComputedResiduesCache: store.setComputedResiduesCache,
            setDisruptionPredictor: store.setDisruptionPredictor,
            resetViewerState,
            clearDynaMutPoll: biophysical.clearDynaMutPoll,
            clearDynaMutComparePoll: biophysical.clearDynaMutComparePoll
          }
        }
      });
    },
    [pipeline, fetchWithAuth, apiClient, settings, store, biophysical, resetViewerState]
  );

  const handleSelectHistoryItem = useCallback(
    (item: { gene: string; variant: string; uniprotId: string }) => {
      store.handleSelectHistoryItem(item, {
        abortAllPendingRequests: () =>
          pipeline.abortAllPendingRequests(biophysical.clearDynaMutPoll, biophysical.clearDynaMutComparePoll),
        resetViewerState,
        executeAnalysis: (g, v, u, signal) => executeAnalysisWrapper(g, v, u, signal),
        setAnalysisState: store.setAnalysisState
      });
    },
    [store, pipeline, biophysical, resetViewerState, executeAnalysisWrapper]
  );

  const handleSelectPreset = useCallback(
    (preset: VariantPreset) => {
      store.handleSelectPreset(preset, {
        abortAllPendingRequests: () =>
          pipeline.abortAllPendingRequests(biophysical.clearDynaMutPoll, biophysical.clearDynaMutComparePoll),
        resetViewerState,
        executeAnalysis: (g, v, u, signal) => executeAnalysisWrapper(g, v, u, signal),
        setAnalysisState: store.setAnalysisState
      });
    },
    [store, pipeline, biophysical, resetViewerState, executeAnalysisWrapper]
  );

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      store.handleSearchSubmit(e, (g, v, u) => executeAnalysisWrapper(g, v, u));
    },
    [store, executeAnalysisWrapper]
  );

  const handleCopyReport = useCallback(async () => {
    await store.handleCopyReport(store.analysisState.result);
  }, [store]);

  const translateVariantNotationWrapper = useCallback(
    (notation: string, signal: AbortSignal) => {
      return pipeline.translateVariantNotation(notation, signal, {
        apiClient,
        setAnalysisState: store.setAnalysisState,
        setLoadingStep: store.setLoadingStep
      });
    },
    [pipeline, apiClient, store.setAnalysisState, store.setLoadingStep]
  );

  const fetchHomologsWrapper = useCallback(
    (targetUniprot: string, signal?: AbortSignal, pos?: number) => {
      return pipeline.fetchHomologs(targetUniprot, apiClient, signal, pos, {
        setHomologs: store.setHomologs,
        setIsHomologsLoading: store.setIsHomologsLoading
      });
    },
    [pipeline, apiClient, store.setHomologs, store.setIsHomologsLoading]
  );

  const fetchNearestResiduesWrapper = useCallback(
    (targetUniprot: string, targetVariant: string, residueIndex: number, pdbStr: string, signal?: AbortSignal) => {
      return pipeline.fetchNearestResidues(targetUniprot, targetVariant, residueIndex, pdbStr, apiClient, signal, {
        setComputedResiduesCache: store.setComputedResiduesCache
      });
    },
    [pipeline, apiClient, store.setComputedResiduesCache]
  );

  const fetchEsmFoldWrapper = useCallback(
    (uniprotIdArg?: string, variantArg?: string, wtSeq?: string, mutSeq?: string) => {
      return structuralFolding.fetchEsmFold(
        apiClient,
        store.addNotification,
        uniprotIdArg || store.uniprotId,
        variantArg || store.variant,
        wtSeq,
        mutSeq
      );
    },
    [structuralFolding, apiClient, store.addNotification, store.uniprotId, store.variant]
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
    const gene = store.gene || store.analysisState.result?.metadata?.gene;
    const variant = store.variant || store.analysisState.result?.metadata?.variant;
    const uniprotId = store.uniprotId || store.analysisState.result?.metadata?.uniprotId;
    if (!gene || !variant || !uniprotId) return;
    const acmgWeighting = settings.acmgWeighting;
    fetchProgressiveStructuralAssessments(
      {
        gene,
        variant,
        uniprotId,
        acmgWeighting
      },
      apiClient,
      new AbortController().signal,
      store.setAnalysisState,
      Date.now(),
      () => Date.now()
    );
  }, [store.gene, store.variant, store.uniprotId, store.analysisState.result?.metadata, store.setAnalysisState, settings.acmgWeighting, apiClient]);

  const state = {
    theme,
    isDark,
    settings,
    showPolarContacts,
    isSettingsOpen,
    ...variantStyles,
    gene: store.gene,
    variant: store.variant,
    uniprotId: store.uniprotId,
    selectedResidueIndex: store.selectedResidueIndex,
    hoveredResidueIndex: store.hoveredResidueIndex,
    searchVal: store.searchVal,
    customGene: store.customGene,
    customVariant: store.customVariant,
    customUniprot: store.customUniprot,
    customGenomic: store.customGenomic,
    showCustomInputs: store.showCustomInputs,
    copied: store.copied,
    customPdbUrl: store.customPdbUrl,
    userDirections: store.userDirections,
    homologs: store.homologs,
    isHomologsLoading: store.isHomologsLoading,
    viewMode: store.viewMode,
    disruptionPredictor: store.disruptionPredictor,
    notifications: store.notifications,
    esmFoldWtPdb: store.esmFoldWtPdb,
    esmFoldMutPdb: store.esmFoldMutPdb,
    esmFoldAlignedPdb: store.esmFoldAlignedPdb,
    esmFoldMetrics: store.esmFoldMetrics,
    foldxMetrics: store.foldxMetrics,
    isEsmFolding: store.isEsmFolding,
    esmFoldingError: store.esmFoldingError,
    active3dModelTab: store.active3dModelTab,
    history: store.history,
    analysisState: store.analysisState,
    loadingStep: store.loadingStep,
    isBiophysicalLoading: store.isBiophysicalLoading,
    isClinicalLoading: store.isClinicalLoading,
    isNarrativeLoading: store.isNarrativeLoading,
    triageOverride: store.triageOverride,
    pdbText: store.pdbText,
    isHowToInspectOpen: store.isHowToInspectOpen,
    isLegendOpen: store.isLegendOpen,
    mutantPdb: store.mutantPdb,
    foldedResidueIndex: store.foldedResidueIndex,
    isFolding: store.isFolding,
    foldingError: store.foldingError,
    foldingStatus: store.foldingStatus,
    foldingDdG: store.foldingDdG,
    foldingEnergetics: store.foldingEnergetics,
    compareMode: store.compareMode,
    compareVariant: store.compareVariant,
    compareMutantPdb: store.compareMutantPdb,
    compareFoldedResidueIndex: store.compareFoldedResidueIndex,
    isFoldingCompare: store.isFoldingCompare,
    foldingCompareError: store.foldingCompareError,
    compareFoldingStatus: store.compareFoldingStatus,
    compareFoldingDdG: store.compareFoldingDdG,
    compareFoldingEnergetics: store.compareFoldingEnergetics,
    comparisonLayout: store.comparisonLayout,
    dynamut2Status: store.dynamut2Status,
    compareDynamut2Status: store.compareDynamut2Status,
    ddmutStatus: store.ddmutStatus,
    compareDdmutStatus: store.compareDdmutStatus,
    thermompnnStatus: store.thermompnnStatus,
    compareThermompnnStatus: store.compareThermompnnStatus,
    thermompnnError: store.thermompnnError,
    compareThermompnnError: store.compareThermompnnError,
    dynamut2JobId: store.dynamut2JobId,
    compareDynamut2JobId: store.compareDynamut2JobId,
    ddmutJobId: store.ddmutJobId,
    compareDdmutJobId: store.compareDdmutJobId,
    thermompnnJobId: store.thermompnnJobId,
    compareThermompnnJobId: store.compareThermompnnJobId,
    structuralDiff: store.structuralDiff,
    compareStructuralDiff: store.compareStructuralDiff,
    computedPocket: store.computedPocket,
    isPocketLoading: store.isPocketLoading,
    pocketError: store.pocketError,
    computedResiduesCache: store.computedResiduesCache
  };

  const actions = {
    setTheme,
    toggleTheme,
    setSettings,
    updateSetting,
    resetSettingsToDefault,
    setShowPolarContacts,
    setIsSettingsOpen,
    setGene: store.setGene,
    setVariant: store.setVariant,
    setUniprotId: store.setUniprotId,
    setSelectedResidueIndex: store.setSelectedResidueIndex,
    setHoveredResidueIndex: store.setHoveredResidueIndex,
    setSearchVal: store.setSearchVal,
    setCustomGene: store.setCustomGene,
    setCustomVariant: store.setCustomVariant,
    setCustomUniprot: store.setCustomUniprot,
    setCustomGenomic: store.setCustomGenomic,
    setShowCustomInputs: store.setShowCustomInputs,
    setCopied: store.setCopied,
    setCustomPdbUrl: store.setCustomPdbUrl,
    setUserDirections: store.setUserDirections,
    setHomologs: store.setHomologs,
    setViewMode: store.setViewMode,
    setDisruptionPredictor: store.setDisruptionPredictor,
    addNotification: store.addNotification,
    removeNotification: store.removeNotification,
    setEsmFoldWtPdb: store.setEsmFoldWtPdb,
    setEsmFoldMutPdb: store.setEsmFoldMutPdb,
    setEsmFoldAlignedPdb: store.setEsmFoldAlignedPdb,
    setEsmFoldMetrics: store.setEsmFoldMetrics,
    setFoldxMetrics: store.setFoldxMetrics,
    setIsEsmFolding: store.setIsEsmFolding,
    setEsmFoldingError: store.setEsmFoldingError,
    setActive3dModelTab: store.setActive3dModelTab,
    handleSelectHistoryItem,
    handleSelectPreset,
    handleSearchSubmit,
    handleCopyReport,
    addToHistory: store.addToHistory,
    clearHistory: store.clearHistory,
    setAnalysisState: store.setAnalysisState,
    retryStructuralAnalysis: retryStructuralAnalysisWrapper,
    executeAnalysis: executeAnalysisWrapper,
    translateVariantNotation: translateVariantNotationWrapper,
    fetchHomologs: fetchHomologsWrapper,
    fetchNearestResidues: fetchNearestResiduesWrapper,
    fetchPocketInfo: biophysical.fetchPocketInfo,
    fetchEsmFold: fetchEsmFoldWrapper,
    resetViewerState,
    formatEnergyString,
    setIsHowToInspectOpen: store.setIsHowToInspectOpen,
    setIsLegendOpen: store.setIsLegendOpen,
    setPdbText: store.setPdbText,
    setTriageOverride: store.setTriageOverride,
    setMutantPdb: store.setMutantPdb,
    setFoldedResidueIndex: store.setFoldedResidueIndex,
    setIsFolding: store.setIsFolding,
    setFoldingError: store.setFoldingError,
    setFoldingStatus: store.setFoldingStatus,
    setFoldingDdG: store.setFoldingDdG,
    setFoldingEnergetics: store.setFoldingEnergetics,
    setCompareMode: store.setCompareMode,
    setCompareVariant: store.setCompareVariant,
    setCompareMutantPdb: store.setCompareMutantPdb,
    setCompareFoldedResidueIndex: store.setCompareFoldedResidueIndex,
    setIsFoldingCompare: store.setIsFoldingCompare,
    setFoldingCompareError: store.setFoldingCompareError,
    setCompareFoldingStatus: store.setCompareFoldingStatus,
    setCompareFoldingDdG: store.setCompareFoldingDdG,
    setCompareFoldingEnergetics: store.setCompareFoldingEnergetics,
    setComparisonLayout: store.setComparisonLayout,
    setDynamut2Status: store.setDynamut2Status,
    setCompareDynamut2Status: store.setCompareDynamut2Status,
    setDdmutStatus: store.setDdmutStatus,
    setCompareDdmutStatus: store.setCompareDdmutStatus,
    setThermompnnStatus: store.setThermompnnStatus,
    setCompareThermompnnStatus: store.setCompareThermompnnStatus,
    setThermompnnError: store.setThermompnnError,
    setCompareThermompnnError: store.setCompareThermompnnError,
    setDynamut2JobId: store.setDynamut2JobId,
    setCompareDynamut2JobId: store.setCompareDynamut2JobId,
    setDdmutJobId: store.setDdmutJobId,
    setCompareDdmutJobId: store.setCompareDdmutJobId,
    setThermompnnJobId: store.setThermompnnJobId,
    setCompareThermompnnJobId: store.setCompareThermompnnJobId,
    setStructuralDiff: store.setStructuralDiff,
    setCompareStructuralDiff: store.setCompareStructuralDiff,
    setComputedPocket: store.setComputedPocket,
    setIsPocketLoading: store.setIsPocketLoading,
    setPocketError: store.setPocketError
  };

  return { state, actions, ...state, ...actions };
}

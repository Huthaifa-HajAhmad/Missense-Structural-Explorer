import { useState, useEffect, useRef, useCallback } from "react";
export * from './variantAnalysisUtils';
import { generateMutantResponseSchema } from "./variantAnalysisUtils";
import { PdbHomolog, VariantPreset, StructureProvenance } from "./types";
import { useSettings } from "./context/SettingsContext";
import { useApiClient } from "./apiClient";
import { useSearchHistory } from "./hooks/useSearchHistory";
import { useNotificationSystem } from "./hooks/useNotificationSystem";
import { useVariantSearch } from "./hooks/useVariantSearch";
import { useBiophysicalModeling } from "./hooks/useBiophysicalModeling";
import { usePredictorData } from "./hooks/usePredictorData";
import { useClinicalEvidence } from "./hooks/useClinicalEvidence";
import { useStructuralFolding } from "./hooks/useStructuralFolding";
import { useAnalysisPipeline } from "./hooks/useAnalysisPipeline";
import { getVariantStyles } from "./shared/variantStyles";

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
    setIsSettingsOpen,
  } = useSettings();

  const { fetchWithAuth, apiClient } = useApiClient();

  // 1. Notification system hook
  const { notifications, addNotification, removeNotification } = useNotificationSystem();

  // 2. Search inputs & selection logic hook
  const search = useVariantSearch();

  // 3. Search history hook
  const { history, setHistory, addToHistory, clearHistory } = useSearchHistory(settings.maxHistoryItems, settings.saveHistory);

  // 4. Predictor data & clinical evidence hooks
  const predictor = usePredictorData();
  const clinical = useClinicalEvidence();

  const [pdbText, setPdbText] = useState<string | null>(null);

  // 5. Biophysical modeling hook
  const biophysical = useBiophysicalModeling(settings, addNotification, apiClient, fetchWithAuth, pdbText);

  // 6. ESMFold / ESM3 structural folding hook
  const structuralFolding = useStructuralFolding();

  // 7. Main analysis execution & API pipeline hook
  const pipeline = useAnalysisPipeline();
  const [viewMode, setViewMode] = useState<"wildtype" | "mutant">("wildtype");
  const [isHowToInspectOpen, setIsHowToInspectOpen] = useState<boolean>(false);
  const [isLegendOpen, setIsLegendOpen] = useState<boolean>(false);

  // Styling Classes — Claude Science Design System
  const variantStyles = getVariantStyles(isDark);

  const resetViewerState = useCallback(() => {
    biophysical.clearDynaMutPoll();
    biophysical.clearDynaMutComparePoll();
    biophysical.clearDdmutPoll();
    biophysical.clearDdmutComparePoll();
    biophysical.clearThermoMpnnPoll();
    biophysical.clearThermoMpnnComparePoll();
    setViewMode("wildtype");
    biophysical.setMutantPdb(null);
    structuralFolding.resetEsmFoldState();
    biophysical.setFoldedResidueIndex(null);
    biophysical.setFoldingError(null);
    biophysical.setFoldingStatus(null);
    biophysical.setFoldingDdG(null);
    biophysical.setFoldingEnergetics(null);
    biophysical.setDynamut2Status(null);
    biophysical.setCompareMode(false);
    biophysical.setCompareVariant("p.Arg408Pro");
    biophysical.setCompareMutantPdb(null);
    biophysical.setCompareFoldedResidueIndex(null);
    biophysical.setIsFolding(false);
    biophysical.setIsFoldingCompare(false);
    biophysical.setFoldingCompareError(null);
    biophysical.setCompareFoldingStatus(null);
    biophysical.setCompareFoldingDdG(null);
    biophysical.setCompareFoldingEnergetics(null);
    biophysical.setCompareDynamut2Status(null);

    // Reset all remote predictor job IDs, statuses, errors, and structural differences
    biophysical.setDdmutStatus(null);
    biophysical.setCompareDdmutStatus(null);
    biophysical.setThermompnnStatus(null);
    biophysical.setCompareThermompnnStatus(null);
    biophysical.setThermompnnError(null);
    biophysical.setCompareThermompnnError(null);
    biophysical.setDynamut2JobId(null);
    biophysical.setCompareDynamut2JobId(null);
    biophysical.setDdmutJobId(null);
    biophysical.setCompareDdmutJobId(null);
    biophysical.setThermompnnJobId(null);
    biophysical.setCompareThermompnnJobId(null);
    biophysical.setStructuralDiff(null);
    biophysical.setCompareStructuralDiff(null);

    setPdbText(null);
    biophysical.setComputedPocket(null);
    biophysical.setIsPocketLoading(false);
    biophysical.lastFetchedFoldRef.current = "";
    biophysical.setPocketError(null);
  }, [biophysical, structuralFolding]);

  const executeAnalysisWrapper = useCallback((
    targetGene: string,
    targetVariant: string,
    targetUniprot?: string,
    providedSignal?: AbortSignal
  ) => {
    return pipeline.executeAnalysis(targetGene, targetVariant, targetUniprot, providedSignal, {
      fetchWithAuth,
      apiClient,
      settings,
      userDirections: search.userDirections,
      setAnalysisState: predictor.setAnalysisState,
      setLoadingStep: predictor.setLoadingStep,
      setIsBiophysicalLoading: predictor.setIsBiophysicalLoading,
      setIsClinicalLoading: predictor.setIsClinicalLoading,
      setIsNarrativeLoading: predictor.setIsNarrativeLoading,
      setGene: search.setGene,
      setVariant: search.setVariant,
      setUniprotId: search.setUniprotId,
      setSearchVal: search.setSearchVal,
      setCustomGene: search.setCustomGene,
      setCustomVariant: search.setCustomVariant,
      setCustomUniprot: search.setCustomUniprot,
      setSelectedResidueIndex: search.setSelectedResidueIndex,
      setDisruptionPredictor: pipeline.setDisruptionPredictor,
      setComputedPocket: biophysical.setComputedPocket,
      setIsPocketLoading: biophysical.setIsPocketLoading,
      setPocketError: biophysical.setPocketError,
      setPdbText,
      addToHistory,
      resetViewerState,
      clearDynaMutPoll: biophysical.clearDynaMutPoll,
      clearDynaMutComparePoll: biophysical.clearDynaMutComparePoll,
      // Biophysical modeling setters for concurrent FoldX execution
      setIsFolding: biophysical.setIsFolding,
      setFoldingError: biophysical.setFoldingError,
      setFoldingStatus: biophysical.setFoldingStatus,
      setMutantPdb: biophysical.setMutantPdb,
      setFoldedResidueIndex: biophysical.setFoldedResidueIndex,
      setFoldingDdG: biophysical.setFoldingDdG,
      setFoldingEnergetics: biophysical.setFoldingEnergetics,
      setDynamut2JobId: biophysical.setDynamut2JobId,
      setDynamut2Status: biophysical.setDynamut2Status,
      setDdmutJobId: biophysical.setDdmutJobId,
      setDdmutStatus: biophysical.setDdmutStatus,
      setThermompnnJobId: biophysical.setThermompnnJobId,
      setThermompnnStatus: biophysical.setThermompnnStatus,
      setThermompnnError: biophysical.setThermompnnError,
      lastFetchedFoldRef: biophysical.lastFetchedFoldRef
    });
  }, [pipeline, fetchWithAuth, apiClient, settings, search, predictor, biophysical, addToHistory, resetViewerState]);

  const handleSelectHistoryItem = useCallback((item: { gene: string; variant: string; uniprotId: string }) => {
    search.handleSelectHistoryItem(item, {
      abortAllPendingRequests: () => pipeline.abortAllPendingRequests(biophysical.clearDynaMutPoll, biophysical.clearDynaMutComparePoll),
      resetViewerState,
      executeAnalysis: (g, v, u, signal) => executeAnalysisWrapper(g, v, u, signal),
      setAnalysisState: predictor.setAnalysisState
    });
  }, [search, pipeline, biophysical, resetViewerState, predictor.setAnalysisState, executeAnalysisWrapper]);

  const handleSelectPreset = useCallback((preset: VariantPreset) => {
    search.handleSelectPreset(preset, {
      abortAllPendingRequests: () => pipeline.abortAllPendingRequests(biophysical.clearDynaMutPoll, biophysical.clearDynaMutComparePoll),
      resetViewerState,
      setAnalysisState: predictor.setAnalysisState
    });
  }, [search, pipeline, biophysical, resetViewerState, predictor.setAnalysisState]);

  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const targetGene = search.customGene.trim();
    const targetVariant = search.customGenomic.trim() ? search.customGenomic.trim() : search.customVariant.trim();
    const targetUniprot = search.customUniprot.trim();
    executeAnalysisWrapper(targetGene, targetVariant, targetUniprot);
  }, [search.customGene, search.customVariant, search.customGenomic, search.customUniprot, executeAnalysisWrapper]);

  const handleCopyReport = useCallback(async () => {
    const result = predictor.analysisState.result;
    if (!result) return;
    const classification = result?.clinvar?.classification ?? result?.ruleBasedInsights?.acmgVerdict ?? "";
    const narrative     = result?.analysis ?? "";
    const acmgCriteria  = (result?.insights?.acmgCriteria ?? result?.ruleBasedInsights?.acmgCriteria ?? []).map((c: any) => c.code);

    try {
      await navigator.clipboard.writeText(
        `${classification}\n\n${narrative}\n\nACMG Evidence: ${acmgCriteria.join(", ")}`
      );
      search.setCopied(true);
      setTimeout(() => search.setCopied(false), 2000);
    } catch (err) {
      console.error("[Copy Report Error] Clipboard write failed:", err);
    }
  }, [predictor.analysisState.result, search.setCopied]);

  const translateVariantNotationWrapper = useCallback((notation: string, signal: AbortSignal) => {
    return pipeline.translateVariantNotation(notation, signal, {
      apiClient,
      setAnalysisState: predictor.setAnalysisState,
      setLoadingStep: predictor.setLoadingStep
    });
  }, [pipeline, apiClient, predictor.setAnalysisState, predictor.setLoadingStep]);

  const fetchHomologsWrapper = useCallback((targetUniprot: string, signal?: AbortSignal) => {
    return pipeline.fetchHomologs(targetUniprot, apiClient, signal);
  }, [pipeline, apiClient]);

  const fetchNearestResiduesWrapper = useCallback((
    targetUniprot: string,
    targetVariant: string,
    residueIndex: number,
    pdbStr: string,
    signal?: AbortSignal
  ) => {
    return pipeline.fetchNearestResidues(targetUniprot, targetVariant, residueIndex, pdbStr, apiClient, signal);
  }, [pipeline, apiClient]);

  const fetchEsmFoldWrapper = useCallback((uniprotIdArg?: string, variantArg?: string, wtSeq?: string, mutSeq?: string) => {
    return structuralFolding.fetchEsmFold(
      apiClient,
      addNotification,
      uniprotIdArg || search.uniprotId,
      variantArg || search.variant,
      wtSeq,
      mutSeq
    );
  }, [structuralFolding, apiClient, addNotification, search.uniprotId, search.variant]);

  const formatEnergyString = useCallback((text: string | null | undefined): string => {
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
  }, [settings.energyUnit]);

  const state = {
    theme, isDark, settings, showPolarContacts, isSettingsOpen,
    ...variantStyles,
    gene: search.gene,
    variant: search.variant,
    uniprotId: search.uniprotId,
    selectedResidueIndex: search.selectedResidueIndex,
    hoveredResidueIndex: search.hoveredResidueIndex,
    searchVal: search.searchVal,
    customGene: search.customGene,
    customVariant: search.customVariant,
    customUniprot: search.customUniprot,
    customGenomic: search.customGenomic,
    showCustomInputs: search.showCustomInputs,
    copied: search.copied,
    customPdbUrl: search.customPdbUrl,
    userDirections: search.userDirections,
    homologs: pipeline.homologs,
    isHomologsLoading: pipeline.isHomologsLoading,
    viewMode,
    disruptionPredictor: pipeline.disruptionPredictor,
    notifications,
    esmFoldWtPdb: structuralFolding.esmFoldWtPdb,
    esmFoldMutPdb: structuralFolding.esmFoldMutPdb,
    esmFoldAlignedPdb: structuralFolding.esmFoldAlignedPdb,
    esmFoldMetrics: structuralFolding.esmFoldMetrics,
    foldxMetrics: structuralFolding.foldxMetrics,
    isEsmFolding: structuralFolding.isEsmFolding,
    esmFoldingError: structuralFolding.esmFoldingError,
    active3dModelTab: structuralFolding.active3dModelTab,
    history,
    analysisState: predictor.analysisState,
    loadingStep: predictor.loadingStep,
    isBiophysicalLoading: predictor.isBiophysicalLoading,
    isClinicalLoading: predictor.isClinicalLoading,
    isNarrativeLoading: predictor.isNarrativeLoading,
    triageOverride: clinical.triageOverride,
    pdbText,
    isHowToInspectOpen,
    isLegendOpen,
    mutantPdb: biophysical.mutantPdb,
    foldedResidueIndex: biophysical.foldedResidueIndex,
    isFolding: biophysical.isFolding,
    foldingError: biophysical.foldingError,
    foldingStatus: biophysical.foldingStatus,
    foldingDdG: biophysical.foldingDdG,
    foldingEnergetics: biophysical.foldingEnergetics,
    compareMode: biophysical.compareMode,
    compareVariant: biophysical.compareVariant,
    compareMutantPdb: biophysical.compareMutantPdb,
    compareFoldedResidueIndex: biophysical.compareFoldedResidueIndex,
    isFoldingCompare: biophysical.isFoldingCompare,
    foldingCompareError: biophysical.foldingCompareError,
    compareFoldingStatus: biophysical.compareFoldingStatus,
    compareFoldingDdG: biophysical.compareFoldingDdG,
    compareFoldingEnergetics: biophysical.compareFoldingEnergetics,
    comparisonLayout: biophysical.comparisonLayout,
    dynamut2Status: biophysical.dynamut2Status,
    compareDynamut2Status: biophysical.compareDynamut2Status,
    ddmutStatus: biophysical.ddmutStatus,
    compareDdmutStatus: biophysical.compareDdmutStatus,
    thermompnnStatus: biophysical.thermompnnStatus,
    compareThermompnnStatus: biophysical.compareThermompnnStatus,
    thermompnnError: biophysical.thermompnnError,
    compareThermompnnError: biophysical.compareThermompnnError,
    dynamut2JobId: biophysical.dynamut2JobId,
    compareDynamut2JobId: biophysical.compareDynamut2JobId,
    ddmutJobId: biophysical.ddmutJobId,
    compareDdmutJobId: biophysical.compareDdmutJobId,
    thermompnnJobId: biophysical.thermompnnJobId,
    compareThermompnnJobId: biophysical.compareThermompnnJobId,
    structuralDiff: biophysical.structuralDiff,
    compareStructuralDiff: biophysical.compareStructuralDiff,
    computedPocket: biophysical.computedPocket,
    isPocketLoading: biophysical.isPocketLoading,
    pocketError: biophysical.pocketError,
    computedResiduesCache: pipeline.computedResiduesCache
  };

  const actions = {
    setTheme, toggleTheme, setSettings, updateSetting, resetSettingsToDefault,
    setShowPolarContacts, setIsSettingsOpen,
    setGene: search.setGene,
    setVariant: search.setVariant,
    setUniprotId: search.setUniprotId,
    setSelectedResidueIndex: search.setSelectedResidueIndex,
    setHoveredResidueIndex: search.setHoveredResidueIndex,
    setSearchVal: search.setSearchVal,
    setCustomGene: search.setCustomGene,
    setCustomVariant: search.setCustomVariant,
    setCustomUniprot: search.setCustomUniprot,
    setCustomGenomic: search.setCustomGenomic,
    setShowCustomInputs: search.setShowCustomInputs,
    setCopied: search.setCopied,
    setCustomPdbUrl: search.setCustomPdbUrl,
    setUserDirections: search.setUserDirections,
    setHomologs: pipeline.setHomologs,
    setViewMode,
    setDisruptionPredictor: pipeline.setDisruptionPredictor,
    addNotification,
    removeNotification,
    setEsmFoldWtPdb: structuralFolding.setEsmFoldWtPdb,
    setEsmFoldMutPdb: structuralFolding.setEsmFoldMutPdb,
    setEsmFoldAlignedPdb: structuralFolding.setEsmFoldAlignedPdb,
    setEsmFoldMetrics: structuralFolding.setEsmFoldMetrics,
    setFoldxMetrics: structuralFolding.setFoldxMetrics,
    setIsEsmFolding: structuralFolding.setIsEsmFolding,
    setEsmFoldingError: structuralFolding.setEsmFoldingError,
    setActive3dModelTab: structuralFolding.setActive3dModelTab,
    handleSelectHistoryItem,
    handleSelectPreset,
    handleSearchSubmit,
    handleCopyReport,
    addToHistory,
    clearHistory,
    setAnalysisState: predictor.setAnalysisState,
    executeAnalysis: executeAnalysisWrapper,
    translateVariantNotation: translateVariantNotationWrapper,
    fetchHomologs: fetchHomologsWrapper,
    fetchNearestResidues: fetchNearestResiduesWrapper,
    fetchPocketInfo: biophysical.fetchPocketInfo,
    fetchEsmFold: fetchEsmFoldWrapper,
    resetViewerState,
    formatEnergyString,
    setIsHowToInspectOpen,
    setIsLegendOpen,
    setPdbText,
    setTriageOverride: clinical.setTriageOverride,
    setMutantPdb: biophysical.setMutantPdb,
    setFoldedResidueIndex: biophysical.setFoldedResidueIndex,
    setIsFolding: biophysical.setIsFolding,
    setFoldingError: biophysical.setFoldingError,
    setFoldingStatus: biophysical.setFoldingStatus,
    setFoldingDdG: biophysical.setFoldingDdG,
    setFoldingEnergetics: biophysical.setFoldingEnergetics,
    setCompareMode: biophysical.setCompareMode,
    setCompareVariant: biophysical.setCompareVariant,
    setCompareMutantPdb: biophysical.setCompareMutantPdb,
    setCompareFoldedResidueIndex: biophysical.setCompareFoldedResidueIndex,
    setIsFoldingCompare: biophysical.setIsFoldingCompare,
    setFoldingCompareError: biophysical.setFoldingCompareError,
    setCompareFoldingStatus: biophysical.setCompareFoldingStatus,
    setCompareFoldingDdG: biophysical.setCompareFoldingDdG,
    setCompareFoldingEnergetics: biophysical.setCompareFoldingEnergetics,
    setComparisonLayout: biophysical.setComparisonLayout,
    setDynamut2Status: biophysical.setDynamut2Status,
    setCompareDynamut2Status: biophysical.setCompareDynamut2Status,
    setDdmutStatus: biophysical.setDdmutStatus,
    setCompareDdmutStatus: biophysical.setCompareDdmutStatus,
    setThermompnnStatus: biophysical.setThermompnnStatus,
    setCompareThermompnnStatus: biophysical.setCompareThermompnnStatus,
    setThermompnnError: biophysical.setThermompnnError,
    setCompareThermompnnError: biophysical.setCompareThermompnnError,
    setDynamut2JobId: biophysical.setDynamut2JobId,
    setCompareDynamut2JobId: biophysical.setCompareDynamut2JobId,
    setDdmutJobId: biophysical.setDdmutJobId,
    setCompareDdmutJobId: biophysical.setCompareDdmutJobId,
    setThermompnnJobId: biophysical.setThermompnnJobId,
    setCompareThermompnnJobId: biophysical.setCompareThermompnnJobId,
    setStructuralDiff: biophysical.setStructuralDiff,
    setCompareStructuralDiff: biophysical.setCompareStructuralDiff,
    setComputedPocket: biophysical.setComputedPocket,
    setIsPocketLoading: biophysical.setIsPocketLoading,
    setPocketError: biophysical.setPocketError
  };

  return { state, actions };
}

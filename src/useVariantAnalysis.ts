import { useCallback, useEffect, useMemo, useRef } from "react";
export * from "./variantAnalysisUtils";
import { VariantPreset } from "./types";
import { useSettings } from "./context/SettingsContext";
import { useApiClient } from "./apiClient";
import { useBiophysicalModeling } from "./hooks/useBiophysicalModeling";
import { useFoldxSuperposition } from "./hooks/useFoldxSuperposition";
import { useAnalysisPipeline } from "./hooks/useAnalysisPipeline";
import { useStoreSettingsSync } from "./hooks/useStoreSettingsSync";
import { getVariantStyles } from "./shared/variantStyles";
import { firstDiagnosticsReading } from "./stores/diagnosticsStore";
import { useVariantAnalysisStore } from "./stores/useVariantAnalysisStore";
import { fetchProgressiveStructuralAssessments } from "./services/pipeline/biophysicalService";
import { requestFieldsOf, type AnalysisCacheContext } from "./services/pipeline/analysisContext";

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
    serverGeminiReady,
    setSettings,
    updateSetting,
    resetSettingsToDefault,
    showPolarContacts,
    setShowPolarContacts,
    isSettingsOpen,
    setIsSettingsOpen
  } = useSettings();

  const { fetchWithAuth, apiClient } = useApiClient();
  useStoreSettingsSync(settings);

  // Subsystem execution hooks
  const biophysical = useBiophysicalModeling(
    settings,
    useVariantAnalysisStore.getState().addNotification,
    apiClient,
    fetchWithAuth
  );
  // Pairs the FoldX variant with its own template for the 3D superposition and its measurements.
  useFoldxSuperposition(apiClient);
  const pipeline = useAnalysisPipeline();
  /**
   * Request generation for structural RE-evaluations, kept separate from the pipeline's own id.
   * See `retryStructuralAnalysisWrapper` for why sharing it orphaned an in-flight FoldX run.
   */
  const structuralRetryIdRef = useRef(0);
  const structuralRetryControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      structuralRetryControllerRef.current?.abort();
      structuralRetryControllerRef.current = null;
    };
  }, []);

  const variantStyles = getVariantStyles(isDark);

  const resetViewerState = useCallback(() => {
    structuralRetryControllerRef.current?.abort();
    structuralRetryControllerRef.current = null;
    biophysical.clearDynaMutPoll();
    biophysical.clearDdmutPoll();
    biophysical.clearThermoMpnnPoll();
    useVariantAnalysisStore.getState().resetViewerState();
  }, [biophysical]);

  const executeAnalysisWrapper = useCallback(
    (targetGene: string, targetVariant: string, targetUniprot?: string, providedSignal?: AbortSignal) => {
      const currentStore = useVariantAnalysisStore.getState();
      return pipeline.executeAnalysis(targetGene, targetVariant, targetUniprot, providedSignal, {
        fetchWithAuth,
        apiClient,
        settings: {
          ...settings,
          serverGeminiReady
        },
        serverGeminiReady,
        userDirections: currentStore.userDirections,
        // A reader's numbering decision applies to the run they made it for; the store clears it when
        // the notation changes, so it can never leak onto a later, different query.
        ...(currentStore.numberingBasis ? { numberingBasis: currentStore.numberingBasis } : {}),
        waitForServerGemini: async () => Boolean((await firstDiagnosticsReading()).diagnostics?.geminiReady),
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
            addToHistory: (gene: string, variant: string, uniprotId: string, query?: string) =>
              currentStore.addToHistory({ gene, variant, uniprotId, ...(query ? { query } : {}) })
          },
          analysis: {
            setAnalysisState: currentStore.setAnalysisState,
            setLoadingStep: currentStore.setLoadingStep,
            setIsBiophysicalLoading: currentStore.setIsBiophysicalLoading,
            setIsStructuralLoading: currentStore.setIsStructuralLoading,
            setIsClinicalLoading: currentStore.setIsClinicalLoading,
            setIsNarrativeLoading: currentStore.setIsNarrativeLoading
          },
          biophysical: {
            setIsFolding: currentStore.setIsFolding,
            setFoldingProgress: currentStore.setFoldingProgress,
            setFoldingError: currentStore.setFoldingError,
            setFoldingStatus: currentStore.setFoldingStatus,
            setMutantPdb: currentStore.setMutantPdb,
            setFoldxWtPdb: currentStore.setFoldxWtPdb,
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
          },
          structure: {
            setPdbText: currentStore.setPdbText,
            /**
             * The structure sink's provenance describes `pdbText`. It used to share one
             * `structureProvenance` field with the FoldX run, and whichever ran last named the
             * structure on the 3D toolbar; FoldX's template now lives only on its energetics.
             */
            setPdbTextProvenance: currentStore.setPdbTextProvenance,
            setComputedPocket: currentStore.setComputedPocket,
            setIsPocketLoading: currentStore.setIsPocketLoading,
            setPocketError: currentStore.setPocketError,
            setHomologs: currentStore.setHomologs,
            setIsHomologsLoading: currentStore.setIsHomologsLoading,
            setComputedResiduesCache: currentStore.setComputedResiduesCache,
            setDisruptionPredictor: currentStore.setDisruptionPredictor,
            resetViewerState,
            /**
             * The four missing poll-clear handlers.
             *
             * `normalizePipelineOptions` returns a caller-supplied `sinks` object AS IS, so a member
             * this adapter omits arrives as `undefined` and every `clearX?.()` inside the pipeline
             * silently does nothing — the DDMut/ThermoMPNN pollers kept running across a new query
             * and could write a previous variant's result into the current one.
             */
            clearDynaMutPoll: biophysical.clearDynaMutPoll,
            clearDdmutPoll: biophysical.clearDdmutPoll,
            clearThermoMpnnPoll: biophysical.clearThermoMpnnPoll
          }
        }
      });
    },
    [pipeline, fetchWithAuth, apiClient, settings, serverGeminiReady, biophysical, resetViewerState]
  );

  const handleSelectHistoryItem = useCallback(
    (item: { gene: string; variant: string; uniprotId: string; query?: string }) => {
      const currentStore = useVariantAnalysisStore.getState();
      currentStore.handleSelectHistoryItem(item, {
        abortAllPendingRequests: () =>
          pipeline.abortAllPendingRequests(
            biophysical.clearDynaMutPoll,
            biophysical.clearDdmutPoll,
            biophysical.clearThermoMpnnPoll
          ),
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
          pipeline.abortAllPendingRequests(
            biophysical.clearDynaMutPoll,
            biophysical.clearDdmutPoll,
            biophysical.clearThermoMpnnPoll
          ),
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

    /**
     * The same coordinate context the run's own request carried (genome build, coordinates, numbering),
     * read from the context the run saved. Without it the server would resolve the protein change on
     * its own, and a change with several possible DNA alleles could be recomputed for another one and
     * written over the selected allele's insights. An older save without a context keeps the weighting
     * from settings alone.
     */
    const savedContext = currentStore.analysisState.result?.metadata?.pipelineContext as AnalysisCacheContext | undefined;
    const requestFields = savedContext ? requestFieldsOf(savedContext) : { acmgWeighting: settings.acmgWeighting };
    /**
     * A LOCAL request generation, not the pipeline's.
     *
     * This used to bump `pipeline.activeRequestIdRef`, which identifies the whole analysis run. An
     * in-flight FoldX leg compares against that id in every poll and in its `finally`, so bumping it
     * made the leg's terminal writes (and its "stop folding") all decline to run — the spinner and
     * its phase stayed on screen with nothing left to clear them, because no new run was started to
     * do it. A structural re-evaluation is a different request from the run; giving it its own
     * counter keeps re-evaluations ordered without invalidating work that is still legitimately
     * owned by the run.
     */
    structuralRetryControllerRef.current?.abort();
    const retryController = new AbortController();
    structuralRetryControllerRef.current = retryController;

    const requestId = ++structuralRetryIdRef.current;
    return await fetchProgressiveStructuralAssessments(
      { gene, variant, uniprotId, ...requestFields },
      apiClient,
      retryController.signal,
      currentStore.setAnalysisState,
      requestId,
      () => structuralRetryIdRef.current,
      undefined,
      currentStore.setIsStructuralLoading
    );
  }, [settings.acmgWeighting, apiClient]);

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
    setFoldxMetrics: useVariantAnalysisStore.getState().setFoldxMetrics,
    addToHistory: useVariantAnalysisStore.getState().addToHistory,
    clearHistory: useVariantAnalysisStore.getState().clearHistory,
    setAnalysisState: useVariantAnalysisStore.getState().setAnalysisState,
    setIsHowToInspectOpen: useVariantAnalysisStore.getState().setIsHowToInspectOpen,
    setIsLegendOpen: useVariantAnalysisStore.getState().setIsLegendOpen,
    setPdbText: useVariantAnalysisStore.getState().setPdbText,
    setTriageOverride: useVariantAnalysisStore.getState().setTriageOverride,
    setMutantPdb: useVariantAnalysisStore.getState().setMutantPdb,
    setFoldxWtPdb: useVariantAnalysisStore.getState().setFoldxWtPdb,
    setFoldedResidueIndex: useVariantAnalysisStore.getState().setFoldedResidueIndex,
    setIsFolding: useVariantAnalysisStore.getState().setIsFolding,
    setFoldingError: useVariantAnalysisStore.getState().setFoldingError,
    setFoldingStatus: useVariantAnalysisStore.getState().setFoldingStatus,
    setFoldingDdG: useVariantAnalysisStore.getState().setFoldingDdG,
    setFoldingEnergetics: useVariantAnalysisStore.getState().setFoldingEnergetics,
    setDynamut2Status: useVariantAnalysisStore.getState().setDynamut2Status,
    setDdmutStatus: useVariantAnalysisStore.getState().setDdmutStatus,
    setThermompnnStatus: useVariantAnalysisStore.getState().setThermompnnStatus,
    setThermompnnError: useVariantAnalysisStore.getState().setThermompnnError,
    setDynamut2JobId: useVariantAnalysisStore.getState().setDynamut2JobId,
    setDdmutJobId: useVariantAnalysisStore.getState().setDdmutJobId,
    setThermompnnJobId: useVariantAnalysisStore.getState().setThermompnnJobId,
    setStructuralDiff: useVariantAnalysisStore.getState().setStructuralDiff,
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
    resetViewerState,
    formatEnergyString
  ]);

  return { state, actions, ...state, ...actions };
}

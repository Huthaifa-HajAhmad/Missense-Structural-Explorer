import { useState, useRef, useCallback, useEffect } from "react";
import { PdbHomolog, NearestResidue } from "../types";
import { parseMutationResidues } from "../variantAnalysisUtils";
import { FALLBACK_ANALYSES, FALLBACK_INSIGHTS } from "../data";
import { useDevConsole } from "../context/DevConsoleContext";
import {
  toFoldxMutation,
  isGenomicOrCdnaNotation,
  translateVariantNotation as translateVariantNotationService
} from "../services/pipeline/notationService";
import {
  fetchPdbCoordinates,
  fetchHomologStructures,
  fetchBindingPocket,
  fetchNearestResidues as fetchNearestResiduesService
} from "../services/pipeline/structureService";
import { executeFoldxPipeline } from "../services/pipeline/foldxService";
import {
  fetchBiophysicalAnalysis,
  fetchProgressiveLandscape,
  fetchProgressiveStructuralAssessments
} from "../services/pipeline/biophysicalService";
import { generateClinicalNarrative } from "../services/pipeline/narrativeService";
import { executeFullAnalysisWorkflow } from "../services/pipeline/workflowOrchestrator";
import { getCachedVariant } from "../services/pipeline/variantCache";
import {
  TraceContext,
  PipelineStateSinks,
  PipelineBiophysicalSink,
  PipelineSearchSink,
  PipelineAnalysisSink,
  PipelineStructureSink,
  StructuredPipelineOptions,
  UseAnalysisPipelineOptions
} from "../services/pipeline/types";
import {
  createAnalysisVersion,
  createPlaceholderAnalysisState,
  createCompletedAnalysisState,
  createBiophysicalErrorAnalysisState,
  createTopLevelErrorAnalysisState,
  createDemoFallbackAnalysisState,
  PipelineStateBaseParams
} from "../services/pipeline/pipelineStateFactory";

// Re-export utility functions and types for backward compatibility
export { toFoldxMutation, isGenomicOrCdnaNotation, createAnalysisVersion };
export type { StructuredPipelineOptions, UseAnalysisPipelineOptions };


/**
 * Normalizes flat or structured options into a uniform StructuredPipelineOptions object.
 */
export function normalizePipelineOptions(options: UseAnalysisPipelineOptions): StructuredPipelineOptions {
  if ("sinks" in options && options.sinks) {
    return {
      fetchWithAuth: options.fetchWithAuth,
      apiClient: options.apiClient,
      settings: options.settings,
      userDirections: options.userDirections,
      sinks: options.sinks
    };
  }

  const flat = options as any;
  return {
    fetchWithAuth: flat.fetchWithAuth,
    apiClient: flat.apiClient,
    settings: flat.settings,
    userDirections: flat.userDirections || "",
    sinks: {
      search: {
        setGene: flat.setGene || (() => {}),
        setVariant: flat.setVariant || (() => {}),
        setUniprotId: flat.setUniprotId || (() => {}),
        setSearchVal: flat.setSearchVal || (() => {}),
        setCustomGene: flat.setCustomGene || (() => {}),
        setCustomVariant: flat.setCustomVariant || (() => {}),
        setCustomUniprot: flat.setCustomUniprot || (() => {}),
        setSelectedResidueIndex: flat.setSelectedResidueIndex || (() => {}),
        addToHistory: flat.addToHistory || (() => {})
      },
      analysis: {
        setAnalysisState: flat.setAnalysisState || (() => {}),
        setLoadingStep: flat.setLoadingStep || (() => {}),
        setIsBiophysicalLoading: flat.setIsBiophysicalLoading || (() => {}),
        setIsClinicalLoading: flat.setIsClinicalLoading || (() => {}),
        setIsNarrativeLoading: flat.setIsNarrativeLoading || (() => {})
      },
      biophysical: {
        setIsFolding: flat.setIsFolding || (() => {}),
        setFoldingError: flat.setFoldingError || (() => {}),
        setFoldingStatus: flat.setFoldingStatus || (() => {}),
        setMutantPdb: flat.setMutantPdb || (() => {}),
        setFoldedResidueIndex: flat.setFoldedResidueIndex || (() => {}),
        setFoldingDdG: flat.setFoldingDdG || (() => {}),
        setFoldingEnergetics: flat.setFoldingEnergetics || (() => {}),
        setDynamut2JobId: flat.setDynamut2JobId || (() => {}),
        setDynamut2Status: flat.setDynamut2Status || (() => {}),
        setDdmutJobId: flat.setDdmutJobId || (() => {}),
        setDdmutStatus: flat.setDdmutStatus || (() => {}),
        setThermompnnJobId: flat.setThermompnnJobId || (() => {}),
        setThermompnnStatus: flat.setThermompnnStatus || (() => {}),
        setThermompnnError: flat.setThermompnnError || (() => {}),
        lastFetchedFoldRef: flat.lastFetchedFoldRef || { current: "" }
      },
      structure: {
        setPdbText: flat.setPdbText || (() => {}),
        setComputedPocket: flat.setComputedPocket || (() => {}),
        setIsPocketLoading: flat.setIsPocketLoading || (() => {}),
        setPocketError: flat.setPocketError || (() => {}),
        setHomologs: flat.setHomologs || (() => {}),
        setIsHomologsLoading: flat.setIsHomologsLoading || (() => {}),
        setComputedResiduesCache: flat.setComputedResiduesCache || (() => {}),
        setDisruptionPredictor: flat.setDisruptionPredictor || (() => {}),
        resetViewerState: flat.resetViewerState || (() => {}),
        clearDynaMutPoll: flat.clearDynaMutPoll || (() => {}),
        clearDynaMutComparePoll: flat.clearDynaMutComparePoll || (() => {})
      }
    }
  };
}

export function useAnalysisPipeline() {
  const { dispatch, startTraceRun, addTraceSpan, updateTraceSpan, finishTraceRun } = useDevConsole();
  const analysisAbortRef = useRef<AbortController | null>(null);
  const mutantFoldAbortRef = useRef<AbortController | null>(null);
  const compareFoldAbortRef = useRef<AbortController | null>(null);
  const pendingResiduesRef = useRef<Set<string>>(new Set());
  const activeRequestIdRef = useRef<number>(0);
  const activeTraceIdRef = useRef<string | null>(null);
  const traceStartRef = useRef<number>(0);

  const [homologs, setHomologs] = useState<PdbHomolog[]>([]);
  const [isHomologsLoading, setIsHomologsLoading] = useState(false);
  const [computedResiduesCache, setComputedResiduesCache] = useState<Record<string, NearestResidue[]>>({});
  const [disruptionPredictor, setDisruptionPredictor] = useState<{ level: "high" | "low" | "unknown"; reason: string; plddt: number | null } | null>(null);

  const abortAllPendingRequests = useCallback((clearDynaMutPoll?: () => void, clearDynaMutComparePoll?: () => void) => {
    activeRequestIdRef.current += 1;
    if (clearDynaMutPoll) clearDynaMutPoll();
    if (clearDynaMutComparePoll) clearDynaMutComparePoll();
    if (analysisAbortRef.current) {
      try {
        analysisAbortRef.current.abort();
      } catch (e) {
        console.error("Failed to abort analysis request", e);
      }
    }
    if (mutantFoldAbortRef.current) {
      try {
        mutantFoldAbortRef.current.abort();
      } catch (e) {
        console.error("Failed to abort mutant fold request", e);
      }
    }
    if (compareFoldAbortRef.current) {
      try {
        compareFoldAbortRef.current.abort();
      } catch (e) {
        console.error("Failed to abort compare fold request", e);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      abortAllPendingRequests();
    };
  }, [abortAllPendingRequests]);

  const getTraceContext = useCallback((): TraceContext => ({
    activeTraceId: activeTraceIdRef.current,
    traceStart: traceStartRef.current,
    addTraceSpan,
    finishTraceRun
  }), [addTraceSpan, finishTraceRun]);

  const translateVariantNotation = useCallback(async (
    notation: string,
    signal: AbortSignal,
    options: Pick<StructuredPipelineOptions, "apiClient"> & {
      setAnalysisState: PipelineAnalysisSink["setAnalysisState"];
      setLoadingStep: PipelineAnalysisSink["setLoadingStep"];
    }
  ) => {
    return translateVariantNotationService(
      notation,
      options.apiClient,
      signal,
      {
        setAnalysisState: options.setAnalysisState,
        setLoadingStep: options.setLoadingStep
      },
      getTraceContext()
    );
  }, [getTraceContext]);

  const fetchHomologs = useCallback(async (
    targetUniprot: string,
    apiClient: any,
    signal?: AbortSignal,
    pos?: number
  ) => {
    return fetchHomologStructures(
      targetUniprot,
      apiClient,
      { setHomologs, setIsHomologsLoading },
      pos,
      signal,
      getTraceContext()
    );
  }, [getTraceContext]);

  const fetchNearestResidues = useCallback(async (
    targetUniprot: string,
    targetVariant: string,
    residueIndex: number,
    pdbText: string,
    apiClient: any,
    signal?: AbortSignal
  ) => {
    return fetchNearestResiduesService(
      targetUniprot,
      targetVariant,
      residueIndex,
      pdbText,
      apiClient,
      computedResiduesCache,
      setComputedResiduesCache,
      pendingResiduesRef.current,
      signal
    );
  }, [computedResiduesCache]);

  const fetchPocketData = useCallback(async (
    targetUniprot: string,
    residueIndex: number,
    pdbText: string,
    apiClient: any,
    setIsPocketLoading: (loading: boolean) => void,
    setPocketError: (err: string | null) => void,
    setComputedPocket: (pocket: any) => void,
    signal?: AbortSignal
  ) => {
    return fetchBindingPocket(
      targetUniprot,
      residueIndex,
      pdbText,
      apiClient,
      { setIsPocketLoading, setPocketError, setComputedPocket },
      signal,
      getTraceContext()
    );
  }, [getTraceContext]);

  const executeAnalysis = async (
    targetGeneArg: string,
    targetVariantArg: string,
    targetUniprotArg?: string,
    providedSignal?: AbortSignal,
    options?: UseAnalysisPipelineOptions
  ) => {
    if (!options) return;
    const normalizedOptions = normalizePipelineOptions(options);
    const { structure: structureSink, analysis: analysisSink } = normalizedOptions.sinks;

    abortAllPendingRequests(structureSink.clearDynaMutPoll, structureSink.clearDynaMutComparePoll);
    const requestId = ++activeRequestIdRef.current;

    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const activeSignal = controller.signal;

    const cached = getCachedVariant(targetGeneArg, targetVariantArg);
    if (cached?.analysisResult) {
      analysisSink.setAnalysisState({ isLoading: false, error: null, result: cached.analysisResult });
      analysisSink.setIsBiophysicalLoading(false);
      analysisSink.setIsClinicalLoading(false);
    } else {
      analysisSink.setAnalysisState({ isLoading: true, error: null, result: null });
      analysisSink.setIsBiophysicalLoading(true);
      analysisSink.setIsClinicalLoading(true);
    }

    const traceQuery = `${targetGeneArg} ${targetVariantArg}`.trim();
    const traceId = startTraceRun(traceQuery || "Variant Analysis");
    activeTraceIdRef.current = traceId;
    traceStartRef.current = performance.now();

    try {
      await executeFullAnalysisWorkflow({
        targetGeneArg,
        targetVariantArg,
        targetUniprotArg,
        options: normalizedOptions,
        activeSignal,
        requestId,
        getActiveRequestId: () => activeRequestIdRef.current,
        getTraceContext,
        fetchHomologs,
        fetchPocketData,
        mutantFoldAbortRef
      });
      if (activeTraceIdRef.current && activeRequestIdRef.current === requestId) {
        finishTraceRun(activeTraceIdRef.current, "completed");
      }
    } catch (err: any) {
      if (activeTraceIdRef.current && activeRequestIdRef.current === requestId) {
        finishTraceRun(activeTraceIdRef.current, "failed");
      }
    }
  };

  return {
    analysisAbortRef,
    mutantFoldAbortRef,
    compareFoldAbortRef,
    pendingResiduesRef,
    activeRequestIdRef,
    homologs,
    setHomologs,
    isHomologsLoading,
    setIsHomologsLoading,
    computedResiduesCache,
    setComputedResiduesCache,
    disruptionPredictor,
    setDisruptionPredictor,
    abortAllPendingRequests,
    translateVariantNotation,
    fetchHomologs,
    fetchNearestResidues,
    fetchPocketData,
    executeAnalysis
  };
}

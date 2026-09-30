import { useCallback } from "react";
import {
  toFoldxMutation,
  isGenomicOrCdnaNotation,
  translateVariantNotation as translateVariantNotationService
} from "../services/pipeline/notationService.ts";
import {
  fetchHomologStructures,
  fetchBindingPocket,
  fetchNearestResidues as fetchNearestResiduesService
} from "../services/pipeline/structureService.ts";
import { executeFullAnalysisWorkflow } from "../services/pipeline/workflowOrchestrator.ts";
import { getCachedVariant } from "../services/pipeline/variantCache.ts";
import { isBuildDegradedResult } from "../shared/contracts.ts";
import {
  PipelineAnalysisSink,
  PipelineStructureSink,
  StructuredPipelineOptions,
  UseAnalysisPipelineOptions
} from "../services/pipeline/types.ts";
import {
  createAnalysisVersion
} from "../services/pipeline/pipelineStateFactory.ts";
import { usePipelineAbortController } from "./pipeline/usePipelineAbortController.ts";
import { useStructuralInspectors } from "./pipeline/useStructuralInspectors.ts";
import { usePipelineTelemetry } from "./pipeline/usePipelineTelemetry.ts";

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
      serverGeminiReady: options.serverGeminiReady,
      userDirections: options.userDirections,
      sinks: options.sinks
    };
  }

  const flat = options as any;
  return {
    fetchWithAuth: flat.fetchWithAuth,
    apiClient: flat.apiClient,
    settings: flat.settings,
    serverGeminiReady: flat.serverGeminiReady,
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
        setIsStructuralLoading: flat.setIsStructuralLoading || (() => {}),
        setIsClinicalLoading: flat.setIsClinicalLoading || (() => {}),
        setIsNarrativeLoading: flat.setIsNarrativeLoading || (() => {})
      },
      biophysical: {
        setIsFolding: flat.setIsFolding || (() => {}),
        setFoldingProgress: flat.setFoldingProgress,
        setFoldingError: flat.setFoldingError || (() => {}),
        setFoldingStatus: flat.setFoldingStatus || (() => {}),
        setMutantPdb: flat.setMutantPdb || (() => {}),
        setFoldxWtPdb: flat.setFoldxWtPdb,
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
        // Provenance of `pdbText` — kept apart from FoldX's template (see `pdbTextProvenance`).
        setPdbTextProvenance: flat.setPdbTextProvenance || (() => {}),
        setComputedPocket: flat.setComputedPocket || (() => {}),
        setIsPocketLoading: flat.setIsPocketLoading || (() => {}),
        setPocketError: flat.setPocketError || (() => {}),
        setHomologs: flat.setHomologs || (() => {}),
        setIsHomologsLoading: flat.setIsHomologsLoading || (() => {}),
        setComputedResiduesCache: flat.setComputedResiduesCache || (() => {}),
        setDisruptionPredictor: flat.setDisruptionPredictor || (() => {}),
        resetViewerState: flat.resetViewerState || (() => {}),
        clearDynaMutPoll: flat.clearDynaMutPoll || (() => {}),
        clearDynaMutComparePoll: flat.clearDynaMutComparePoll || (() => {}),
        clearDdmutPoll: flat.clearDdmutPoll || (() => {}),
        clearDdmutComparePoll: flat.clearDdmutComparePoll || (() => {}),
        clearThermoMpnnPoll: flat.clearThermoMpnnPoll || (() => {}),
        clearThermoMpnnComparePoll: flat.clearThermoMpnnComparePoll || (() => {})
      }
    }
  };
}

/**
 * High-level orchestration hook for variant analysis pipeline.
 * Composes specialized lifecycle, inspector, and telemetry sub-hooks.
 */
export function useAnalysisPipeline() {
  const {
    activeTraceIdRef,
    traceStartRef,
    getTraceContext,
    startPipelineTrace,
    finishPipelineTrace
  } = usePipelineTelemetry();

  const {
    analysisAbortRef,
    mutantFoldAbortRef,
    compareFoldAbortRef,
    activeRequestIdRef,
    abortAllPendingRequests
  } = usePipelineAbortController();

  const {
    homologs,
    setHomologs,
    isHomologsLoading,
    setIsHomologsLoading,
    computedResiduesCache,
    setComputedResiduesCache,
    disruptionPredictor,
    setDisruptionPredictor,
    pendingResiduesRef
  } = useStructuralInspectors();

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
    pos?: number,
    sink?: Pick<PipelineStructureSink, "setHomologs" | "setIsHomologsLoading">
  ) => {
    const combinedSink = {
      setHomologs: (val: any) => {
        setHomologs(val);
        if (sink?.setHomologs) {
          sink.setHomologs(val);
        }
      },
      setIsHomologsLoading: (val: any) => {
        setIsHomologsLoading(val);
        if (sink?.setIsHomologsLoading) {
          sink.setIsHomologsLoading(val);
        }
      }
    };
    return fetchHomologStructures(
      targetUniprot,
      apiClient,
      combinedSink,
      pos,
      signal,
      getTraceContext()
    );
  }, [getTraceContext, setHomologs, setIsHomologsLoading]);

  const fetchNearestResidues = useCallback(async (
    targetUniprot: string,
    targetVariant: string,
    residueIndex: number,
    pdbText: string,
    apiClient: any,
    signal?: AbortSignal,
    sink?: Pick<PipelineStructureSink, "setComputedResiduesCache">
  ) => {
    const combinedSetCache = (updater: any) => {
      setComputedResiduesCache(updater);
      if (sink?.setComputedResiduesCache) {
        sink.setComputedResiduesCache(updater);
      }
    };
    return fetchNearestResiduesService(
      targetUniprot,
      targetVariant,
      residueIndex,
      pdbText,
      apiClient,
      computedResiduesCache,
      combinedSetCache,
      pendingResiduesRef.current,
      signal
    );
  }, [computedResiduesCache, setComputedResiduesCache, pendingResiduesRef]);

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

    abortAllPendingRequests(
      structureSink.clearDynaMutPoll,
      structureSink.clearDynaMutComparePoll,
      structureSink.clearDdmutPoll,
      structureSink.clearDdmutComparePoll,
      structureSink.clearThermoMpnnPoll,
      structureSink.clearThermoMpnnComparePoll
    );

    /**
     * Clear the run state an abort leaves behind — BEFORE the new run claims its request id.
     *
     * `abortAllPendingRequests` bumps the id and aborts, and `foldxService`'s finally is
     * `!signal.aborted && getActiveRequestId() === requestId`. After an abort BOTH clauses are false, so
     * the run correctly declines to write and NOTHING owns the flag. If the new run then skips Stage 3 —
     * which is exactly what the search form does, because `lastFetchedFoldRef` still holds this variant,
     * the backfill is cooldown-blocked, and the early return needs no FoldX — no dispatch ever sets or
     * clears it, and `isFolding` stays true while all six engines render "running" with no way back.
     *
     * This is the only place in the app that aborts and then starts a run, so it is the one point where
     * the clear cannot race a newer run. It must NOT move into the abort itself: `workflowOrchestrator`
     * aborts the old fold controller and then SYNCHRONOUSLY calls `executeFoldxPipeline`, whose
     * `setIsFolding(true)` runs before its first await, so a run observing its abort late would wipe the
     * NEW run's flag.
     */
    normalizedOptions.sinks.biophysical.setIsFolding(false);
    // ...and the phase goes with it: `setIsFolding` clears progress, but a sink supplied by an
    // older caller (or a test double) may not implement the pairing.
    normalizedOptions.sinks.biophysical.setFoldingProgress?.(null);
    /**
     * The companion, and it is not optional.
     *
     * Clearing the flag alone converts a permanent "Running" into a permanent FoldX "no result" that
     * pressing Search again cannot fix: `lastFetchedFoldRef` still holds this variant, so Stage 3 is
     * skipped on every retry and nothing re-attempts the fold. Clearing the ref re-arms it.
     */
    normalizedOptions.sinks.biophysical.lastFetchedFoldRef.current = "";

    const requestId = ++activeRequestIdRef.current;

    const controller = new AbortController();
    if (providedSignal) {
      if (providedSignal.aborted) {
        controller.abort();
      } else {
        providedSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }
    analysisAbortRef.current = controller;
    const activeSignal = controller.signal;

    const cached = getCachedVariant(targetGeneArg, targetVariantArg);
    /**
     * A cached bundle whose evidence was built against a non-canonical reference is NOT painted.
     *
     * It used to be painted unconditionally, so clicking a recent analysis whose coordinate could not
     * be lifted at the time restored its verdict verbatim — an older coordinate chip, an older target
     * build, and population evidence the source had refused ("PM2 withheld: this coordinate's build is
     * not one gnomAD r4 serves") — even though the current intake lifts that coordinate and scores it.
     * The bundle is skipped rather than deleted: the run below re-fetches, and the heavy build-free
     * artefacts (PDB text, energetics) are still restored from it.
     */
    const servableCachedResult =
      cached?.analysisResult && !isBuildDegradedResult(cached.analysisResult)
        ? cached.analysisResult
        : null;
    if (servableCachedResult) {
      analysisSink.setAnalysisState({ isLoading: false, error: null, result: servableCachedResult });
      analysisSink.setIsBiophysicalLoading(false);
      analysisSink.setIsStructuralLoading(false);
      analysisSink.setIsClinicalLoading(false);
    } else {
      analysisSink.setAnalysisState({ isLoading: true, error: null, result: null });
      analysisSink.setIsBiophysicalLoading(true);
      analysisSink.setIsStructuralLoading(true);
      analysisSink.setIsClinicalLoading(true);
    }

    const traceQuery = `${targetGeneArg} ${targetVariantArg}`.trim();
    startPipelineTrace(traceQuery);

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
        fetchHomologs: (u, api, sig, p) => fetchHomologs(u, api, sig, p, normalizedOptions.sinks.structure),
        fetchPocketData,
        mutantFoldAbortRef
      });
      if (activeTraceIdRef.current && activeRequestIdRef.current === requestId) {
        finishPipelineTrace("completed");
      }
    } catch (err: any) {
      if (activeTraceIdRef.current && activeRequestIdRef.current === requestId) {
        finishPipelineTrace("failed");
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

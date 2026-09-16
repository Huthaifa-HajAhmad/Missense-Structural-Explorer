import { parseMutationResidues } from "../../variantAnalysisUtils";
import { FALLBACK_ANALYSES, FALLBACK_INSIGHTS } from "../../data";
import {
  isGenomicOrCdnaNotation,
  translateVariantNotation as translateVariantNotationService
} from "./notationService";
import { fetchPdbCoordinates } from "./structureService";
import { executeFoldxPipeline } from "./foldxService";
import {
  fetchBiophysicalAnalysis,
  fetchProgressiveLandscape,
  fetchProgressiveStructuralAssessments
} from "./biophysicalService";
import { generateClinicalNarrative } from "./narrativeService";
import {
  StructuredPipelineOptions,
  TraceContext
} from "./types";
import {
  createPlaceholderAnalysisState,
  createCompletedAnalysisState,
  createBiophysicalErrorAnalysisState,
  createTopLevelErrorAnalysisState,
  createDemoFallbackAnalysisState,
  PipelineStateBaseParams
} from "./pipelineStateFactory";
import { getCachedVariant, setCachedVariant, isFallbackNarrative } from "./variantCache";

export interface WorkflowOrchestratorParams {
  targetGeneArg: string;
  targetVariantArg: string;
  targetUniprotArg?: string;
  options: StructuredPipelineOptions;
  activeSignal: AbortSignal;
  requestId: number;
  getActiveRequestId: () => number;
  getTraceContext: () => TraceContext;
  fetchHomologs: (targetUniprot: string, apiClient: any, signal?: AbortSignal, pos?: number) => Promise<any>;
  fetchPocketData: (
    targetUniprot: string,
    residueIndex: number,
    pdbText: string,
    apiClient: any,
    setIsPocketLoading: (loading: boolean) => void,
    setPocketError: (err: string | null) => void,
    setComputedPocket: (pocket: any) => void,
    signal?: AbortSignal
  ) => Promise<any>;
  mutantFoldAbortRef: { current: AbortController | null };
}

export async function executeFullAnalysisWorkflow({
  targetGeneArg,
  targetVariantArg,
  targetUniprotArg,
  options,
  activeSignal,
  requestId,
  getActiveRequestId,
  getTraceContext,
  fetchHomologs,
  fetchPocketData,
  mutantFoldAbortRef
}: WorkflowOrchestratorParams): Promise<void> {
  const { fetchWithAuth, apiClient, settings, userDirections, sinks } = options;
  const { search: searchSink, analysis: analysisSink, biophysical: biophysicalSink, structure: structureSink } = sinks;

  let targetGene = targetGeneArg.trim();
  let targetVariant = targetVariantArg.trim();
  let targetUniprot = (targetUniprotArg || "").trim();
  let transcriptMeta: any = null;
  let residueIndex: number | undefined;

  try {
    // Stage 1: Notation Resolution
    if (isGenomicOrCdnaNotation(targetVariant)) {
      const transResult = await translateVariantNotationService(
        targetVariant,
        apiClient,
        activeSignal,
        {
          setAnalysisState: analysisSink.setAnalysisState,
          setLoadingStep: analysisSink.setLoadingStep
        },
        getTraceContext()
      );
      targetGene = transResult.gene;
      targetVariant = transResult.variant;
      targetUniprot = transResult.uniprotId;
      transcriptMeta = transResult.transcriptMeta;
    }

    // Stage 1.5: Resolve UniProt accession if not provided
    if (!targetUniprot && targetGene && apiClient?.resolveGene) {
      try {
        analysisSink.setLoadingStep("Step 1/4: Resolving gene mapping...");
        const geneRes = await apiClient.resolveGene(targetGene, activeSignal);
        if (geneRes?.uniprotId) {
          targetUniprot = geneRes.uniprotId;
        }
      } catch (geneErr) {
        console.warn("[WorkflowOrchestrator] Gene resolution error:", geneErr);
      }
    }

    searchSink.setGene(targetGene);
    searchSink.setVariant(targetVariant);
    searchSink.setUniprotId(targetUniprot);
    searchSink.setSearchVal(`${targetGene} ${targetVariant}`);
    searchSink.setCustomGene(targetGene);
    searchSink.setCustomVariant(targetVariant);
    searchSink.setCustomUniprot(targetUniprot);

    const posMatch = targetVariant.match(/\d+/);
    residueIndex = posMatch ? parseInt(posMatch[0], 10) : undefined;

    // Check high-fidelity client variant snapshot cache
    const cached = getCachedVariant(targetGene, targetVariant);
    if (cached) {
      if (cached.analysisResult) {
        analysisSink.setAnalysisState({
          isLoading: false,
          error: null,
          result: cached.analysisResult
        });
        analysisSink.setIsBiophysicalLoading(false);
        analysisSink.setIsStructuralLoading(false);
        analysisSink.setIsClinicalLoading(false);
        analysisSink.setIsNarrativeLoading(false);
      }
      if (cached.pdbText) {
        structureSink.setPdbText(cached.pdbText);
      }
      if (cached.mutantPdb) {
        biophysicalSink.setMutantPdb(cached.mutantPdb);
      }
      if (cached.foldedResidueIndex != null) biophysicalSink.setFoldedResidueIndex(cached.foldedResidueIndex);
      if (cached.foldingDdG != null) biophysicalSink.setFoldingDdG(cached.foldingDdG);
      if (cached.foldingEnergetics) biophysicalSink.setFoldingEnergetics(cached.foldingEnergetics);
      if (cached.foldingStatus) biophysicalSink.setFoldingStatus(cached.foldingStatus as any);
      const isStale = (Date.now() - (cached.timestamp || 0)) > 300000;
      const resolveRestoredStatus = (status: string | null | undefined, score: number | null | undefined) => {
        if (score != null) return "done";
        if (status === "pending" && isStale) return "unavailable";
        return status ?? null;
      };

      biophysicalSink.setDynamut2JobId(cached.dynamut2JobId ?? null);
      biophysicalSink.setDynamut2Status(resolveRestoredStatus(cached.dynamut2Status, cached.foldingEnergetics?.dynamut2) as any);
      biophysicalSink.setDdmutJobId(cached.ddmutJobId ?? null);
      biophysicalSink.setDdmutStatus(resolveRestoredStatus(cached.ddmutStatus, cached.foldingEnergetics?.ddmut) as any);
      biophysicalSink.setThermompnnJobId(cached.thermompnnJobId ?? null);
      biophysicalSink.setThermompnnStatus(resolveRestoredStatus(cached.thermompnnStatus, cached.foldingEnergetics?.thermompnn) as any);
      biophysicalSink.setThermompnnError(cached.thermompnnError ?? null);
      if (cached.computedPocket) {
        structureSink.setComputedPocket(cached.computedPocket);
      }
      if (cached.homologs) {
        structureSink.setHomologs(cached.homologs);
      }
      if (cached.disruptionPredictor) {
        structureSink.setDisruptionPredictor(cached.disruptionPredictor);
      }

      // Check if previous cached narrative was a fallback placeholder but we now have active Gemini credentials
      const isFallback = isFallbackNarrative(
        cached.analysisResult?.analysis,
        cached.analysisResult?.isFallback,
        cached.analysisResult?.fallbackReason
      );
      const hasActiveGemini = Boolean(
        (settings?.geminiSessionId && settings?.geminiSessionExpiresAt && settings.geminiSessionExpiresAt > Date.now()) ||
        settings?.geminiApiKey ||
        settings?.serverGeminiReady ||
        options?.serverGeminiReady
      );
      const needsNarrativeBackfill = isFallback && hasActiveGemini;

      // If cached bundle contains a complete analysis and no custom user instructions were requested,
      // and does not require a narrative backfill/upgrade, short-circuit downstream re-fetches.
      const hasCompleteAnalysis = Boolean(
        cached.analysisResult?.analysis &&
        !cached.analysisResult.analysis.includes("in progress") &&
        !needsNarrativeBackfill &&
        (cached.analysisResult.predictorData || cached.analysisResult.insights)
      );

      if (hasCompleteAnalysis && (!userDirections || !userDirections.trim())) {
        searchSink.addToHistory(targetGene, targetVariant, targetUniprot);
        if (residueIndex != null) {
          searchSink.setSelectedResidueIndex(residueIndex);
        }
        analysisSink.setLoadingStep("Analysis complete!");
        analysisSink.setIsBiophysicalLoading(false);
        analysisSink.setIsStructuralLoading(false);
        analysisSink.setIsClinicalLoading(false);
        analysisSink.setIsNarrativeLoading(false);

        if ((!cached.homologs || cached.homologs.length === 0) && targetUniprot) {
          fetchHomologs(targetUniprot, apiClient, activeSignal, residueIndex ?? undefined);
        }
        if (!cached.pdbText) {
          fetchPdbCoordinates(
            targetGene,
            targetVariant,
            targetUniprot,
            residueIndex,
            apiClient,
            activeSignal,
            getTraceContext()
          ).then((pdb: any) => {
            if (pdb && getActiveRequestId() === requestId && !activeSignal.aborted) {
              structureSink.setPdbText(pdb);
              if (residueIndex && (!cached?.computedPocket || cached.computedPocket.status === "unavailable")) {
                fetchPocketData(
                  targetUniprot,
                  residueIndex,
                  pdb,
                  apiClient,
                  structureSink.setIsPocketLoading,
                  structureSink.setPocketError,
                  structureSink.setComputedPocket,
                  activeSignal
                );
              }
            }
          });
        }

        // P0-CRITICAL: If the cached variant snapshot lacks mutantPdb or StabilityOracle energetics,
        // or if previous run was failed/unavailable, dispatch executeFoldxPipeline to compute / backfill biophysics without blocking the UI.
        const needsBiophysicsBackfill = !cached.mutantPdb || !cached.foldingEnergetics || cached.foldingEnergetics?.stabilityoracle == null || cached.foldingStatus === "failed" || cached.foldingStatus === "unavailable";
        if (needsBiophysicsBackfill && posMatch && targetUniprot) {
          executeFoldxPipeline({
            gene: targetGene,
            uniprotId: targetUniprot,
            variant: targetVariant,
            residueIndex: residueIndex ?? null,
            conditions: settings.biophysicsConditions,
            fetchWithAuth,
            sink: biophysicalSink,
            signal: activeSignal,
            requestId,
            getActiveRequestId
          });
        }

        return;
      }
    } else {
      structureSink.resetViewerState();
    }

    fetchHomologs(targetUniprot, apiClient, activeSignal, residueIndex ?? undefined);

    // Stage 2: 3D Structure Fetch
    if (!cached?.pdbText) {
      analysisSink.setLoadingStep("Step 2/4: Fetching AlphaFold & PDB 3D structures...");
    }
    const pdbWarmupPromise = fetchPdbCoordinates(
      targetGene,
      targetVariant,
      targetUniprot,
      residueIndex,
      apiClient,
      activeSignal,
      getTraceContext()
    );

    // Stage 3: Concurrent FoldX Simulation Pipeline
    const foldKey = `${targetUniprot}_${targetVariant}`;
    if (biophysicalSink.lastFetchedFoldRef.current !== foldKey && posMatch) {
      biophysicalSink.lastFetchedFoldRef.current = foldKey;

      if (mutantFoldAbortRef.current) {
        try {
          mutantFoldAbortRef.current.abort();
        } catch (e) {
          console.error("[Pipeline] Failed to abort previous mutant fold request", e);
        }
      }
      const foldController = new AbortController();
      mutantFoldAbortRef.current = foldController;
      const foldTimeoutId = setTimeout(() => {
        foldController.abort();
        if (getActiveRequestId() === requestId) {
          biophysicalSink.setFoldingError("Simulation timed out after 5 minutes.");
          biophysicalSink.setFoldingStatus("failed");
          biophysicalSink.setIsFolding(false);
        }
      }, 300000);

      executeFoldxPipeline({
        gene: targetGene,
        uniprotId: targetUniprot,
        variant: targetVariant,
        residueIndex: residueIndex ?? null,
        conditions: settings.biophysicsConditions,
        fetchWithAuth,
        sink: biophysicalSink,
        signal: foldController.signal,
        requestId,
        getActiveRequestId
      }).finally(() => {
        clearTimeout(foldTimeoutId);
      });
    }

    // Stage 4: Multi-Model Biophysics Suite
    analysisSink.setLoadingStep("Step 3/4: Computing AI biophysical assessment...");
    const biophysicalPromise = fetchBiophysicalAnalysis(
      { gene: targetGene, variant: targetVariant, uniprotId: targetUniprot },
      apiClient,
      activeSignal,
      (chunkData: any) => {
        if (getActiveRequestId() !== requestId || activeSignal.aborted) return;
        analysisSink.setAnalysisState((prev: any) => {
          if (!prev.result) return prev;
          return {
            ...prev,
            result: {
              ...prev.result,
              ...chunkData,
              metadata: {
                ...prev.result.metadata,
                ...(chunkData.metadata || {})
              }
            }
          };
        });
      },
      getTraceContext()
    );

    const parsedResidues = parseMutationResidues(targetVariant);
    analysisSink.setIsNarrativeLoading(false);

    const baseParams: PipelineStateBaseParams = {
      gene: targetGene,
      variant: targetVariant,
      uniprotId: targetUniprot,
      residueIndex: residueIndex ?? null,
      wildType: parsedResidues?.wt || "",
      mutant: parsedResidues?.mut || "",
      transcriptMeta
    };

    pdbWarmupPromise.then((pdb: any) => {
      if (pdb && getActiveRequestId() === requestId && !activeSignal.aborted) {
        structureSink.setPdbText(pdb);
        if (residueIndex && (!cached?.computedPocket || cached.computedPocket.status === "unavailable")) {
          fetchPocketData(
            targetUniprot,
            residueIndex,
            pdb,
            apiClient,
            structureSink.setIsPocketLoading,
            structureSink.setPocketError,
            structureSink.setComputedPocket,
            activeSignal
          );
        }
        analysisSink.setAnalysisState((prev: any) => {
          if (prev.result) return prev;
          return createPlaceholderAnalysisState(baseParams);
        });
      }
    });

    const triggerNarrative = (bpResult: any) => {
      generateClinicalNarrative(
        {
          gene: targetGene,
          variant: targetVariant,
          uniprotId: targetUniprot,
          userDirections,
          settings,
          bpResult
        },
        apiClient,
        {
          addToHistory: searchSink.addToHistory,
          setSelectedResidueIndex: searchSink.setSelectedResidueIndex
        },
        analysisSink,
        activeSignal,
        requestId,
        getActiveRequestId,
        getTraceContext()
      );
    };

    biophysicalPromise
      .then((resResult: any) => {
        if (getActiveRequestId() !== requestId || activeSignal.aborted) return;
        analysisSink.setIsBiophysicalLoading(false);
        analysisSink.setIsClinicalLoading(false);

        if (resResult) {
          if (!targetUniprot && resResult.metadata?.uniprotId) {
            targetUniprot = resResult.metadata.uniprotId;
            searchSink.setUniprotId(targetUniprot);
            baseParams.uniprotId = targetUniprot;
          }

          analysisSink.setAnalysisState(createCompletedAnalysisState(resResult, baseParams));
          triggerNarrative(resResult);

          // Progressive query for Landscape Data
          fetchProgressiveLandscape(
            { gene: targetGene, variant: targetVariant, uniprotId: targetUniprot },
            apiClient,
            activeSignal,
            analysisSink.setAnalysisState,
            requestId,
            getActiveRequestId
          );

          // Progressive query for Deep Structural Models (ESM3, ESMC, ESM2-3B, SaProt)
          fetchProgressiveStructuralAssessments(
            {
              gene: targetGene,
              variant: targetVariant,
              uniprotId: targetUniprot,
              acmgWeighting: settings.acmgWeighting,
              saprotEngine: settings.saprotEngine
            },
            apiClient,
            activeSignal,
            analysisSink.setAnalysisState,
            requestId,
            getActiveRequestId,
            getTraceContext(),
            analysisSink.setIsStructuralLoading
          );
        } else {
          throw new Error("Biophysical result payload empty.");
        }
      })
      .catch((err: any) => {
        if (getActiveRequestId() !== requestId || activeSignal.aborted) return;
        console.error("Biophysical analysis error:", err);
        analysisSink.setIsBiophysicalLoading(false);
        analysisSink.setIsStructuralLoading(false);
        analysisSink.setIsClinicalLoading(false);
        analysisSink.setIsNarrativeLoading(false);

        const fallbackKey = `${targetGene}_${targetVariant}`;
        if (FALLBACK_ANALYSES[fallbackKey] || FALLBACK_INSIGHTS[fallbackKey]) {
          analysisSink.setAnalysisState(
            createDemoFallbackAnalysisState(FALLBACK_ANALYSES[fallbackKey], FALLBACK_INSIGHTS[fallbackKey] || null, baseParams)
          );
        } else {
          analysisSink.setAnalysisState(
            createBiophysicalErrorAnalysisState(err?.message || "Biophysical analysis failed", baseParams)
          );
        }
      });
  } catch (err: any) {
    if (getActiveRequestId() === requestId && !activeSignal.aborted) {
      console.error("Top-level pipeline error:", err);
      // Defensive: when notation translation fails, `targetVariant` is still a genomic
      // coordinate and this helper throws. Letting that escape would skip the error-state
      // assignment below and leave the UI stuck on a loading spinner with no message, so
      // treat unparseable residues as absent rather than fatal.
      let parsedResidues: { wt: string; mut: string } | null = null;
      try {
        parsedResidues = parseMutationResidues(targetVariant);
      } catch {
        parsedResidues = null;
      }
      const baseParams: PipelineStateBaseParams = {
        gene: targetGene,
        variant: targetVariant,
        uniprotId: targetUniprot,
        residueIndex: residueIndex ?? null,
        wildType: parsedResidues?.wt || "",
        mutant: parsedResidues?.mut || "",
        transcriptMeta
      };
      analysisSink.setAnalysisState(createTopLevelErrorAnalysisState(err?.message || "Unknown error", baseParams));
      analysisSink.setIsBiophysicalLoading(false);
      analysisSink.setIsStructuralLoading(false);
      analysisSink.setIsClinicalLoading(false);
      analysisSink.setIsNarrativeLoading(false);
    }
  }
}

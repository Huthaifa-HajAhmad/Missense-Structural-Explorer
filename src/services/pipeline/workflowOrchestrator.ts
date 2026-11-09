import { parseMutationResidues } from "../../variantAnalysisUtils";
import { FALLBACK_ANALYSES, FALLBACK_INSIGHTS } from "../../data";
import { shouldRunBiophysics } from "./biophysicsRetryPolicy";
import {
  needsNotationResolution,
  translateVariantNotation as translateVariantNotationService
} from "./notationService";
import { fetchPdbCoordinates } from "./structureService";
import { executeFoldxPipeline } from "./foldxService";
import {
  fetchBiophysicalAnalysis,
  fetchProgressiveLandscape,
  fetchProgressiveStructuralAssessments,
  fetchProgressiveMultimer,
  fetchProgressivePpi
} from "./biophysicalService";
import { generateClinicalNarrative } from "./narrativeService";
import { mergeResultPatch, mergeCompletedCore, settleUnreportedStages, type StageOutcome } from "./resultMerge";
import { refusalAttachmentsFromError } from "./refusalAttachments";
import { isServableStoredResult, narrativeNeedsBackfill, NO_RESTORED_REMOTE_STATE, restoreStoredArtifacts, stagesToResume, type RestoredRemoteState, type ResumableStage } from "./storedAnalysis";
import { createAnalysisCacheContext, narrativeModeOf } from "./analysisContext";
import { createPipelineRun } from "./pipelineRun";
import { geminiCredentials } from "../../shared/geminiCredentials";
import { narrativeFreshness } from "../../shared/narrativeEvidence";
import { narrativeActivityOutstanding } from "../../shared/narrativeResynthesis";
import {
  StructuredPipelineOptions,
  TraceContext
} from "./types";
import { variantNumberingView } from "../../shared/numbering";
import {
  createPlaceholderAnalysisState,
  createCompletedAnalysisState,
  createBiophysicalErrorAnalysisState,
  createTopLevelErrorAnalysisState,
  createDemoFallbackAnalysisState,
  PipelineStateBaseParams
} from "./pipelineStateFactory";
import {
  getCachedVariant,
  setCachedVariant,
  recordBiophysicsAttempt,
  getBiophysicsAttemptedAt,
} from "./variantCache";

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
}: WorkflowOrchestratorParams): Promise<"completed" | "failed" | "aborted"> {
  const { fetchWithAuth, apiClient, settings, userDirections, numberingBasis, sinks } = options;
  const { search: searchSink, analysis: analysisSink, biophysical: biophysicalSink, structure: structureSink } = sinks;
  const runMetadata: Record<string, unknown> = { pipelineRunId: `${requestId}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`}` };
  const run = createPipelineRun({ requestId, signal: activeSignal, getActiveRequestId });
  const dispatchAnalysisState = analysisSink.setAnalysisState;
  const decorateState = (next: any) => !next?.result ? next : { ...next, result: { ...next.result, metadata: {
    ...next.result.metadata, ...runMetadata,
    pipelineStages: run.withAnnouncedStages(next.result.metadata?.pipelineStages)
  } } };
  const setAnalysisState = (updater: any) => {
    if (!run.acceptsEvidence()) return;
    if (typeof updater !== "function") return dispatchAnalysisState(decorateState(updater));
    dispatchAnalysisState((prev: any) => !run.acceptsEvidence() ? prev : decorateState(updater(prev)));
  };
  /** Lowers the run-level flags. The narrative flag stays up while a Re-synthesize request is still in flight. */
  const clearAnalysisActivity = () => {
    analysisSink.setIsBiophysicalLoading(false);
    analysisSink.setIsStructuralLoading(false);
    analysisSink.setIsClinicalLoading(false);
    if (!narrativeActivityOutstanding()) analysisSink.setIsNarrativeLoading(false);
  };
  const runAnalysisSink = { ...analysisSink, setAnalysisState };
  const getCurrentEvidenceForRun = () => {
    try {
      const snapshot = options.getCurrentEvidence?.();
      return snapshot?.result?.metadata?.pipelineRunId === runMetadata.pipelineRunId ? snapshot : null;
    } catch (error) {
      console.warn("[Pipeline] Current evidence snapshot unavailable:", error);
      return null;
    }
  };

  let targetGene = targetGeneArg.trim();
  let targetVariant = targetVariantArg.trim();
  /** The notation as submitted. Recorded in Recents only when resolution changed it. */
  const submittedVariant = targetVariantArg.trim();
  const historyQuery = () => (submittedVariant && submittedVariant !== targetVariant ? submittedVariant : undefined);
  let targetUniprot = (targetUniprotArg || "").trim();
  let transcriptMeta: any = null;
  let residueIndex: number | undefined;

  if (run.isStale()) {
    return "aborted";
  }

  try {
    // Stage 1: Notation Resolution
    // Covers coordinate/cDNA input (needs coordinate translation) AND accession-qualified protein
    // notation such as `NP_001032248.1:p.Lys281Asn`, whose residue numbers belong to a possibly
    // non-canonical isoform and must be mapped onto the canonical sequence before modelling.
    if (needsNotationResolution(targetVariant)) {
      const transResult = await translateVariantNotationService(
        targetVariant,
        apiClient,
        activeSignal,
        {
          setAnalysisState: setAnalysisState,
          setLoadingStep: analysisSink.setLoadingStep
        },
        getTraceContext(),
        // A bare `c.` names no transcript; the gene lets the server pin it to that gene's canonical (MANE Select) transcript.
        targetGene
      );
      if (run.isStale()) return "aborted";
      // Translation can legitimately answer without an accession. Keep the one we were given, but only
      // for the same gene: an accession from another gene would analyse the wrong protein.
      const sameGene = transResult.gene.toUpperCase() === targetGene.toUpperCase();
      targetUniprot = transResult.uniprotId || (sameGene ? targetUniprot : "");
      targetGene = transResult.gene;
      targetVariant = transResult.variant;
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
      if (run.isStale()) return "aborted";
    }

    /**
     * What goes back into the search fields is the REPORTED notation (the lab's numbering), in a form
     * this platform can re-resolve — not the canonical string the engines were handed.
     *
     * Two reasons: a clinician checks this field against their report, and the canonical notation meant
     * re-mapping by hand (the exact question that prompted this change); and a BARE reported notation
     * would be ambiguous for a gene like ACOT9, whereas `Q9Y305-4:p.Lys281Asn` declares its basis, so a
     * re-run resolves identically. The engines still receive `targetVariant` (canonical) below.
     */
    const numberingView = variantNumberingView({
      variant: targetVariant,
      uniprotId: targetUniprot,
      numberingRemap: transcriptMeta?.numberingRemap ?? null,
    });
    const fieldVariant = numberingView.reportedQualified ?? targetVariant;

    searchSink.setGene(targetGene);
    searchSink.setVariant(fieldVariant);
    searchSink.setUniprotId(targetUniprot);
    searchSink.setSearchVal(`${targetGene} ${fieldVariant}`);
    searchSink.setCustomGene(targetGene);
    searchSink.setCustomVariant(fieldVariant);
    searchSink.setCustomUniprot(targetUniprot);

    const posMatch = targetVariant.match(/\d+/);
    residueIndex = posMatch ? parseInt(posMatch[0], 10) : undefined;

    /**
     * Named once, HERE, because two consumers need it before the pipeline's own network calls:
     * the streamed chunk merge (which must be able to seed a result object the instant the first
     * chunk lands) and every state factory below.
     *
     * `parseMutationResidues` throws on a notation it cannot parse — a genomic coordinate reaches
     * this line when notation translation was skipped or failed — and letting that escape would
     * turn "unparseable notation" into an unhandled rejection with no error state. The outer catch
     * treats unparseable residues as absent for the same reason; this mirrors it.
     */
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

    const pipelineContext = createAnalysisCacheContext(targetUniprot, settings, transcriptMeta ?? {}, userDirections, numberingBasis);
    runMetadata.pipelineContext = pipelineContext;
    const requestParams = () => ({
      gene: targetGene, variant: targetVariant, uniprotId: targetUniprot,
      pipelineRunId: String(runMetadata.pipelineRunId),
      acmgWeighting: pipelineContext.acmgWeighting as "standard" | "conservative" | "strict-structural",
      saprotEngine: settings.saprotEngine,
      ...(transcriptMeta?.assembly ? { assembly: transcriptMeta.assembly } : {}),
      ...(transcriptMeta?.genomicCoordinates && transcriptMeta?.assembly ? { genomicCoordinates: transcriptMeta.genomicCoordinates } : {}),
      ...(transcriptMeta?.resolvedAssembly ? { resolvedAssembly: transcriptMeta.resolvedAssembly } : {}),
      ...(transcriptMeta?.liftedGenomicCoordinates ? { liftedGenomicCoordinates: transcriptMeta.liftedGenomicCoordinates } : {}),
      ...(numberingBasis ? { numberingBasis } : {})
    });
    const mode = narrativeModeOf(settings);
    const seedState = () => {
      const state = createPlaceholderAnalysisState(baseParams);
      return { ...state, result: { ...state.result, metadata: { ...state.result.metadata, ...runMetadata } } };
    };
    /** Applies a state change, then saves the result it produced. The save stays out of the state update. */
    const writeAndCache = (updater: (prev: any) => any, shouldCache: () => boolean = () => true) => {
      let latest: any = null;
      setAnalysisState((prev: any) => (latest = updater(prev)));
      if (latest?.result && shouldCache()) setCachedVariant(targetGene, targetVariant, targetUniprot, { analysisResult: latest.result });
    };
    const markCoordinates = (outcome: StageOutcome) => {
      if (!run.acceptsEvidence()) return;
      run.record({ type: "stage", stage: "coordinates", outcome });
      writeAndCache(
        (prev: any) => mergeResultPatch(prev, {}, undefined, "coordinates", outcome),
        () => getCachedVariant(targetGene, targetVariant)?.analysisResult?.metadata?.pipelineRunId === runMetadata.pipelineRunId
      );
    };
    /** Ends the run: lowers the flags and gives every stage still running a final outcome. */
    const settleRun = () => {
      if (run.isStale()) return;
      analysisSink.setLoadingStep("");
      clearAnalysisActivity();
      writeAndCache((prev: any) => {
        if (!prev?.result) return prev;
        // A stage announced after the last write exists only in the ledger until this point.
        const seeded = decorateState(prev).result;
        const stages = settleUnreportedStages(seeded);
        return { ...prev, result: stages ? { ...seeded, metadata: { ...seeded.metadata, pipelineStages: stages } } : seeded };
      });
    };
    const structureFailed = (error: any) => {
      if (run.isStale()) return;
      markCoordinates("error");
      console.warn("[Pipeline] Protein coordinates query failed:", error?.message || error);
    };
    // Protein artifacts are reusable; interpretation must match all scientific inputs.
    const hasActiveGemini = geminiCredentials(settings, Boolean(settings?.serverGeminiReady || options?.serverGeminiReady), Date.now()).canAttemptNarrative;
    const cached = getCachedVariant(targetGene, targetVariant, pipelineContext);
    /** The remote engines as restored, handed to FoldX so a failure settles against what the store holds. */
    let restoredRemoteState: RestoredRemoteState = NO_RESTORED_REMOTE_STATE;

    const conditionsContext = pipelineContext.simulationConditions;
    /** Starts FoldX. A run that reaches its end starts the retry cooldown; an abandoned one does not. */
    const dispatchFoldx = (signal: AbortSignal) => executeFoldxPipeline({
      gene: targetGene,
      uniprotId: targetUniprot,
      variant: targetVariant,
      residueIndex: residueIndex ?? null,
      conditions: settings.biophysicsConditions,
      fetchWithAuth,
      sink: biophysicalSink,
      signal,
      requestId,
      getActiveRequestId,
      // FoldX records its own span; the run's trace context is what lets it land in the waterfall.
      traceContext: getTraceContext(),
      // This variant's own restored state, so a failure settles against what the store holds and does
      // not mark an engine unavailable while the store is still polling for it.
      initialRemoteState: restoredRemoteState
    }).finally(() => {
      if (!signal.aborted && !run.isStale()) recordBiophysicsAttempt(targetGene, targetVariant, conditionsContext);
    });
    const shouldDispatchFoldx = () => shouldRunBiophysics(cached, getBiophysicsAttemptedAt(targetGene, targetVariant, conditionsContext));

    if (cached) {
      /**
       * The same guard as the pre-flight paint in `useAnalysisPipeline`, for the same reason: a bundle
       * whose evidence was built against a non-canonical reference must not be shown as the current
       * verdict. This site paints too (the pre-flight only covers the caller that reads the cache
       * before starting), so both are checked or the stale state returns through the other door.
       */
      if (isServableStoredResult(cached.analysisResult)) {
        setAnalysisState({
          isLoading: false,
          error: null,
          result: cached.analysisResult
        });
        clearAnalysisActivity();
      }
      restoredRemoteState = restoreStoredArtifacts(cached, biophysicalSink, structureSink);

      const narrativeMissing = mode === "automatic" && narrativeNeedsBackfill(cached.analysisResult);

      /*
       * If the cached bundle contains a complete analysis and does not require a narrative backfill or
       * upgrade, short-circuit the downstream re-fetches.
       *
       * Custom user instructions are NOT tested here, and that is deliberate: `pipelineContext` carries
       * `userDirections` into the cache read above (`getCachedVariant(targetGene, targetVariant,
       * pipelineContext)`), and `variantCache` drops `analysisResult` when the context does not match.
       * So a run whose directions changed cannot reach this branch at all — it misses the cache and
       * performs a full run and synthesis — while a re-run of the SAME directions short-circuits
       * instead of paying for a model call to reproduce a narrative it already has.
       */
      const hasCompleteAnalysis = isServableStoredResult(cached.analysisResult) && Boolean(
        cached.analysisResult.metadata?.pipelineStages?.core === "complete" || cached.analysisResult.predictorData || cached.analysisResult.ruleBasedInsights || cached.analysisResult.clinvar || cached.analysisResult.insights
      );

      if (hasCompleteAnalysis) {
        // Explicitly claim this valid snapshot for the new run before guarded progressive cache writes.
        setCachedVariant(targetGene, targetVariant, targetUniprot, { analysisResult: decorateState({ result: cached.analysisResult }).result });
        const cachedTasks: Promise<unknown>[] = [];
        searchSink.addToHistory(targetGene, targetVariant, targetUniprot, historyQuery());
        if (residueIndex != null) {
          searchSink.setSelectedResidueIndex(residueIndex);
        }
        analysisSink.setLoadingStep("Analysis complete!");
        clearAnalysisActivity();

        if ((!cached.homologs || cached.homologs.length === 0) && targetUniprot) {
          fetchHomologs(targetUniprot, apiClient, activeSignal, residueIndex ?? undefined);
        }
        if (!cached.pdbText) {
          markCoordinates("running");
          fetchPdbCoordinates(
            targetGene,
            targetVariant,
            targetUniprot,
            residueIndex,
            apiClient,
            activeSignal,
            getTraceContext()
          ).then(installStructure).catch(structureFailed);
        } else {
          markCoordinates("complete");
        }

        if (shouldDispatchFoldx() && posMatch && targetUniprot) {
          // The dispatch is deliberately not awaited, but it must never be a floating promise: a
          // rejection here would surface as an unhandled rejection and leave the spinner up with no
          // deadline and no message.
          void dispatchFoldx(activeSignal).catch(err => {
            // This path has no watchdog and no caller awaiting it, so a failure must be reported
            // here or the user is left with a spinner that never resolves and no explanation.
            if (run.isStale()) return;
            console.warn("[Backfill] Biophysics backfill failed:", err?.message ?? err);
            biophysicalSink.setFoldingError(
              `The background biophysics retry failed: ${err?.message ?? "unknown error"}`
            );
            biophysicalSink.setFoldingStatus("failed");
            biophysicalSink.setIsFolding(false);
          });
        }

        // Resume only unfinished enrichments, never re-run healthy core to repair optional prose.
        if (targetUniprot) {
          const start: Record<ResumableStage, () => Promise<unknown>> = {
            multimer: () => fetchProgressiveMultimer(requestParams(), fetchWithAuth, activeSignal, setAnalysisState, requestId, getActiveRequestId),
            // The partner lookups are resumed with the assembly: the Interfaces & PPI tab renders them cold otherwise.
            ppi: () => fetchProgressivePpi(requestParams(), fetchWithAuth, activeSignal, setAnalysisState, requestId, getActiveRequestId),
            landscape: () => fetchProgressiveLandscape(requestParams(), apiClient, activeSignal, setAnalysisState, requestId, getActiveRequestId),
            structural: () => fetchProgressiveStructuralAssessments(requestParams(), apiClient, activeSignal, setAnalysisState, requestId, getActiveRequestId, getTraceContext(), analysisSink.setIsStructuralLoading),
          };
          // Each resumed stage says it is running, so the rail does not look settled while it loads.
          for (const stage of stagesToResume(cached.analysisResult)) {
            setAnalysisState((prev: any) => mergeResultPatch(prev, {}, undefined, stage, "running"));
            cachedTasks.push(start[stage]());
          }
        }
        if (narrativeMissing || mode !== "automatic") cachedTasks.push(backfillNarrative(cached.analysisResult));
        await Promise.allSettled(cachedTasks);
        await refreshNarrativeOnce();
        settleRun();
        return run.isStale() ? "aborted" : "completed";
      }
    } else {
      structureSink.resetViewerState();
    }

    void fetchHomologs(targetUniprot, apiClient, activeSignal, residueIndex ?? undefined);

    // Independent enrichment starts after intake, not behind the slowest core source.
    // Results seed the workspace only when real evidence lands; final core merges by ownership.
    const enrichmentTasks: Promise<unknown>[] = [];
    let enrichmentStarted = false;
    const setEnrichmentState = (updater: any) => setAnalysisState((prev: any) =>
      typeof updater === "function" ? updater(prev?.result ? prev : seedState()) : updater
    );
    const startEnrichment = () => {
      if (enrichmentStarted || !targetUniprot || run.isStale()) return;
      enrichmentStarted = true;
      for (const stage of ["landscape", "structural", "multimer", "ppi"] as const) run.record({ type: "stage", stage, outcome: "running" });
      const params = requestParams();
      enrichmentTasks.push(Promise.resolve(fetchProgressiveLandscape(params, apiClient, activeSignal, setEnrichmentState, requestId, getActiveRequestId)));
      enrichmentTasks.push(fetchProgressiveStructuralAssessments(
        { ...params, saprotEngine: settings.saprotEngine }, apiClient, activeSignal,
        setEnrichmentState, requestId, getActiveRequestId, getTraceContext(), analysisSink.setIsStructuralLoading
      ));
      enrichmentTasks.push(fetchProgressiveMultimer(params, fetchWithAuth, activeSignal, setEnrichmentState, requestId, getActiveRequestId));
      // Partners, IntAct methods and STRING are independent of the assembly: prefetch them together
      // so the Interfaces & PPI tab is warm when it opens.
      enrichmentTasks.push(fetchProgressivePpi(params, fetchWithAuth, activeSignal, setEnrichmentState, requestId, getActiveRequestId));
    };

    // Stage 2: 3D Structure Fetch
    if (!cached?.pdbText) {
      analysisSink.setLoadingStep("Fetching protein structure...");
    }
    const initialStructureAccession = targetUniprot;
    if (targetUniprot) markCoordinates("running");
    const pdbWarmupPromise = targetUniprot ? fetchPdbCoordinates(
      targetGene,
      targetVariant,
      targetUniprot,
      residueIndex,
      apiClient,
      activeSignal,
      getTraceContext()
    ) : Promise.resolve(null);

    // Stage 3: Concurrent FoldX. Missing intake accessions are deferred until core resolves them.
    let foldStarted = false;
    const startFolding = () => {
      if (!targetUniprot || !posMatch || run.isStale()) return;
      if (foldStarted || !shouldDispatchFoldx()) return;
      foldStarted = true;
      mutantFoldAbortRef.current?.abort();
      const foldController = new AbortController();
      mutantFoldAbortRef.current = foldController;
      const onParentAbort = () => foldController.abort();
      activeSignal.addEventListener("abort", onParentAbort, { once: true });
      // foldxService owns queue/execution/poll budgets. An absolute watchdog would orphan queued work.
      void dispatchFoldx(foldController.signal).catch(error => {
        if (foldController.signal.aborted || run.isStale()) return;
        biophysicalSink.setFoldingError(error?.message || "Biophysical simulation failed");
        biophysicalSink.setFoldingStatus("failed");
        biophysicalSink.setIsFolding(false);
      }).finally(() => activeSignal.removeEventListener("abort", onParentAbort));
    };
    startFolding();

    // Stage 4: Multi-Model Biophysics Suite
    analysisSink.setLoadingStep("Assessing clinical and computational evidence...");
    const biophysicalPromise = fetchBiophysicalAnalysis(
      // Same scientific inputs for every branch. Submitted and lifted coordinate/build pairs stay
      // separate; the server validates their lift rather than trusting a caller-authored decision.
      requestParams(),
      apiClient,
      activeSignal,
      (chunkData: any) => {
        if (run.isStale()) return;
        setAnalysisState((prev: any) => {
          /**
           * Seed a result object on the FIRST chunk that carries data, rather than waiting for the
           * structure warm-up below.
           *
           * This block used to `return prev` whenever `prev.result` was still null — and `result`
           * was created only by the PDB promise, so every chunk that arrived before the AlphaFold
           * fetch resolved was merged into nothing and thrown away. The server had already spent
           * the ClinVar and predictor round trips; the reader saw a spinner. Verified by driving
           * the workflow with the structure fetch held open: the chunk arrived, `result` stayed
           * null, and the payload was gone once the placeholder was finally built from `baseParams`.
           *
           * Seeding HERE (and not at the top of the workflow) is deliberate: an early, empty shell
           * would claim the analysis had started producing evidence while the fast triage was still
           * in flight. The placeholder appears with the first real data and not before.
           */
          return mergeResultPatch(prev?.result ? prev : seedState(), chunkData, baseParams, "core", "running");
        });
      },
      getTraceContext()
    );

    // Prefer the stream as shared-core owner; enrichment still starts before any response is awaited.
    startEnrichment();

    /**
     * The structure warm-up is what paints the 3D viewer, and on the NON-streaming fallback path
     * (`apiClient.getBiophysicalAnalysis`, no chunks at all) it is still what creates the first
     * result object. On the streaming path the chunk merge above has usually seeded one already,
     * and this call is then a no-op by design.
     */
    function installStructure(pdb: any) {
      if (!run.acceptsEvidence()) return;
      const coordinates = typeof pdb === "string" ? pdb : pdb?.pdbText;
      if (typeof coordinates !== "string" || !coordinates.trim()) {
        markCoordinates("degraded");
        return;
      }
      const provenance = pdb?.provenance || null;
      structureSink.setPdbText(coordinates);
      if (provenance && structureSink.setPdbTextProvenance) {
        structureSink.setPdbTextProvenance(provenance);
      }
      if (residueIndex && (!cached?.computedPocket || cached.computedPocket.status === "unavailable")) {
        fetchPocketData(
          targetUniprot,
          residueIndex,
          coordinates,
          apiClient,
          structureSink.setIsPocketLoading,
          structureSink.setPocketError,
          structureSink.setComputedPocket,
          activeSignal
        );
      }
      setAnalysisState((prev: any) => {
        if (prev.result) return prev;
        return createPlaceholderAnalysisState(baseParams);
      });
      markCoordinates("complete");
    }
    if (initialStructureAccession) void pdbWarmupPromise.then(installStructure).catch(structureFailed);

    async function triggerNarrative(bpResult: any) {
      if (run.isStale()) return;
      if (mode !== "automatic") {
        searchSink.addToHistory(targetGene, targetVariant, targetUniprot, historyQuery());
        if (residueIndex != null) searchSink.setSelectedResidueIndex(residueIndex);
        if (!narrativeActivityOutstanding()) analysisSink.setIsNarrativeLoading(false);
        setAnalysisState((prev: any) => mergeResultPatch(prev, { metadata: { narrativeMode: mode } }, baseParams, "narrative", "skipped"));
        return;
      }
      return generateClinicalNarrative(
        {
          gene: targetGene,
          variant: targetVariant,
          uniprotId: targetUniprot,
          userDirections,
          settings,
          bpResult,
          getCurrentEvidence: getCurrentEvidenceForRun
        },
        apiClient,
        {
          addToHistory: (g: string, v: string, u: string) => searchSink.addToHistory(g, v, u, historyQuery()),
          setSelectedResidueIndex: searchSink.setSelectedResidueIndex
        },
        runAnalysisSink,
        activeSignal,
        requestId,
        getActiveRequestId,
        getTraceContext()
      );
    }

    /** Writes the narrative a saved result lacks. After a reload the first health reading may still be on its way. */
    async function backfillNarrative(result: any) {
      if (mode === "automatic" && !hasActiveGemini && !(await options.waitForServerGemini?.())) return;
      return triggerNarrative(result);
    }

    /** One refresh after the initial fan-out. Optional, so its failure can never harm finished evidence. */
    async function refreshNarrativeOnce() {
      try {
        const snapshot = getCurrentEvidenceForRun();
        if (mode === "automatic" && hasActiveGemini && snapshot && narrativeFreshness(snapshot.result, snapshot.context) === "outdated") {
          await triggerNarrative(snapshot.result);
        }
      } catch (error) {
        console.warn("[Pipeline] Narrative refresh failed:", error);
      }
    }

    const coreResult = await biophysicalPromise
      .then((resResult: any) => {
        if (run.isStale()) return null;
        analysisSink.setIsBiophysicalLoading(false);
        analysisSink.setIsClinicalLoading(false);
        if (!resResult) throw new Error("Biophysical result payload empty.");

        if (!targetUniprot && resResult.metadata?.uniprotId) {
          targetUniprot = resResult.metadata.uniprotId;
          searchSink.setUniprotId(targetUniprot);
          baseParams.uniprotId = targetUniprot;
        }

        pipelineContext.uniprotId = targetUniprot.toUpperCase();
        if (!initialStructureAccession && targetUniprot) {
          markCoordinates("running");
          void fetchPdbCoordinates(targetGene, targetVariant, targetUniprot, residueIndex, apiClient, activeSignal, getTraceContext()).then(installStructure).catch(structureFailed);
        }
        startFolding();
        setAnalysisState((prev: any) => mergeCompletedCore(prev, createCompletedAnalysisState(resResult, baseParams), baseParams));
        // Cache core evidence even when optional AI is disabled or deferred.
        writeAndCache((prev: any) => prev);
        analysisSink.setLoadingStep("Evidence ready · Background enrichment continues");
        startEnrichment();
        return resResult;
      })
      .catch(async (err: any) => {
        if (run.isStale()) return null;
        console.error("[WorkflowOrchestrator] Biophysical analysis error:", err);
        run.record({ type: "core-failed" });
        clearAnalysisActivity();

        const fallbackKey = `${targetGene}_${targetVariant}`;
        if (FALLBACK_ANALYSES[fallbackKey] || FALLBACK_INSIGHTS[fallbackKey]) {
          setAnalysisState(
            createDemoFallbackAnalysisState(FALLBACK_ANALYSES[fallbackKey], FALLBACK_INSIGHTS[fallbackKey] || null, baseParams)
          );
        } else {
          setAnalysisState(
            createBiophysicalErrorAnalysisState(
              err?.message || "Biophysical analysis failed",
              baseParams,
              // The refusal lands HERE (this promise is consumed by `.catch`, so the outer try/catch
              // never sees it) — without this the reader gets the message and no way to answer it.
              refusalAttachmentsFromError(err, targetVariant)
            )
          );
        }
        run.stopEvidence();
        await Promise.allSettled(enrichmentTasks);
        return null;
      });

    // From here core has landed, so nothing below may turn this run into a core failure.
    if (coreResult) {
      // Awaiting here owns telemetry completion, never navigation or workspace readiness.
      await Promise.allSettled([...enrichmentTasks, triggerNarrative(coreResult)]);
      await refreshNarrativeOnce();
      settleRun();
    }
  } catch (err: any) {
    if (!run.isStale()) {
      console.error("[WorkflowOrchestrator] Top-level pipeline error:", err);
      run.record({ type: "core-failed" });
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
      /**
       * An ambiguous numbering is a QUESTION, not a failure: carry the readings into the state so the
       * UI can offer them.
       */
      const refusalExtra = refusalAttachmentsFromError(err, targetVariant);
      setAnalysisState(
        createTopLevelErrorAnalysisState(err?.message || "Unknown error", baseParams, refusalExtra)
      );
      clearAnalysisActivity();
      run.stopEvidence();
    }
  }
  return run.isStale() ? "aborted" : run.hasFailed() ? "failed" : "completed";
}

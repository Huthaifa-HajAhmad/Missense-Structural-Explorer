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
  fetchProgressiveMultimer
} from "./biophysicalService";
import { generateClinicalNarrative } from "./narrativeService";
import { mergeResultPatch, mergeCompletedCore, hasReusableCoreEvidence, type StageOutcome } from "./resultMerge";
import { createAnalysisCacheContext, narrativeModeOf } from "./analysisContext";
import { narrativeFreshness } from "../../shared/narrativeEvidence";
import {
  StructuredPipelineOptions,
  TraceContext
} from "./types";
import {
  buildHintSchema,
  coordinateLiftSchema,
  genomeAssemblySchema,
  isBuildDegradedResult,
  numberingChoiceSchema,
  REFUSAL_CODES,
} from "../../shared/contracts";
import { variantNumberingView } from "../../shared/numbering";
import {
  createPlaceholderAnalysisState,
  createCompletedAnalysisState,
  createBiophysicalErrorAnalysisState,
  createTopLevelErrorAnalysisState,
  createDemoFallbackAnalysisState,
  PipelineStateBaseParams,
  type RefusalAttachments,
  type RefusalBuildTrail
} from "./pipelineStateFactory";
import {
  getCachedVariant,
  setCachedVariant,
  isFallbackNarrative,
  recordBiophysicsAttempt,
  getBiophysicsAttemptedAt,
} from "./variantCache";

/**
 * True when a result is a REFUSAL WAITING FOR AN ANSWER rather than a finished analysis.
 *
 * The attachments that ask a question — the readings of an ambiguous notation, the alternative build
 * for a coordinate whose alleles matched nothing — must not be cached as if they were an answer, and
 * must not short-circuit the run that would resolve them. One predicate, so a future attachment cannot
 * be added to the render path while being forgotten here (which is exactly what happened to the build
 * hint: it was cached, restored with `error: null`, and then short-circuited the re-run).
 */
export function isUnansweredRefusal(result: {
  numberingChoices?: unknown[] | null;
  buildHint?: unknown;
} | null | undefined): boolean {
  if (!result) return false;
  return Boolean(result.numberingChoices?.length) || Boolean(result.buildHint);
}

/**
 * The build decision a refusal travelled with, re-validated field by field.
 *
 * Read structurally like the hint beside it: a build is either one of the two this platform speaks or
 * it is not reported at all, and a lift record that does not parse is dropped rather than rendered.
 * `buildDeclared` is the field the copy needs — it is what separates "read as GRCh38" from "read as
 * GRCh38, which nobody stated".
 */
function buildTrailFromDetails(details: any): RefusalBuildTrail | undefined {
  const assembly = genomeAssemblySchema.safeParse(details?.assembly);
  const resolvedAssembly = genomeAssemblySchema.safeParse(details?.resolvedAssembly);
  const coordinateLift = coordinateLiftSchema.safeParse(details?.coordinateLift);
  const assemblyNote = typeof details?.assemblyNote === "string" ? details.assemblyNote : undefined;

  if (!assembly.success && !resolvedAssembly.success && !coordinateLift.success && !assemblyNote) {
    return undefined;
  }
  return {
    ...(assembly.success ? { assembly: assembly.data } : {}),
    ...(resolvedAssembly.success ? { resolvedAssembly: resolvedAssembly.data } : {}),
    ...(coordinateLift.success ? { coordinateLift: coordinateLift.data } : {}),
    ...(assemblyNote ? { assemblyNote } : {}),
  };
}

/**
 * Reads the REFUSAL ATTACHMENTS out of a thrown analysis error — the readings of an ambiguous
 * notation, the alternative-build spelling of a coordinate whose alleles matched no reference, and the
 * build decision the refusal was taken under.
 *
 * Read structurally (`code`/`details` off the error) rather than by importing the client's `ApiError`,
 * so this service layer keeps its dependency direction — and exported so the hop is testable without
 * driving the whole pipeline.
 *
 * Returns `{}` for every other error: an unrelated failure must not render a prompt.
 */
export function refusalAttachmentsFromError(error: unknown, fallbackNotation: string): RefusalAttachments {
  const code = (error as any)?.code;
  const details: any = (error as any)?.details;

  if (code === REFUSAL_CODES.coordinateReferenceMismatch) {
    /**
     * The build hint is re-validated, not trusted: a hint whose notation does not actually STATE the
     * build it offers would render a button labelled "the other build" over a coordinate that repeats
     * the request the server has just refused.
     */
    const parsed = buildHintSchema.safeParse(details?.buildHint);
    const buildTrail = buildTrailFromDetails(details);
    return {
      ...(parsed.success ? { buildHint: parsed.data } : {}),
      ...(buildTrail ? { buildTrail } : {}),
    };
  }

  if (code !== REFUSAL_CODES.ambiguousProteinNumbering) return {};

  // Bounded like every other server-supplied array: a compromised or buggy response must not be able
  // to make the UI render an unbounded list of buttons (the server emits at most one per isoform).
  const parsed = numberingChoiceSchema.array().max(16).safeParse(details?.candidates);
  if (!parsed.success || parsed.data.length === 0) return {};

  return {
    numberingChoices: parsed.data,
    numberingNotation: typeof details?.notation === "string" ? details.notation : fallbackNotation,
  };
}

export interface WorkflowOrchestratorParams {  targetGeneArg: string;
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
  const initialStages: Record<string, string> = {};
  let acceptingEvidence = true;
  let outcome: "completed" | "failed" = "completed";
  const markCoreFailure = () => {
    outcome = "failed";
    for (const stage of Object.keys(initialStages)) if (initialStages[stage] === "running") initialStages[stage] = "skipped";
    initialStages.core = "error";
  };
  const dispatchAnalysisState = analysisSink.setAnalysisState;
  const decorateState = (next: any) => !next?.result ? next : { ...next, result: { ...next.result, metadata: {
    ...next.result.metadata, ...runMetadata,
    pipelineStages: { ...initialStages, ...next.result.metadata?.pipelineStages }
  } } };
  const setAnalysisState = (updater: any) => {
    if (!acceptingEvidence || activeSignal.aborted || getActiveRequestId() !== requestId) return;
    if (typeof updater !== "function") return dispatchAnalysisState(decorateState(updater));
    dispatchAnalysisState((prev: any) => !acceptingEvidence || activeSignal.aborted || getActiveRequestId() !== requestId ? prev : decorateState(updater(prev)));
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

  if (activeSignal.aborted || getActiveRequestId() !== requestId) {
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
      if (activeSignal.aborted || getActiveRequestId() !== requestId) return "aborted";
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
    const markCoordinates = (outcome: StageOutcome) => {
      if (!acceptingEvidence || activeSignal.aborted || getActiveRequestId() !== requestId) return;
      initialStages.coordinates = outcome;
      setAnalysisState((prev: any) => {
        const next = mergeResultPatch(prev, {}, undefined, "coordinates", outcome);
        const cachedResult = getCachedVariant(targetGene, targetVariant)?.analysisResult;
        if (next?.result && cachedResult?.metadata?.pipelineRunId === runMetadata.pipelineRunId) {
          setCachedVariant(targetGene, targetVariant, targetUniprot, { analysisResult: next.result });
        }
        return next;
      });
    };
    const structureFailed = (error: any) => {
      if (activeSignal.aborted || getActiveRequestId() !== requestId) return;
      markCoordinates("error");
      console.warn("[Pipeline] Protein coordinates query failed:", error?.message || error);
    };
    // Protein artifacts are reusable; interpretation must match all scientific inputs.
    const hasActiveGemini = Boolean(
      (settings?.geminiSessionId && settings?.geminiSessionExpiresAt && settings.geminiSessionExpiresAt > Date.now()) ||
      settings?.geminiApiKey || settings?.serverGeminiReady || options?.serverGeminiReady
    );
    const cached = getCachedVariant(targetGene, targetVariant, pipelineContext);
    if (cached && cached.biophysicsContext !== pipelineContext.simulationConditions) {
      biophysicalSink.setMutantPdb(null);
      biophysicalSink.setFoldxWtPdb?.(null);
      biophysicalSink.setFoldedResidueIndex(null);
      biophysicalSink.setFoldingDdG(null);
      biophysicalSink.setFoldingEnergetics(null);
      biophysicalSink.setFoldingStatus(null);
      biophysicalSink.setDynamut2JobId(null);
      biophysicalSink.setDynamut2Status(null);
      biophysicalSink.setDdmutJobId(null);
      biophysicalSink.setDdmutStatus(null);
      biophysicalSink.setThermompnnJobId(null);
      biophysicalSink.setThermompnnStatus(null);
      biophysicalSink.setThermompnnError(null);
    }

    /**
     * The store's view of the remote engines, RESOLVED — one value, shared by BOTH dispatch sites.
     *
     * The seeds used to be built independently from the RAW cached statuses, which meant the settle could
     * be told `pending` for an engine the restore had already resolved to `done` (its score is present,
     * so nothing will ever poll it) — a status the settle is entitled to clear, for an engine that is
     * finished. Resolving once, with the same function the sink restore uses, makes the store and the
     * seed agree by construction rather than by both being written carefully.
     *
     * It lives at function scope because the resolver is declared inside the cached branch while the
     * Stage-3 dispatch is outside it — the shape that let the two sites drift apart in the first place.
     */
    let restoredRemoteState: {
      dynamut2Status: string | null;
      dynamut2JobId: string | null;
      ddmutStatus: string | null;
      ddmutJobId: string | null;
      thermompnnStatus: string | null;
      thermompnnJobId: string | null;
    } = {
      dynamut2Status: null,
      dynamut2JobId: null,
      ddmutStatus: null,
      ddmutJobId: null,
      thermompnnStatus: null,
      thermompnnJobId: null
    };

    if (cached) {
      /**
       * The same guard as the pre-flight paint in `useAnalysisPipeline`, for the same reason: a bundle
       * whose evidence was built against a non-canonical reference must not be shown as the current
       * verdict. This site paints too (the pre-flight only covers the caller that reads the cache
       * before starting), so both are checked or the stale state returns through the other door.
       */
      if (hasReusableCoreEvidence(cached.analysisResult) && !isBuildDegradedResult(cached.analysisResult)) {
        setAnalysisState({
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
        // Always written with the variant, so a previous variant's paired wild type cannot linger.
        biophysicalSink.setFoldxWtPdb?.(cached.foldxWtPdb ?? null);
      }
      if (cached.foldedResidueIndex != null) biophysicalSink.setFoldedResidueIndex(cached.foldedResidueIndex);
      if (cached.foldingDdG != null) biophysicalSink.setFoldingDdG(cached.foldingDdG);
      if (cached.foldingEnergetics) {
        // FoldX's template travels inside the energetics. It is not written to the structure sink:
        // that sink describes `pdbText`, and restoring the template there is how a cached run
        // labelled the AlphaFold model with the crystal entry FoldX had used.
        biophysicalSink.setFoldingEnergetics(cached.foldingEnergetics);
      }
      if (cached.foldingStatus) biophysicalSink.setFoldingStatus(cached.foldingStatus as any);
      /**
       * Decides whether a restored remote status is still actionable.
       *
       * The previous rule was clock-based — `Date.now() - cached.timestamp > 5 min` — but
       * `cached.timestamp` is a whole-bundle marker that ANY write refreshes (landscape, pockets,
       * multimer), so the same status could be judged fresh or stale depending on whether
       * something unrelated had touched the bundle. It also marked a still-pollable engine
       * unavailable purely because the snapshot was old.
       *
       * The real question is not "how old is this?" but "can anything still resolve it?": a
       * pending engine is recoverable only if there is a job id to poll (`useJobPoller` requires
       * one, and the SSE channel for these engines is only emitted from that poller).
       */
      const resolveRestoredStatus = (
        status: string | null | undefined,
        score: number | null | undefined,
        jobId: string | null | undefined
      ) => {
        if (score != null) return "done";
        if (status === "pending" && !jobId) return "unavailable";
        return status ?? null;
      };

      biophysicalSink.setDynamut2JobId(cached.dynamut2JobId ?? null);
      biophysicalSink.setDynamut2Status(resolveRestoredStatus(cached.dynamut2Status, cached.foldingEnergetics?.dynamut2, cached.dynamut2JobId) as any);
      biophysicalSink.setDdmutJobId(cached.ddmutJobId ?? null);
      biophysicalSink.setDdmutStatus(resolveRestoredStatus(cached.ddmutStatus, cached.foldingEnergetics?.ddmut, cached.ddmutJobId) as any);
      biophysicalSink.setThermompnnJobId(cached.thermompnnJobId ?? null);
      biophysicalSink.setThermompnnStatus(resolveRestoredStatus(cached.thermompnnStatus, cached.foldingEnergetics?.thermompnn, cached.thermompnnJobId) as any);
      biophysicalSink.setThermompnnError(cached.thermompnnError ?? null);

      // The SAME resolution the sink just received, captured for the settle's seed.
      restoredRemoteState = {
        dynamut2Status: (resolveRestoredStatus(
          cached.dynamut2Status,
          cached.foldingEnergetics?.dynamut2,
          cached.dynamut2JobId
        ) ?? null) as string | null,
        dynamut2JobId: cached.dynamut2JobId ?? null,
        ddmutStatus: (resolveRestoredStatus(
          cached.ddmutStatus,
          cached.foldingEnergetics?.ddmut,
          cached.ddmutJobId
        ) ?? null) as string | null,
        ddmutJobId: cached.ddmutJobId ?? null,
        thermompnnStatus: (resolveRestoredStatus(
          cached.thermompnnStatus,
          cached.foldingEnergetics?.thermompnn,
          cached.thermompnnJobId
        ) ?? null) as string | null,
        thermompnnJobId: cached.thermompnnJobId ?? null
      };
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
      const needsNarrativeBackfill = mode === "automatic" && (isFallback || !cached.analysisResult?.analysis) && hasActiveGemini;

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
      const hasCompleteAnalysis = Boolean(
        cached.analysisResult &&
        hasReusableCoreEvidence(cached.analysisResult) &&
        /**
         * A result that carries numbering CHOICES or a BUILD HINT is an unanswered refusal, not a
         * completed analysis. Caching one (the report bar re-synthesises whatever is on screen) and
         * restoring it later would put a stale prompt back on screen — with no refusal text beside it,
         * because the cache path restores `error: null` — and skip the run that would answer it. Both
         * refusal attachments are checked through one predicate so the next one cannot be forgotten.
         */
        !isUnansweredRefusal(cached.analysisResult) &&
        /**
         * …and a result whose evidence was built against a NON-CANONICAL reference is not a completed
         * analysis either. Short-circuiting on one kept the older coordinate, the older target build and
         * the withheld population criterion on screen indefinitely, because the only thing that would
         * have improved them — the lift performed at intake — never ran. Re-running is the fix, so the
         * short-circuit has to decline it.
         */
        !isBuildDegradedResult(cached.analysisResult) &&
        (cached.analysisResult.metadata?.pipelineStages?.core === "complete" || cached.analysisResult.predictorData || cached.analysisResult.ruleBasedInsights || cached.analysisResult.clinvar || cached.analysisResult.insights)
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
        analysisSink.setIsBiophysicalLoading(false);
        analysisSink.setIsStructuralLoading(false);
        analysisSink.setIsClinicalLoading(false);
        analysisSink.setIsNarrativeLoading(false);

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

        const needsBiophysicsBackfill = shouldRunBiophysics(cached, getBiophysicsAttemptedAt(targetGene, targetVariant));
        if (needsBiophysicsBackfill && posMatch && targetUniprot) {
          // Recorded BEFORE dispatch, so an abort or a crash still starts the cooldown rather
          // than leaving the next visit free to launch another full run. Written to its own store:
          // a bundle-shaped record could never be read back by the check above, because that check
          // lives inside the cached-bundle branch a payload-free record can never enter.
          recordBiophysicsAttempt(targetGene, targetVariant, targetUniprot);

          // The dispatch is deliberately not awaited, but it must never be a floating promise: a
          // rejection here would surface as an unhandled rejection and leave the spinner up with no
          // deadline and no message.
          void executeFoldxPipeline({
            gene: targetGene,
            uniprotId: targetUniprot,
            variant: targetVariant,
            residueIndex: residueIndex ?? null,
            conditions: settings.biophysicsConditions,
            fetchWithAuth,
            sink: biophysicalSink,
            signal: activeSignal,
            requestId,
            getActiveRequestId,
            traceContext: getTraceContext(),
            // This variant's own restored state, so a failure settles against what the STORE holds
            // rather than only against what this run has seen so far. Without it an engine the store
            // is already polling for can be marked unavailable, which tears that poller down.
            initialRemoteState: restoredRemoteState
          }).catch(err => {
            // This path has no watchdog and no caller awaiting it, so a failure must be reported
            // here or the user is left with a spinner that never resolves and no explanation.
            if (getActiveRequestId() !== requestId) return;
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
          const stages = cached.analysisResult?.metadata?.pipelineStages;
          if (!cached.analysisResult?.multimerData) cachedTasks.push(fetchProgressiveMultimer(requestParams(), fetchWithAuth, activeSignal, setAnalysisState, requestId, getActiveRequestId));
          if (!cached.analysisResult?.landscapeData || stages?.landscape === "running" || stages?.landscape === "error") {
            cachedTasks.push(fetchProgressiveLandscape(requestParams(), apiClient, activeSignal, setAnalysisState, requestId, getActiveRequestId));
          }
          const modelStillLoading = ["esm3Eval", "esmcEval", "esm2Eval", "saprotEval"].some(key => cached.analysisResult?.[key]?.loading);
          if (modelStillLoading || ["running", "error", "degraded"].includes(stages?.structural ?? "") || (!stages?.structural && !cached.analysisResult?.esm2Eval && !cached.analysisResult?.saprotEval)) {
            cachedTasks.push(fetchProgressiveStructuralAssessments(requestParams(), apiClient, activeSignal, setAnalysisState, requestId, getActiveRequestId, getTraceContext(), analysisSink.setIsStructuralLoading));
          }
        }
        if (needsNarrativeBackfill || mode !== "automatic") cachedTasks.push(triggerNarrative(cached.analysisResult));
        await Promise.allSettled(cachedTasks);
        await refreshNarrativeOnce();
        return activeSignal.aborted || getActiveRequestId() !== requestId ? "aborted" : "completed";
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
      if (enrichmentStarted || !targetUniprot || activeSignal.aborted) return;
      enrichmentStarted = true;
      Object.assign(initialStages, { landscape: "running", structural: "running", multimer: "running" });
      const params = requestParams();
      enrichmentTasks.push(Promise.resolve(fetchProgressiveLandscape(params, apiClient, activeSignal, setEnrichmentState, requestId, getActiveRequestId)));
      enrichmentTasks.push(fetchProgressiveStructuralAssessments(
        { ...params, saprotEngine: settings.saprotEngine }, apiClient, activeSignal,
        setEnrichmentState, requestId, getActiveRequestId, getTraceContext(), analysisSink.setIsStructuralLoading
      ));
      enrichmentTasks.push(fetchProgressiveMultimer(params, fetchWithAuth, activeSignal, setEnrichmentState, requestId, getActiveRequestId));
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
    const startFolding = () => {
      if (!targetUniprot || !posMatch || activeSignal.aborted || getActiveRequestId() !== requestId) return;
      const foldKey = `${targetUniprot}_${targetVariant}_${pipelineContext.simulationConditions}`;
      if (biophysicalSink.lastFetchedFoldRef.current === foldKey || !shouldRunBiophysics(cached, getBiophysicsAttemptedAt(targetGene, targetVariant))) return;
      recordBiophysicsAttempt(targetGene, targetVariant, targetUniprot);
      biophysicalSink.lastFetchedFoldRef.current = foldKey;
      mutantFoldAbortRef.current?.abort();
      const foldController = new AbortController();
      mutantFoldAbortRef.current = foldController;
      const onParentAbort = () => foldController.abort();
      activeSignal.addEventListener("abort", onParentAbort, { once: true });
      // foldxService owns queue/execution/poll budgets. An absolute watchdog would orphan queued work.
      void executeFoldxPipeline({
        gene: targetGene, uniprotId: targetUniprot, variant: targetVariant,
        residueIndex: residueIndex ?? null, conditions: settings.biophysicsConditions,
        fetchWithAuth, sink: biophysicalSink, signal: foldController.signal, requestId, getActiveRequestId,
        // FoldX records its own span; the run's trace context is what lets it land in the waterfall.
        traceContext: getTraceContext(),
        // Preserve this variant's live remote-job IDs when a new submission fails before returning IDs.
        initialRemoteState: restoredRemoteState
      }).catch(error => {
        if (foldController.signal.aborted || getActiveRequestId() !== requestId) return;
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
        if (getActiveRequestId() !== requestId || activeSignal.aborted) return;
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
      if (!acceptingEvidence || activeSignal.aborted || getActiveRequestId() !== requestId) return;
      const coordinates = typeof pdb === "string" ? pdb : pdb?.pdbText;
      if (typeof coordinates !== "string" || !coordinates.trim()) {
        markCoordinates("degraded");
        return;
      }
      if (pdb && acceptingEvidence && getActiveRequestId() === requestId && !activeSignal.aborted) {
        const pdbString = typeof pdb === "string" ? pdb : pdb?.pdbText;
        if (typeof pdbString !== "string" || !pdbString.trim()) return;
        const provenance = pdb?.provenance || (typeof pdb === "string" ? (pdb as any).provenance : null);
        structureSink.setPdbText(pdbString);
        if (provenance && structureSink.setPdbTextProvenance) {
          structureSink.setPdbTextProvenance(provenance);
        }
        if (residueIndex && (!cached?.computedPocket || cached.computedPocket.status === "unavailable")) {
          fetchPocketData(
            targetUniprot,
            residueIndex,
            pdbString,
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
    }
    if (initialStructureAccession) void pdbWarmupPromise.then(installStructure).catch(structureFailed);

    function triggerNarrative(bpResult: any) {
      if (activeSignal.aborted || getActiveRequestId() !== requestId) return Promise.resolve();
      if (mode !== "automatic") {
        searchSink.addToHistory(targetGene, targetVariant, targetUniprot);
        if (residueIndex != null) searchSink.setSelectedResidueIndex(residueIndex);
        analysisSink.setIsNarrativeLoading(false);
        setAnalysisState((prev: any) => mergeResultPatch(prev, { metadata: { narrativeMode: mode } }, baseParams, "narrative", "skipped"));
        return Promise.resolve();
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

    async function refreshNarrativeOnce() {
      const snapshot = getCurrentEvidenceForRun();
      if (mode === "automatic" && hasActiveGemini && snapshot && narrativeFreshness(snapshot.result, snapshot.context) === "outdated") {
        // One refresh after the initial fan-out, never a loop driven by long-lived engine polling.
        await triggerNarrative(snapshot.result);
      }
    }

    await biophysicalPromise
      .then(async (resResult: any) => {
        if (getActiveRequestId() !== requestId || activeSignal.aborted) return;
        analysisSink.setIsBiophysicalLoading(false);
        analysisSink.setIsClinicalLoading(false);

        if (resResult) {
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
          setAnalysisState((prev: any) => {
            if (prev?.result) setCachedVariant(targetGene, targetVariant, targetUniprot, { analysisResult: prev.result });
            return prev;
          });
          analysisSink.setLoadingStep("Evidence ready · Background enrichment continues");
          startEnrichment();
          // Awaiting here owns telemetry completion, never navigation or workspace readiness.
          await Promise.allSettled([...enrichmentTasks, triggerNarrative(resResult)]);
          await refreshNarrativeOnce();
        } else {
          throw new Error("Biophysical result payload empty.");
        }
      })
      .catch(async (err: any) => {
        if (getActiveRequestId() !== requestId || activeSignal.aborted) return;
        console.error("[WorkflowOrchestrator] Biophysical analysis error:", err);
        markCoreFailure();
        analysisSink.setIsBiophysicalLoading(false);
        analysisSink.setIsStructuralLoading(false);
        analysisSink.setIsClinicalLoading(false);
        analysisSink.setIsNarrativeLoading(false);

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
        acceptingEvidence = false;
        await Promise.allSettled(enrichmentTasks);
      });
  } catch (err: any) {
    if (getActiveRequestId() === requestId && !activeSignal.aborted) {
      console.error("[WorkflowOrchestrator] Top-level pipeline error:", err);
      markCoreFailure();
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
      analysisSink.setIsBiophysicalLoading(false);
      analysisSink.setIsStructuralLoading(false);
      analysisSink.setIsClinicalLoading(false);
      analysisSink.setIsNarrativeLoading(false);
      acceptingEvidence = false;
    }
  }
  return activeSignal.aborted || getActiveRequestId() !== requestId ? "aborted" : outcome;
}

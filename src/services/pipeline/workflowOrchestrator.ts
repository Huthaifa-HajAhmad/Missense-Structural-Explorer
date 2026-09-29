import { parseMutationResidues } from "../../variantAnalysisUtils";
import { FALLBACK_ANALYSES, FALLBACK_INSIGHTS } from "../../data";
import { BIOPHYSICS_RETRY_COOLDOWN_MS } from "../../shared/timeouts";
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
}: WorkflowOrchestratorParams): Promise<void> {
  const { fetchWithAuth, apiClient, settings, userDirections, numberingBasis, sinks } = options;
  const { search: searchSink, analysis: analysisSink, biophysical: biophysicalSink, structure: structureSink } = sinks;

  let targetGene = targetGeneArg.trim();
  let targetVariant = targetVariantArg.trim();
  let targetUniprot = (targetUniprotArg || "").trim();
  let transcriptMeta: any = null;
  let residueIndex: number | undefined;

  if (activeSignal.aborted || getActiveRequestId() !== requestId) {
    return;
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
      if (activeSignal.aborted || getActiveRequestId() !== requestId) return;
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

    // Check high-fidelity client variant snapshot cache
    const cached = getCachedVariant(targetGene, targetVariant);

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
      if (cached.analysisResult && !isBuildDegradedResult(cached.analysisResult)) {
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
      if (cached.foldingEnergetics) {
        biophysicalSink.setFoldingEnergetics(cached.foldingEnergetics);
        if (cached.foldingEnergetics.structureProvenance) {
          // FoldX's TEMPLATE. It is not written to the structure sink: that sink describes `pdbText`,
          // and restoring the template there is how a cached run labelled the AlphaFold model with
          // the crystal entry FoldX had used.
          biophysicalSink.setStructureProvenance?.(cached.foldingEnergetics.structureProvenance);
        }
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
              const pdbString = typeof pdb === "string" ? pdb : pdb?.pdbText;
              const provenance = pdb?.provenance || (typeof pdb === "string" ? (pdb as any).provenance : null);
              structureSink.setPdbText(pdbString);
              if (provenance && structureSink.setStructureProvenance) {
                structureSink.setStructureProvenance(provenance);
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
            }
          });
        }

        /**
         * Should this cached snapshot be re-computed?
         *
         * The previous predicate was PERMANENTLY TRUE in any deployment without the Python
         * sidecar: `cached.foldingEnergetics?.stabilityoracle == null` can never be satisfied
         * because StabilityOracle has no other data path. Every single visit therefore re-ran the
         * full FoldX pipeline, and the watchdog then stamped a fresh `failed` status onto an
         * otherwise good cached snapshot — which is why the tab showed cached engine values
         * beside a brand-new "timed out" error.
         *
         * Three rules replace it:
         *   1. Re-run only what another attempt can actually fix (missing structure, missing
         *      energetics, or a failure that is not structural).
         *   2. An engine that is *structurally* unavailable here — missing binary, failed repair,
         *      absent sidecar, uncovered dataset — is not evidence of an incomplete snapshot.
         *   3. Rate-limit retries, so a persistently failing run cannot re-burn minutes of compute
         *      on every visit. There is no negative-caching or circuit breaker behind this yet.
         */
        const cachedEnergetics = cached.foldingEnergetics;
        const foldxStructurallyUnavailable = Boolean(
          cachedEnergetics?.foldxBinaryMissing || cachedEnergetics?.foldxRepairFailed
        );
        const snapshotIncomplete = !cached.mutantPdb || !cachedEnergetics;
        const retryableFailure =
          cached.foldingStatus === "failed" && !foldxStructurallyUnavailable;
        const retryCooldownElapsed =
          Date.now() - (getBiophysicsAttemptedAt(targetGene, targetVariant) ?? 0) > BIOPHYSICS_RETRY_COOLDOWN_MS;

        const needsBiophysicsBackfill =
          (snapshotIncomplete || retryableFailure) && retryCooldownElapsed;

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

        // Backfill multimer data if missing from cached snapshot
        if (!cached.analysisResult?.multimerData && targetUniprot) {
          fetchProgressiveMultimer(
            { gene: targetGene, variant: targetVariant, uniprotId: targetUniprot },
            fetchWithAuth,
            activeSignal,
            analysisSink.setAnalysisState,
            requestId,
            getActiveRequestId
          );
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
      const onParentAbort = () => foldController.abort();
      activeSignal.addEventListener("abort", onParentAbort, { once: true });

      /**
       * No absolute watchdog here any more.
       *
       * A timer armed before submission cannot tell a *queued* job from a *running* one, so it fired
       * while the job was still legitimately waiting for a concurrency slot — reporting a timeout for
       * work the server went on to complete, and orphaning the result. `foldxService` bounds each
       * phase itself (queue wait, execution, and every individual poll), which it can do because it
       * observes the job's state as it polls.
       */
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
        getActiveRequestId,
        /**
         * The SAME seed the backfill dispatch passes — and it IS load-bearing, which a correction to an
         * earlier record needs to state plainly.
         *
         * I removed this once, on the strength of a mutation check that dropped the seed and left every
         * test passing. That inference was wrong, and wrong in the exact way this audit is about: the
         * fixture used to test it (`HEALTHY_SNAPSHOT`, whose bundle carries a complete analysis) returns
         * EARLIER, inside `if (hasCompleteAnalysis && !userDirections)` — so the test could never reach
         * this dispatch, and its silence proved nothing about it. A cached bundle with no
         * `analysisResult` does fall through to here, and `variantCache` deliberately persists exactly
         * those bundles.
         *
         * Without the seed this path settles from this attempt's responses alone, so an engine the store
         * is already polling is marked unavailable and its live poller is torn down — the defect F4
         * fixed, re-opened by my own "refutation".
         */
        initialRemoteState: restoredRemoteState
      }).finally(() => {
        activeSignal.removeEventListener("abort", onParentAbort);
      });
    }

    // Stage 4: Multi-Model Biophysics Suite
    analysisSink.setLoadingStep("Step 3/4: Computing AI biophysical assessment...");
    const biophysicalPromise = fetchBiophysicalAnalysis(
      // `assembly` comes from the notation-translation step, which is the only place the
      // build is known (it is parsed from an inline annotation, or defaults to GRCh38).
      // Forwarding it lets the server route build-aware sources and skip the GRCh38-only
      // ones instead of handing them another build's coordinates.
      {
        gene: targetGene,
        variant: targetVariant,
        uniprotId: targetUniprot,
        ...(transcriptMeta?.assembly ? { assembly: transcriptMeta.assembly } : {}),
        // Forward the coordinate the user's notation resolved to, but ONLY together with its
        // declared build — the server refuses a coordinate whose build was not stated, because
        // a defaulted GRCh38 label over a GRCh37 position is the wrong-locus hazard itself.
        ...(transcriptMeta?.genomicCoordinates && transcriptMeta?.assembly
          ? { genomicCoordinates: transcriptMeta.genomicCoordinates }
          : {}),
        /**
         * The CANONICAL pair, forwarded BESIDE the submitted pair above rather than replacing it.
         *
         * When a submitted GRCh37 coordinate was lifted onto GRCh38 and reverse-verified, the
         * predictors must be given the build they actually query: Ensembl VEP is asked BY POSITION,
         * so a GRCh37 coordinate is re-lifted downstream (or refused outright by a GRCh38-only
         * source), while the verified canonical locus is already on the required build and cannot
         * disagree with the annotation that produced the protein substitution. A coordinate paired
         * with the wrong build is the wrong-locus hazard.
         *
         * The DECISION RECORD is deliberately not forwarded: the analysis route derives it from
         * these facts (`deriveCoordinateLift`), because a disclosure a caller can assert is
         * decoration, not evidence.
         */
        ...(transcriptMeta?.resolvedAssembly ? { resolvedAssembly: transcriptMeta.resolvedAssembly } : {}),
        ...(transcriptMeta?.liftedGenomicCoordinates
          ? { liftedGenomicCoordinates: transcriptMeta.liftedGenomicCoordinates }
          : {}),
        // Carries the reader's answer to the ambiguity prompt to the route that raised it, so the
        // canonical reading can be chosen (re-submitting the bare notation alone is refused again).
        ...(numberingBasis ? { numberingBasis } : {})
      },
      apiClient,
      activeSignal,
      (chunkData: any) => {
        if (getActiveRequestId() !== requestId || activeSignal.aborted) return;
        analysisSink.setAnalysisState((prev: any) => {
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
          const seed = prev?.result ? prev : createPlaceholderAnalysisState(baseParams);
          const base = seed.result;
          return {
            ...seed,
            result: {
              ...base,
              ...chunkData,
              metadata: {
                ...(base.metadata || {}),
                ...(chunkData.metadata || {})
              }
            }
          };
        });
      },
      getTraceContext()
    );

    /**
     * The structure warm-up is what paints the 3D viewer, and on the NON-streaming fallback path
     * (`apiClient.getBiophysicalAnalysis`, no chunks at all) it is still what creates the first
     * result object. On the streaming path the chunk merge above has usually seeded one already,
     * and this call is then a no-op by design.
     */
    pdbWarmupPromise.then((pdb: any) => {
      if (pdb && getActiveRequestId() === requestId && !activeSignal.aborted) {
        const pdbString = typeof pdb === "string" ? pdb : pdb?.pdbText;
        const provenance = pdb?.provenance || (typeof pdb === "string" ? (pdb as any).provenance : null);
        structureSink.setPdbText(pdbString);
        if (provenance && structureSink.setStructureProvenance) {
          structureSink.setStructureProvenance(provenance);
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

          // Progressive query for Quaternary Multimer Assembly
          fetchProgressiveMultimer(
            { gene: targetGene, variant: targetVariant, uniprotId: targetUniprot },
            fetchWithAuth,
            activeSignal,
            analysisSink.setAnalysisState,
            requestId,
            getActiveRequestId
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
            createBiophysicalErrorAnalysisState(
              err?.message || "Biophysical analysis failed",
              baseParams,
              // The refusal lands HERE (this promise is consumed by `.catch`, so the outer try/catch
              // never sees it) — without this the reader gets the message and no way to answer it.
              refusalAttachmentsFromError(err, targetVariant)
            )
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
      /**
       * An ambiguous numbering is a QUESTION, not a failure: carry the readings into the state so the
       * UI can offer them.
       */
      const refusalExtra = refusalAttachmentsFromError(err, targetVariant);
      analysisSink.setAnalysisState(
        createTopLevelErrorAnalysisState(err?.message || "Unknown error", baseParams, refusalExtra)
      );
      analysisSink.setIsBiophysicalLoading(false);
      analysisSink.setIsStructuralLoading(false);
      analysisSink.setIsClinicalLoading(false);
      analysisSink.setIsNarrativeLoading(false);
    }
  }
}

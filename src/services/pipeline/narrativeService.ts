import { TraceContext, PipelineAnalysisSink, PipelineSearchSink, type CurrentRunEvidence } from "./types";
import { setCachedVariant, getCachedVariant } from "./variantCache";
import { isFallbackNarrative } from "../../shared/narrativeFallback";
import { narrativeModeOf } from "./analysisContext";
import {
  NARRATIVE_DEEP_EVIDENCE,
  narrativeEvidenceSourceFromResult,
  pipelineRunIdOf,
  planNarrativeSynthesis,
  type NarrativeEvidenceStamp,
  type NarrativeSynthesisRequestPlan,
} from "../../shared/narrativeEvidence";
import {
  deepEvidenceContextFromResult,
  deepModelEvidenceFor,
} from "../../shared/deepModelEvidence";
import {
  acquireNarrativeFlight,
  mergeNarrativeFields,
  narrativeActivityOutstanding,
  narrativeFieldsFromResponse,
  narrativeFieldsFromTransportFailure,
  narrativeFlightKey,
  withNarrativeStageOutcome,
} from "../../shared/narrativeResynthesis";

export interface NarrativeGenerationParams {
  gene: string;
  variant: string;
  uniprotId: string;
  userDirections?: string;
  settings: {
    acmgWeighting?: any;
    [key: string]: any;
  };
  bpResult: any;
  /**
   * The run's current evidence at invocation, when the caller can vouch for it (see
   * `CurrentRunEvidence`).
   *
   * Supplied by the orchestrator, which alone can verify that the recorded result belongs to the run
   * that is asking. Returning `null` or `undefined` — or omitting the callback entirely, as on the
   * flat/legacy option shape — makes the pass describe itself from `bpResult` exactly as it always did.
   */
  getCurrentEvidence?: () => CurrentRunEvidence | null | undefined;
}

/**
 * Tell whether two snapshots describe the same evidence identity, without touching the evidence.
 *
 * Used only for the diagnostic path below: a caller's getter that names a different variant or run than
 * the one this pass is synthesising for is not an error worth failing the report over, but it IS worth
 * saying out loud rather than silently planning a synthesis from another run's payload.
 */
function sameRun(a: { gene: string; variant: string }, result: any): boolean {
  const gene = typeof result?.metadata?.gene === "string" ? result.metadata.gene : "";
  const variant = typeof result?.metadata?.variant === "string" ? result.metadata.variant : "";
  if (!gene || !variant) return true;
  return gene.trim().toUpperCase() === a.gene.trim().toUpperCase() &&
    variant.trim().toLowerCase() === a.variant.trim().toLowerCase();
}

export async function generateClinicalNarrative(
  params: NarrativeGenerationParams,
  apiClient: any,
  searchSink: Pick<PipelineSearchSink, "addToHistory" | "setSelectedResidueIndex">,
  analysisSink: PipelineAnalysisSink,
  signal: AbortSignal,
  requestId: number,
  getActiveRequestId: () => number,
  traceContext?: TraceContext,
  /**
   * The same snapshot, as a positional argument.
   *
   * Both shapes are accepted because the orchestrator's call site and this signature are owned
   * separately: a caller that appends the argument and a caller that puts it in `params` must not
   * disagree about whether the fix is wired. The positional one wins, since it is the more explicit
   * injection point.
   */
  getCurrentEvidence?: () => CurrentRunEvidence | null | undefined
): Promise<void> {
  const { gene, variant, uniprotId, userDirections, settings, bpResult } = params;
  const readCurrentEvidence = getCurrentEvidence ?? params.getCurrentEvidence;

  searchSink.addToHistory(gene, variant, uniprotId);

  const posMatch = variant.match(/\d+/);
  if (posMatch) {
    searchSink.setSelectedResidueIndex(parseInt(posMatch[0], 10));
  }

  /**
   * THIS function is the AUTOMATIC pass, so the reader's narrative mode gate belongs here.
   *
   * `on-demand` means exactly what it says: a narrative is produced when the reader asks for one
   * (`useNarrativeResynthesis`), not as a side effect of loading a variant. `off` means never. Without
   * this gate the setting would be honoured by whichever call sites remembered to read it, and the
   * pipeline's own trigger — which runs on every analysis — is the one place a reader would notice.
   *
   * Nothing is written and nothing is claimed on the way out: the report keeps the database evidence
   * and rule-based criteria it already has, and no provenance field is touched, so a surface renders
   * "not requested" rather than a degradation the reader did not experience.
   */
  if (narrativeModeOf(settings) !== "automatic") {
    return;
  }

  /**
   * The request is built from the SHARED contract, not from a list written here.
   *
   * The explicit Re-synthesize control builds its request through the same function
   * (`src/shared/narrativeEvidence.ts`), so the evidence hash the server computes is a property of one
   * run rather than of which control the reader pressed. It used to be two hand-written lists: this
   * path forwarded no `aouFrequency`, the other forwarded no `aouFrequency` either, and the route's
   * frequency sentence reads it — a field the schema accepted and nobody sent.
   *
   * Built before the `try` because the failure path below must record the SAME evidence revision the
   * request was made for, and constructing it is pure.
   */
  /*
   * The FAST evidence comes from `bpResult` — this pass's own payload — UNLESS the caller can vouch for
   * the run's current evidence, in which case that snapshot is the whole evidence set.
   *
   * Why the snapshot wins: `bpResult` carries no FoldX energetics (the stability route does not return
   * them and `createCompletedAnalysisState` never copies them), so the automatic pass used to describe
   * itself from a weaker set than the explicit Re-synthesize control — one run, two narratives, decided
   * by which control asked. The callback is read HERE, at invocation and after the mode gate, so it
   * observes the enrichment that has actually settled.
   *
   * The DEEP block comes from the same snapshot where there is one; otherwise it is read from the run's
   * latest recorded result (the language-model evaluations land on the ANALYSIS result, while the
   * stability values arrive on the biophysical response), through the one adapter.
   */
  let currentEvidence: CurrentRunEvidence | null = null;
  if (readCurrentEvidence) {
    try {
      // `undefined` and `null` both mean "no snapshot": a caller's own lookup produces either, and the
      // distinction never carries information this pass can act on.
      currentEvidence = readCurrentEvidence() ?? null;
    } catch (evidenceErr: any) {
      // A caller's getter must not be able to break the report: fall back to this pass's own payload.
      console.warn("[NarrativeService] getCurrentEvidence threw; using the biophysical payload.", evidenceErr);
      currentEvidence = null;
    }
    if (currentEvidence && !sameRun({ gene, variant }, currentEvidence.result)) {
      console.warn(
        "[NarrativeService] getCurrentEvidence returned another run's result; using this pass's payload."
      );
      currentEvidence = null;
    }
  }

  /*
   * The SaProt engine setting belongs to THIS pass's invocation, so it is filled in when the snapshot's
   * context does not carry one. Without it the language-model roster would name the card's static label
   * where the explicit control names the engine that actually served the score, and the two plans would
   * hash differently — a cache miss and no coalescing, for a difference that is not evidence.
   */
  const evidenceContext = currentEvidence
    ? {
        ...currentEvidence.context,
        saprotEngine: currentEvidence.context?.saprotEngine ?? settings?.saprotEngine ?? null,
      }
    : deepEvidenceContextFromResult(bpResult, settings?.saprotEngine ?? null);

  /** The result the plan's evidence came from — and therefore the run this synthesis is FOR. */
  const evidenceResult = currentEvidence ? currentEvidence.result : bpResult;
  /**
   * The declared run id of that evidence, which is both the stamp's record and a segment of the flight
   * key: two runs of one variant must never share a synthesis, however identical their evidence.
   */
  const evidenceRunId = pipelineRunIdOf(evidenceResult);

  const latestRunResult = getCachedVariant(gene, variant)?.analysisResult ?? bpResult;
  const deepEvidence = currentEvidence
    ? deepModelEvidenceFor(currentEvidence.result, evidenceContext)
    : deepModelEvidenceFor(latestRunResult, evidenceContext);
  const evidenceSource = currentEvidence
    ? narrativeEvidenceSourceFromResult(currentEvidence.result, evidenceContext)
    : narrativeEvidenceSourceFromResult(bpResult);
  const plan: NarrativeSynthesisRequestPlan = planNarrativeSynthesis(
    { gene, variant, uniprotId },
    evidenceSource,
    { userDirections, acmgWeighting: settings.acmgWeighting, deepEvidence }
  );

  /**
   * `baseStamp` is the provenance every install from this request carries.
   *
   * `deepEvidenceIntegrated` is read from the shared declaration and the block above is what makes it
   * true: the deep-model observations are in the request, the route validates them, and the prompt
   * renders them under rules that forbid turning a prediction into an ACMG criterion. Recording it on
   * the install is what lets a surface answer "did the prose consider the ΔΔG on screen?" from the
   * result rather than from an assurance.
   */
  const baseStamp = (): NarrativeEvidenceStamp => ({
    contractVersion: plan.contract.contractVersion,
    revision: plan.revision,
    synthesizedAt: Date.now(),
    pipelineRunId: evidenceRunId,
    deepEvidenceIntegrated: NARRATIVE_DEEP_EVIDENCE.integrated,
  });

  analysisSink.setLoadingStep("Step 4/4: Generating AI clinical narrative...");
  analysisSink.setIsClinicalLoading(false);
  /*
   * The shared flag is raised for this pass and lowered in the `finally` below only when NOTHING is
   * outstanding. Every writer of this flag holds an activity token — the automatic pass, and the owner
   * of a resynthesis flight — so "nothing outstanding" is the precise answer to "may I lower it".
   */
  analysisSink.setIsNarrativeLoading(true);

  /*
   * The narrative STAGE is running — the first time any synthesis records that fact.
   *
   * Guarded by the run's own request id: a superseded pass must not mark the CURRENT run's stage as
   * running on the strength of a request nobody is waiting for. The terminal outcome is written by the
   * shared merge (where the outcome vocabulary lives), and sibling stages ride along untouched.
   */
  if (getActiveRequestId() === requestId && !signal.aborted) {
    analysisSink.setAnalysisState((prev: any) =>
      prev?.result ? { ...prev, result: withNarrativeStageOutcome(prev.result, "running") } : prev
    );
  }

  /**
   * One span per outcome, and NO finish of the trace run.
   *
   * This function used to call `finishTraceRun(activeTraceId, "completed")` when the synthesis
   * returned. The narrative is triggered fire-and-forget by the orchestrator (`triggerNarrative`), so
   * that call finished the WHOLE pipeline's trace as soon as the narrative landed — and on a slow
   * synthesis the run was already finished before the span below was appended, which is why the
   * waterfall showed no narrative stage at all. Finishing a run is the pipeline's own business
   * (`usePipelineTelemetry.finishPipelineTrace`).
   */
  const recordNarrativeSpan = (
    status: "success" | "failed" | "unavailable",
    startedAt: number,
    error?: string
  ) => {
    if (!traceContext?.activeTraceId) return;
    const durationMs = Math.round(performance.now() - startedAt);
    traceContext.addTraceSpan({
      traceId: traceContext.activeTraceId,
      name: "AI Clinical Narrative & ACMG Synthesis",
      stage: "clinical",
      startTime: Date.now() - durationMs,
      offsetMs: traceContext.traceStart ? Math.max(0, Math.round(startedAt - traceContext.traceStart)) : 0,
      durationMs,
      status,
      ...(error ? { error } : {})
    });
  };

  const narrativeStart = performance.now();

  const installFromResponse = (narrativeData: any) => {
    if (getActiveRequestId() !== requestId || signal.aborted) return;

    /*
     * Degradation is the shared vocabulary's verdict — the flag, the reason code and the prose
     * together — not `isFallback` alone. The explicit retry path reads the same predicate, so the two
     * surfaces cannot disagree about whether the prose on screen came from a model.
     */
    const degraded = isFallbackNarrative(
      narrativeData?.analysis,
      narrativeData?.isFallback,
      narrativeData?.fallbackReason
    );

    recordNarrativeSpan(degraded ? "unavailable" : "success", narrativeStart);

    analysisSink.setAnalysisState((prev: any) => {
      if (!prev.result) return prev;
      /*
       * `prev.result` — read HERE, at write time — is the result the install merges into.
       *
       * It used to merge into the snapshot this pass held, which is how a synthesis that started
       * before the structure or the energetics landed wrote its older copy of the result back over
       * them. Only the fields a narrative owns are replaced (`mergeNarrativeFields`), and everything
       * the run produced while the request was in flight is copied forward from the latest state.
       */
      const updated = mergeNarrativeFields(
        prev.result,
        narrativeFieldsFromResponse(narrativeData ?? {}, degraded),
        baseStamp()
      );
      setCachedVariant(gene, variant, uniprotId, { analysisResult: updated });
      return {
        ...prev,
        result: updated
      };
    });
    analysisSink.setLoadingStep("");
  };

  const installFromTransportFailure = (narrativeErr: any) => {
    /*
     * A transport-level failure (the request never reached the narrative route, or the client timed
     * out) is a *degraded* report, not a broken one: the rule-based ACMG evidence already in the
     * result is still valid.
     *
     * The request guard is the fix here. This branch previously wrote whenever the signal was live,
     * so an OLD request's transport error — the variant the reader has since left, or a run the
     * store has superseded — replaced the current report's narrative with "Clinical Narrative
     * Unavailable". Superseding the run is exactly what `getActiveRequestId()` reports, and the
     * success path has always checked it; the failure path is where a stale write is easiest to miss,
     * because a rejected promise carries no payload to compare.
     */
    if (getActiveRequestId() !== requestId || signal.aborted) return;
    console.error("[NarrativeService Error] Narrative generation failed:", narrativeErr);
    recordNarrativeSpan("failed", narrativeStart, String(narrativeErr?.message || narrativeErr));
    analysisSink.setAnalysisState((prev: any) => {
      if (!prev.result) return prev;
      const updated = mergeNarrativeFields(
        prev.result,
        narrativeFieldsFromTransportFailure(String(narrativeErr?.message || narrativeErr)),
        baseStamp()
      );
      setCachedVariant(gene, variant, uniprotId, { analysisResult: updated });
      return {
        ...prev,
        result: updated
      };
    });
    analysisSink.setLoadingStep("");
  };

  /**
   * One synthesis per identity+RUN+evidence, whoever starts it.
   *
   * The automatic pass and the explicit Re-synthesize control compute the same plan from the same
   * evidence (that is what `getCurrentEvidence` is for), so within one run they hash to the same flight
   * key and share one provider call: a reader who presses the control while the automatic synthesis is
   * still running waits for it rather than paying for a second one, and an automatic pass that starts
   * while the control's request is in flight joins that instead of racing it.
   *
   * The RUN is part of the key because a re-analysis can produce identical evidence: without it, this
   * run would join the previous run's synthesis and be handed an install whose own guard refuses a
   * different `pipelineRunId` — leaving this run with no narrative at all.
   *
   * Only the OWNER's work runs. A joiner therefore installs nothing — the owner's install writes the
   * same run's narrative into the same store — and takes no activity token, because the owner's token
   * already describes the work the joiner is waiting for.
   */
  const handle = acquireNarrativeFlight(
    narrativeFlightKey({ gene, variant, uniprotId }, plan.revision, evidenceRunId),
    async (flightSignal) => {
      /*
       * Both signals: the run's own (a superseded analysis must stop paying for a response nobody will
       * read) and the flight's (a synthesis NO participant is waiting for any more). `AbortSignal.any`
       * is guarded because this module also runs under test doubles and older runtimes.
       */
      const workSignal =
        typeof (AbortSignal as any).any === "function" && flightSignal
          ? (AbortSignal as any).any([signal, flightSignal])
          : signal;

      try {
        const narrativeData = await apiClient.getNarrative(plan.request, workSignal);
        installFromResponse(narrativeData);
      } catch (narrativeErr: any) {
        if (workSignal.aborted) {
          if (getActiveRequestId() === requestId && !signal.aborted) {
            analysisSink.setAnalysisState((prev: any) =>
              prev?.result ? { ...prev, result: withNarrativeStageOutcome(prev.result, "skipped") } : prev
            );
          }
          return;
        }
        installFromTransportFailure(narrativeErr);
      }
    }
  );

  try {
    await handle.promise;
  } finally {
    handle.release();
    /*
     * The token registry is the precise test for "may the flag be lowered", and it replaces the
     * `getActiveRequestId() === requestId` guard that used to stand here.
     *
     * That guard was an approximation: it stopped a superseded run from clearing a NEWER run's flag,
     * but it also let a superseded run leave the flag RAISED forever when the run that replaced it
     * never started a narrative of its own (a reader who switched narrative mode to on-demand, or a
     * run whose variant had no sequence to synthesise from). "Nothing is outstanding" answers both
     * questions at once, because every writer of this flag holds a token.
     */
    if (!narrativeActivityOutstanding()) {
      analysisSink.setIsNarrativeLoading(false);
      analysisSink.setLoadingStep("");
    }
  }
}

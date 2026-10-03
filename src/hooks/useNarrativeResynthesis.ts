import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../context/SettingsContext";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { setCachedVariant } from "../services/pipeline/variantCache";
import { narrativeModeOf } from "../services/pipeline/analysisContext";
import { isFallbackNarrative } from "../shared/narrativeFallback";
import {
  NARRATIVE_DEEP_EVIDENCE,
  narrativeEvidenceSourceFromResult,
  pipelineRunIdOf,
  planNarrativeSynthesis,
  type NarrativeEvidenceStamp,
} from "../shared/narrativeEvidence";
import { deepEvidenceContextFromStore } from "../shared/deepModelEvidence";
import {
  acquireNarrativeFlight,
  mergeNarrativeFields,
  narrativeActivityOutstanding,
  narrativeFieldsFromResponse,
  narrativeFlightKey,
  withNarrativeStageOutcome,
} from "../shared/narrativeResynthesis";

/**
 * Re-run AI narrative synthesis for the variant currently in the store.
 *
 * Why this is a hook rather than a handler inside the report
 * ---------------------------------------------------------
 * The report view owned the only implementation, so every other surface that met a degraded
 * narrative — the Residue Shifts inspector among them — could only tell the reader *that*
 * synthesis had failed. Two hand-written copies of this would have drifted on exactly the
 * details that matter here: which diagnostics are persisted onto the result, and how a
 * degraded response merges into the previous insights.
 *
 * What the extraction had to fix as well
 * --------------------------------------
 * The inherited handler wrote its response over whatever the store held when the response
 * arrived:
 *
 *   - it never checked that the *same variant* was still loaded, so a retry started for
 *     variant A could resolve after the user had switched to B and install A's report under
 *     B's name;
 *   - it passed no `AbortSignal`, so the request could not be cancelled when the user moved on;
 *   - it merged `insights` with a spread, which *retains* AI-authored fields a degraded
 *     response does not carry (`plausibility`), leaving an AI plausibility paragraph on screen
 *     under a "rule-based only" status strip.
 *
 * What the shared modules had to fix on top of that
 * ------------------------------------------------
 * Per-instance state cannot express a fact about the SET of instances that render this control, so
 * three things moved into `src/shared/narrativeResynthesis.ts`:
 *
 *   - the in-flight promise, so two surfaces (or two mounted inspectors) share one synthesis
 *     instead of running two and letting the slower one win;
 *   - the load/unload of the store's narrative flag, so an older request finishing after a newer
 *     one has started cannot clear the newer one's spinner;
 *   - the merge itself, which the pipeline path performed differently (it named each field it kept
 *     and dropped `model`/`source`), so one synthesis rendered two ways depending on which control
 *     the reader pressed.
 *
 * The request body likewise comes from `src/shared/narrativeEvidence.ts`, so the evidence hash the
 * server computes describes the run rather than the control.
 */
export interface NarrativeResynthesis {
  /** Re-run synthesis, coalescing with any request already in flight for this identity. */
  resynthesize: () => Promise<void>;
  /** True while this hook's own call is waiting on a synthesis (its own, or a shared one). */
  isResynthesizing: boolean;
}

/** Identity as captured when the request was described, for comparison at write time. */
interface NarrativeIdentity {
  gene: string;
  variant: string;
  uniprotId: string;
  /** `metadata.pipelineRunId` of the run the request was made for, when the run declared one. */
  pipelineRunId: string | null;
}

function sameIdentity(a: NarrativeIdentity, b: NarrativeIdentity): boolean {
  return (
    a.gene.trim().toUpperCase() === b.gene.trim().toUpperCase() &&
    a.variant.trim().toLowerCase() === b.variant.trim().toLowerCase() &&
    (a.uniprotId || "").trim().toUpperCase() === (b.uniprotId || "").trim().toUpperCase()
  );
}

export function useNarrativeResynthesis(): NarrativeResynthesis {
  const { apiClient } = useApiClient();
  const { settings } = useSettings();
  const [isResynthesizing, setIsResynthesizing] = useState(false);
  /**
   * The reader's narrative mode, read through the shared resolver rather than off `settings`
   * directly: `narrativeModeOf` is where an unset or unexpected value becomes `automatic`, so this
   * hook cannot invent a third behaviour for a value the settings payload has not learned yet.
   */
  const narrativeMode = narrativeModeOf(settings);

  /**
   * This instance's detached-flight guard.
   *
   * The synchronous `resynthesize` call returns a promise the caller awaits; when the component
   * unmounts mid-flight there is nobody left to receive the result, and `release()` cancels the
   * request only if no other instance is waiting for it.
   */
  const flightRef = useRef<{ release: () => void } | null>(null);
  useEffect(() => () => flightRef.current?.release(), []);

  const resynthesize = useCallback(async () => {
    /*
     * One snapshot, so the request is described by the run it is actually for. Reading
     * gene/variant after the await is what let a stale response land on a new variant.
     */
    const store = useVariantAnalysisStore.getState();
    const result = store.analysisState.result;
    if (!result) return;

    const identity: NarrativeIdentity = {
      gene: store.gene || result.metadata?.gene || "",
      variant: store.variant || result.metadata?.variant || "",
      uniprotId: store.uniprotId || result.metadata?.uniprotId || "",
      pipelineRunId: pipelineRunIdOf(result),
    };

    /*
     * The narrative mode gate. `off` is the reader having said "do not spend a model call on this
     * report"; the control stays visible (the setting is one click away) and says so rather than
     * silently doing nothing. `on-demand` is this control by definition, so it proceeds.
     */
    if (narrativeMode === "off") {
      store.addNotification(
        "info",
        "AI narrative synthesis is turned off in Settings. Enable it there to generate a clinical report narrative."
      );
      return;
    }

    /*
     * The deep-model supplement: the stability values and the run lifecycle live in the store's
     * biophysics state, not on the analysis result (`createCompletedAnalysisState` never copies them),
     * and this is the surface that owns the live values. The same context is what a freshness check must
     * pass, so the revision it recomputes is the one recorded below.
     */
    const plan = planNarrativeSynthesis(
      { gene: identity.gene, variant: identity.variant, uniprotId: identity.uniprotId },
      narrativeEvidenceSourceFromResult(result, deepEvidenceContextFromStore(store, settings.saprotEngine ?? null)),
      { userDirections: store.userDirections, acmgWeighting: settings.acmgWeighting }
    );

    /**
     * Whether the store still holds the run this request was described for.
     *
     * The ONE guard for every write this call makes — the stage's `running` stamp as well as the terminal
     * install. The user may have moved to another variant while the request was in flight, and writing it
     * anyway would render A's clinical report under B's header.
     *
     * It compares all three identifiers, not the variant alone: a variant string is not unique across
     * genes (`p.Arg408Trp` exists in more than one protein), and the previous version passed a
     * same-variant/different-gene switch straight through. The RUN is compared too — same variant, fresh
     * analysis is a different run with different evidence, and its report must not receive the previous
     * run's prose (nor its stage outcome).
     */
    const currentRunMatches = (state: ReturnType<typeof useVariantAnalysisStore.getState>): boolean => {
      const currentResult = state.analysisState.result;
      if (!currentResult) return false;
      const currentIdentity: NarrativeIdentity = {
        gene: state.gene || currentResult.metadata?.gene || "",
        variant: state.variant || currentResult.metadata?.variant || "",
        uniprotId: state.uniprotId || currentResult.metadata?.uniprotId || "",
        pipelineRunId: pipelineRunIdOf(currentResult),
      };
      if (!sameIdentity(identity, currentIdentity)) return false;
      if (
        identity.pipelineRunId &&
        currentIdentity.pipelineRunId &&
        identity.pipelineRunId !== currentIdentity.pipelineRunId
      ) {
        return false;
      }
      return true;
    };

    setIsResynthesizing(true);
    /*
     * The shared flag is raised for this call and lowered in the `finally` below only when NOTHING is
     * outstanding. A joiner raising a flag the owner already raised is a no-op; what matters is the
     * lowering, and that is decided by the activity registry rather than by this instance — a joiner
     * that took its own token would keep the spinner raised after the work it was waiting for had
     * finished.
     */
    useVariantAnalysisStore.getState().setIsNarrativeLoading(true);

    /*
     * The narrative STAGE is running, on the run this request is for. The identity guard is the same one
     * the install uses — a stamp written into another run's result would describe that run's narrative
     * stage with an outcome belonging to this one — and a joiner marking it is harmless: the run is the
     * same, and the owner's terminal outcome replaces it.
     */
    const storeBeforeStage = useVariantAnalysisStore.getState();
    if (currentRunMatches(storeBeforeStage)) {
      storeBeforeStage.setAnalysisState((prev) =>
        prev.result ? { ...prev, result: withNarrativeStageOutcome(prev.result, "running") } : prev
      );
    }

    const handle = acquireNarrativeFlight(
      /*
       * The key carries the RUN as well as the identity and the evidence: a re-analysis of the same
       * variant can produce byte-identical evidence, and joining that run's flight would leave THIS run
       * with no narrative — the owner's install refuses a result whose `pipelineRunId` differs.
       */
      narrativeFlightKey(identity, plan.revision, identity.pipelineRunId),
      async (signal) => {
        try {
          const narrativeData = await apiClient.getNarrative(plan.request, signal);
          if (signal.aborted) return;
          if (!narrativeData?.analysis) return;

          /*
           * The identity guard. The user may have moved to another variant while this request was
           * in flight, and writing it anyway would render A's clinical report under B's header.
           *
           * It compares all three identifiers, not the variant alone: a variant string is not unique
           * across genes (`p.Arg408Trp` exists in more than one protein), and the previous version
           * passed a same-variant/different-gene switch straight through. The RUN is compared too —
           * same variant, fresh analysis is a different run with different evidence, and its report
           * must not receive the previous run's prose.
           */
          const beforeWrite = useVariantAnalysisStore.getState();
          if (!currentRunMatches(beforeWrite)) return;

          const degraded = isFallbackNarrative(
            narrativeData.analysis,
            narrativeData.isFallback,
            narrativeData.fallbackReason
          );

          /**
           * The stamp records the evidence revision the prose was written from.
           *
           * It is what makes "the narrative predates the evidence on screen" a checkable statement
           * (`narrativeFreshness`) rather than a guess, and what lets a surface disclose that
           * deep-model results are present and were never part of the synthesis — instead of implying
           * they were.
           */
          const stamp: NarrativeEvidenceStamp = {
            contractVersion: plan.contract.contractVersion,
            revision: plan.revision,
            synthesizedAt: Date.now(),
            pipelineRunId: identity.pipelineRunId,
            // Read from the declaration, so a change to what a synthesis is given cannot leave the
            // stamp asserting the old answer.
            deepEvidenceIntegrated: NARRATIVE_DEEP_EVIDENCE.integrated,
          };

          beforeWrite.setAnalysisState((prev) => {
            if (!prev.result) return prev;
            /*
             * Merge into `prev.result` — the LATEST result — not into the snapshot this request was
             * built from. Evidence that arrived while the synthesis was in flight (energetics,
             * structure, deep-model stages) is copied forward, and only the fields a narrative owns
             * are replaced.
             */
            const mergedResult = mergeNarrativeFields(
              prev.result,
              narrativeFieldsFromResponse(narrativeData, degraded),
              stamp
            );
            setCachedVariant(identity.gene, identity.variant, identity.uniprotId, {
              analysisResult: mergedResult,
            });
            return { ...prev, result: mergedResult };
          });

          const { addNotification } = useVariantAnalysisStore.getState();
          if (degraded) {
            addNotification(
              narrativeData.fallbackRetryable === false ? "warn" : "info",
              narrativeData.fallbackMessage ||
                "AI synthesis was unavailable; the report shows database-derived evidence and rule-based ACMG criteria."
            );
          } else {
            addNotification("success", "Clinical report updated with calibrated multi-layer Gemini insights.");
          }
        } catch (err: any) {
          if (signal.aborted) return;
          /*
           * The stage ENDS here, even though the report does not change.
           *
           * A manual re-synthesis that never reached the route leaves the previous narrative in place —
           * deliberately, because that prose is still this run's own — but the STEP failed, and a stage
           * left `running` would be the never-ending row this vocabulary exists to remove. `error`
           * rather than `degraded`: nothing came back at all, which is the same distinction the
           * pipeline's transport-failure installer makes. Identity-guarded like every other write here.
           */
          const storeAfterFailure = useVariantAnalysisStore.getState();
          if (currentRunMatches(storeAfterFailure)) {
            storeAfterFailure.setAnalysisState((prev) =>
              prev.result ? { ...prev, result: withNarrativeStageOutcome(prev.result, "error") } : prev
            );
          }
          storeAfterFailure.addNotification(
            "error",
            err?.message || "Failed to generate AI narrative from Gemini API."
          );
        }
      }
    );

    flightRef.current = handle;

    try {
      await handle.promise;
    } finally {
      handle.release();
      if (flightRef.current === handle) flightRef.current = null;
      setIsResynthesizing(false);
      /*
       * Lower the shared flag only when NOTHING is outstanding — not merely when THIS request
       * finished. A synthesis that started while this one was on the wire (another inspector, a
       * second variant, the pipeline's own pass) keeps the spinner, which is the fix for the stale
       * `finally`: the previous version cleared the flag unconditionally and told the reader that
       * narrative synthesis had stopped while a newer request was still running.
       */
      if (!narrativeActivityOutstanding()) {
        useVariantAnalysisStore.getState().setIsNarrativeLoading(false);
      }
    }
  }, [apiClient, settings.acmgWeighting, narrativeMode]);

  return { resynthesize, isResynthesizing };
}

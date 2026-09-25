import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../context/SettingsContext";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { setCachedVariant } from "../services/pipeline/variantCache";
import { isNarrativeFallbackReason } from "../shared/narrativeFallback";

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
 *     B's name (the store's own `updateAnalysisResultSlice` and the pipeline both guard on
 *     this; this path did not);
 *   - it passed no `AbortSignal`, so the request could not be cancelled when the user moved on;
 *   - it merged `insights` with a spread, which *retains* AI-authored fields a degraded
 *     response does not carry (`plausibility`), leaving an AI plausibility paragraph on screen
 *     under a "rule-based only" status strip.
 */
export interface NarrativeResynthesis {
  /** Re-run synthesis, coalescing with any request already in flight. */
  resynthesize: () => Promise<void>;
  /** True while this hook's own request is in flight. */
  isResynthesizing: boolean;
}

export function useNarrativeResynthesis(): NarrativeResynthesis {
  const { apiClient } = useApiClient();
  const { settings } = useSettings();
  const [isResynthesizing, setIsResynthesizing] = useState(false);

  /** Coalesces concurrent retries: two surfaces must not run two syntheses for one variant. */
  const inFlightRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const resynthesize = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;

    /*
     * One snapshot, so the request is described by the variant it is actually for. Reading
     * gene/variant after the await is what let a stale response land on a new variant.
     */
    const store = useVariantAnalysisStore.getState();
    const result = store.analysisState.result;
    if (!result) return;

    const targetGene = store.gene || result.metadata?.gene || "";
    const targetVariant = store.variant || result.metadata?.variant || "";
    const targetUniprot = store.uniprotId || result.metadata?.uniprotId || "";

    const controller = new AbortController();
    abortRef.current = controller;
    setIsResynthesizing(true);
    useVariantAnalysisStore.getState().setIsNarrativeLoading(true);

    const task = (async () => {
      try {
        const narrativeData = await apiClient.getNarrative(
          {
            gene: targetGene,
            variant: targetVariant,
            uniprotId: targetUniprot,
            userDirections: store.userDirections || undefined,
            acmgWeighting: settings.acmgWeighting,
            clinvar: result.clinvar || null,
            predictorData: result.predictorData || null,
            conservationData: result.conservationData || null,
            stringInteractions: result.stringInteractions || null,
            gnomadConstraint: result.gnomadConstraint || null,
            gnomadFrequency: result.gnomadFrequency || null,
            uniprotFeatures: result.uniprotFeatures || null,
            sequence: result.metadata?.sequence || null,
          },
          controller.signal
        );

        if (controller.signal.aborted) return;
        if (!narrativeData?.analysis) return;

        /*
         * The user may have moved to another variant while this request was in flight. Writing
         * it anyway would render A's clinical report under B's gene/variant header.
         */
        const beforeWrite = useVariantAnalysisStore.getState();
        const currentVariant = beforeWrite.variant || "";
        if (targetVariant && currentVariant && currentVariant !== targetVariant) return;

        const isDegraded =
          narrativeData.isFallback === true || isNarrativeFallbackReason(narrativeData.fallbackReason);

        const previousInsights = result.insights ?? {
          biochemicalShift: "",
          structuralImpact: "",
          acmgCriteria: [],
        };
        const nextInsights = narrativeData.insights;

        const mergedResult = {
          ...result,
          analysis: narrativeData.analysis,
          isFallback: narrativeData.isFallback ?? false,
          fallbackReason: narrativeData.fallbackReason,
          fallbackMessage: narrativeData.fallbackMessage,
          fallbackRetryable: narrativeData.fallbackRetryable,
          providerDetail: narrativeData.providerDetail,
          attemptedModels: narrativeData.attemptedModels,
          insights: nextInsights
            ? {
                // Merge rather than replace: the narrative response does not carry every field
                // the earlier pass produced.
                ...previousInsights,
                ...nextInsights,
                /*
                 * ...except where the response *declares* absence. A degraded payload carries no
                 * plausibility, and inheriting the previous pass's paragraph would print AI prose
                 * beside a rule-based status. For the AI-authored fields, absence wins.
                 */
                plausibility: isDegraded
                  ? ""
                  : nextInsights.plausibility || previousInsights.plausibility || "",
              }
            : result.insights,
        };

        beforeWrite.setAnalysisState(prev => (prev.result ? { ...prev, result: mergedResult } : prev));
        setCachedVariant(targetGene, targetVariant, targetUniprot, { analysisResult: mergedResult });

        const { addNotification } = useVariantAnalysisStore.getState();
        if (narrativeData.isFallback) {
          addNotification(
            narrativeData.fallbackRetryable === false ? "warn" : "info",
            narrativeData.fallbackMessage ||
              "AI synthesis was unavailable; the report shows database-derived evidence and rule-based ACMG criteria."
          );
        } else {
          addNotification("success", "Clinical report updated with calibrated multi-layer Gemini insights.");
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        useVariantAnalysisStore
          .getState()
          .addNotification("error", err?.message || "Failed to generate AI narrative from Gemini API.");
      } finally {
        abortRef.current = null;
        setIsResynthesizing(false);
        // Clear the shared flag through the store, so both surfaces that read it agree about
        // whether a request is still running.
        useVariantAnalysisStore.getState().setIsNarrativeLoading(false);
      }
    })();

    inFlightRef.current = task;
    try {
      await task;
    } finally {
      inFlightRef.current = null;
    }
  }, [apiClient, settings.acmgWeighting]);

  return { resynthesize, isResynthesizing };
}

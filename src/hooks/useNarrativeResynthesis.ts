import { useCallback, useState } from "react";
import { useSettings } from "../context/SettingsContext";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { setCachedVariant } from "../services/pipeline/variantCache";

/**
 * Re-run AI narrative synthesis for the variant currently in the store.
 *
 * Why this is a hook rather than a handler inside the report
 * ---------------------------------------------------------
 * The report view owned the only implementation, so every other surface that met a
 * degraded narrative — the Residue Shifts inspector among them — could only tell the
 * reader *that* synthesis had failed. Two hand-written copies of this would have
 * drifted on exactly the details that matter here: which diagnostics are persisted
 * onto the result, and whether the degraded result replaces the previous insights or
 * merges into them.
 *
 * The store is written the same way the pipeline writes it, so a re-synthesis is
 * indistinguishable from the original pass to every consumer downstream — including
 * the variant cache, which otherwise keeps serving the degraded result after a
 * successful retry.
 */
export interface NarrativeResynthesis {
  /** Re-run synthesis. Safe to call while a previous attempt is in flight. */
  resynthesize: () => Promise<void>;
  /** True while this hook's own request is in flight. */
  isResynthesizing: boolean;
}

export function useNarrativeResynthesis(): NarrativeResynthesis {
  const { apiClient } = useApiClient();
  const { settings } = useSettings();

  const gene = useVariantAnalysisStore(s => s.gene);
  const variant = useVariantAnalysisStore(s => s.variant);
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const userDirections = useVariantAnalysisStore(s => s.userDirections);
  const setAnalysisState = useVariantAnalysisStore(s => s.setAnalysisState);
  const setIsNarrativeLoading = useVariantAnalysisStore(s => s.setIsNarrativeLoading);
  const addNotification = useVariantAnalysisStore(s => s.addNotification);

  const [isResynthesizing, setIsResynthesizing] = useState(false);

  const resynthesize = useCallback(async () => {
    const result = useVariantAnalysisStore.getState().analysisState.result;
    if (!result) return;

    setIsResynthesizing(true);
    setIsNarrativeLoading(true);

    try {
      const narrativeData = await apiClient.getNarrative({
        gene: gene || result.metadata?.gene || "",
        variant: variant || result.metadata?.variant || "",
        uniprotId: uniprotId || result.metadata?.uniprotId || "",
        userDirections: userDirections || undefined,
        acmgWeighting: settings.acmgWeighting,
        clinvar: result.clinvar || null,
        predictorData: result.predictorData || null,
        conservationData: result.conservationData || null,
        stringInteractions: result.stringInteractions || null,
        gnomadConstraint: result.gnomadConstraint || null,
        gnomadFrequency: result.gnomadFrequency || null,
        uniprotFeatures: result.uniprotFeatures || null,
        sequence: result.metadata?.sequence || null,
      });

      if (!narrativeData?.analysis) return;

      const mergedResult = {
        ...result,
        analysis: narrativeData.analysis,
        isFallback: narrativeData.isFallback ?? false,
        fallbackReason: narrativeData.fallbackReason,
        fallbackMessage: narrativeData.fallbackMessage,
        fallbackRetryable: narrativeData.fallbackRetryable,
        providerDetail: narrativeData.providerDetail,
        attemptedModels: narrativeData.attemptedModels,
        // Merge rather than replace: the narrative response does not carry every
        // field the earlier pass produced, and a degraded narrative must not erase
        // evidence the rule-based pass established.
        insights: narrativeData.insights
          ? { ...result.insights, ...narrativeData.insights }
          : result.insights,
      };

      setAnalysisState(prev => (prev.result ? { ...prev, result: mergedResult } : prev));

      const targetGene = gene || result.metadata?.gene || "";
      const targetVariant = variant || result.metadata?.variant || "";
      const targetUniprot = uniprotId || result.metadata?.uniprotId || "";
      setCachedVariant(targetGene, targetVariant, targetUniprot, { analysisResult: mergedResult });

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
      addNotification("error", err?.message || "Failed to generate AI narrative from Gemini API.");
    } finally {
      setIsResynthesizing(false);
      setIsNarrativeLoading(false);
    }
  }, [
    apiClient,
    settings.acmgWeighting,
    gene,
    variant,
    uniprotId,
    userDirections,
    setAnalysisState,
    setIsNarrativeLoading,
    addNotification,
  ]);

  return { resynthesize, isResynthesizing };
}

export default useNarrativeResynthesis;

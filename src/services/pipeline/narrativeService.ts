import { TraceContext, PipelineAnalysisSink, PipelineSearchSink } from "./types";
import { setCachedVariant } from "./variantCache";

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
}

export async function generateClinicalNarrative(
  params: NarrativeGenerationParams,
  apiClient: any,
  searchSink: Pick<PipelineSearchSink, "addToHistory" | "setSelectedResidueIndex">,
  analysisSink: PipelineAnalysisSink,
  signal: AbortSignal,
  requestId: number,
  getActiveRequestId: () => number,
  traceContext?: TraceContext
): Promise<void> {
  const { gene, variant, uniprotId, userDirections, settings, bpResult } = params;

  searchSink.addToHistory(gene, variant, uniprotId);

  const posMatch = variant.match(/\d+/);
  if (posMatch) {
    searchSink.setSelectedResidueIndex(parseInt(posMatch[0], 10));
  }

  analysisSink.setLoadingStep("Step 4/4: Generating AI clinical narrative...");
  analysisSink.setIsClinicalLoading(false);
  analysisSink.setIsNarrativeLoading(true);

  try {
    const narrativeStart = performance.now();
    const narrativeData = await apiClient.getNarrative(
      {
        gene,
        variant,
        uniprotId,
        userDirections: userDirections || undefined,
        acmgWeighting: settings.acmgWeighting,
        clinvar: bpResult?.clinvar || null,
        predictorData: bpResult?.predictorData || null,
        conservationData: bpResult?.conservationData || null,
        stringInteractions: bpResult?.stringInteractions || null,
        gnomadConstraint: bpResult?.gnomadConstraint || null,
        gnomadFrequency: bpResult?.gnomadFrequency || null,
        uniprotFeatures: bpResult?.uniprotFeatures || null,
        sequence: bpResult?.metadata?.sequence || null,
        /*
         * The run's per-source outcomes. Without this the server cannot tell "ClinVar holds nothing"
         * from "the ClinVar query failed" — both arrive as a null record — and a timeout was described
         * to the model as "ClinVar was not queried", which the Population rail on the same screen
         * contradicts. The route's request schema already accepted this field; nothing was sending it.
         */
        serviceStatus: bpResult?.serviceStatus ?? bpResult?.metadata?.serviceStatus ?? null
      },
      signal
    );

    const durationMs = Math.round(performance.now() - narrativeStart);
    const offsetMs = traceContext ? Math.max(0, Math.round(narrativeStart - traceContext.traceStart)) : 0;
    if (traceContext?.activeTraceId) {
      traceContext.addTraceSpan({
        traceId: traceContext.activeTraceId,
        name: "AI Clinical Narrative & ACMG Synthesis",
        stage: "clinical",
        startTime: Date.now() - durationMs,
        offsetMs,
        durationMs,
        status: "success"
      });
      if (traceContext.finishTraceRun) {
        traceContext.finishTraceRun(traceContext.activeTraceId, "completed");
      }
    }

    if (getActiveRequestId() !== requestId || signal.aborted) return;

    analysisSink.setAnalysisState((prev: any) => {
      if (!prev.result) return prev;
      const prevInsights = prev.result.insights || {
        biochemicalShift: "",
        structuralImpact: "",
        acmgCriteria: [],
        plausibility: ""
      };
      const updatedResult = {
        ...prev.result,
        analysis: narrativeData.analysis,
        isFallback: narrativeData.isFallback ?? false,
        fallbackReason: narrativeData.fallbackReason,
        fallbackMessage: narrativeData.fallbackMessage,
        fallbackRetryable: narrativeData.fallbackRetryable,
        providerDetail: narrativeData.providerDetail,
        attemptedModels: narrativeData.attemptedModels,
        insights: {
          ...prevInsights,
          /*
           * Carry the response's OWN provenance fields (`model`, `source`) before the explicit picks
           * below overwrite the ones this reducer has an opinion about.
           *
           * The picks are exhaustive, so anything the server attached that is not named here was
           * dropped — and `model`/`source` were both. The consequence was visible: re-synthesising
           * from the Report inspector merged with a spread (`useNarrativeResynthesis`) and produced
           * "AI synthesis · gemini-3.7-flash", while the SAME synthesis run end-to-end through this
           * pipeline path produced the chip's generic "AI synthesis" fallback, because the model
           * identity had been discarded one line earlier. One fact, two renderings, decided by which
           * control the user happened to press.
           */
          ...(narrativeData.insights ?? {}),
          biochemicalShift: narrativeData.insights?.biochemicalShift || prevInsights.biochemicalShift || "",
          structuralImpact: narrativeData.insights?.structuralImpact || prevInsights.structuralImpact || "",
          acmgCriteria: narrativeData.insights?.acmgCriteria || [],
          acmgVerdict: narrativeData.insights?.acmgVerdict || prev.result.ruleBasedInsights?.acmgVerdict || "",
          partialEvidence: narrativeData.insights?.partialEvidence || prev.result.ruleBasedInsights?.partialEvidence,
          pathogenicity: narrativeData.insights?.pathogenicity || prevInsights.pathogenicity,
          /*
           * A degraded response carries no model, and the route `delete`s the key rather than sending
           * an explicit null — so the spread above cannot clear it, and `prevInsights` would restore
           * the PREVIOUS pass's model. That yields `{ source: "rule_based", model: "<old model>" }`, a
           * payload that contradicts itself. Every current consumer gates the model on the AI verdict
           * so nothing renders it today, but the next consumer would read a model that did not write
           * this text. Same treatment `plausibility` already gets two lines down.
           */
          model: (narrativeData.isFallback ? undefined : narrativeData.insights?.model) ?? undefined,
          plausibility: narrativeData.insights?.plausibility || ""
        }
      };
      setCachedVariant(gene, variant, uniprotId, { analysisResult: updatedResult });
      return {
        ...prev,
        result: updatedResult
      };
    });
  } catch (narrativeErr: any) {
    if (!signal.aborted) {
      console.error("[NarrativeService Error] Narrative generation failed:", narrativeErr);
      analysisSink.setAnalysisState((prev: any) => {
        if (!prev.result) return prev;
        /**
         * A transport-level failure (the request never reached the narrative route, or the
         * client timed out) is a *degraded* report, not a broken one: the rule-based ACMG
         * evidence in `prev.result` is still valid. Preserve it and mark the narrative as
         * unavailable rather than replacing the whole report with an error string.
         */
        const errorResult = {
          ...prev.result,
          analysis: [
            "### Clinical Narrative Unavailable",
            "",
            "The narrative synthesis request did not complete, so this report contains the " +
            "database-derived evidence and rule-based ACMG/AMP assessment only.",
            "",
            "Use **Re-synthesize** to retry, or check the **Console** tab for the underlying request error.",
          ].join("\n"),
          isFallback: true,
          fallbackReason: "SERVICE_UNAVAILABLE",
          fallbackMessage: "The narrative request did not complete. The rule-based evidence below is unaffected.",
          fallbackRetryable: true,
          providerDetail: String(narrativeErr?.message || narrativeErr),
        };
        setCachedVariant(gene, variant, uniprotId, { analysisResult: errorResult });
        return {
          ...prev,
          result: errorResult
        };
      });
    }
  } finally {
    if (getActiveRequestId() === requestId) {
      analysisSink.setIsNarrativeLoading(false);
    }
  }
}

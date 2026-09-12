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
        sequence: bpResult?.metadata?.sequence || null
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
        insights: {
          ...prevInsights,
          biochemicalShift: narrativeData.insights?.biochemicalShift || prevInsights.biochemicalShift || "",
          structuralImpact: narrativeData.insights?.structuralImpact || prevInsights.structuralImpact || "",
          acmgCriteria: narrativeData.insights?.acmgCriteria || [],
          acmgVerdict: narrativeData.insights?.acmgVerdict || prev.result.ruleBasedInsights?.acmgVerdict || "",
          partialEvidence: narrativeData.insights?.partialEvidence || prev.result.ruleBasedInsights?.partialEvidence,
          pathogenicity: narrativeData.insights?.pathogenicity || prevInsights.pathogenicity,
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
        const errorResult = {
          ...prev.result,
          analysis: `### ❌ Narrative Generation Failed\n\nAn error occurred while generating the clinical narrative: **${narrativeErr.message || narrativeErr}**.\n\nPlease check your network connection or API key settings and try again.`,
          isFallback: true,
          fallbackReason: "SERVICE_UNAVAILABLE"
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

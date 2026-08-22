import { TraceContext, TranslatedVariantResult } from "./types";
import { parseVariantCoordinate } from "../../shared/variantCoordinate.ts";

export function toFoldxMutation(proteinVariant: string): string | null {
  try {
    const coord = parseVariantCoordinate(proteinVariant);
    return coord.foldxCode;
  } catch (_) {
    return null;
  }
}

export function isGenomicOrCdnaNotation(variant: string): boolean {
  const trimmed = variant.trim();
  return (
    /^(?:chr)?[0-9XYMT]+:g\./i.test(trimmed) ||
    /^(?:chr)?[0-9XYMT]+-\d+-[ACGTN]+-[ACGTN]+/i.test(trimmed) ||
    /^(?:[A-Z0-9_.]+:)?c\.\d+/i.test(trimmed) ||
    /^(?:[A-Z0-9_.]+:)?g\.\d+/i.test(trimmed) ||
    /^(?:chr)?[0-9XYMT]+:\d+/i.test(trimmed) ||
    /^chr/i.test(trimmed)
  );
}

export async function translateVariantNotation(
  notation: string,
  apiClient: any,
  signal: AbortSignal,
  callbacks?: {
    setAnalysisState?: (fn: any) => void;
    setLoadingStep?: (step: string) => void;
  },
  traceContext?: TraceContext
): Promise<TranslatedVariantResult> {
  if (callbacks?.setAnalysisState) {
    callbacks.setAnalysisState((prev: any) => ({ ...prev, isLoading: true, error: null }));
  }
  if (callbacks?.setLoadingStep) {
    callbacks.setLoadingStep("Step 1/4: Translating genomic / cDNA variant notation via Ensembl VEP...");
  }

  const startTime = performance.now();
  try {
    const data = await apiClient.translateVariant(notation, signal);
    const durationMs = Math.round(performance.now() - startTime);
    const offsetMs = traceContext ? Math.max(0, Math.round(startTime - traceContext.traceStart)) : 0;

    if (traceContext?.activeTraceId) {
      traceContext.addTraceSpan({
        traceId: traceContext.activeTraceId,
        name: "Genomic & cDNA Notation Translation (VEP)",
        stage: "genomics",
        startTime: Date.now() - durationMs,
        offsetMs,
        durationMs,
        status: "success",
        meta: { gene: data.gene, variant: data.variant, transcriptId: data.transcriptId }
      });
    }

    return {
      gene: data.gene,
      variant: data.variant,
      uniprotId: data.uniprotId,
      transcriptMeta: {
        transcriptId: data.transcriptId,
        isManeSelect: data.isManeSelect,
        isManePlusClinical: data.isManePlusClinical,
        isCanonical: data.isCanonical,
        maneRefSeqId: data.maneRefSeqId,
        transcriptWarning: data.transcriptWarning
      }
    };
  } catch (err: any) {
    const durationMs = Math.max(1, Math.round(performance.now() - startTime));
    if (traceContext?.activeTraceId) {
      traceContext.addTraceSpan({
        traceId: traceContext.activeTraceId,
        name: "Genomic & cDNA Notation Translation (VEP)",
        stage: "genomics",
        startTime: Date.now(),
        offsetMs: Math.max(0, Math.round(performance.now() - (traceContext.traceStart || performance.now()))),
        durationMs,
        status: "failed",
        error: err.message || "Failed to translate notation"
      });
    }
    if (signal.aborted) throw err;
    throw new Error(err.message || "Failed to translate notation");
  }
}

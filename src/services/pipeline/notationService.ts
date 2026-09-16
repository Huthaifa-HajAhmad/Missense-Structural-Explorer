import { TraceContext, TranslatedVariantResult } from "./types";
import { parseVariantCoordinate } from "../../shared/variantCoordinate.ts";

// ── Notation grammar is centralized in src/shared/variantNotation.ts ──────────
// Re-exported here so existing import paths (`./notationService`,
// `../useAnalysisPipeline`) keep resolving. Never re-declare these patterns locally:
// the copy that used to live here had drifted from the server's gate and the React
// inputs, and its `/^chr/i` catch-all mis-routed gene symbols such as CHRD to VEP.
export {
  isGenomicOrCdnaNotation,
  isProteinNotation,
  classifyNotation,
  detectAssemblyAnnotation,
  normalizeGenomicNotation,
  ACCEPTED_NOTATION_EXAMPLES,
  ACCEPTED_NOTATION_SUMMARY,
  type NotationDescriptor,
  type NotationKind,
  type GenomeAssembly,
} from "../../shared/variantNotation.ts";

export function toFoldxMutation(proteinVariant: string): string | null {
  try {
    const coord = parseVariantCoordinate(proteinVariant);
    return coord.foldxCode;
  } catch (_) {
    return null;
  }
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
        transcriptWarning: data.transcriptWarning,
        // Preserved so callers/reports can state which build the coordinate resolved against.
        assembly: data.assembly,
        assemblyNote: data.assemblyNote
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

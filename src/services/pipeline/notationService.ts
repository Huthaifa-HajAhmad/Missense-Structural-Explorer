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
    callbacks.setLoadingStep("Step 1/4: Translating genomic / cDNA variant notation…");
  }

  const startTime = performance.now();
  try {
    const data = await apiClient.translateVariant(notation, signal);
    const durationMs = Math.round(performance.now() - startTime);
    const offsetMs = traceContext ? Math.max(0, Math.round(startTime - traceContext.traceStart)) : 0;

    // Name the span after the provider that ACTUALLY answered. Hardcoding "(VEP)" attributed a
    // VariantValidator fallback resolution to Ensembl, which is wrong in the audit trail and
    // contradicts the telemetry rail, where the same reader is told the fallback has taken over.
    const providerLabel = data.provenance?.providerLabel || "Ensembl VEP";
    const spanName = data.provenance?.usedFallback
      ? `Genomic & cDNA Notation Translation (${providerLabel} fallback)`
      : `Genomic & cDNA Notation Translation (${providerLabel})`;

    if (traceContext?.activeTraceId) {
      traceContext.addTraceSpan({
        traceId: traceContext.activeTraceId,
        name: spanName,
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
        // Numbering basis of the returned variant, and — when the MANE notation had to be
        // renumbered onto the canonical isoform — the record of what changed, so downstream
        // surfaces can disclose it instead of quietly reporting a different residue number.
        uniprotIsoform: data.uniprotIsoform,
        numberingRemap: data.numberingRemap,
        // Preserved so callers/reports can state which build the coordinate resolved against.
        assembly: data.assembly,
        assemblyNote: data.assemblyNote
      },
      // Carried through rather than dropped, so downstream surfaces can disclose a degraded
      // provider. VariantValidator returns no UniProt accession and no Ensembl transcript id,
      // so a fallback resolution is materially poorer and must not look identical to a normal one.
      provenance: data.provenance
        ? {
            provider: data.provenance.provider,
            providerLabel: data.provenance.providerLabel,
            usedFallback: data.provenance.usedFallback,
            cacheHit: data.provenance.cacheHit
          }
        : undefined
    };
  } catch (err: any) {
    const durationMs = Math.max(1, Math.round(performance.now() - startTime));
    if (traceContext?.activeTraceId) {
      traceContext.addTraceSpan({
        traceId: traceContext.activeTraceId,
        name: "Genomic & cDNA Notation Translation",
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

/**
 * variantHeaderModel.ts — everything the variant chrome shows, derived once from the result.
 *
 * The header is two pieces of chrome now: the variant's IDENTITY in the top bar (gene, HGVS,
 * transcript, coordinate, UniProt) and a one-line CONTEXT strip under it (gene constraint, notes, run
 * state). Both read this model, so they cannot disagree about which notation leads, which transcript
 * tier applies, or whether the run is degraded — and the decisions are testable without rendering.
 *
 * Pure. `useVariantHeaderModel` is a memoising wrapper for components.
 */
import { useMemo } from "react";
import type { AnalysisResult } from "../../types";
import { parseVariantCoordinate } from "../../shared/variantCoordinate";
import { variantNumberingView } from "../../shared/numbering";
import { isFallbackLocus, isRetryableFallbackLocus, fallbackLocusShortLabel } from "../../shared/locusResolution";
import { buildConstraintMetrics, type VhMetric } from "./constraintMetrics";

export type TierTone = "good" | "clay" | "warn" | "muted";

export interface VariantHeaderModel {
  gene: string;
  /** The notation the header LEADS with: the lab's (reported) one when a remap happened. */
  headlineVariant: string;
  /** Set when the leading notation was converted for modelling: what it was modelled as. */
  modelledBasis: { modelled: string; note: string | null } | null;
  transcript: { id: string; tier: { tone: TierTone; label: string | null }; title: string } | null;
  coordinate: { id: string; assemblyKey: "GRCh37" | "GRCh38" | null; title: string; srLabel: string } | null;
  uniprotId: string | null;
  splice: { distance: number } | null;
  metrics: VhMetric[];
  /**
   * The run's state, when it is not clean. A degraded run must never look like a finished one in the
   * chrome: this is the fixed slot the strip renders it in.
   */
  runState: { label: string; detail: string; retryable: boolean } | null;
}

export interface VariantHeaderInput {
  gene: string;
  variant: string;
  uniprotId: string;
  analysisResult: AnalysisResult | null;
}

function hgvsp3(notation: string): string {
  try {
    return parseVariantCoordinate(notation).hgvsp3;
  } catch {
    return notation;
  }
}

export function buildVariantHeaderModel({ gene, variant, uniprotId, analysisResult }: VariantHeaderInput): VariantHeaderModel {
  const result = analysisResult;
  const pred = result?.predictorData;

  // ── Notation: the reported (lab) numbering leads when a remap converted it for modelling ──
  const numbering = variantNumberingView({
    variant,
    uniprotId,
    numberingRemap: (result as any)?.numberingRemap ?? null,
  });
  const formatted = variant ? hgvsp3(variant) : "";
  const headlineVariant = numbering.remapped && numbering.reported ? hgvsp3(numbering.reported) : formatted;
  const modelledBasis =
    numbering.remapped && numbering.modelled
      ? { modelled: `${numbering.modelled}${uniprotId ? ` on canonical ${uniprotId}` : ""}`, note: numbering.basisNote ?? null }
      : null;

  // ── Transcript and its tier ──
  const transcriptId = result?.transcriptId ?? pred?.transcriptId ?? null;
  const maneRefSeqId = result?.maneRefSeqId ?? pred?.maneRefSeqId ?? null;
  const displayTranscript = maneRefSeqId?.trim() || transcriptId || null;
  const tier = (result?.isManeSelect ?? pred?.isManeSelect)
    ? { tone: "good" as const, label: "MANE Select", suffix: "MANE Select — clinical gold standard" }
    : (result?.isManePlusClinical ?? pred?.isManePlusClinical)
      ? { tone: "clay" as const, label: "MANE+Clin", suffix: "MANE Plus Clinical" }
      : (result?.isCanonical ?? pred?.isCanonical)
        ? { tone: "warn" as const, label: "Ensembl Canonical", suffix: "Ensembl canonical transcript" }
        : { tone: "muted" as const, label: null, suffix: "alternative / fallback transcript" };

  // ── Coordinate: the build travels with it and is never assumed (see predictorData contract) ──
  const genomicId = pred?.gnomadVariantId ?? null;
  const assembly = pred?.gnomadVariantAssembly ?? null;
  const assemblyKey = assembly === "GRCh37" || assembly === "GRCh38" ? assembly : null;

  // ── Run state: the fixed slot a degraded run is announced in ──
  let runState: VariantHeaderModel["runState"] = null;
  if (isFallbackLocus(result)) {
    runState = {
      label: fallbackLocusShortLabel(assembly),
      detail: "The GRCh38 lookup did not complete on this run, so population evidence and the other GRCh38-only sources were not assessed.",
      retryable: isRetryableFallbackLocus(result),
    };
  } else {
    const gnomadStatus = result?.serviceStatus?.gnomadFrequency ?? result?.metadata?.serviceStatus?.gnomadFrequency;
    if (gnomadStatus === "timeout" || gnomadStatus === "error") {
      runState = {
        label: "gnomAD did not answer",
        detail: "The gnomAD frequency query did not complete on this run, so population evidence is incomplete.",
        retryable: true,
      };
    }
  }

  const splice = result?.conservationData?.spliceProximity;

  return {
    gene,
    headlineVariant,
    modelledBasis,
    transcript: displayTranscript
      ? { id: displayTranscript, tier: { tone: tier.tone, label: tier.label }, title: `Transcript ${displayTranscript} — ${tier.suffix}` }
      : null,
    coordinate: genomicId
      ? {
          id: genomicId,
          assemblyKey,
          title: `${assembly ?? "Build not reported"} genomic coordinates ${genomicId}`,
          srLabel: assembly ? `${assembly} coordinates ` : "Coordinates, build not reported, ",
        }
      : null,
    uniprotId: uniprotId || null,
    splice: splice?.isNearSpliceSite && typeof splice.distance === "number" ? { distance: splice.distance } : null,
    metrics: buildConstraintMetrics(result),
    runState,
  };
}

export function useVariantHeaderModel(input: VariantHeaderInput): VariantHeaderModel {
  const { gene, variant, uniprotId, analysisResult } = input;
  return useMemo(
    () => buildVariantHeaderModel({ gene, variant, uniprotId, analysisResult }),
    [gene, variant, uniprotId, analysisResult]
  );
}

import { parseGenomicCoordinateString } from "../contracts.ts";
import { THRESHOLDS } from "../thresholds/constants.ts";
import { meetsHighBound, type ThresholdBound, type VcepInsilicoRule } from "./vcepTypes.ts";

export interface SpliceAiFailureLike {
  kind: string;
  httpStatus?: number | null;
  detail?: string | null;
}

export interface SpliceAiChannels {
  ds_ag?: number | null;
  ds_al?: number | null;
  ds_dg?: number | null;
  ds_dl?: number | null;
}

export interface SplicePredictorDataLike {
  gnomadVariantId?: string | null;
  gnomadVariantAssembly?: string | null;
  locusResolution?: {
    canonicalBy?: string | null;
    failureKind?: string | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface SpliceConservationDataLike {
  spliceai?: (SpliceAiChannels & { max_ds?: number | null }) | null;
  modelStatus?: { spliceai?: "pending" | "settled" | "timeout" | string | null; [key: string]: unknown } | null;
  spliceaiFailure?: SpliceAiFailureLike | null;
  assemblyRefusals?: ReadonlyArray<{ source?: string; reason?: string }> | null;
  [key: string]: unknown;
}

export interface SpliceServiceStatusLike {
  predictorData?: string | null;
  conservationData?: string | null;
  [key: string]: unknown;
}

export interface SpliceAiGateInput {
  maxDs: number | null;
  status: "pending" | "settled" | "timeout" | null;
  failure: SpliceAiFailureLike | null;
  coordinateBlocked: boolean;
  coordinateReason: string | null;
  channels?: SpliceAiChannels | null;
}

export type SpliceBp4Gate =
  | { status: "blocked"; maxDs: number; reason: string }
  | { status: "withheld-transient"; retryable: true; failureKind: string | null; reason: string }
  | { status: "withheld-coordinate"; retryable: false; reason: string }
  | { status: "passed-indeterminate-splicing"; maxDs: number; note: string }
  | { status: "passed"; maxDs: number }
  | { status: "applied-no-transcript"; note: string }
  | { status: "applied-unassessed"; note: string };

export interface SplicePp3Call {
  code: "PP3" | "PP3_Moderate";
  strength: "Supporting" | "Moderate";
  maxDs: number;
  source: string;
  reason: string;
}

const TRANSIENT_SPLICE_FAILURES = new Set(["rate-limited", "timeout", "upstream-error", "network", "unreadable"]);

export function finiteScore(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** True only when `predictorData` carries a parseable genomic coordinate with an explicit assembly supported by SpliceAI. */
export function hasValidSpliceCoordinate(predictorData: SplicePredictorDataLike | null | undefined): boolean {
  const id = predictorData?.gnomadVariantId;
  const assembly = predictorData?.gnomadVariantAssembly;
  if (typeof id !== "string" || !parseGenomicCoordinateString(id)) return false;
  return assembly === "GRCh38" || assembly === "GRCh37";
}

function resolveCoordinateBlock(
  predictorData: SplicePredictorDataLike | null | undefined,
  conservationData: SpliceConservationDataLike | null | undefined,
  serviceStatus: SpliceServiceStatusLike | null | undefined,
  failure: SpliceAiFailureLike | null,
  maxDs: number | null,
): { blocked: boolean; reason: string | null } {
  if (failure?.kind === "coordinate-rejected") {
    return { blocked: true, reason: "SpliceAI rejected this coordinate, so splicing cannot be cleared for BP4." };
  }
  const refusal = conservationData?.assemblyRefusals?.find?.(r => r.source === "spliceai-lookup");
  if (refusal) {
    return { blocked: true, reason: refusal.reason ?? "SpliceAI did not score this coordinate's genome build, so BP4 is withheld." };
  }
  const locus = predictorData?.locusResolution;
  if (locus?.failureKind === "multiple-candidates" || locus?.failureKind === "ambiguous-allele") {
    return { blocked: true, reason: "The protein change maps to multiple nucleotide alleles, so splicing was not checked and BP4 is withheld." };
  }
  if (locus && locus.canonicalBy === null && !hasValidSpliceCoordinate(predictorData)) {
    return { blocked: true, reason: "No verified GRCh38 nucleotide locus was established, so splicing was not checked and BP4 is withheld." };
  }
  const predStatus = serviceStatus?.predictorData;
  if (predStatus === "timeout" || predStatus === "error" || predStatus === "not_found") {
    return {
      blocked: true,
      reason: predStatus === "not_found"
        ? "No nucleotide coordinate was found for this variant, so splicing was not checked and BP4 is withheld."
        : "Coordinate resolution did not finish, so splicing was not checked and BP4 is withheld.",
    };
  }
  if (predictorData != null && "gnomadVariantId" in predictorData && predictorData.gnomadVariantId == null) {
    return { blocked: true, reason: "No nucleotide locus was resolved for this variant, so splicing was not checked and BP4 is withheld." };
  }
  if (conservationData?.modelStatus?.spliceai === "settled" && maxDs === null && failure === null) {
    return { blocked: true, reason: "SpliceAI could not run without a resolved nucleotide coordinate, so BP4 is withheld." };
  }
  return { blocked: false, reason: null };
}

/**
 * Extracts the SpliceAI gate inputs identically for both the ACMG engine and UI surfaces.
 */
export function resolveSpliceAiGateInput(params: {
  predictorData?: SplicePredictorDataLike | null;
  conservationData?: SpliceConservationDataLike | null;
  serviceStatus?: SpliceServiceStatusLike | null;
}): SpliceAiGateInput {
  const { predictorData, conservationData, serviceStatus } = params;
  const sp = conservationData?.spliceai;
  const maxDs = finiteScore(sp?.max_ds);
  const rawExplicit = conservationData?.modelStatus?.spliceai;
  const explicitStatus = rawExplicit === "pending" || rawExplicit === "settled" || rawExplicit === "timeout" ? rawExplicit : null;
  const compositeStatus = serviceStatus?.conservationData;
  const status = explicitStatus ?? (
    compositeStatus === "pending" ? "pending"
    : compositeStatus === "timeout" || compositeStatus === "error" ? "timeout"
    : null
  );
  const failure = conservationData?.spliceaiFailure ?? null;
  const coord = resolveCoordinateBlock(predictorData, conservationData, serviceStatus, failure, maxDs);
  return {
    maxDs,
    status,
    failure,
    coordinateBlocked: coord.blocked,
    coordinateReason: coord.reason,
    channels: sp ? {
      ds_ag: finiteScore(sp.ds_ag),
      ds_al: finiteScore(sp.ds_al),
      ds_dg: finiteScore(sp.ds_dg),
      ds_dl: finiteScore(sp.ds_dl),
    } : null,
  };
}

function formatBoundCut(bound: ThresholdBound): string {
  const sym = bound.inclusive ? "≥" : ">";
  const num = bound.threshold === 0 ? "0" : bound.threshold.toFixed(2);
  return `${sym} ${num}`;
}

function evaluateMissingSpliceBp4(spliceAi: SpliceAiGateInput): SpliceBp4Gate {
  const failureKind = spliceAi.failure?.kind ?? null;
  if (spliceAi.status === "pending" || spliceAi.status === "timeout" || (failureKind !== null && TRANSIENT_SPLICE_FAILURES.has(failureKind))) {
    return {
      status: "withheld-transient",
      retryable: true,
      failureKind,
      reason: "BP4 withheld: SpliceAI did not finish scoring this variant; re-run to check splicing before accepting BP4.",
    };
  }
  if (spliceAi.coordinateBlocked) {
    return {
      status: "withheld-coordinate",
      retryable: false,
      reason: spliceAi.coordinateReason ?? "BP4 withheld: SpliceAI lacked a valid nucleotide coordinate to rule out splice impact.",
    };
  }
  if (failureKind === "no-transcript") {
    return {
      status: "applied-no-transcript",
      note: "SpliceAI returned no scored GENCODE transcript at this locus; verify splicing manually.",
    };
  }
  return {
    status: "applied-unassessed",
    note: "SpliceAI had no score in this payload; verify splicing manually.",
  };
}

export function evaluateSpliceBp4Gate(
  spliceAi: SpliceAiGateInput | null | undefined,
  vcepRule?: VcepInsilicoRule | null,
): SpliceBp4Gate {
  if (!spliceAi) {
    return {
      status: "applied-unassessed",
      note: "SpliceAI was not assessed on this call; check splicing separately.",
    };
  }
  if (spliceAi.maxDs === null) return evaluateMissingSpliceBp4(spliceAi);
  // Walker 2023 >= 0.20 always blocks BP4 regardless of looser VCEP wording.
  if (spliceAi.maxDs >= THRESHOLDS.spliceai.splicingPp3) {
    return {
      status: "blocked",
      maxDs: spliceAi.maxDs,
      reason: `BP4 withheld: SpliceAI max Δ ${spliceAi.maxDs.toFixed(2)} ≥ ${THRESHOLDS.spliceai.splicingPp3.toFixed(2)} (Walker et al. 2023) indicates potential splice disruption.`,
    };
  }
  const vcepBlock = vcepRule?.splice?.bp4Block;
  if (vcepBlock && meetsHighBound(spliceAi.maxDs, vcepBlock)) {
    return {
      status: "blocked",
      maxDs: spliceAi.maxDs,
      reason: `BP4 withheld: SpliceAI max Δ ${spliceAi.maxDs.toFixed(2)} ${formatBoundCut(vcepBlock)} (${vcepRule!.vcep}, ${vcepRule!.cspecId} v${vcepRule!.version}) blocks BP4.`,
    };
  }
  if (spliceAi.maxDs > THRESHOLDS.spliceai.splicingBp4Below) {
    return {
      status: "passed-indeterminate-splicing",
      maxDs: spliceAi.maxDs,
      note: `SpliceAI max Δ ${spliceAi.maxDs.toFixed(2)} sits in the splicing indeterminate zone (0.10–0.20, below the 0.20 block).`,
    };
  }
  return { status: "passed", maxDs: spliceAi.maxDs };
}

function evaluateNf1SplicePp3(spliceAi: SpliceAiGateInput, vcepRule: VcepInsilicoRule): SplicePp3Call | null {
  const maxDs = spliceAi.maxDs!;
  const gainMax = Math.max(spliceAi.channels?.ds_ag ?? 0, spliceAi.channels?.ds_dg ?? 0);
  const lossMax = Math.max(spliceAi.channels?.ds_al ?? 0, spliceAi.channels?.ds_dl ?? 0);
  const source = `${vcepRule.vcep} (${vcepRule.cspecId} v${vcepRule.version})`;
  if (maxDs >= 0.6) {
    return {
      code: "PP3",
      strength: "Supporting",
      maxDs,
      source,
      reason: `SpliceAI max Δ ${maxDs.toFixed(2)} ≥ 0.60 (${source}) supports splicing PP3.`,
    };
  }
  if (gainMax >= 0.4 && lossMax >= 0.4) {
    return {
      code: "PP3",
      strength: "Supporting",
      maxDs,
      source,
      reason: `SpliceAI paired gain (${gainMax.toFixed(2)}) and loss (${lossMax.toFixed(2)}) ≥ 0.40 (${source}) supports splicing PP3.`,
    };
  }
  return null;
}

/** Evaluates splicing PP3 under Walker 2023 or the gene's VCEP rule; never applied alongside PVS1. */
export function evaluateSplicePp3(
  spliceAi: SpliceAiGateInput | null | undefined,
  vcepRule?: VcepInsilicoRule | null,
  hasPvs1 = false,
): SplicePp3Call | null {
  if (hasPvs1 || !spliceAi || spliceAi.maxDs === null || spliceAi.coordinateBlocked || spliceAi.failure !== null) return null;
  const maxDs = spliceAi.maxDs;
  const spec = vcepRule?.splice?.pp3Missense;
  if (spec === "none") return null;
  if (spec === "nf1") return evaluateNf1SplicePp3(spliceAi, vcepRule!);
  if (spec) {
    const source = `${vcepRule!.vcep} (${vcepRule!.cspecId} v${vcepRule!.version})`;
    if (spec.Moderate && meetsHighBound(maxDs, spec.Moderate)) {
      return {
        code: "PP3_Moderate",
        strength: "Moderate",
        maxDs,
        source,
        reason: `SpliceAI max Δ ${maxDs.toFixed(2)} ${formatBoundCut(spec.Moderate)} (${source}) supports splicing PP3 Moderate.`,
      };
    }
    if (spec.Supporting && meetsHighBound(maxDs, spec.Supporting)) {
      return {
        code: "PP3",
        strength: "Supporting",
        maxDs,
        source,
        reason: `SpliceAI max Δ ${maxDs.toFixed(2)} ${formatBoundCut(spec.Supporting)} (${source}) supports splicing PP3.`,
      };
    }
    return null;
  }
  if (maxDs >= THRESHOLDS.spliceai.splicingPp3) {
    return {
      code: "PP3",
      strength: "Supporting",
      maxDs,
      source: "Walker et al. 2023",
      reason: `SpliceAI max Δ ${maxDs.toFixed(2)} ≥ ${THRESHOLDS.spliceai.splicingPp3.toFixed(2)} (Walker et al. 2023) supports splicing PP3.`,
    };
  }
  return null;
}

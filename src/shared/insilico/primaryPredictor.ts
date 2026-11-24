import {
  CALIBRATION_SOURCES,
  PP3_BP4_CALIBRATION,
  calibratedCall,
  type CalibratedCall,
  type EvidenceStrength,
} from "../thresholds/calibration.ts";
import { THRESHOLDS } from "../thresholds/constants.ts";
import { lookupVcepInsilicoRule, type VcepInsilicoRule } from "./vcepRules.ts";

/** Settled fallback order (Phase 5a decision, 2026-11-24): REVEL -> BayesDel noAF -> AlphaMissense -> ESM1b. */
export const PRIMARY_PREDICTOR_CHAIN = ["revel", "bayesdel", "alphaMissense", "esm1b"] as const;
export type ChainToolKey = (typeof PRIMARY_PREDICTOR_CHAIN)[number];

export const CHAIN_TOOL_LABEL: Record<ChainToolKey, string> = {
  revel: "REVEL",
  bayesdel: "BayesDel noAF",
  alphaMissense: "AlphaMissense",
  esm1b: "ESM1b",
};

export type InsilicoCriterionCode =
  | "PP3"
  | "PP3_Moderate"
  | "PP3_Strong"
  | "BP4"
  | "BP4_Moderate"
  | "BP4_Strong"
  | "BP4_VeryStrong";

export interface ChainToolScore {
  key: ChainToolKey;
  label: string;
  score: number | null;
  call: CalibratedCall | null;
  sourceCitation: string | null;
}

export interface DisagreeingChainTool {
  key: ChainToolKey;
  label: string;
  score: number;
  call: CalibratedCall;
}

export interface SpliceAiFailureLike {
  kind: string;
  httpStatus?: number | null;
  detail?: string | null;
}

export interface SpliceAiGateInput {
  maxDs: number | null;
  status: "pending" | "settled" | "timeout" | null;
  failure: SpliceAiFailureLike | null;
  coordinateBlocked: boolean;
  coordinateReason: string | null;
}

export type SpliceBp4Gate =
  | { status: "blocked"; maxDs: number; reason: string }
  | { status: "withheld-transient"; retryable: true; failureKind: string | null; reason: string }
  | { status: "withheld-coordinate"; retryable: false; reason: string }
  | { status: "passed-indeterminate-splicing"; maxDs: number; note: string }
  | { status: "passed"; maxDs: number }
  | { status: "applied-no-transcript"; note: string }
  | { status: "applied-unassessed"; note: string };

export interface PrimaryInsilicoInput {
  gene?: string | null;
  scores: Partial<Record<ChainToolKey, number | null | undefined>>;
  baseStatus?: "pending" | "settled" | "timeout" | null;
  spliceAi?: SpliceAiGateInput | null;
  vcepRule?: VcepInsilicoRule | null;
}

export interface PrimaryInsilicoDecision {
  outcome: "met" | "indeterminate" | "no-score" | "blocked-spliceai" | "withheld-spliceai" | "withheld-base";
  code: InsilicoCriterionCode | null;
  direction: "PP3" | "BP4" | null;
  strength: EvidenceStrength | null;
  activeTool: ChainToolKey | null;
  activeScore: number | null;
  activeCall: CalibratedCall | null;
  skippedBefore: ChainToolKey[];
  chain: ChainToolScore[];
  disagreeingTools: DisagreeingChainTool[];
  spliceGate: SpliceBp4Gate | null;
  vcepRule: VcepInsilicoRule | null;
}

const TRANSIENT_SPLICE_FAILURES = new Set(["rate-limited", "timeout", "upstream-error", "network", "unreadable"]);

function finiteScore(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function sourceCitationFor(tool: ChainToolKey): string {
  return CALIBRATION_SOURCES[PP3_BP4_CALIBRATION[tool].source].short;
}

function resolveCoordinateBlock(
  predictorData: any,
  conservationData: any,
  serviceStatus: any,
  failure: SpliceAiFailureLike | null,
): { blocked: boolean; reason: string | null } {
  if (failure?.kind === "coordinate-rejected") {
    return { blocked: true, reason: "SpliceAI rejected this coordinate, so splicing cannot be cleared for BP4." };
  }
  const refusal = conservationData?.assemblyRefusals?.find?.((r: { source?: string; reason?: string }) => r.source === "spliceai-lookup");
  if (refusal) {
    return { blocked: true, reason: refusal.reason ?? "SpliceAI did not score this coordinate's genome build, so BP4 is withheld." };
  }
  const locus = predictorData?.locusResolution;
  if (locus?.failureKind === "multiple-candidates" || locus?.failureKind === "ambiguous-allele") {
    return { blocked: true, reason: "The protein change maps to multiple nucleotide alleles, so splicing was not checked and BP4 is withheld." };
  }
  if (locus?.route === "fallback" && locus?.canonicalBy === null) {
    return { blocked: true, reason: "No verified GRCh38 nucleotide locus was established, so splicing was not checked and BP4 is withheld." };
  }
  if (serviceStatus?.predictorData === "timeout" || serviceStatus?.predictorData === "error") {
    return { blocked: true, reason: "Coordinate resolution did not finish, so splicing was not checked and BP4 is withheld." };
  }
  return { blocked: false, reason: null };
}

/**
 * Extracts the SpliceAI gate inputs identically for both the ACMG engine and UI surfaces.
 */
export function resolveSpliceAiGateInput(params: {
  predictorData?: any;
  conservationData?: any;
  serviceStatus?: any;
}): SpliceAiGateInput {
  const { predictorData, conservationData, serviceStatus } = params;
  const maxDs = finiteScore(conservationData?.spliceai?.max_ds);
  const explicitStatus = conservationData?.modelStatus?.spliceai ?? null;
  const compositeStatus = serviceStatus?.conservationData;
  const status = explicitStatus ?? (
    compositeStatus === "pending" ? "pending"
    : compositeStatus === "timeout" || compositeStatus === "error" ? "timeout"
    : null
  );
  const failure = conservationData?.spliceaiFailure ?? null;
  const coord = resolveCoordinateBlock(predictorData, conservationData, serviceStatus, failure);
  return {
    maxDs,
    status,
    failure,
    coordinateBlocked: coord.blocked,
    coordinateReason: coord.reason,
  };
}

/**
 * Builds the `PrimaryInsilicoInput` from an analysis payload or engine input object.
 * AlphaMissense reads numeric `amPathogenicity` only (never `amClass`).
 */
export function primaryInsilicoInputFromResult(params: {
  gene?: string | null;
  predictorData?: any;
  conservationData?: any;
  serviceStatus?: any;
  vcepRule?: VcepInsilicoRule | null;
}): PrimaryInsilicoInput {
  const { gene, predictorData, conservationData, serviceStatus, vcepRule } = params;
  return {
    gene,
    scores: {
      revel: finiteScore(conservationData?.revel),
      bayesdel: finiteScore(conservationData?.bayesdel),
      alphaMissense: finiteScore(predictorData?.amPathogenicity),
      esm1b: finiteScore(conservationData?.esm1b),
    },
    // With no conservation payload at all, the lookup's own status says whether REVEL and BayesDel are
    // unknown (still running, timed out, failed) or truly absent ("not found").
    baseStatus: conservationData?.modelStatus?.base ?? (conservationData ? null
      : serviceStatus?.conservationData === "pending" ? "pending"
      : serviceStatus?.conservationData === "timeout" || serviceStatus?.conservationData === "error" ? "timeout"
      : null),
    spliceAi: resolveSpliceAiGateInput({ predictorData, conservationData, serviceStatus }),
    vcepRule,
  };
}

function evaluateSpliceBp4Gate(spliceAi: SpliceAiGateInput | null | undefined): SpliceBp4Gate {
  if (!spliceAi) {
    return {
      status: "applied-unassessed",
      note: "SpliceAI was not assessed on this call; check splicing separately.",
    };
  }
  if (spliceAi.maxDs !== null) {
    if (spliceAi.maxDs >= THRESHOLDS.spliceai.splicingPp3) {
      return {
        status: "blocked",
        maxDs: spliceAi.maxDs,
        reason: `BP4 withheld: SpliceAI max Δ ${spliceAi.maxDs.toFixed(2)} ≥ ${THRESHOLDS.spliceai.splicingPp3.toFixed(2)} (Walker et al. 2023) indicates potential splice disruption.`,
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

function buildChainEntries(scores: PrimaryInsilicoInput["scores"]): ChainToolScore[] {
  return PRIMARY_PREDICTOR_CHAIN.map((key) => {
    const score = finiteScore(scores[key]);
    return {
      key,
      label: CHAIN_TOOL_LABEL[key],
      score,
      call: score !== null ? calibratedCall(key, score) : null,
      sourceCitation: sourceCitationFor(key),
    };
  });
}

function findDisagreeingTools(chain: ChainToolScore[], activeKey: ChainToolKey, direction: "PP3" | "BP4"): DisagreeingChainTool[] {
  return chain
    .filter((entry): entry is ChainToolScore & { score: number; call: CalibratedCall } =>
      entry.key !== activeKey && entry.score !== null && entry.call !== null &&
      entry.call.direction !== null && entry.call.direction !== direction
    )
    .map((entry) => ({ key: entry.key, label: entry.label, score: entry.score, call: entry.call }));
}

/**
 * Evaluates PP3/BP4 from the single pre-specified primary calibrated predictor chain:
 * REVEL -> BayesDel noAF -> AlphaMissense -> ESM1b.
 */
export function decidePrimaryInsilico(input: PrimaryInsilicoInput): PrimaryInsilicoDecision {
  const vcepRule = input.vcepRule !== undefined ? input.vcepRule : lookupVcepInsilicoRule(input.gene);
  const chain = buildChainEntries(input.scores);
  const empty = {
    code: null, direction: null, strength: null, activeTool: null, activeScore: null, activeCall: null,
    skippedBefore: [] as ChainToolKey[], chain, disagreeingTools: [] as DisagreeingChainTool[], spliceGate: null, vcepRule,
  };
  if (input.baseStatus === "pending" || input.baseStatus === "timeout") return { ...empty, outcome: "withheld-base" };

  const activeIdx = chain.findIndex((entry) => entry.score !== null && entry.call !== null);
  if (activeIdx === -1) return { ...empty, outcome: "no-score" };

  const active = chain[activeIdx];
  const skippedBefore = chain.slice(0, activeIdx).map((e) => e.key);
  const activeCall = active.call!;
  if (activeCall.direction === null) {
    return { ...empty, outcome: "indeterminate", activeTool: active.key, activeScore: active.score, activeCall, skippedBefore };
  }

  const disagreeingTools = findDisagreeingTools(chain, active.key, activeCall.direction);
  const spliceGate = activeCall.direction === "BP4" ? evaluateSpliceBp4Gate(input.spliceAi) : null;
  if (spliceGate && (spliceGate.status === "blocked" || spliceGate.status === "withheld-transient" || spliceGate.status === "withheld-coordinate")) {
    return {
      ...empty,
      outcome: spliceGate.status === "blocked" ? "blocked-spliceai" : "withheld-spliceai",
      activeTool: active.key, activeScore: active.score, activeCall, skippedBefore, disagreeingTools, spliceGate,
    };
  }
  return {
    outcome: "met", code: activeCall.code as InsilicoCriterionCode, direction: activeCall.direction, strength: activeCall.strength,
    activeTool: active.key, activeScore: active.score, activeCall, skippedBefore, chain, disagreeingTools, spliceGate, vcepRule,
  };
}

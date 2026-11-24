import {
  CALIBRATION_SOURCES,
  PP3_BP4_CALIBRATION,
  calibratedCall,
  formatEvidenceCode,
  type CalibratedCall,
  type EvidenceStrength,
} from "../thresholds/calibration.ts";
import { validCaddScore } from "../candidateScores.ts";
import { evaluateVcepMissenseCall, lookupVcepInsilicoRule, vcepRuleRequiresDbnsfp } from "./vcepRules.ts";
import type { VcepInsilicoRule } from "./vcepTypes.ts";
import {
  evaluateSpliceBp4Gate,
  evaluateSplicePp3,
  finiteScore,
  resolveSpliceAiGateInput,
  type SpliceAiFailureLike,
  type SpliceAiGateInput,
  type SpliceBp4Gate,
  type SplicePp3Call,
} from "./spliceGate.ts";

export {
  evaluateSpliceBp4Gate, evaluateSplicePp3, resolveSpliceAiGateInput,
  type SpliceAiFailureLike, type SpliceAiGateInput, type SpliceBp4Gate, type SplicePp3Call, type VcepInsilicoRule,
};

/** Settled fallback order (Phase 5a decision, 2026-11-24): REVEL -> BayesDel noAF -> AlphaMissense -> ESM1b. */
export const PRIMARY_PREDICTOR_CHAIN = ["revel", "bayesdel", "alphaMissense", "esm1b"] as const;
export type ChainToolKey = (typeof PRIMARY_PREDICTOR_CHAIN)[number];
export type ActivePredictorTool = ChainToolKey | "cadd" | "spliceai";

export const CHAIN_TOOL_LABEL: Record<ChainToolKey, string> = {
  revel: "REVEL", bayesdel: "BayesDel noAF", alphaMissense: "AlphaMissense", esm1b: "ESM1b",
};

export const PREDICTOR_TOOL_LABEL: Record<ActivePredictorTool, string> = {
  ...CHAIN_TOOL_LABEL, cadd: "CADD", spliceai: "SpliceAI",
};

export type InsilicoCriterionCode =
  | "PP3" | "PP3_Moderate" | "PP3_Strong"
  | "BP4" | "BP4_Moderate" | "BP4_Strong" | "BP4_VeryStrong";

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

export interface PrimaryInsilicoInput {
  gene?: string | null;
  scores: Partial<Record<ChainToolKey | "cadd", number | null | undefined>>;
  baseStatus?: "pending" | "settled" | "timeout" | null;
  spliceAi?: SpliceAiGateInput | null;
  vcepRule?: VcepInsilicoRule | null;
  hasPvs1?: boolean;
}

export interface PrimaryInsilicoDecision {
  outcome: "met" | "indeterminate" | "no-score" | "blocked-spliceai" | "withheld-spliceai" | "withheld-base" | "vcep-excluded";
  code: InsilicoCriterionCode | null;
  direction: "PP3" | "BP4" | null;
  strength: EvidenceStrength | null;
  activeTool: ActivePredictorTool | null;
  activeScore: number | null;
  activeCall: CalibratedCall | null;
  skippedBefore: ActivePredictorTool[];
  chain: ChainToolScore[];
  disagreeingTools: DisagreeingChainTool[];
  spliceGate: SpliceBp4Gate | null;
  vcepRule: VcepInsilicoRule | null;
  criterionSource: "chain" | "vcep" | "spliceai" | null;
  vcepApplied: boolean;
  vcepNotes: string[];
  splicePp3Corroboration: string | null;
}

const STRENGTH_RANK: Record<EvidenceStrength, number> = { Supporting: 1, Moderate: 2, Strong: 3, VeryStrong: 4 };

/** Canonical score decimal precision for computational predictor tools. */
export function formatPredictorScore(tool: ActivePredictorTool, score: number): string {
  return tool === "cadd" ? score.toFixed(1) : tool === "esm1b" || tool === "spliceai" ? score.toFixed(2) : score.toFixed(3);
}

/**
 * Builds the `PrimaryInsilicoInput` from an analysis payload or engine input object.
 * AlphaMissense reads numeric `amPathogenicity` only (never `amClass`).
 */
export function primaryInsilicoInputFromResult(params: {
  gene?: string | null; predictorData?: any; conservationData?: any; serviceStatus?: any;
  vcepRule?: VcepInsilicoRule | null; hasPvs1?: boolean;
}): PrimaryInsilicoInput {
  const { gene, predictorData, conservationData, serviceStatus, vcepRule, hasPvs1 } = params;
  return {
    gene,
    scores: {
      revel: finiteScore(conservationData?.revel),
      bayesdel: finiteScore(conservationData?.bayesdel),
      alphaMissense: finiteScore(predictorData?.amPathogenicity),
      esm1b: finiteScore(conservationData?.esm1b),
      cadd: validCaddScore(predictorData?.caddPhred),
    },
    // With no conservation payload at all, the lookup's status says whether REVEL/BayesDel are pending, timed out, or absent.
    baseStatus: conservationData?.modelStatus?.base ?? (conservationData ? null
      : serviceStatus?.conservationData === "pending" ? "pending"
      : serviceStatus?.conservationData === "timeout" || serviceStatus?.conservationData === "error" ? "timeout"
      : null),
    spliceAi: resolveSpliceAiGateInput({ predictorData, conservationData, serviceStatus }),
    vcepRule,
    hasPvs1,
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
      sourceCitation: CALIBRATION_SOURCES[PP3_BP4_CALIBRATION[key].source].short,
    };
  });
}

function findDisagreeingTools(
  chain: ChainToolScore[], activeKey: ActivePredictorTool, direction: "PP3" | "BP4",
  vcepRule: VcepInsilicoRule | null, vcepApplied: boolean,
): DisagreeingChainTool[] {
  const allowedTools = vcepApplied && vcepRule && "tools" in vcepRule.rule
    ? new Set<string>(vcepRule.rule.tools.map(t => t.tool))
    : null;
  return chain
    .filter((entry): entry is ChainToolScore & { score: number; call: CalibratedCall } =>
      entry.key !== activeKey &&
      (allowedTools === null || allowedTools.has(entry.key)) &&
      entry.score !== null && entry.call !== null &&
      entry.call.direction !== null && entry.call.direction !== direction
    )
    .map((entry) => ({ key: entry.key, label: entry.label, score: entry.score, call: entry.call }));
}

interface MissenseResult {
  outcome: "met" | "indeterminate" | "no-score" | "vcep-excluded";
  activeTool: ActivePredictorTool | null;
  activeScore: number | null;
  activeCall: CalibratedCall | null;
  skippedBefore: ActivePredictorTool[];
  source: "chain" | "vcep" | null;
}

function makeDecisionBase(
  outcome: PrimaryInsilicoDecision["outcome"], chain: ChainToolScore[], vcepRule: VcepInsilicoRule | null,
  vcepApplied: boolean, vcepNotes: string[], missense?: Partial<MissenseResult>,
): PrimaryInsilicoDecision {
  return {
    outcome, code: null, direction: null, strength: null,
    activeTool: missense?.activeTool ?? null, activeScore: missense?.activeScore ?? null, activeCall: missense?.activeCall ?? null,
    skippedBefore: missense?.skippedBefore ?? [], chain, disagreeingTools: [], spliceGate: null,
    vcepRule, criterionSource: null, vcepApplied, vcepNotes, splicePp3Corroboration: null,
  };
}

function emitSplicePp3(
  base: PrimaryInsilicoDecision, splicePp3: SplicePp3Call, spliceGate: SpliceBp4Gate | null, corroboration: string | null,
): PrimaryInsilicoDecision {
  return {
    ...base,
    outcome: "met", code: splicePp3.code, direction: "PP3", strength: splicePp3.strength,
    activeTool: "spliceai", activeScore: splicePp3.maxDs, activeCall: null, skippedBefore: [],
    disagreeingTools: [], spliceGate, criterionSource: "spliceai", splicePp3Corroboration: corroboration,
  };
}

function resolveMissenseWithSplice(
  missense: MissenseResult, chain: ChainToolScore[], input: PrimaryInsilicoInput,
  vcepRule: VcepInsilicoRule | null, vcepApplied: boolean, vcepNotes: string[],
): PrimaryInsilicoDecision {
  const splicePp3 = evaluateSplicePp3(input.spliceAi, vcepRule, Boolean(input.hasPvs1));
  const base = makeDecisionBase(missense.outcome, chain, vcepRule, vcepApplied, vcepNotes, missense);
  const call = missense.activeCall;
  if (missense.outcome !== "met" || !call?.direction || missense.activeTool === null || missense.activeScore === null) {
    return splicePp3 ? emitSplicePp3(base, splicePp3, null, null) : base;
  }

  const tool = missense.activeTool;
  const disagreeingTools = findDisagreeingTools(chain, tool, call.direction, vcepRule, vcepApplied);
  if (call.direction === "PP3") {
    if (splicePp3 && STRENGTH_RANK[splicePp3.strength] > STRENGTH_RANK[call.strength!]) {
      const note = `${PREDICTOR_TOOL_LABEL[tool]} ${formatPredictorScore(tool, missense.activeScore)} also supports missense ${formatEvidenceCode(call.code)}; splicing ${formatEvidenceCode(splicePp3.code)} governs and PP3 is applied once.`;
      return emitSplicePp3(base, splicePp3, null, note);
    }
    const corroboration = splicePp3
      ? `SpliceAI max Δ ${formatPredictorScore("spliceai", splicePp3.maxDs)} also supports splicing ${formatEvidenceCode(splicePp3.code)} (${splicePp3.source}); PP3 is applied once (Walker et al. 2023).`
      : null;
    return {
      ...base, outcome: "met", code: call.code as InsilicoCriterionCode, direction: "PP3",
      strength: call.strength, disagreeingTools, criterionSource: missense.source, splicePp3Corroboration: corroboration,
    };
  }

  const spliceGate = evaluateSpliceBp4Gate(input.spliceAi, vcepRule);
  if (spliceGate.status === "blocked") {
    if (splicePp3) {
      const note = `${PREDICTOR_TOOL_LABEL[tool]} ${formatPredictorScore(tool, missense.activeScore)} reads ${formatEvidenceCode(call.code)} for missense impact, which SpliceAI max Δ ${formatPredictorScore("spliceai", splicePp3.maxDs)} overrides and replaces with splicing ${formatEvidenceCode(splicePp3.code)}.`;
      return emitSplicePp3(base, splicePp3, spliceGate, note);
    }
    return { ...base, outcome: "blocked-spliceai", disagreeingTools, spliceGate };
  }
  if (spliceGate.status === "withheld-transient" || spliceGate.status === "withheld-coordinate") {
    return { ...base, outcome: "withheld-spliceai", disagreeingTools, spliceGate };
  }
  return {
    ...base, outcome: "met", code: call.code as InsilicoCriterionCode, direction: "BP4",
    strength: call.strength, disagreeingTools, spliceGate, criterionSource: missense.source,
  };
}

/** Evaluates PP3/BP4 from the primary calibrated chain, VCEP gene rules, and Walker 2023 splicing PP3 / BP4 gate. */
export function decidePrimaryInsilico(input: PrimaryInsilicoInput): PrimaryInsilicoDecision {
  const vcepRule = input.vcepRule !== undefined ? input.vcepRule : lookupVcepInsilicoRule(input.gene);
  const chain = buildChainEntries(input.scores);
  const vcepNotes = [...(vcepRule?.notes ?? [])];
  if ((input.baseStatus === "pending" || input.baseStatus === "timeout") && vcepRuleRequiresDbnsfp(vcepRule)) {
    return makeDecisionBase("withheld-base", chain, vcepRule, false, vcepNotes);
  }

  if (vcepRule && vcepRule.rule.kind !== "advisory") {
    const res = evaluateVcepMissenseCall(vcepRule, input.scores);
    const mergedNotes = [...vcepNotes, ...res.runtimeNotes];
    return resolveMissenseWithSplice(
      { ...res, source: "vcep" },
      chain,
      input,
      vcepRule,
      true,
      mergedNotes,
    );
  }

  const activeIdx = chain.findIndex((entry) => entry.score !== null && entry.call !== null);
  const missense: MissenseResult = activeIdx === -1
    ? { outcome: "no-score", activeTool: null, activeScore: null, activeCall: null, skippedBefore: [], source: "chain" }
    : {
        outcome: chain[activeIdx].call!.direction === null ? "indeterminate" : "met",
        activeTool: chain[activeIdx].key,
        activeScore: chain[activeIdx].score,
        activeCall: chain[activeIdx].call,
        skippedBefore: chain.slice(0, activeIdx).map((e) => e.key),
        source: "chain",
      };
  return resolveMissenseWithSplice(missense, chain, input, vcepRule, false, vcepNotes);
}
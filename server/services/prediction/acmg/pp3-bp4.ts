import {
  CALIBRATION_SOURCES,
  PP3_BP4_CALIBRATION,
  formatEvidenceCode,
} from "../../../../src/shared/thresholds/calibration.ts";
import {
  CHAIN_TOOL_LABEL,
  PREDICTOR_TOOL_LABEL,
  decidePrimaryInsilico,
  primaryInsilicoInputFromResult,
  type ActivePredictorTool,
  type PrimaryInsilicoDecision,
} from "../../../../src/shared/insilico/primaryPredictor.ts";
import { validCaddScore } from "../../../../src/shared/candidateScores.ts";
import type { ACMGItem } from "./classifier.ts";
import type { ACMGEvidenceInput, CriteriaEvaluationResult } from "./criteria.ts";

function formatPredictorScore(tool: ActivePredictorTool, score: number): string {
  if (tool === "esm1b") return score.toFixed(2);
  if (tool === "cadd") return score.toFixed(1);
  if (tool === "spliceai") return score.toFixed(2);
  return score.toFixed(3);
}

function informationalTail(
  predictorData: ACMGEvidenceInput["predictorData"],
  conservationData: ACMGEvidenceInput["conservationData"],
  excludeCadd: boolean,
): string {
  const items: string[] = [];
  const cadd = excludeCadd ? null : validCaddScore(predictorData?.caddPhred);
  if (cadd !== null) items.push(`CADD ${cadd.toFixed(1)}`);
  const popeve = conservationData?.popeve;
  if (typeof popeve === "number" && Number.isFinite(popeve)) items.push(`popEVE ${popeve.toFixed(3)}`);
  const avi = conservationData?.alphagenome?.aviPhred;
  if (typeof avi === "number" && Number.isFinite(avi) && avi >= 0) items.push(`AlphaGenome ${avi.toFixed(1)} Phred`);
  return items.length ? ` Informational, not counted: ${items.join(", ")}.` : "";
}

function buildLead(decision: PrimaryInsilicoDecision): string {
  const tool = decision.activeTool!;
  const scoreStr = formatPredictorScore(tool, decision.activeScore!);
  const codeLabel = formatEvidenceCode(decision.code!);
  const vcep = decision.vcepRule;

  if (decision.criterionSource === "spliceai") {
    const spliceSource = vcep?.splice?.pp3Missense && typeof vcep.splice.pp3Missense === "object" || vcep?.splice?.pp3Missense === "nf1"
      ? `${vcep.vcep}, ${vcep.cspecId} v${vcep.version}`
      : "Walker et al. 2023";
    return `SpliceAI max Δ ${scoreStr} supports ${codeLabel} for predicted splicing impact (${spliceSource}).`;
  }
  if (decision.criterionSource === "vcep" && vcep) {
    const label = PREDICTOR_TOOL_LABEL[tool];
    const fallbackNote = decision.skippedBefore.length > 0
      ? ` after ${decision.skippedBefore.map(k => PREDICTOR_TOOL_LABEL[k]).join(", ")} had no score`
      : "";
    return `${vcep.vcep} (${vcep.cspecId} v${vcep.version}) rule: ${label} ${scoreStr}${fallbackNote} sits in the ${codeLabel} band.`;
  }
  const chainTool = tool as keyof typeof CHAIN_TOOL_LABEL;
  const citation = CALIBRATION_SOURCES[PP3_BP4_CALIBRATION[chainTool].source].short;
  const label = CHAIN_TOOL_LABEL[chainTool];
  const fallbackNote = decision.skippedBefore.length > 0
    ? `, selected via fallback order after ${decision.skippedBefore.map(k => PREDICTOR_TOOL_LABEL[k]).join(", ")} had no score`
    : "";
  return `Primary calibrated predictor ${label} ${scoreStr} sits in the ${codeLabel} band (${citation}${fallbackNote}).`;
}

function buildCriterionReason(
  decision: PrimaryInsilicoDecision,
  predictorData: ACMGEvidenceInput["predictorData"],
  conservationData: ACMGEvidenceInput["conservationData"],
): string {
  const lead = buildLead(decision);
  const splicingNote = decision.splicePp3Corroboration ? ` ${decision.splicePp3Corroboration}` : "";
  const disagreement = decision.disagreeingTools.length > 0
    ? ` ⚠ Calibrated disagreement (strength unchanged): ${decision.disagreeingTools
        .map(d => `${d.label} ${formatPredictorScore(d.key, d.score)} (${formatEvidenceCode(d.call.code)})`)
        .join(", ")}.`
    : "";
  const spliceNote = decision.spliceGate && "note" in decision.spliceGate
    ? ` Note: ${decision.spliceGate.note}`
    : "";
  const vcepNote = decision.vcepNotes.length > 0 ? ` VCEP note: ${decision.vcepNotes.join(" ")}` : "";

  return `${lead}${splicingNote}${disagreement}${spliceNote}${vcepNote}${informationalTail(predictorData, conservationData, decision.activeTool === "cadd")}`;
}

/**
 * Evaluates PP3 / BP4 using the single primary calibrated predictor chain
 * (REVEL -> BayesDel noAF -> AlphaMissense -> ESM1b), VCEP overrides, and Walker 2023 splicing PP3 / BP4 gate.
 */
export function evaluateInsilicoCriterion(
  input: Pick<ACMGEvidenceInput, "gene" | "predictorData" | "conservationData" | "serviceStatus"> & { hasPvs1?: boolean },
  gates: { skipPathogenicComp: boolean; skipBenignComp: boolean },
): CriteriaEvaluationResult {
  const decision = decidePrimaryInsilico(
    primaryInsilicoInputFromResult({
      gene: input.gene,
      predictorData: input.predictorData,
      conservationData: input.conservationData,
      serviceStatus: input.serviceStatus,
      hasPvs1: input.hasPvs1,
    }),
  );

  const available = decision.chain.filter(c => c.score !== null).map(c => c.label.toUpperCase());
  const unavailable: string[] = [];

  if (decision.outcome === "withheld-base") {
    unavailable.push("DBNSFP_SCORES (dbNSFP ensemble incomplete — PP3/BP4 withheld)");
  } else if (decision.outcome === "vcep-excluded" && decision.vcepRule) {
    const v = decision.vcepRule;
    unavailable.push(`${v.gene} (${v.vcep}, ${v.cspecId} v${v.version}): missense computational predictors excluded.`);
  } else {
    for (const c of decision.chain) {
      if (c.score === null) unavailable.push(c.label.toUpperCase());
    }
  }

  if (
    decision.spliceGate &&
    (decision.spliceGate.status === "blocked" ||
      decision.spliceGate.status === "withheld-transient" ||
      decision.spliceGate.status === "withheld-coordinate")
  ) {
    unavailable.push(decision.spliceGate.reason);
  }

  const criteria: ACMGItem[] = [];
  const skip =
    (decision.direction === "PP3" && gates.skipPathogenicComp) ||
    (decision.direction === "BP4" && gates.skipBenignComp);

  if (decision.outcome === "met" && decision.code && !skip) {
    criteria.push({
      code: decision.code,
      reason: buildCriterionReason(decision, input.predictorData, input.conservationData),
    });
  }

  return { criteria, available, unavailable };
}

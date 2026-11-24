import {
  CALIBRATION_SOURCES,
  PP3_BP4_CALIBRATION,
  formatEvidenceCode,
} from "../../../../src/shared/thresholds/calibration.ts";
import {
  CHAIN_TOOL_LABEL,
  decidePrimaryInsilico,
  primaryInsilicoInputFromResult,
  type ChainToolKey,
  type PrimaryInsilicoDecision,
} from "../../../../src/shared/insilico/primaryPredictor.ts";
import { validCaddScore } from "../../../../src/shared/candidateScores.ts";
import type { ACMGItem } from "./classifier.ts";
import type { ACMGEvidenceInput, CriteriaEvaluationResult } from "./criteria.ts";

function formatChainScore(tool: ChainToolKey, score: number): string {
  return tool === "esm1b" ? score.toFixed(2) : score.toFixed(3);
}

function informationalTail(
  predictorData: ACMGEvidenceInput["predictorData"],
  conservationData: ACMGEvidenceInput["conservationData"],
): string {
  const items: string[] = [];
  const cadd = validCaddScore(predictorData?.caddPhred);
  if (cadd !== null) items.push(`CADD ${cadd.toFixed(1)}`);
  const popeve = conservationData?.popeve;
  if (typeof popeve === "number" && Number.isFinite(popeve)) items.push(`popEVE ${popeve.toFixed(3)}`);
  const avi = conservationData?.alphagenome?.aviPhred;
  if (typeof avi === "number" && Number.isFinite(avi) && avi >= 0) items.push(`AlphaGenome ${avi.toFixed(1)} Phred`);
  return items.length ? ` Informational, not counted: ${items.join(", ")}.` : "";
}

function buildCriterionReason(
  decision: PrimaryInsilicoDecision,
  predictorData: ACMGEvidenceInput["predictorData"],
  conservationData: ACMGEvidenceInput["conservationData"],
): string {
  const tool = decision.activeTool!;
  const scoreStr = formatChainScore(tool, decision.activeScore!);
  const codeLabel = formatEvidenceCode(decision.code!);
  const citation = CALIBRATION_SOURCES[PP3_BP4_CALIBRATION[tool].source].short;
  const label = CHAIN_TOOL_LABEL[tool];
  const fallbackNote = decision.skippedBefore.length > 0
    ? `, selected via fallback order after ${decision.skippedBefore.map(k => CHAIN_TOOL_LABEL[k]).join(", ")} had no score`
    : "";
  const lead = `Primary calibrated predictor ${label} ${scoreStr} sits in the ${codeLabel} band (${citation}${fallbackNote}).`;

  const disagreement = decision.disagreeingTools.length > 0
    ? ` ⚠ Calibrated disagreement (strength unchanged): ${decision.disagreeingTools
        .map(d => `${d.label} ${formatChainScore(d.key, d.score)} (${formatEvidenceCode(d.call.code)})`)
        .join(", ")}.`
    : "";

  const spliceNote = decision.spliceGate && "note" in decision.spliceGate
    ? ` Note: ${decision.spliceGate.note}`
    : "";

  return `${lead}${disagreement}${spliceNote}${informationalTail(predictorData, conservationData)}`;
}

/**
 * Evaluates PP3 / BP4 using the single primary calibrated predictor chain
 * (REVEL -> BayesDel noAF -> AlphaMissense -> ESM1b) plus the Walker 2023 SpliceAI BP4 gate.
 */
export function evaluateInsilicoCriterion(
  input: Pick<ACMGEvidenceInput, "gene" | "predictorData" | "conservationData" | "serviceStatus">,
  gates: { skipPathogenicComp: boolean; skipBenignComp: boolean },
): CriteriaEvaluationResult {
  const decision = decidePrimaryInsilico(
    primaryInsilicoInputFromResult({
      gene: input.gene,
      predictorData: input.predictorData,
      conservationData: input.conservationData,
      serviceStatus: input.serviceStatus,
    }),
  );

  const available = decision.chain.filter(c => c.score !== null).map(c => c.label.toUpperCase());
  const unavailable: string[] = [];

  if (decision.outcome === "withheld-base") {
    unavailable.push("DBNSFP_SCORES (dbNSFP ensemble incomplete — PP3/BP4 withheld)");
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

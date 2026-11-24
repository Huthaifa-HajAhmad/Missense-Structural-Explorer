/**
 * predictorSummary.ts — the Predictors finding in words, from the primary decision and VCEP / Walker 2023 rules.
 */
import { formatEvidenceCode } from "./thresholds/calibration.ts";
import {
  PREDICTOR_TOOL_LABEL,
  PRIMARY_PREDICTOR_CHAIN,
  type ActivePredictorTool,
  type ChainToolKey,
  type PrimaryInsilicoDecision,
} from "./insilico/primaryPredictor.ts";
import type { PredictorEvidence } from "./predictorEvidence.ts";

/** The fixed order as a reader sees it: "REVEL → BayesDel noAF → AlphaMissense → ESM1b". */
export const CHAIN_ORDER_TEXT = PRIMARY_PREDICTOR_CHAIN.map(k => PREDICTOR_TOOL_LABEL[k]).join(" → ");

function scoreText(tool: ActivePredictorTool, score: number): string {
  if (tool === "cadd") return score.toFixed(1);
  if (tool === "esm1b") return score.toFixed(2);
  if (tool === "spliceai") return `max Δ ${score.toFixed(2)}`;
  return score.toFixed(3);
}

function list(keys: ActivePredictorTool[]): string {
  return keys.map(k => PREDICTOR_TOOL_LABEL[k]).join(", ");
}

function ensureSentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** "REVEL 0.850", "CADD 28.5", "SpliceAI max Δ 0.45", or null when no tool answered. */
export function activeToolText(primary: PrimaryInsilicoDecision): string | null {
  if (primary.activeTool === null || primary.activeScore === null) return null;
  return `${PREDICTOR_TOOL_LABEL[primary.activeTool]} ${scoreText(primary.activeTool, primary.activeScore)}`;
}

/** The calibrated tools that point the other way, in one sentence, or null when none does. */
export function disagreementText(primary: PrimaryInsilicoDecision): string | null {
  if (primary.disagreeingTools.length === 0) return null;
  const tools = primary.disagreeingTools
    .map(d => `${d.label} ${scoreText(d.key as ChainToolKey, d.score)} (${formatEvidenceCode(d.call.code)})`)
    .join(", ");
  return `${tools} ${primary.disagreeingTools.length === 1 ? "points" : "point"} the other way. The strength stays with the first tool; weigh the disagreement before you accept it.`;
}

/** The SpliceAI gate's reason as the end of a sentence: no "BP4 withheld:" prefix, no full stop. */
function spliceReasonClause(primary: PrimaryInsilicoDecision): string {
  const gate = primary.spliceGate;
  if (!gate || !("reason" in gate)) return "splicing was not cleared";
  const clause = gate.reason.replace(/^BP4 withheld: /, "").replace(/\.$/, "");
  return /^(The|No|Coordinate) /.test(clause) ? clause[0].toLowerCase() + clause.slice(1) : clause;
}

/** Why there is no PP3 or BP4, in one clause (no full stop). */
export function noCriterionText(primary: PrimaryInsilicoDecision): string {
  const tool = activeToolText(primary);
  switch (primary.outcome) {
    case "no-score":
      return primary.vcepApplied && primary.vcepRule
        ? `No PP3 or BP4: ${primary.vcepRule.vcep} (${primary.vcepRule.cspecId} v${primary.vcepRule.version}) tools did not score this variant`
        : "No PP3 or BP4: none of the calibrated tools scored this variant";
    case "withheld-base":
      return "No PP3 or BP4 yet: the dbNSFP scores did not finish, so the first tool in the order is unknown";
    case "vcep-excluded":
      return primary.vcepRule
        ? `No PP3 or BP4: ${primary.vcepRule.vcep} (${primary.vcepRule.cspecId} v${primary.vcepRule.version}) excludes missense computational predictors`
        : "No PP3 or BP4: ClinGen VCEP excludes missense computational predictors";
    case "indeterminate":
      return tool
        ? `No PP3 or BP4: ${tool}, the first tool with a score, sits between its bands`
        : "No PP3 or BP4: the VCEP multi-tool requirement was not met";
    case "blocked-spliceai":
    case "withheld-spliceai":
      return `No BP4: ${tool} reads ${formatEvidenceCode(primary.activeCall?.code ?? "BP4")}, but ${spliceReasonClause(primary)}`;
    case "met":
      return `${formatEvidenceCode(primary.code ?? "")} from ${tool}`;
    default:
      return "No PP3 or BP4";
  }
}

/** The finding in words: the headline and its predicate, as the Population tab words its own. */
export function predictorFinding(evidence: PredictorEvidence): { headline: string; predicate: string } {
  const { primary } = evidence;
  const tool = activeToolText(primary);
  const fallback = primary.skippedBefore.length > 0 ? `${list(primary.skippedBefore)} had no score, so ` : "";
  switch (primary.outcome) {
    case "met":
      if (primary.criterionSource === "spliceai") {
        const ruleSource = primary.vcepRule?.splice?.pp3Missense && primary.vcepRule.splice.pp3Missense !== "none"
          ? `${primary.vcepRule.vcep} (${primary.vcepRule.cspecId} v${primary.vcepRule.version}) splicing rule`
          : "Walker et al. 2023 splicing rule";
        return {
          headline: `${tool} supports splicing ${formatEvidenceCode(primary.code!)}`,
          predicate: primary.splicePp3Corroboration
            ? primary.splicePp3Corroboration.replace(/\.$/, "")
            : `it meets the ${ruleSource}, and PP3 is applied once when PVS1 is absent`,
        };
      }
      if (primary.criterionSource === "vcep" && primary.vcepRule) {
        const v = primary.vcepRule;
        return {
          headline: `${tool} is in its ${formatEvidenceCode(primary.code!)} band`,
          predicate: `${fallback}selected under ${v.vcep} (${v.cspecId} v${v.version}), setting ${formatEvidenceCode(primary.code!)}`,
        };
      }
      return {
        headline: `${tool} is in its ${formatEvidenceCode(primary.code!)} band`,
        predicate: `${fallback}it is the first calibrated tool with a score (${CHAIN_ORDER_TEXT}), and it sets ${formatEvidenceCode(primary.code!)}`,
      };
    case "indeterminate":
      return tool
        ? {
            headline: `${tool} sits between its bands`,
            predicate: `${fallback}it is the first calibrated tool with a score, so neither PP3 nor BP4 is supported`,
          }
        : {
            headline: "VCEP multi-tool threshold not met",
            predicate: primary.vcepNotes[0]?.replace(/\.$/, "") ?? "tools disagreed or sat between bands",
          };
    case "vcep-excluded":
      return {
        headline: "Missense computational predictors excluded",
        predicate: primary.vcepRule
          ? `per ${primary.vcepRule.vcep} (${primary.vcepRule.cspecId} v${primary.vcepRule.version})`
          : "per ClinGen VCEP specification",
      };
    case "blocked-spliceai":
    case "withheld-spliceai":
      return { headline: `${tool} reads ${formatEvidenceCode(primary.activeCall!.code)}, but BP4 is withheld`, predicate: noCriterionText(primary).replace(/^No BP4: /, "") };
    case "withheld-base":
      return { headline: "The calibrated scores are not complete", predicate: "so PP3/BP4 waits until dbNSFP answers" };
    case "no-score":
      return { headline: "No calibrated tool scored this variant", predicate: "so neither PP3 nor BP4 is supported" };
  }
}

export interface PredictorSummary {
  tone: "warning" | "neutral";
  /** The bold sentence, ending in a full stop. */
  lead: string;
  /** Plain sentences after it, each ending in a full stop. */
  rest: string[];
  /** Which engine situation produced the lead — pinned by tests, used for `data-state`. */
  state: "recorded" | "unconfirmed" | "withheld" | "stale" | "none";
}

export function predictorSummary(evidence: PredictorEvidence): PredictorSummary {
  const { primary, engine } = evidence;
  const code = (c: string) => formatEvidenceCode(c);
  const ruleCode = primary.code;
  const from = activeToolText(primary);
  const disagreement = disagreementText(primary);
  const spliceNote = primary.spliceGate && "note" in primary.spliceGate ? primary.spliceGate.note : null;
  const notes = [
    ...(disagreement ? [disagreement] : []),
    ...(primary.splicePp3Corroboration ? [ensureSentence(primary.splicePp3Corroboration)] : []),
    ...(spliceNote ? [ensureSentence(spliceNote)] : []),
    ...primary.vcepNotes.map(ensureSentence),
  ];
  const finish = (state: PredictorSummary["state"], lead: string, extra: string[], warn: boolean): PredictorSummary => ({
    tone: warn || disagreement !== null ? "warning" : "neutral",
    lead: `${lead}.`,
    rest: [...extra, ...notes],
    state,
  });

  if (!engine.known) {
    return ruleCode
      ? finish("unconfirmed", `The rule gives ${code(ruleCode)} from ${from}`, ["This result carries no engine record to confirm it against."], false)
      : finish("none", noCriterionText(primary), [], false);
  }
  if (engine.withheldByWeighting) {
    return finish("withheld", `The rule gives ${code(ruleCode!)} from ${from}, but the engine recorded no in-silico criterion`, [`The ${engine.weighting} ACMG weighting withholds it.`], true);
  }
  if ((engine.code ?? null) !== ruleCode) {
    const recorded = engine.code ? `recorded ${code(engine.code)}` : "recorded no PP3 or BP4";
    const current = ruleCode ? `${code(ruleCode)} from ${from}` : "neither PP3 nor BP4";
    return finish("stale", `The engine ${recorded} where the current rule gives ${current}`, ["This result was classified by an earlier engine; re-run the analysis to refresh it."], true);
  }
  if (engine.code) {
    const vcepTag = primary.vcepApplied && primary.vcepRule ? ` (${primary.vcepRule.cspecId} v${primary.vcepRule.version})` : "";
    const fallback = primary.skippedBefore.length > 0 ? `, after ${list(primary.skippedBefore)} had no score` : "";
    return finish("recorded", `The engine recorded ${code(engine.code)} from ${from}${vcepTag}${fallback}`, [], false);
  }
  return finish("none", noCriterionText(primary), [], false);
}

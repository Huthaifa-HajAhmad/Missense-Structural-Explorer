/**
 * predictorSummary.ts — the Predictors finding in words, from the primary calibrated decision.
 *
 * PP3/BP4 comes from ONE calibrated tool: the first with a score in the fixed order
 * REVEL → BayesDel noAF → AlphaMissense → ESM1b (`decidePrimaryInsilico`). These sentences say
 * which tool answered, in which band, what the engine recorded, and whether another calibrated tool
 * points the other way. They never say more than the decision and the engine record do.
 */
import { formatEvidenceCode } from "./thresholds/calibration.ts";
import { CHAIN_TOOL_LABEL, PRIMARY_PREDICTOR_CHAIN, type ChainToolKey, type PrimaryInsilicoDecision } from "./insilico/primaryPredictor.ts";
import type { PredictorEvidence } from "./predictorEvidence.ts";

/** The fixed order as a reader sees it: "REVEL → BayesDel noAF → AlphaMissense → ESM1b". */
export const CHAIN_ORDER_TEXT = PRIMARY_PREDICTOR_CHAIN.map(k => CHAIN_TOOL_LABEL[k]).join(" → ");

function scoreText(tool: ChainToolKey, score: number): string {
  return tool === "esm1b" ? score.toFixed(2) : score.toFixed(3);
}

function list(keys: ChainToolKey[]): string {
  return keys.map(k => CHAIN_TOOL_LABEL[k]).join(", ");
}

/** "REVEL 0.850", or null when no tool answered. */
export function activeToolText(primary: PrimaryInsilicoDecision): string | null {
  if (primary.activeTool === null || primary.activeScore === null) return null;
  return `${CHAIN_TOOL_LABEL[primary.activeTool]} ${scoreText(primary.activeTool, primary.activeScore)}`;
}

/** The calibrated tools that point the other way, in one sentence, or null when none does. */
export function disagreementText(primary: PrimaryInsilicoDecision): string | null {
  if (primary.disagreeingTools.length === 0) return null;
  const tools = primary.disagreeingTools
    .map(d => `${d.label} ${scoreText(d.key, d.score)} (${formatEvidenceCode(d.call.code)})`)
    .join(", ");
  return `${tools} ${primary.disagreeingTools.length === 1 ? "points" : "point"} the other way. The strength stays with the first tool; weigh the disagreement before you accept it.`;
}

/** The SpliceAI gate's reason as the end of a sentence: no "BP4 withheld:" prefix, no full stop. */
function spliceReasonClause(primary: PrimaryInsilicoDecision): string {
  const gate = primary.spliceGate;
  if (!gate || !("reason" in gate)) return "splicing was not cleared";
  const clause = gate.reason.replace(/^BP4 withheld: /, "").replace(/\.$/, "");
  // Lower-case an ordinary first word ("The protein change…"), never a name such as "SpliceAI".
  return /^(The|No|Coordinate) /.test(clause) ? clause[0].toLowerCase() + clause.slice(1) : clause;
}

/** Why there is no PP3 or BP4, in one clause (no full stop). */
export function noCriterionText(primary: PrimaryInsilicoDecision): string {
  const tool = activeToolText(primary);
  switch (primary.outcome) {
    case "no-score":
      return "No PP3 or BP4: none of the calibrated tools scored this variant";
    case "withheld-base":
      return "No PP3 or BP4 yet: the dbNSFP scores did not finish, so the first tool in the order is unknown";
    case "indeterminate":
      return `No PP3 or BP4: ${tool}, the first tool with a score, sits between its bands`;
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
      return {
        headline: `${tool} is in its ${formatEvidenceCode(primary.code!)} band`,
        predicate: `${fallback}it is the first calibrated tool with a score (${CHAIN_ORDER_TEXT}), and it sets ${formatEvidenceCode(primary.code!)}`,
      };
    case "indeterminate":
      return {
        headline: `${tool} sits between its bands`,
        predicate: `${fallback}it is the first calibrated tool with a score, so neither PP3 nor BP4 is supported`,
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

/**
 * The finding card's one summary line: what the engine recorded, which tool gave the current call,
 * and any disagreement — the facts a curator needs, said ONCE.
 *
 * `tone` is "warning" exactly when a curator must reconcile two readings: another calibrated tool
 * points the other way, the weighting withheld the code, or the payload's record differs from what
 * the current rule gives.
 */
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
  const notes = [...(disagreement ? [disagreement] : []), ...(spliceNote ? [spliceNote] : [])];
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
    const fallback = primary.skippedBefore.length > 0 ? `, after ${list(primary.skippedBefore)} had no score` : "";
    return finish("recorded", `The engine recorded ${code(engine.code)} from ${from}${fallback}`, [], false);
  }
  return finish("none", noCriterionText(primary), [], false);
}

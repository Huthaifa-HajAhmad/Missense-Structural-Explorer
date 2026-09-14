import { evaluateAcmgCriteria, ACMGEvidenceInput } from "./criteria.ts";
import { classifyVariant, codeWeight, RuleBasedInsights } from "./classifier.ts";

export * from "./syntax.ts";
export * from "./classifier.ts";
export * from "./criteria.ts";

/**
 * Executes full rule-based ACMG/AMP 2015 pathogenicity classification workflow.
 * Evaluates in-silico, population, frequency, structural, and variant mechanism criteria,
 * computes 5-tier classification verdict, and generates plausibility insight narrative.
 */
export function computeRuleBasedACMG(input: ACMGEvidenceInput): RuleBasedInsights {
  const { criteria, available, unavailable } = evaluateAcmgCriteria(input);

  // -------------------------------------------------------------------------
  // 5. ACMG five-tier verdict
  // -------------------------------------------------------------------------
  const acmgVerdict = classifyVariant(criteria);

  // -------------------------------------------------------------------------
  // 6. Plausibility summary narrative
  // -------------------------------------------------------------------------
  const pathCodes = criteria.filter(c => codeWeight(c.code) > 0);
  const benignCodes = criteria.filter(c => codeWeight(c.code) < 0);

  let plausibility = "";
  if (pathCodes.length > 0 && benignCodes.length === 0) {
    plausibility = `Plausibly pathogenic based on gathered evidence: ${pathCodes.map(c => c.code).join(", ")}.`;
  } else if (benignCodes.length > 0 && pathCodes.length === 0) {
    plausibility = `Plausibly benign based on gathered evidence: ${benignCodes.map(c => c.code).join(", ")}.`;
  } else if (pathCodes.length > 0 && benignCodes.length > 0) {
    plausibility = `Conflicting evidence. Pathogenic indicators: ${pathCodes.map(c => c.code).join(", ")}; Benign indicators: ${benignCodes.map(c => c.code).join(", ")}.`;
  } else {
    plausibility = "No strong pathogenic or benign indicator criteria from database evidence.";
  }

  return {
    plausibility,
    acmgVerdict,
    acmgCriteria: criteria,
    partialEvidence: { available, unavailable },
  };
}

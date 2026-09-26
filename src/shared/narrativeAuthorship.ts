/**
 * narrativeAuthorship.ts — one answer to "did a model write the prose on screen".
 *
 * WHY THIS EXISTS
 * ---------------
 * Three surfaces answered it three ways:
 *
 *   `ClinicalInsightsCard`     `!isFallbackNarrative(analysis, isFallback, fallbackReason)`
 *   `NarrativeProvenanceRow`   `insights.source === "ai_inference"` when present, else `!isDegraded`
 *   `ClinicalReportBar`        `!isFallback && Boolean(narrative)`
 *
 * They agree on every payload a shipped writer currently produces, which is why the divergence was
 * latent rather than live — but they are three predicates for one fact, and the rail's trusts a payload
 * field with no cross-check. The field is stamped by the route (`server/routes/shared.ts`), and the
 * route stamps it only when `insights` is truthy, so a response whose insights failed to parse carries
 * prose with no `source` at all: one surface then decides from the prose, another from a field that is
 * not there.
 *
 * The two inputs are not redundant and neither is sufficient:
 *
 *   - `source` is the server's own record, and is authoritative WHEN PRESENT — but it can be absent,
 *     and a degraded run's prose is a rule-based report the model never wrote;
 *   - the fallback verdict is derived on the client from `isFallback`, the reason code, and the prose
 *     itself, so it survives an older or partially-degraded payload.
 *
 * So: a degraded run is NEVER AI-authored, whatever the field says. That direction matters more than
 * the other — presenting rule-based prose as a model's output overstates its provenance, while
 * presenting model prose as rule-based understates it, and only the first is a claim a curator would
 * act on differently.
 *
 * Deliberately dependency-free: `src/shared/` may not import outside itself.
 */

export type NarrativeAuthorship = "ai" | "rule-based" | "none";

export interface NarrativeAuthorshipInput {
  /** The narrative prose, if any. Empty means no narrative exists yet. */
  analysis: string | null | undefined;
  /** The shared degraded-narrative verdict (`isFallbackNarrative`). */
  isDegraded: boolean;
  /** The route's own record, when the payload carries one. */
  declaredSource?: string | null;
}

export function deriveNarrativeAuthorship({
  analysis,
  isDegraded,
  declaredSource,
}: NarrativeAuthorshipInput): NarrativeAuthorship {
  const hasProse = typeof analysis === "string" && analysis.trim().length > 0;
  if (!hasProse && !isDegraded) return "none";

  // Degradation wins over the field: a rule-based report is not a model's output even if a stale or
  // wrongly-stamped payload says otherwise.
  if (isDegraded) return "rule-based";

  if (declaredSource === "rule_based") return "rule-based";
  if (declaredSource === "ai_inference") return "ai";

  // No record on the payload. The presence of prose that is not degraded is the best available
  // evidence, and it is what every surface did before this module existed.
  return hasProse ? "ai" : "none";
}

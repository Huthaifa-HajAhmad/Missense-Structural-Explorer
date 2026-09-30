/**
 * acmgCriteriaView.ts — one ACMG criteria list, with one provenance vocabulary, for every surface
 * that renders criteria.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three surfaces render the same criteria — the Insights rail's audit trace, the Population Data
 * rail's rule count, and the report's evidence list — and two of them derived the list themselves.
 * They disagreed, in one viewport, about the same code.
 *
 * `handleNarrativeResponse` (`server/routes/shared.ts`) already returns a MERGED, source-tagged list
 * in `insights.acmgCriteria`: the rule engine's codes tagged `database_verified` first, then the
 * AI's non-duplicate codes tagged `ai_suggested`. But the two rails concatenated that merged list
 * with the RAW `ruleBasedInsights.acmgCriteria` — which carries no `source` at all — and deduped
 * with `new Map(pairs)`, which keeps the LAST entry per key. The untagged rule-based copy therefore
 * overwrote the tagged one, and every rule-engine criterion rendered as "AI Inferred":
 *
 *     rail   PP3  "AI Inferred"          <- the rule engine's own code, mislabelled
 *     card   PP3  "DATABASE-VERIFIED"    <- the same code, correctly labelled
 *
 * The card and the rail sat a few hundred pixels apart asserting opposite provenance for PP3, PP2
 * and PM2 — the one field that decides whether a curator treats a criterion as evidence or as a
 * suggestion.
 *
 * The fix is to stop re-deriving. `insights.acmgCriteria` is the server's answer; this module
 * normalises it for display and falls back to the rule-based list only when the merged list is
 * genuinely absent (a biophysics-stage payload, before any narrative ran).
 */

/** The only two provenances a criterion can have. Mirrors the server's `acmgCriteriaItemSchema`. */
export type AcmgCriteriaSource = "database_verified" | "ai_suggested";

export interface AcmgCriteriaItemLike {
  code: string;
  reason?: string;
  source?: string;
}

export interface AcmgCriteriaView {
  code: string;
  reason: string;
  source: AcmgCriteriaSource;
}

/**
 * One label per provenance, used by every surface that shows one.
 *
 * The three render sites apply `uppercase` themselves, so these are written in sentence case and
 * read as DATABASE-VERIFIED / AI-INFERRED wherever they are rendered. Before this the same fact was
 * printed as "Rule Engine" in the Insights rail, "DATABASE-VERIFIED" in the card beside it, and
 * "database" in the report — one fact in three vocabularies, which is how the mislabelling above
 * stayed invisible: a reader comparing the panes had to assume the words meant the same thing.
 */
export const ACMG_SOURCE_LABEL: Record<AcmgCriteriaSource, string> = {
  // "Database-verified" claimed a check nothing performs: the engine computes the code from retrieved
  // values, it does not verify it against a database. Named for what it is.
  database_verified: "Rule engine",
  ai_suggested: "Model-proposed",
};

/**
 * The ACMG codes the rule engine evaluates (`server/services/prediction/acmg/criteria.ts`).
 *
 * A model proposal for one of these is dropped from every count and list: the engine already ruled on
 * the code, from data the model was never given. For NAE1 p.Asp116Gly the model proposed PM2 while the
 * prompt held no allele frequency (it said so itself: "counts not provided in the prompt"), and the
 * merge kept the proposal because the engine had not FIRED PM2 — so a guess overrode "not met".
 * Keep this list equal to the codes `evaluateAcmgCriteria` can emit; a test reads the source to check.
 */
export const ENGINE_OWNED_CODES: ReadonlySet<string> = new Set([
  "PVS1", "PS1", "PM1", "PM2", "PM4", "PP2", "PP3", "BA1", "BS1", "BS2", "BP3", "BP4",
]);

/** "PP3_Moderate" → "PP3". Strength suffixes do not change which rule owns a code. */
export function baseAcmgCode(code: string): string {
  return code.split("_")[0].toUpperCase();
}

export function isEngineOwnedCode(code: string): boolean {
  return ENGINE_OWNED_CODES.has(baseAcmgCode(code));
}

export interface PartitionedCriteria {
  /** Codes the rule engine computed. The only ones that count toward the tier. */
  engine: AcmgCriteriaView[];
  /** Model proposals for codes the engine cannot evaluate. Shown, never counted. */
  proposals: AcmgCriteriaView[];
  /** Model proposals for engine-owned codes, dropped. Reported as a count, not shown as evidence. */
  droppedEngineOwned: AcmgCriteriaView[];
}

export function partitionCriteria(criteria: ReadonlyArray<AcmgCriteriaView>): PartitionedCriteria {
  const engine: AcmgCriteriaView[] = [];
  const proposals: AcmgCriteriaView[] = [];
  const droppedEngineOwned: AcmgCriteriaView[] = [];
  for (const c of criteria) {
    if (c.source === "database_verified") engine.push(c);
    else if (isEngineOwnedCode(c.code)) droppedEngineOwned.push(c);
    else proposals.push(c);
  }
  return { engine, proposals, droppedEngineOwned };
}

/** `undefined` for an item whose source the payload did not record — never guessed. */
export function normaliseCriteriaSource(source: string | undefined | null): AcmgCriteriaSource | undefined {
  return source === "database_verified" || source === "ai_suggested" ? source : undefined;
}

/**
 * Build the list a surface renders.
 *
 * Order of preference:
 *   1. `insightsCriteria` — the server's merged, tagged list. Used whole.
 *   2. `ruleBasedCriteria` — the rule engine's raw list, labelled `database_verified` because that
 *      is what it is: these codes were computed from retrieved database values, not proposed by a
 *      model. The previous code did this mapping in one place and not the other, which is the
 *      asymmetry that produced the contradiction.
 *
 * Deduplication keeps the `database_verified` entry when a code appears under both provenances. The
 * server already drops AI duplicates of rule-based codes, but a cached payload from before that
 * reconciliation existed does not, and "database beats suggestion" is the safe resolution: the
 * reader is shown the better-evidenced claim.
 *
 * A code with no `reason` gets an explicit placeholder rather than an empty body — an ACMG code with
 * a blank justification is not actionable.
 */
export function acmgCriteriaView(
  insightsCriteria?: ReadonlyArray<AcmgCriteriaItemLike> | null,
  ruleBasedCriteria?: ReadonlyArray<AcmgCriteriaItemLike> | null
): AcmgCriteriaView[] {
  const source = (insightsCriteria ?? []).filter(item => item && typeof item.code === "string" && item.code);
  const fromMergedList = source.length > 0;

  const raw: AcmgCriteriaItemLike[] = fromMergedList
    ? source
    : (ruleBasedCriteria ?? []).filter(item => item && typeof item.code === "string" && item.code);

  /**
   * Codes the rule engine computed, for the untagged-item fallback below.
   *
   * On the fallback path every code came from the engine, so the whole list is `database_verified`.
   * On the merged path an item with no `source` is a payload that did not record one — and the previous
   * version GUESSED `ai_suggested` for it, which is the defect this module exists to remove in the
   * opposite direction: it would present a rule engine's computed criterion to a curator as a model's
   * suggestion. Membership is checkable, so it is checked instead of guessed.
   */
  const ruleBasedCodes = new Set(
    (ruleBasedCriteria ?? [])
      .filter(item => item && typeof item.code === "string" && item.code)
      .map(item => item.code)
  );

  const byCode = new Map<string, AcmgCriteriaView>();
  for (const item of raw) {
    const claimed = normaliseCriteriaSource(item.source);
    const resolved: AcmgCriteriaSource =
      claimed
      ?? (fromMergedList
        // Named by the engine's own list: computed evidence, whatever the tag did or did not say.
        ? (ruleBasedCodes.has(item.code) ? "database_verified" : "ai_suggested")
        : "database_verified");

    const existing = byCode.get(item.code);
    if (existing) {
      // Database evidence outranks a model suggestion for the same code.
      if (existing.source === "database_verified" || resolved !== "database_verified") continue;
    }

    byCode.set(item.code, {
      code: item.code,
      reason: item.reason && item.reason.trim() ? item.reason : "No justification recorded for this code.",
      source: resolved,
    });
  }

  return Array.from(byCode.values());
}

/**
 * How many of each provenance. Used by the rail's header count.
 *
 * No production caller yet — the rail renders `uniqueCriteria.length`. Kept because the two numbers a
 * reader compares on that screen are "how many criteria" and "how many of them the engine actually
 * computed", and that second one has no other accessor; a test exercises it directly.
 */
export function countBySource(criteria: ReadonlyArray<AcmgCriteriaView>): {
  total: number;
  database: number;
  ai: number;
} {
  return {
    total: criteria.length,
    database: criteria.filter(c => c.source === "database_verified").length,
    ai: criteria.filter(c => c.source === "ai_suggested").length,
  };
}

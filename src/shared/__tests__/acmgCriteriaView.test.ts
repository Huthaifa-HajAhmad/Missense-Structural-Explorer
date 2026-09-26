import { describe, it, expect } from "vitest";
import {
  ACMG_SOURCE_LABEL,
  acmgCriteriaView,
  countBySource,
  normaliseCriteriaSource,
} from "../acmgCriteriaView";

/**
 * The rail labelled the rule engine's own criteria "AI Inferred".
 *
 * `handleNarrativeResponse` returns a MERGED, source-tagged list in `insights.acmgCriteria`. Both
 * rails threw it away: they concatenated that list with the raw, untagged
 * `ruleBasedInsights.acmgCriteria` and deduped with `new Map(pairs)`, which keeps the LAST entry per
 * key — so the untagged rule-based copy overwrote the tagged one and every rule-engine code rendered
 * as "AI Inferred". The card in the main column labelled the same PP3/PP2/PM2 "DATABASE-VERIFIED".
 *
 * The first test below reproduces the deleted derivation and asserts it produces the wrong label, so
 * this suite fails on the defect rather than merely describing the fix.
 */

/** The server's merged payload: rule-engine codes first, tagged; then AI-only codes, tagged. */
const MERGED_INSIGHTS = [
  { code: "PP3", reason: "4/10 predictors agree on pathogenic impact.", source: "database_verified" },
  { code: "PP2", reason: "Missense variant in a gnomAD-constrained gene.", source: "database_verified" },
  { code: "PM2", reason: "Extremely rare in gnomAD.", source: "database_verified" },
  { code: "PS3", reason: "Functional assay in the cited paper.", source: "ai_suggested" },
];

/** The same run's rule-engine list as the client receives it: no `source` field at all. */
const RAW_RULE_BASED = [
  { code: "PP3", reason: "4/10 predictors agree on pathogenic impact." },
  { code: "PP2", reason: "Missense variant in a gnomAD-constrained gene." },
  { code: "PM2", reason: "Extremely rare in gnomAD." },
];

/**
 * The pre-fix derivation, verbatim, as the negative control.
 *
 * Not exported from the component under test — reproduced here so the assertion is about the old
 * behaviour, not about a strawman.
 */
function legacyDerivation(
  insightsCriteria: Array<{ code: string; reason?: string; source?: string }>,
  ruleBasedCriteria: Array<{ code: string; reason?: string; source?: string }>
) {
  const criteria = [...insightsCriteria, ...ruleBasedCriteria];
  return Array.from(new Map(criteria.map(c => [c.code, c])).values());
}

describe("acmgCriteriaView", () => {
  it("keeps the server's source tags on the merged list", () => {
    const view = acmgCriteriaView(MERGED_INSIGHTS, RAW_RULE_BASED);

    expect(view.map(c => [c.code, c.source])).toEqual([
      ["PP3", "database_verified"],
      ["PP2", "database_verified"],
      ["PM2", "database_verified"],
      ["PS3", "ai_suggested"],
    ]);
  });

  it("does not label a rule-engine criterion as AI-inferred", () => {
    // The exact confusion: PP3 is in the rule-engine list AND in the merged list, tagged.
    const view = acmgCriteriaView(MERGED_INSIGHTS, RAW_RULE_BASED);
    const pp3 = view.find(c => c.code === "PP3");

    expect(pp3?.source).toBe("database_verified");
    expect(ACMG_SOURCE_LABEL[pp3!.source]).toBe("Database-verified");
    expect(ACMG_SOURCE_LABEL[pp3!.source]).not.toBe(ACMG_SOURCE_LABEL.ai_suggested);
  });

  it("NEGATIVE CONTROL: the deleted derivation mislabels the same criterion", () => {
    const legacy = legacyDerivation(MERGED_INSIGHTS, RAW_RULE_BASED) as Array<{ code: string; source?: string }>;
    const pp3 = legacy.find(c => c.code === "PP3");

    // The old code left `source` undefined for PP3, and the rail's `crit.source === "database_verified"`
    // test then fell through to its "AI Inferred" branch.
    expect(pp3?.source, "the old derivation kept the tag").toBeUndefined();
    expect(normaliseCriteriaSource(pp3?.source)).toBeUndefined();
    // ...whereas the fixed path resolves it.
    expect(acmgCriteriaView(MERGED_INSIGHTS, RAW_RULE_BASED).find(c => c.code === "PP3")?.source)
      .toBe("database_verified");
  });

  it("labels a rule-engine-only payload as database-verified, not as a suggestion", () => {
    // A biophysics-stage payload: no narrative has run, so there is no merged list.
    const view = acmgCriteriaView(null, RAW_RULE_BASED);

    expect(view).toHaveLength(3);
    expect(view.every(c => c.source === "database_verified")).toBe(true);
    expect(ACMG_SOURCE_LABEL[view[0].source]).not.toMatch(/AI/i);
  });

  it("prefers the database-verified entry when a code appears under both provenances", () => {
    // A cached payload from before the server's reconciliation dropped AI duplicates of rule codes.
    const view = acmgCriteriaView([
      { code: "PP3", reason: "AI's version of the same code.", source: "ai_suggested" },
      { code: "PP3", reason: "Rule engine's version.", source: "database_verified" },
    ]);

    expect(view).toHaveLength(1);
    expect(view[0].source).toBe("database_verified");
    expect(view[0].reason).toBe("Rule engine's version.");
  });

  it("does not invent a provenance for an untagged code in a merged payload", () => {
    /*
     * On the merged path a missing tag means the payload did not record provenance. Guessing
     * `database_verified` there would present a model's suggestion to a curator as computed evidence.
     *
     * The FIRST version resolved every untagged merged item to `ai_suggested` — the same class of error
     * in the opposite direction, labelling the rule engine's computed criterion as a model's proposal.
     * Membership in the engine's own list is checkable, so it is checked rather than guessed.
     */
    const view = acmgCriteriaView(
      [{ code: "PP3", reason: "untagged but the engine computed it" }, { code: "PS3", reason: "untagged, engine did not" }],
      [{ code: "PP3", reason: "engine" }]
    );

    expect(view.map(c => [c.code, c.source])).toEqual([
      ["PP3", "database_verified"],
      ["PS3", "ai_suggested"],
    ]);
  });

  it("still guesses nothing when the engine's own list is absent", () => {
    // With no engine list to check membership against, an untagged item is a payload with no provenance
    // at all — and the label that does not overstate evidence is the safe one.
    const view = acmgCriteriaView([{ code: "PM2", reason: "no tag, no engine list" }]);
    expect(view[0].source).toBe("ai_suggested");
  });

  it("names a missing justification rather than rendering an empty body", () => {
    const view = acmgCriteriaView([{ code: "PM1", source: "database_verified" }, { code: "PP4", reason: "   ", source: "database_verified" }]);
    expect(view.map(c => c.reason)).toEqual([
      "No justification recorded for this code.",
      "No justification recorded for this code.",
    ]);
  });

  it("drops entries that are not criteria", () => {
    const view = acmgCriteriaView([
      { code: "", reason: "empty code", source: "ai_suggested" },
      null as any,
      { code: "BP4", reason: "ok", source: "ai_suggested" },
    ]);
    expect(view.map(c => c.code)).toEqual(["BP4"]);
  });

  it("returns an empty list for an empty payload rather than falling through to the other argument", () => {
    expect(acmgCriteriaView([], RAW_RULE_BASED).every(c => c.source === "database_verified")).toBe(true);
    expect(acmgCriteriaView(null, null)).toEqual([]);
  });

  it("counts each provenance for the rail's header", () => {
    const counts = countBySource(acmgCriteriaView(MERGED_INSIGHTS, RAW_RULE_BASED));
    expect(counts).toEqual({ total: 4, database: 3, ai: 1 });
  });
});

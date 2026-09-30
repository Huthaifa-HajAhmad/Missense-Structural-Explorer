/**
 * insightsSnapshot.test.ts — the Report's stability input must equal the one the Insights card feeds
 * the consolidator, or the Report would show a stability lane the Insights tab would not.
 */
import { describe, expect, it } from "vitest";
import { stabilityInputFor, insightsEvidenceFor } from "../../shared/insightsSnapshot";
import { deriveConsensus } from "../ClinicalInsightsCard";

const result: any = { metadata: { gene: "NAE1", variant: "p.Asp116Gly" }, ruleBasedInsights: { acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [] } };

const cases: Array<[string, any, number | null]> = [
  ["no engines", null, null],
  ["FoldX only, from the single value", null, 2.6],
  ["three engines agreeing", { foldx: 2.6, foldxMean: 2.6, thermompnn: 1.4, stabilityoracle: 1.1 }, 2.6],
  ["engines disagreeing in sign", { foldx: 2.62, foldxMean: 2.62, thermompnn: -0.36, stabilityoracle: -0.06 }, 2.62],
  ["FoldX repair failed", { foldx: 2.6, foldxMean: 2.6, foldxRepairFailed: true, dynamut2: 1.2 }, 2.6],
];

describe("stabilityInputFor", () => {
  it.each(cases)("matches the Insights card's consensus: %s", (_name, fe, ddg) => {
    const card = deriveConsensus({ result, foldingEnergetics: fe, foldingDdG: ddg });
    const ours = stabilityInputFor(result, fe, ddg);
    if (!card) return expect(ours).toBeNull();
    expect(ours).toEqual({
      verdict: card.consensusVerdict,
      enginesCounted: card.enginesCounted,
      enginesDestabilizing: card.enginesDestabilizing,
    });
  });

  it("returns nothing when no analysis is loaded", () => {
    expect(stabilityInputFor(null, { foldx: 1 }, 1)).toBeNull();
    expect(insightsEvidenceFor({ result: null })).toBeNull();
  });
});

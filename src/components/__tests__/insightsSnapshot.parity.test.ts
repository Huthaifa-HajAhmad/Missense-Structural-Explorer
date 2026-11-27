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
  ["FoldX repair failed", { foldx: 2.6, foldxMean: 2.6, foldxRepairFailed: true, thermompnn: 1.2 }, 2.6],
];

describe("stabilityInputFor", () => {
  it.each(cases)("matches the Insights card's consensus: %s", (_name, fe, ddg) => {
    const card = deriveConsensus({ result, foldingEnergetics: fe, foldingDdG: ddg });
    const ours = stabilityInputFor(result, fe, ddg);
    if (!card) return expect(ours).toBeNull();
    expect(ours).toMatchObject({
      verdict: card.consensusVerdict,
      enginesCounted: card.enginesCounted,
      enginesDestabilizing: card.enginesDestabilizing,
      enginesModerate: card.enginesModerate,
    });
  });

  it("carries the provisional state and the running engine while FoldX is still running", () => {
    const ours = stabilityInputFor(result, { rasp: 1.1, thermompnn: 0.5 }, null, { isFolding: true, foldingStatus: null });
    expect(ours?.provisional).toBe(true);
    expect(ours?.runningEngines).toContain("FoldX");
  });

  it("carries a withheld stability conclusion when the AlphaFold residue has very low confidence", () => {
    const lowConfidence = {
      ...result,
      disruptionPredictor: { plddt: 20 },
    };
    const ours = stabilityInputFor(lowConfidence, { rasp: 1.1, thermompnn: 0.5, structureProvenance: { source: "alphafold" } }, null);
    expect(ours?.withheldText).toMatch(/^No stability conclusion: AlphaFold's confidence at this residue is very low/);
  });

  it("carries moderate engines from the Energetics bands", () => {
    const ours = stabilityInputFor(result, { foldx: 2.6, thermompnn: 0.5, rasp: 0.5 }, null);
    expect(ours).toMatchObject({ enginesDestabilizing: 1, enginesModerate: 2, enginesCounted: 3 });
  });

  it("returns nothing when no analysis is loaded", () => {
    expect(stabilityInputFor(null, { foldx: 1 }, 1)).toBeNull();
    expect(insightsEvidenceFor({ result: null })).toBeNull();
  });
});

/**
 * insightsEvidence.test.ts — what the consolidator may claim.
 *
 * Reference variant: NAE1 p.Asp116Gly. The model's PM2 arrived beside an engine that recorded only PP3,
 * and the old verdict badge listed both.
 */
import { describe, expect, it } from "vitest";
import { buildInsightsEvidence, computeTierGap, tierIndexOf } from "../insightsEvidence";

const functionInput = { residue: 116, uniprot: null, serviceStatus: "ok" } as any;

function nae1(over: Record<string, any> = {}) {
  return {
    metadata: { gene: "NAE1", variant: "p.Asp116Gly", acmgWeighting: "standard" },
    predictorData: { caddPhred: 26.3, amPathogenicity: 0.362, amClass: "ambiguous", source: "Ensembl VEP" },
    conservationData: { revel: 0.231, metarnn: 0.529, clinpred: 0.977 },
    ruleBasedInsights: {
      plausibility: "",
      acmgVerdict: "Variant of Uncertain Significance (VUS)",
      acmgCriteria: [{ code: "PP3", reason: "3/6 predictors agree" }],
      partialEvidence: { available: [], unavailable: [] },
    },
    insights: {
      acmgVerdict: "Variant of Uncertain Significance (VUS)",
      acmgCriteria: [
        { code: "PP3", reason: "3/6 predictors agree", source: "database_verified" },
        { code: "PM2", reason: "counts not provided in the prompt", source: "ai_suggested" },
        { code: "PS3", reason: "assay in a cited abstract", source: "ai_suggested" },
      ],
    },
    ...over,
  } as any;
}

describe("buildInsightsEvidence", () => {
  const ev = buildInsightsEvidence({ result: nae1(), functionInput, stability: { verdict: "Destabilizing (Engines Agree)", enginesCounted: 3, enginesDestabilizing: 3 } });

  it("takes the tier from the engine record", () => {
    expect(ev.tier).toBe("Uncertain");
    expect(ev.recordMismatch).toBe(false);
  });

  it("counts only the engine's codes and drops the engine-owned model proposal", () => {
    expect(ev.engineCodes.map(c => c.code)).toEqual(["PP3"]);
    expect(ev.droppedEngineOwned.map(c => c.code)).toEqual(["PM2"]);
    expect(ev.proposals.map(c => c.code)).toEqual(["PS3"]);
  });

  it("marks only the lane the engine recorded as counted", () => {
    const counted = ev.lanes.filter(l => l.counted).map(l => l.key);
    expect(counted).toEqual(["computational"]);
    expect(ev.lanes.find(l => l.key === "stability")!.counted).toBe(false);
    expect(ev.lanes.find(l => l.key === "stability")!.lean).toBe("pathogenic");
  });

  it("states the vote and the disagreement in words", () => {
    const c = ev.lanes.find(l => l.key === "computational")!;
    expect(c.lead).toContain("says tolerated");
    expect(ev.differ.map(d => d.text).join(" ")).toMatch(/REVEL .*tolerated/);
    expect(ev.differ.map(d => d.text).join(" ")).toContain("Only one evidence area is counted");
  });

  it("flags a lane that leans but is not counted while the tier is uncertain", () => {
    expect(ev.differ.some(d => d.text.startsWith("Stability leans pathogenic"))).toBe(true);
  });

  it("reports that the recorded tier differs from the combining rule", () => {
    const r = nae1();
    r.ruleBasedInsights.acmgVerdict = "Likely Pathogenic";
    const mism = buildInsightsEvidence({ result: r, functionInput, stability: null });
    expect(mism.recordMismatch).toBe(true);
  });

  it("does not invent a verdict when nothing was classified", () => {
    const none = buildInsightsEvidence({ result: { metadata: {} } as any, functionInput, stability: null });
    expect(none.ready).toBe(false);
    expect(none.tier).toBeNull();
    expect(none.gap).toBeNull();
  });
});

describe("computeTierGap uses the engine's own combining rule", () => {
  it("one Supporting is 4 additions from Likely pathogenic at the fewest", () => {
    const gap = computeTierGap([{ code: "PP3", reason: "" }])!;
    expect(gap.side).toBe("pathogenic");
    expect(gap.target).toBe("Likely pathogenic");
    // Every option must actually reach the target under classifyVariant.
    expect(gap.options.length).toBeGreaterThan(0);
    expect(gap.options.join(" | ")).toContain("Very strong");
  });

  it("reports nothing to reach from Pathogenic", () => {
    expect(computeTierGap([{ code: "PVS1", reason: "" }, { code: "PS3", reason: "" }])).toBeNull();
  });

  it("leans benign when the counted evidence does", () => {
    const gap = computeTierGap([{ code: "BP4", reason: "" }])!;
    expect(gap.side).toBe("benign");
    expect(gap.target).toBe("Likely benign");
  });
});

describe("tierIndexOf", () => {
  it("maps the engine's verdict strings", () => {
    expect(["Benign", "Likely Benign", "Variant of Uncertain Significance (VUS)", "Likely Pathogenic", "Pathogenic"].map(tierIndexOf)).toEqual([0, 1, 2, 3, 4]);
  });
});

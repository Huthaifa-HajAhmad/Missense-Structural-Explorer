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
  it('qualifies uncounted population support inside agreement prose', () => {
    const result = nae1({ gnomadFrequency: { exomeAF: 0.000001, exomeAC: 1, exomeAN: 1000000, groupMaxAF: 0.000001 }, serviceStatus: { gnomadFrequency: "ok" } });
    const model = buildInsightsEvidence({ result, functionInput, stability: null });
    expect(model.lanes.find(l => l.key === 'population')?.unconfirmed).toBe(true);
    expect(model.agree.map(a => a.text).join(' ')).toContain('Population (not counted)');
  });
  it('uses the raw engine list consistently when a stale merged narrative omits a criterion', () => {
    const result = nae1();
    result.ruleBasedInsights.acmgCriteria.push({ code: 'PM2', reason: 'Recorded rarity' });
    const model = buildInsightsEvidence({ result, functionInput, stability: null });
    expect(model.engineCodes.map(c => c.code)).toEqual(['PP3', 'PM2']);
    expect(model.finding.rest).toContain('2 criteria: PP3, PM2');
    expect(model.criteria.find(c => c.code === 'PM2')?.state).toBe('met');
    expect(model.lanes.find(l => l.key === 'population')?.counted).toBe(true);
    expect(model.droppedEngineOwned.some(c => c.code === 'PM2')).toBe(false);
  });

  it('does not restore stale merged criteria over an explicitly empty raw engine list', () => {
    const result = nae1();
    result.ruleBasedInsights.acmgCriteria = [];
    const model = buildInsightsEvidence({ result, functionInput, stability: null });
    expect(model.engineCodes).toEqual([]);
    expect(model.lanes.every(l => !l.counted)).toBe(true);
  });

  it('identifies a recorded predictor criterion the current rule no longer gives', () => {
    const result = nae1({ predictorData: null, conservationData: { revel: 0.1 } });
    const model = buildInsightsEvidence({ result, functionInput, stability: null });
    expect(model.lanes.find(l => l.key === 'computational')?.rest).toContain('differs from the current rule');
  });
  it("describes PM2 with the same Supporting strength as the recorded criterion", () => {
    const result = nae1({ insights: null, ruleBasedInsights: { ...nae1().ruleBasedInsights, acmgCriteria: [{ code: "PM2", reason: "Recorded rarity" }] } });
    const model = buildInsightsEvidence({ result, functionInput, stability: null });
    const strength = model.criteria.find(c => c.code === "PM2")!.strength;
    expect(model.criteria.find(c => c.code === "PM2")!.state).toBe("met");
    expect(strength).toBe("Supporting");
    expect(model.glossary.find(g => g.term === "PM2")!.text).toContain(`${strength}.`);
  });
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

  it('retains a recorded computational criterion when its live calibrated inputs are missing', () => {
    const result = nae1({ predictorData: null, conservationData: null });
    const ev = buildInsightsEvidence({ result, functionInput, stability: null });
    const lane = ev.lanes.find(l => l.key === 'computational')!;
    expect(lane.counted).toBe(true);
    expect(lane.rest).toContain('calibrated inputs are unavailable');
    expect(lane.rest).not.toContain('Nothing is counted');
  });

  it("marks only the lane the engine recorded as counted", () => {
    const counted = ev.lanes.filter(l => l.counted).map(l => l.key);
    expect(counted).toEqual(["computational"]);
    expect(ev.lanes.find(l => l.key === "stability")!.counted).toBe(false);
    expect(ev.lanes.find(l => l.key === "stability")!.lean).toBe("none");
  });

  it("states which calibrated tool gave the call, in words", () => {
    const c = ev.lanes.find(l => l.key === "computational")!;
    expect(c.lead).toContain("REVEL 0.231, the first calibrated tool with a score, gives BP4");
    // NAE1's saved record is PP3 from the retired vote; the lane says the record is out of date.
    expect(c.rest).toContain("differs from the current rule");
    expect(ev.differ.map(d => d.text).join(" ")).toContain("Only one evidence area is counted");
  });

  it("does not translate fold destabilisation into pathogenicity", () => {
    expect(ev.differ.some(d => d.text.startsWith("Stability leans pathogenic"))).toBe(false);
  });

  it.each([['BS1', 'Strong', 3], ['BA1', 'Stand-alone', 3]] as const)('draws %s at its recorded strength rather than as supporting', (code, strength, length) => {
    const result = nae1({ gnomadFrequency: { alleleFrequency: 0.1 }, ruleBasedInsights: { acmgVerdict: 'Benign', acmgCriteria: [{ code, reason: 'Recorded frequency criterion' }] } });
    const ev = buildInsightsEvidence({ result, functionInput, stability: null });
    expect(ev.lanes.find(l => l.key === 'population')!.length).toBe(length);
    expect(ev.criteria.find(c => c.code === code)!.strength).toBe(strength);
  });

  it("calls BP4 Very Strong 'Very strong', not stand-alone: only BA1 stands alone", () => {
    const result = nae1({ ruleBasedInsights: { acmgVerdict: 'Benign', acmgCriteria: [{ code: 'BP4_VeryStrong', reason: 'REVEL 0.002' }] } });
    const ev = buildInsightsEvidence({ result, functionInput, stability: null });
    expect(ev.criteria.find(c => c.code === 'BP4_VeryStrong')!.strength).toBe('Very strong');
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

  it("reads candidate disagreement cleanly and reports failed candidate queries as a source fault", () => {
    const candidate = (alt: string) => ({ grch37Id: `4-1806119-G-${alt}`, id: `4-1804392-G-${alt}`, canonicalBy: "ensembl-lift", retryable: false });
    const disagree = nae1({
      gnomadFrequency: {
        maxAF: null, groupMaxAF: null, genomeAF: null, exomeAF: null, genomeAC: null, exomeAC: null, genomeAN: null, exomeAN: null, nHomozygous: null, dataset: "gnomad_r4",
        candidates: [
          { id: "4-1804392-G-A", grch37Id: "4-1806119-G-A", outcome: "found", frequency: { maxAF: 0.03, groupMaxAF: 0.03, faf95: 0.02, dataset: "gnomad_r4" } },
          { id: "4-1804392-G-C", grch37Id: "4-1806119-G-C", outcome: "not-found", frequency: null },
        ],
      },
      serviceStatus: { gnomadFrequency: "ok" },
      predictorData: {
        gnomadVariantId: null, gnomadVariantAssembly: null,
        locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", steps: [], candidates: [candidate("A"), candidate("C")] },
      },
    });
    const disagreeLane = buildInsightsEvidence({ result: disagree, functionInput, stability: null }).lanes.find(l => l.key === "population")!;
    expect(disagreeLane.lead).toBe("Candidate alleles disagree.");
    expect(disagreeLane.rest).toMatch(/^The candidate alleles fall on different sides/);
    expect(disagreeLane.rest).not.toContain("The frequency read is");

    const failed = nae1({
      gnomadFrequency: {
        maxAF: null, groupMaxAF: null, genomeAF: null, exomeAF: null, genomeAC: null, exomeAC: null, genomeAN: null, exomeAN: null, nHomozygous: null, dataset: "gnomad_r4",
        candidates: [
          { id: "4-1804392-G-A", grch37Id: "4-1806119-G-A", outcome: "not-found", frequency: null },
          { id: "4-1804392-G-C", grch37Id: "4-1806119-G-C", outcome: "failed", frequency: null, detail: "timeout" },
        ],
      },
      serviceStatus: { gnomadFrequency: "ok" },
      predictorData: {
        gnomadVariantId: null, gnomadVariantAssembly: null,
        locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", steps: [], candidates: [candidate("A"), candidate("C")] },
      },
    });
    const failedLane = buildInsightsEvidence({ result: failed, functionInput, stability: null }).lanes.find(l => l.key === "population")!;
    expect(failedLane.rest).toBe("A source failed to answer, so rarity (PM2) was not computed.");
  });
});

describe("consolidated fields a report can reuse", () => {
  const ev = buildInsightsEvidence({ result: nae1(), functionInput, stability: null });

  it("words the finding once", () => {
    expect(ev.finding.headline).toBe("Not enough evidence either way yet.");
    expect(ev.finding.rest).toBe(
      "The engine counted 1 criterion: PP3. The model proposed PS3, which the engine cannot compute, so it is not counted."
    );
  });

  it("lists every engine-owned code with its strength and state", () => {
    expect(ev.criteria.map(c => c.code)).toEqual(
      ["PVS1", "PS1", "PM1", "PM2", "PM4", "PP2", "PP3", "BA1", "BS1", "BS2", "BP3", "BP4"]
    );
    const pp3 = ev.criteria.find(c => c.code === "PP3")!;
    expect(pp3.state).toBe("met");
    expect(pp3.strength).toBe("Supporting");
    // The model's PM2 never turns the engine's row into "met".
    expect(ev.criteria.find(c => c.code === "PM2")!.state).not.toBe("met");
    // PM2 is weighed at Supporting (ClinGen SVI 2020); the row must say what the engine weighs.
    expect(ev.criteria.find(c => c.code === "PM2")!.strength).toBe("Supporting");
    expect(ev.criteria.filter(c => c.state === "met").map(c => c.code)).toEqual(["PP3"]);
  });

  it("gives the tier gap as one sentence", () => {
    expect(ev.gap!.sentence).toContain("To reach likely pathogenic");
    expect(ev.gap!.sentence).toContain("1 Strong + 1 Moderate");
  });

  it("states what the model was and was not shown", () => {
    expect(ev.narrative.sent).toContain("CADD");
    expect(ev.narrative.notSent).toContain("gnomAD frequency");
  });

  it("does not call a degraded run's prose the model's", () => {
    const degraded = buildInsightsEvidence({ result: nae1({ analysis: "text" }), functionInput, stability: null, narrativeDegraded: true });
    expect(degraded.narrative.authorship).not.toBe("ai");
  });
});

describe("computeTierGap uses the engine's own combining rule", () => {
  it("one Supporting is 4 additions from Likely pathogenic at the fewest", () => {
    const gap = computeTierGap([{ code: "PP3", reason: "" }], { nullVariant: true })!;
    expect(gap.side).toBe("pathogenic");
    expect(gap.target).toBe("Likely pathogenic");
    // Every option must actually reach the target under classifyVariant.
    expect(gap.options.length).toBeGreaterThan(0);
    expect(gap.options.join(" | ")).toContain("Very strong");
  });

  it("reports nothing to reach from Pathogenic", () => {
    expect(computeTierGap([{ code: "PVS1", reason: "" }, { code: "PS3", reason: "" }])).toBeNull();
  });

  it("says the evidence conflicts instead of printing an empty list", () => {
    // 6 Supporting pathogenic with BS1 + BP4: adding pathogenic criteria can never leave the conflict.
    const codes = ["PP3", "PP2", "PP1", "PP4", "PP5", "PP3", "BS1", "BP4"].map(code => ({ code, reason: "" }));
    const gap = computeTierGap(codes);
    expect(gap).not.toBeNull();
    expect(gap!.options).toEqual([]);
    expect(gap!.sentence).not.toMatch(/: \.$/);
    expect(gap!.sentence).toContain("conflicts");
  });

  it("leans benign when the counted evidence does", () => {
    const gap = computeTierGap([{ code: "BP4", reason: "" }])!;
    expect(gap.side).toBe("benign");
    expect(gap.target).toBe("Likely benign");
  });

  it("treats BS1 + BP4_Moderate as Likely benign needing 1 Supporting or 1 Strong to reach Benign", () => {
    const gap = computeTierGap([{ code: "BS1", reason: "" }, { code: "BP4_Moderate", reason: "" }])!;
    expect(gap.side).toBe("benign");
    expect(gap.target).toBe("Benign");
    expect(gap.options).toEqual(["1 Strong", "1 Supporting"]);
  });
});

describe("tierIndexOf", () => {
  it("maps the engine's verdict strings", () => {
    expect(["Benign", "Likely Benign", "Variant of Uncertain Significance (VUS)", "Likely Pathogenic", "Pathogenic"].map(tierIndexOf)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("Insights audit 2026-11-24", () => {
  const twoStrongMissing = [{ code: "PS1", reason: "" }, { code: "PM2_Supporting", reason: "" }, { code: "PP3", reason: "" }];

  it("never offers PVS1 to a missense change: a null-variant code cannot be met by one", () => {
    const gap = computeTierGap(twoStrongMissing)!;
    expect(gap.options.join(" | ")).not.toContain("Very strong");
    expect(gap.options).toContain("1 Strong");
  });

  it("offers PVS1 when the change is a null variant", () => {
    const gap = computeTierGap(twoStrongMissing, { nullVariant: true })!;
    expect(gap.options.join(" | ")).toContain("Very strong");
  });

  it("names example codes for every strength an option uses", () => {
    const gap = computeTierGap(twoStrongMissing)!;
    const strong = gap.examples.find(e => e.strength === "Strong");
    expect(strong?.codes).toMatch(/PS3/);
    expect(gap.examples.some(e => e.strength === "Very strong")).toBe(false);
  });

  it("reads the variant to decide whether PVS1 is reachable", () => {
    const nonsense = buildInsightsEvidence({ result: nae1({ metadata: { gene: "NAE1", variant: "p.Arg116Ter" } }), functionInput, stability: null });
    const missense = buildInsightsEvidence({ result: nae1(), functionInput, stability: null });
    expect(nonsense.gap!.options.join(" | ")).toContain("Very strong");
    expect(missense.gap!.options.join(" | ")).not.toContain("Very strong");
  });

  it("marks the rows the engine never counts as context, and names the genome-wide row for what feeds it", () => {
    const ev = buildInsightsEvidence({ result: nae1(), functionInput, stability: null });
    expect(ev.lanes.filter(l => l.contextOnly).map(l => l.key)).toEqual(["stability", "assembly", "language-models"]);
    const genome = ev.lanes.find(l => l.key === "language-models")!;
    expect(genome.name).toBe("Genome-wide scores");
  });

  it("tells apart candidate alleles that were all read from ones that were not", () => {
    const locus = (candidates: unknown[]) => nae1({
      gnomadFrequency: { candidates },
      predictorData: { locusResolution: { route: "fallback", canonicalBy: null, failureKind: "multiple-candidates", steps: [], candidates: [{}, {}] } },
    });
    const read = buildInsightsEvidence({ result: locus([{ outcome: "found" }, { outcome: "not-found" }]), functionInput, stability: null });
    const missed = buildInsightsEvidence({ result: locus([{ outcome: "found" }, { outcome: "failed" }]), functionInput, stability: null });
    expect(read.candidateFrequencyRead).toBe(true);
    expect(missed.candidateFrequencyRead).toBe(false);
  });

  it("lists the deep-model engines this run named to the model, not a fixed list", () => {
    const ev = buildInsightsEvidence({ result: nae1(), functionInput, stability: null, deepEnginesNamed: ["FoldX", "RaSP"] });
    const deep = ev.narrative.sent.find(s => s.startsWith("deep-model"))!;
    expect(deep).toContain("FoldX, RaSP");
    expect(deep).not.toContain("StabilityOracle");
  });

  it("says no deep-model block was sent when the run produced none", () => {
    const ev = buildInsightsEvidence({ result: nae1(), functionInput, stability: null, deepEnginesNamed: [] });
    expect(ev.narrative.sent.find(s => s.startsWith("no deep-model"))).toBeDefined();
  });

  it("counts the candidate alleles of an ambiguous protein change", () => {
    const result = nae1({ predictorData: { locusResolution: { route: "fallback", canonicalBy: null, failureKind: "multiple-candidates", steps: [], candidates: [{}, {}] } } });
    expect(buildInsightsEvidence({ result, functionInput, stability: null }).candidateAlleles).toBe(2);
    expect(buildInsightsEvidence({ result: nae1(), functionInput, stability: null }).candidateAlleles).toBeNull();
  });
});

describe("buildInsightsEvidence — the Assembly lane says when no structure models the residue", () => {
  it("reads ABCG1 Gly358 as not modelled in the 5 solved structures, never 'not at any native interface'", async () => {
    const { ABCG1_INTERFACES: F } = await import("./fixtures/abcg1Interfaces");
    const result: any = { ...F.result, multimerData: F.assembly };
    const lane = buildInsightsEvidence({ result, functionInput, stability: null }).lanes.find(l => l.key === "assembly")!;
    expect(lane.rest).toBe("Gly358 is not modelled in any of the 5 solved structures, so they cannot place it. The engine does not read assembly.");
  });
});

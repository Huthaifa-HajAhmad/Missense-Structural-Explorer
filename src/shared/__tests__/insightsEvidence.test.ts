/**
 * insightsEvidence.test.ts — what the consolidator may claim.
 *
 * Reference variant: NAE1 p.Asp116Gly. The model's PM2 arrived beside an engine that recorded only PP3,
 * and the old verdict badge listed both.
 */
import { describe, expect, it } from "vitest";
import { buildInsightsEvidence, computeTierGap, runStatusOf, tierIndexOf, TIER_SCOPE_SENTENCE } from "../insightsEvidence";
import { BS2_NOT_APPLIED_REASON } from "../frequencyRule";

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
    expect(model.finding.rest).toContain('Counted: PP3 Supporting, PM2 Supporting.');
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
    expect(c.lead).toContain("REVEL is the first tool in the standard order that has a score. It gives BP4");
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
    expect(ev.finding.headline).toBe("Automated tier: uncertain significance.");
    expect(ev.finding.rest).toBe(
      "Counted: PP3 Supporting. The model proposed PS3, which the engine cannot compute, so it is not counted."
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

describe("summary wording and run completeness (release audit FB1)", () => {
  const withoutGnomad = () => nae1({ gnomadFrequency: { exomeAF: null, exomeAC: null, exomeAN: null }, serviceStatus: { gnomadFrequency: "ok" } });

  it("states the automated tier with the criteria that counted, not 'not enough evidence'", () => {
    const model = buildInsightsEvidence({ result: nae1(), functionInput, stability: null });
    expect(model.finding.headline).toBe("Automated tier: uncertain significance.");
    expect(model.finding.rest).toMatch(/^Counted: PP3/);
    expect(model.finding.rest).not.toContain("Not enough evidence");
  });

  it("says no criterion counted when the engine recorded none", () => {
    const result = nae1();
    result.ruleBasedInsights.acmgCriteria = [];
    result.insights.acmgCriteria = [];
    const model = buildInsightsEvidence({ result, functionInput, stability: null });
    expect(model.finding.headline).toBe("Automated tier: uncertain significance.");
    expect(model.finding.rest).toBe("No criterion counted.");
  });

  it("gives the scope sentence once as a constant the screens share", () => {
    expect(TIER_SCOPE_SENTENCE).toBe(
      "This tier counts only the criteria the app computes: population frequency, in-silico predictors, regional constraint and protein-domain context. ClinVar assertions are not counted as PP5/BP6; ClinVar is checked only for same-amino-acid PS1 comparators, conservative weighting and fallback allele frequency when gnomAD has no reading. This tier does not include case, segregation, functional or patient phenotype evidence.",
    );
  });

  it("holds Protein function pending while ClinGen CSpec PM1 applicability is loading, and discloses unavailability when CSpec fails", () => {
    const fnWithUniprot = { residue: 116, uniprot: { features: [] }, serviceStatus: "ok" } as any;
    const loading = buildInsightsEvidence({ result: nae1(), functionInput: fnWithUniprot, stability: null, expertPm1Status: "loading" });
    const fnLoading = loading.lanes.find(l => l.key === "function")!;
    expect(fnLoading.state).toBe("pending");
    expect(fnLoading.lead).toMatch(/Checking ClinGen CSpec/i);

    const unavailable = buildInsightsEvidence({ result: nae1(), functionInput: fnWithUniprot, stability: null, expertPm1Status: "unavailable" });
    const fnUnavailable = unavailable.lanes.find(l => l.key === "function")!;
    expect(fnUnavailable.state).toBe("read");
    expect(fnUnavailable.rest).toMatch(/ClinGen CSpec could not be read/i);
  });

  it("names only the genome-wide scores that came back", () => {
    const model = buildInsightsEvidence({ result: nae1(), functionInput, stability: null });
    const lead = model.lanes.find(l => l.key === "language-models")!.lead;
    expect(lead.startsWith("1 genome-wide score (CADD) returned")).toBe(true);
    expect(lead).not.toContain("AlphaGenome");
  });

  it("marks stability as still running and says the count may change while an engine is provisional", () => {
    const model = buildInsightsEvidence({
      result: nae1(),
      functionInput,
      stability: { verdict: "Destabilising", enginesCounted: 3, enginesDestabilizing: 0, provisional: true },
    });
    const lane = model.lanes.find(l => l.key === "stability")!;
    expect(lane.state).toBe("pending");
    expect(lane.lead).toContain("so far");
    expect(lane.rest).toContain("may change");
    expect(lane.lead).toContain("past their local destabilising mark");
    expect(lane.lead).not.toContain("predict destabilisation");
  });

  it("tags each lane's name as counted or not counted, so no tag is left to read as covering the names before it", () => {
    const result = nae1({ gnomadFrequency: { exomeAF: 0.000001, exomeAC: 1, exomeAN: 1000000, groupMaxAF: 0.000001 }, serviceStatus: { gnomadFrequency: "ok" } });
    const model = buildInsightsEvidence({ result, functionInput, stability: null });
    const agree = model.agree.map(a => a.text).join(" ");
    expect(agree).toContain("Computational (counted), Population (not counted) and Genome-wide scores (not counted)");
  });

  it("names the population frequency criterion the BS2 reason when it is read", () => {
    const result = nae1({ gnomadFrequency: { exomeAF: 0.000001, exomeAC: 1, exomeAN: 1000000, groupMaxAF: 0.000001 }, serviceStatus: { gnomadFrequency: "ok" } });
    const model = buildInsightsEvidence({ result, functionInput, stability: null });
    expect(model.lanes.find(l => l.key === "population")!.rest).toContain(BS2_NOT_APPLIED_REASON);
  });

  it("reports the run as running while a lane is still pending", () => {
    const model = buildInsightsEvidence({ result: nae1(), functionInput, stability: null, isLoading: true });
    expect(runStatusOf(model).state).toBe("running");
    expect(runStatusOf(model).running.length).toBeGreaterThan(0);
  });

  it("reports gaps, with the area and the withheld criterion, for an ABCG1-like run with no frequency read", () => {
    const model = buildInsightsEvidence({ result: withoutGnomad(), functionInput: { ...functionInput, serviceStatus: "error" }, stability: null });
    const status = runStatusOf(model);
    expect(status.state).toBe("gaps");
    expect(status.running).toEqual([]);
    expect(status.gaps).toContain("Population (not assessed)");
    expect(status.gaps).toContain("Splicing (not assessed)");
  });

  it("reports complete only when no lane is pending or absent and no criterion is withheld", () => {
    const model = buildInsightsEvidence({ result: nae1(), functionInput, stability: null });
    const allRead = { ...model, lanes: model.lanes.map(l => ({ ...l, state: "read" as const })), criteria: model.criteria.map(c => (c.state === "withheld" ? { ...c, state: "not met" as const } : c)) };
    expect(runStatusOf(allRead)).toEqual({ state: "complete", running: [], gaps: [] });
  });
});

describe("BP4 when the predictor scores never finished (release audit FB1)", () => {
  it("shows BP4 as withheld, not 'Not met', because the engine never tested it", () => {
    // PTEN's ClinGen rule needs REVEL or BayesDel, and the base predictor lookup is still pending.
    const result = nae1({
      metadata: { gene: "PTEN", variant: "p.Asp116Gly", acmgWeighting: "standard" },
      predictorData: {},
      conservationData: { modelStatus: { base: "pending" } },
    });
    const model = buildInsightsEvidence({ result, functionInput, stability: null });
    const bp4 = model.criteria.find(c => c.code === "BP4");
    expect(bp4?.state).toBe("withheld");
    expect(bp4?.reason).toContain("did not finish");
  });
});

describe("buildInsightsEvidence: run state and withheld readings (release fix FC-a)", () => {
  const stable = { verdict: "Destabilizing (Engines Agree)", enginesCounted: 2, enginesDestabilizing: 2 };

  it("reads a stability count as provisional, and names the engine still running", () => {
    const model = buildInsightsEvidence({
      result: nae1(), functionInput, stability: { ...stable, provisional: true, runningEngines: ["FoldX"] },
    });
    const lane = model.lanes.find(l => l.key === "stability")!;
    expect(lane.state).toBe("pending");
    expect(lane.lead).toContain("so far");
    expect(lane.rest).toContain("FoldX is still running");
    expect(runStatusOf(model).running).toContain("Stability");
  });

  it("says a stability conclusion is withheld, not a direction, when the engines withhold it", () => {
    const withheldText = "No stability conclusion: AlphaFold's confidence at this residue is very low (pLDDT 20.0), so the coordinates the estimates use are unreliable.";
    const model = buildInsightsEvidence({ result: nae1(), functionInput, stability: { ...stable, withheldText } });
    const lane = model.lanes.find(l => l.key === "stability")!;
    expect(lane.lead).toBe(withheldText);
    expect(lane.lead).not.toMatch(/destabilis/i);
  });

  it("says no splicing check was made when the splice geometry was refused", () => {
    const result = nae1({
      conservationData: { assemblyRefusals: [{ source: "splice-proximity", reason: "no exact DNA change was established" }] },
    });
    const lane = buildInsightsEvidence({ result, functionInput, stability: null }).lanes.find(l => l.key === "splicing")!;
    expect(lane.rest).toBe("No splicing check was made, because no exact DNA change was established. BP4 is withheld for that reason.");
    expect(lane.rest).not.toMatch(/until SpliceAI has answered/);
  });

  it("marks protein function as not available, not running, when the feature table did not load", () => {
    const lane = buildInsightsEvidence({ result: nae1(), functionInput: { residue: 116, uniprot: null, serviceStatus: "ok" } as any, stability: null })
      .lanes.find(l => l.key === "function")!;
    expect(lane.state).toBe("absent");
  });

  it("keeps protein function running while the feature read is still in flight", () => {
    const model = buildInsightsEvidence({
      result: nae1(), functionInput: { residue: 116, uniprot: null, serviceStatus: "pending" } as any, stability: null, isLoading: true,
    });
    expect(model.lanes.find(l => l.key === "function")!.state).toBe("pending");
  });

  it("names the expert panel's PM1 specification instead of 'PM1 not met'", () => {
    const uniprot = { features: [], sequenceLength: 300 } as any;
    const lane = buildInsightsEvidence({
      result: nae1(), functionInput: { residue: 116, uniprot, serviceStatus: "ok" } as any, stability: null, expertPm1Specified: true,
    }).lanes.find(l => l.key === "function")!;
    expect(lane.lead).toBe("PM1 not assessed — the expert panel's PM1 specification applies.");
  });

  it("does not name tools that returned no genome-wide score", () => {
    const result = nae1({ predictorData: { source: "Ensembl VEP" }, conservationData: { revel: 0.231 } });
    const lane = buildInsightsEvidence({ result, functionInput, stability: null }).lanes.find(l => l.key === "language-models")!;
    expect(lane.name).toBe("Genome-wide scores");
    expect(lane.lead).not.toMatch(/CADD|AlphaGenome/);
  });

  it("explains the first scored tool in plain words, with the standard order", () => {
    const result = nae1({ predictorData: { caddPhred: 26.3, source: "Ensembl VEP" }, conservationData: { revel: 0.922 } });
    const lane = buildInsightsEvidence({ result, functionInput, stability: null }).lanes.find(l => l.key === "computational")!;
    expect(lane.lead).toBe("REVEL is the first tool in the standard order that has a score. It gives PP3 Moderate.");
  });
});


describe("stability moderate counts", () => {
  it.each([
    [1, 1, false],
    [0, 2, false],
    [0, 2, true],
  ])("shows %i past the mark and %i moderate (provisional: %s)", (destabilizing, moderate, provisional) => {
    const model = buildInsightsEvidence({ result: nae1(), functionInput, stability: {
      verdict: "Destabilising", enginesCounted: 3, enginesDestabilizing: destabilizing,
      enginesModerate: moderate, provisional,
    } });
    const lane = model.lanes.find(l => l.key === "stability")!;
    expect(lane.lead).toContain(`${destabilizing} of 3 stability engines past their local destabilising mark`);
    expect(lane.lead).toContain(`; ${moderate} in the moderately destabilising band.`);
    expect(lane.state).toBe(provisional ? "pending" : "read");
    if (provisional) expect(lane.lead).toContain("so far");
  });

  it("keeps withheld conclusions instead of moderate counts", () => {
    const lane = buildInsightsEvidence({ result: nae1(), functionInput, stability: {
      verdict: "Destabilising", enginesCounted: 3, enginesDestabilizing: 1,
      enginesModerate: 2, withheldText: "No stability conclusion: coordinates are unreliable.",
    } }).lanes.find(l => l.key === "stability")!;
    expect(lane.lead).toBe("No stability conclusion: coordinates are unreliable.");
  });
});

it("names analysis when loading has no pending lane", () => {
 const ev = buildInsightsEvidence({ result: nae1(), functionInput, stability: null });
 ev.pending = true;
 ev.lanes = ev.lanes.map(l => ({ ...l, state: "read" }));
 expect(runStatusOf(ev).running).toEqual(["analysis in progress"]);
});
it("keeps peptide-only contacts apart from native whole-protein interfaces", async () => {
 const { ABCG1_INTERFACES: F } = await import("./fixtures/abcg1Interfaces");
 const assembly = structuredClone(F.assembly) as any;
 assembly.experimental.partners = [{ accession: "PEPTIDE", gene: "ABCG1", context: "peptide", pdbEntries: ["1ABC"], modelledEntries: ["1ABC"], variantEntries: ["1ABC"], variantAtInterface: true, support: [1], residues: [358], artefact: false }];
 const ev = buildInsightsEvidence({ result: { ...F.result, multimerData: assembly } as any, functionInput, stability: null });
 expect(ev.lanes.find(l => l.key === "assembly")?.rest).toContain("1 of 1 short-peptide structures, read apart from native whole-protein interfaces");
});

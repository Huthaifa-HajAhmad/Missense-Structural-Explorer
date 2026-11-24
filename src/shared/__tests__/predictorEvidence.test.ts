/**
 * predictorEvidence.test.ts — what the in-silico evidence model may claim.
 *
 * Each block pins a claim the Predictors tab previously got wrong for GZF1 p.Arg591Trp:
 *   • cut-points labelled "ClinGen-calibrated" that were not the published bands;
 *   • popEVE −3.93 voted "pathogenic" on an unsourced −2.0 cut (the authors' cut is −4.617);
 *   • the AlphaGenome AVI voted, and set PP3's strength, although it is a rank that contains
 *     AlphaMissense;
 *   • the tab's verdict rule (majority) differed from the engine's (plurality);
 *   • a count of correlated tools set PP3/BP4 at all — the rule is now one calibrated tool, the
 *     first with a score in the fixed order REVEL → BayesDel noAF → AlphaMissense → ESM1b.
 */
import { describe, expect, it } from "vitest";
import {
  PP3_BP4_CALIBRATION,
  calibratedCall,
  calibrationBands,
  evaluateAlphaGenomeAvi,
  evaluateAlphaMissense,
  evaluatePopEve,
} from "../thresholds";
import { buildPredictorEvidence, localPredictorAgreement, predictorFinding, predictorSummary } from "../predictorEvidence";

/** The scores on the screenshots the redesign was reviewed against. */
function gzf1(overrides: Record<string, any> = {}) {
  return {
    metadata: { gene: "GZF1", variant: "p.Arg591Trp", acmgWeighting: "standard" },
    predictorData: { caddPhred: 29.5, amPathogenicity: 0.835, amClass: "likely_pathogenic", source: "Ensembl VEP" },
    conservationData: {
      revel: 0.234,
      bayesdel: 0.092,
      // Retired tools a saved analysis may still carry: none of them draws a reading.
      metarnn: 0.767,
      clinpred: 0.998,
      eigenPhred: 6.3,
      dann: 0.999,
      popeve: -3.931,
      gerp: 5.0,
      phylop: 4.91,
      scorecons: 0.957,
      alphagenome: { status: "live", aviPhred: 26.4, topPercentile: 0.23, topModality: "AlphaMissense", acmgStrength: "PP3_Moderate" },
      source: "Public dbNSFP (dbnsfp.org)",
    },
    esmcEval: { llr: -9.55, provenance: "VESM-150M (local sidecar)" },
    esm2Eval: { llr: -4.78 },
    saprotEval: { llr: -3.16 },
    ...overrides,
  } as any;
}

describe("calibration — the published bands, transcribed", () => {
  it("REVEL follows Pejaver 2022, not 0.75 / 0.15", () => {
    expect(calibratedCall("revel", 0.234)?.code).toBe("BP4");
    expect(calibratedCall("revel", 0.183)?.code).toBe("BP4_Moderate");
    expect(calibratedCall("revel", 0.5)?.code).toBe("Indeterminate");
    expect(calibratedCall("revel", 0.644)?.code).toBe("PP3");
    expect(calibratedCall("revel", 0.8)?.code).toBe("PP3_Moderate");
    expect(calibratedCall("revel", 0.932)?.code).toBe("PP3_Strong");
    expect(calibratedCall("revel", 0.003)?.code).toBe("BP4_VeryStrong");
  });

  it("CADD reaches Moderate at most, and its BP4 starts at 22.7", () => {
    expect(calibratedCall("cadd", 29.5)?.code).toBe("PP3_Moderate");
    expect(calibratedCall("cadd", 25.3)?.code).toBe("PP3");
    expect(calibratedCall("cadd", 24)?.code).toBe("Indeterminate");
    expect(calibratedCall("cadd", 22.7)?.code).toBe("BP4");
    expect(PP3_BP4_CALIBRATION.cadd.pp3.Strong).toBeUndefined();
  });

  it("AlphaMissense follows Bergquist 2025, not 0.983 / 0.063", () => {
    expect(calibratedCall("alphaMissense", 0.835)?.code).toBe("PP3");
    expect(calibratedCall("alphaMissense", 0.7)?.code).toBe("Indeterminate");
    expect(calibratedCall("alphaMissense", 0.95)?.code).toBe("PP3_Moderate");
    expect(calibratedCall("alphaMissense", 0.99)?.code).toBe("PP3_Strong");
    expect(calibratedCall("alphaMissense", 0.12)?.code).toBe("BP4");
  });

  it("ESM1b runs the other way: more negative is more pathogenic", () => {
    expect(calibratedCall("esm1b", -11)?.code).toBe("PP3");
    expect(calibratedCall("esm1b", -13)?.code).toBe("PP3_Moderate");
    expect(calibratedCall("esm1b", -25)?.code).toBe("PP3_Strong");
    expect(calibratedCall("esm1b", -8)?.code).toBe("Indeterminate");
    expect(calibratedCall("esm1b", -5)?.code).toBe("BP4");
    expect(calibratedCall("esm1b", 0)?.code).toBe("BP4_Moderate");
  });

  it("BayesDel noAF uses −0.18, not −0.0404", () => {
    expect(calibratedCall("bayesdel", 0.092)?.code).toBe("Indeterminate");
    expect(calibratedCall("bayesdel", -0.05)?.code).toBe("Indeterminate");
    expect(calibratedCall("bayesdel", -0.2)?.code).toBe("BP4");
    expect(calibratedCall("bayesdel", 0.5)?.code).toBe("PP3_Strong");
  });

  it("GERP++ has no PP3 band at all", () => {
    expect(calibratedCall("gerp", 6)?.code).toBe("Indeterminate");
    expect(calibrationBands("gerp").every(b => b.direction === "BP4")).toBe(true);
  });

  it("returns null for a missing or non-finite score", () => {
    expect(calibratedCall("revel", null)).toBeNull();
    expect(calibratedCall("revel", Number.NaN)).toBeNull();
  });

  it("lists bands weakest first, each running to the next stronger threshold", () => {
    const pp3 = calibrationBands("revel").filter(b => b.direction === "PP3");
    expect(pp3.map(b => [b.code, b.threshold, b.until])).toEqual([
      ["PP3", 0.644, 0.773],
      ["PP3_Moderate", 0.773, 0.932],
      ["PP3_Strong", 0.932, null],
    ]);
  });
});

describe("evaluators — no unsourced cut-point reaches PP3/BP4", () => {
  it("popEVE calls pathogenic only at the authors' −4.617, and never benign", () => {
    expect(evaluatePopEve(-3.931)).toBe("vus");
    expect(evaluatePopEve(-4.617)).toBe("pathogenic");
    expect(evaluatePopEve(-0.2)).toBe("vus");
    expect(evaluatePopEve(0.8)).toBe("vus");
  });

  it("AlphaMissense: the score decides; a class alone is indeterminate", () => {
    expect(evaluateAlphaMissense(0.7, "likely_pathogenic")).toBe("vus");
    expect(evaluateAlphaMissense(null, "likely_pathogenic")).toBe("vus");
    expect(evaluateAlphaMissense(null, null)).toBe("unavailable");
  });

  it("the AlphaGenome AVI is never a call", () => {
    expect(evaluateAlphaGenomeAvi({ aviPhred: 38 })).toBe("vus");
    expect(evaluateAlphaGenomeAvi({ aviPhred: 2 })).toBe("vus");
    expect(evaluateAlphaGenomeAvi(null)).toBe("unavailable");
  });
});

describe("buildPredictorEvidence — GZF1 p.Arg591Trp", () => {
  const evidence = buildPredictorEvidence({ result: gzf1() });

  it("takes BP4 from REVEL, the first calibrated tool with a score, and notes AlphaMissense's opposite call", () => {
    expect(evidence.primary).toMatchObject({ outcome: "met", activeTool: "revel", code: "BP4", skippedBefore: [] });
    expect(evidence.primary.disagreeingTools.map(d => d.key)).toEqual(["alphaMissense"]);
    expect(evidence.readings.filter(r => r.chainKey !== null).map(r => r.key)).toEqual(["revel", "bayesdel", "am", "esm"]);
  });

  it("shows ProtVar's residue conservation as an informational 0-1 reading with no cut-points", () => {
    const row = evidence.readings.find(r => r.key === "scorecons")!;
    expect(row).toMatchObject({ group: "conservation", chainKey: null, score: 0.957, scoreText: "0.96", scale: { min: 0, max: 1 }, orientation: "higher" });
    expect(row.cutpoints.kind).toBe("none");
    expect(row.source).toMatch(/ProtVar/);
    expect(evidence.readings.find(r => r.key === "consurf")).toBeUndefined();
  });

  it("shows popEVE as a cross-gene severity reading that never sets PP3/BP4", () => {
    const popeve = evidence.readings.find(r => r.key === "popeve")!;
    expect(popeve.chainKey).toBeNull();
    expect(popeve.group).toBe("severity");
    expect(popeve.caveats).toContain("no-benign-cut");
  });

  it("keeps every informational tool out of the fixed order", () => {
    for (const r of evidence.readings.filter(x => x.chainKey === null)) {
      expect(["cadd", "popeve", "alphagenome", "phylop", "gerp", "scorecons"]).toContain(r.key);
    }
    // DANN, Eigen, MetaRNN and ClinPred were retired; the fixture's stored scores draw no reading.
    for (const key of ["dann", "eigen", "metarnn", "clinpred"]) expect(evidence.readings.find(r => r.key === key)).toBeUndefined();
    const avi = evidence.readings.find(r => r.key === "alphagenome")!;
    expect(avi.callLabel).toBe("Informational");
    expect(avi.caveats).toEqual(expect.arrayContaining(["rank-not-probability", "includes-alphamissense"]));
  });

  it("shows CADD with its calibrated band, as a genome-wide model that is not counted", () => {
    const cadd = evidence.readings.find(r => r.key === "cadd")!;
    expect(cadd).toMatchObject({ group: "genome", chainKey: null, callLabel: "PP3_Moderate" });
  });

  it("shows no row for the retired runtime language models a saved analysis still carries, and keeps ESM1b", () => {
    // The fixture stores ESMC/VESM, ESM-2 and SaProt results, as analyses saved before 2026-11-18 do.
    for (const key of ["esm2_3b", "vesm", "saprot"]) expect(evidence.readings.find(r => r.key === key)).toBeUndefined();
    expect(evidence.readings.map(r => r.name).join(" ")).not.toMatch(/ESM-2|ESMC|VESM|SaProt/);
    const esm1b = evidence.readings.find(r => r.key === "esm")!;
    expect(esm1b.name).toBe("ESM1b");
    expect(esm1b.group).toBe("primary");
    expect(esm1b.chainKey).toBe("esm1b");
  });

  it("reads the engine record rather than inferring it", () => {
    expect(evidence.engine.known).toBe(false);
    const withRecord = buildPredictorEvidence({
      result: gzf1({ ruleBasedInsights: { acmgCriteria: [{ code: "PM2", reason: "" }, { code: "PP3_Moderate", reason: "old" }] } }),
    });
    expect(withRecord.engine).toMatchObject({ known: true, code: "PP3_Moderate" });
  });

  it("does not call a code withheld by the conservative weighting when ClinVar corroborates its direction", () => {
    // GZF1's rule gives BP4. Conservative weighting keeps BP4 when ClinVar says benign, as the engine does.
    const corroborated = buildPredictorEvidence({
      result: gzf1({ metadata: { acmgWeighting: "conservative" }, clinvar: { classification: "Benign" }, ruleBasedInsights: { acmgCriteria: [] } }),
    });
    expect(corroborated.engine.withheldByWeighting).toBe(false);
    const uncorroborated = buildPredictorEvidence({
      result: gzf1({ metadata: { acmgWeighting: "conservative" }, clinvar: { classification: "Pathogenic" }, ruleBasedInsights: { acmgCriteria: [] } }),
    });
    expect(uncorroborated.engine.withheldByWeighting).toBe(true);
  });

  it("marks a criterion withheld by the weighting", () => {
    const e = buildPredictorEvidence({
      result: gzf1({ metadata: { acmgWeighting: "strict-structural" }, ruleBasedInsights: { acmgCriteria: [] } }),
    });
    expect(e.engine.withheldByWeighting).toBe(true);
  });

  it("words the finding from the first calibrated tool with a score", () => {
    const f = predictorFinding(evidence);
    expect(f.headline).toBe("REVEL 0.234 is in its BP4 band");
    expect(f.predicate).toBe("it is the first calibrated tool with a score (REVEL → BayesDel noAF → AlphaMissense → ESM1b), and it sets BP4");
  });

  it("names the tools skipped before a fallback answers", () => {
    const f = predictorFinding(buildPredictorEvidence({ result: gzf1({ conservationData: { ...gzf1().conservationData, revel: null, bayesdel: null } }) }));
    expect(f.headline).toBe("AlphaMissense 0.835 is in its PP3 band");
    expect(f.predicate.startsWith("REVEL, BayesDel noAF had no score, so it is the first")).toBe(true);
  });

  it("reports a missing score as pending while the analysis runs, and as no result after", () => {
    const missing = { conservationData: { ...gzf1().conservationData, esm1b: null } };
    const loading = buildPredictorEvidence({ result: gzf1(missing), isLoading: true });
    expect(loading.readings.find(r => r.key === "esm")!.availability.state).toBe("pending");
    const done = buildPredictorEvidence({ result: gzf1(missing) });
    expect(done.readings.find(r => r.key === "esm")!.availability.state).toBe("absent");
  });
});

describe("predictorSummary — one line for every engine state", () => {
  const summary = (overrides: Record<string, any>, extra: Record<string, unknown> = {}) =>
    predictorSummary(buildPredictorEvidence({ result: gzf1(overrides), ...extra }));
  const record = (...codes: string[]) => ({ ruleBasedInsights: { acmgCriteria: codes.map(code => ({ code, reason: "" })) } });
  const scores = (patch: Record<string, unknown>) => ({ conservationData: { ...gzf1().conservationData, ...patch } });
  const NO_SPLICE = "SpliceAI had no score in this payload; verify splicing manually.";
  const SPLICE_CLEAR = { spliceai: { ds_ag: 0, ds_al: 0, ds_dg: 0, ds_dl: 0.01, max_ds: 0.01 } };
  const AM_DISAGREES = "AlphaMissense 0.835 (PP3) points the other way. The strength stays with the first tool; weigh the disagreement before you accept it.";

  it("recorded, another calibrated tool disagrees: says which, and warns", () => {
    const s = summary(record("BP4"));
    expect(s).toMatchObject({ state: "recorded", tone: "warning" });
    expect(s.lead).toBe("The engine recorded BP4 from REVEL 0.234.");
    expect(s.rest).toEqual([AM_DISAGREES, NO_SPLICE]);
  });

  it("recorded, no disagreement: no warning, the strength named", () => {
    const s = summary({ ...record("PP3_Moderate"), ...scores({ revel: 0.8 }) });
    expect(s).toMatchObject({ state: "recorded", tone: "neutral" });
    expect(s.lead).toBe("The engine recorded PP3 Moderate from REVEL 0.800.");
    expect(s.rest).toEqual([]);
  });

  it("recorded from a fallback: names the tools that had no score", () => {
    const s = summary({ ...record("BP4_Moderate"), ...scores({ revel: null, bayesdel: -0.4, ...SPLICE_CLEAR }), predictorData: { amPathogenicity: 0.1 } });
    expect(s.lead).toBe("The engine recorded BP4 Moderate from BayesDel noAF -0.400, after REVEL had no score.");
  });

  it("first tool between its bands: no criterion, later tools not asked", () => {
    const s = summary({ ...record(), ...scores({ revel: 0.5 }) });
    expect(s.state).toBe("none");
    expect(s.lead).toBe("No PP3 or BP4: REVEL 0.500, the first tool with a score, sits between its bands.");
  });

  it("no calibrated tool at all: says so", () => {
    const s = summary({ predictorData: {}, conservationData: {}, ...record() });
    expect(s.lead).toBe("No PP3 or BP4: none of the calibrated tools scored this variant.");
    expect(s.tone).toBe("neutral");
  });

  it("SpliceAI at 0.20 or more blocks BP4 and emits Walker 2023 splicing PP3 when PVS1 is absent", () => {
    // Uncovered gene (GZF1): SpliceAI 0.30 blocks REVEL BP4 and triggers Walker 2023 splicing PP3.
    const s = summary({ ...record("PP3"), ...scores({ spliceai: { ds_ag: 0.3, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: 0.3 } }) });
    expect(s.state).toBe("recorded");
    expect(s.lead).toBe("The engine recorded PP3 from SpliceAI max Δ 0.30.");
    expect(s.rest.join(" ")).toContain("REVEL 0.234 reads BP4 for missense impact, which SpliceAI max Δ 0.30 overrides");

    // When splicing PP3 is suppressed (e.g., VCEP PAH > 0.50), BP4 is still blocked without PP3.
    const pahBlocked = summary({
      metadata: { gene: "PAH", variant: "p.Val245Ala", acmgWeighting: "standard" },
      ...record(),
      ...scores({ spliceai: { ds_ag: 0.3, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: 0.3 } }),
    });
    expect(pahBlocked.state).toBe("none");
    expect(pahBlocked.lead.startsWith("No BP4: REVEL 0.234 reads BP4, but SpliceAI max Δ 0.30 ≥ 0.20")).toBe(true);
  });

  it("no engine record: the rule's code is called unconfirmed", () => {
    const s = summary({});
    expect(s.state).toBe("unconfirmed");
    expect(s.lead).toBe("The rule gives BP4 from REVEL 0.234.");
    expect(s.rest[0]).toBe("This result carries no engine record to confirm it against.");
  });

  it("withheld by the weighting: named, and warned", () => {
    const s = summary({ metadata: { acmgWeighting: "strict-structural" }, ...record() });
    expect(s).toMatchObject({ state: "withheld", tone: "warning" });
    expect(s.lead).toBe("The rule gives BP4 from REVEL 0.234, but the engine recorded no in-silico criterion.");
    expect(s.rest[0]).toBe("The strict-structural ACMG weighting withholds it.");
  });

  it("an earlier engine's vote: says the record is stale", () => {
    const s = summary(record("PP3"));
    expect(s).toMatchObject({ state: "stale", tone: "warning" });
    expect(s.lead).toBe("The engine recorded PP3 where the current rule gives BP4 from REVEL 0.234.");
    expect(s.rest[0]).toMatch(/earlier engine; re-run the analysis/);
  });
});

describe("AlphaGenome reference-base refusal", () => {
  const message =
    "AlphaGenome gRPC error [code 3]: Variant: chr16:66823281:A>G reference base does not match the expected reference base: T";

  it("is stated as a coordinate mismatch, not a retryable provider error", () => {
    const e = buildPredictorEvidence({
      result: gzf1({
        conservationData: { ...gzf1().conservationData, alphagenome: { status: "error", aviPhred: null, message } },
      }),
    });
    const avi = e.readings.find(r => r.key === "alphagenome")!.availability;
    expect(avi.state).toBe("absent");
    expect(avi.action).toBeNull();
    expect(avi.reason).toMatch(/reference base here is T, but the variant gives A/);
    expect(avi.reason).not.toMatch(/gRPC/);
  });
});

describe("local informational agreement", () => {
  it("keeps calibrated bands, unclassified scores and missingness separate from PP3/BP4", () => {
    const evidence = buildPredictorEvidence({ result: gzf1({ conservationData: { ...gzf1().conservationData, gerp: null } }) });
    const agreement = localPredictorAgreement(evidence);
    expect(agreement.unclassified.map(r => r.key)).toContain("alphagenome");
    expect(agreement.missing.map(r => r.key)).toContain("gerp");
    expect(agreement.calibrated.every(x => x.reading.chainKey === null)).toBe(true);
    const empty = localPredictorAgreement(buildPredictorEvidence({ result: {} as any }));
    expect(empty.scored).toBe(0);
    // The tab card and the rail render these strings verbatim, so gaps are stated only when they
    // exist: "None" is not a finding, and a calibrated code names its band without counting it.
    expect(agreement.lead[0]).toContain("informational readings scored");
    expect(agreement.tail.some(t => t.startsWith("No published band:"))).toBe(true);
    expect(agreement.tail.some(t => t.startsWith("Not scored:"))).toBe(true);
    expect(agreement.tail.every(t => !/\bnone\b/i.test(t))).toBe(true);
    expect(agreement.calibrated.every(x => x.label.endsWith("(published band, not counted)"))).toBe(true);
    expect(empty.tail.some(t => t.startsWith("No sequence-preference reading:"))).toBe(false);
    // An empty payload scores nothing, so each reading is listed with its own reason rather than a
    // bare "None", and the two surfaces cannot disagree about what is missing.
    expect(empty.tail.find(t => t.startsWith("Not scored:"))).toContain("(");
  });

  it("labels an interrupted provider as timed out, not a completed miss", () => {
    const evidence = buildPredictorEvidence({
      result: gzf1({
        conservationData: {
          ...gzf1().conservationData,
          revel: null,
          popeve: null,
          modelStatus: { base: "timeout", popeve: "timeout" },
        },
      }),
    });
    for (const key of ["revel", "popeve"]) {
      const availability = evidence.readings.find(r => r.key === key)!.availability;
      expect(availability.label).toBe("Timed out");
      expect(availability.action).toBe("retry");
      expect(availability.reason).toMatch(/analysis budget/);
    }
    // A provider that answered and holds no score is a completed miss, and stays worded as one.
    const settled = buildPredictorEvidence({
      result: gzf1({
        conservationData: { ...gzf1().conservationData, revel: null, modelStatus: { base: "settled" } },
      }),
    });
    expect(settled.readings.find(r => r.key === "revel")!.availability.label).toBe("No result");
  });
});

describe("VCEP rules and Walker 2023 splicing PP3 in predictorEvidence", () => {
  it("applies gene-specific VCEP strength bounds (PTEN cap) and exclusions (PALB2)", () => {
    const pten = buildPredictorEvidence({
      result: gzf1({
        metadata: { gene: "PTEN", variant: "p.Arg130Gln", acmgWeighting: "standard" },
        conservationData: { revel: 0.95, spliceai: { max_ds: 0.01 } },
        ruleBasedInsights: { acmgCriteria: [{ code: "PP3", reason: "PTEN VCEP" }] },
      }),
    });
    expect(pten.primary).toMatchObject({ outcome: "met", code: "PP3", vcepApplied: true, criterionSource: "vcep" });
    expect(predictorSummary(pten).lead).toContain("GN003 v3.2");

    const palb2 = buildPredictorEvidence({
      result: gzf1({
        metadata: { gene: "PALB2", variant: "p.Leu100Pro", acmgWeighting: "standard" },
        conservationData: { revel: 0.95, spliceai: { max_ds: 0.01 } },
        ruleBasedInsights: { acmgCriteria: [] },
      }),
    });
    expect(palb2.primary).toMatchObject({ outcome: "vcep-excluded", code: null, vcepApplied: true });
    expect(predictorSummary(palb2).lead).toContain("excludes missense computational predictors");
  });

  it("emits Walker 2023 splicing PP3 when SpliceAI >= 0.20 overrides BP4 without PVS1", () => {
    const ev = buildPredictorEvidence({
      result: gzf1({
        metadata: { gene: "GBA1", variant: "p.Asn370Ser", acmgWeighting: "standard" },
        conservationData: { revel: 0.002, spliceai: { max_ds: 0.45 } },
        ruleBasedInsights: { acmgCriteria: [{ code: "PP3", reason: "SpliceAI 0.45" }] },
      }),
    });
    expect(ev.primary).toMatchObject({ outcome: "met", code: "PP3", activeTool: "spliceai", criterionSource: "spliceai" });
    expect(predictorSummary(ev).lead).toContain("SpliceAI max Δ 0.45");
  });
});

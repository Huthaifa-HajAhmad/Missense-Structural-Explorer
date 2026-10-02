/**
 * predictorEvidence.test.ts — what the in-silico evidence model may claim.
 *
 * Each block pins a claim the Predictors tab previously got wrong for GZF1 p.Arg591Trp:
 *   • cut-points labelled "ClinGen-calibrated" that were not the published bands;
 *   • popEVE −3.93 voted "pathogenic" on an unsourced −2.0 cut (the authors' cut is −4.617);
 *   • the AlphaGenome AVI voted, and set PP3's strength, although it is a rank that contains
 *     AlphaMissense;
 *   • the tab's verdict rule (majority) differed from the engine's (plurality).
 */
import { describe, expect, it } from "vitest";
import {
  PP3_BP4_CALIBRATION,
  calibratedCall,
  calibrationBands,
  countPredictorConcordance,
  evaluateAlphaGenomeAvi,
  evaluateAlphaMissense,
  evaluatePopEve,
  insilicoVoteOutcome,
} from "../thresholds";
import { buildPredictorEvidence, predictorFinding, predictorSummary } from "../predictorEvidence";

/** The scores on the screenshots the redesign was reviewed against. */
function gzf1(overrides: Record<string, any> = {}) {
  return {
    metadata: { gene: "GZF1", variant: "p.Arg591Trp", acmgWeighting: "standard" },
    predictorData: { caddPhred: 29.5, amPathogenicity: 0.835, amClass: "likely_pathogenic", source: "Ensembl VEP" },
    conservationData: {
      revel: 0.234,
      bayesdel: 0.092,
      metarnn: 0.767,
      clinpred: 0.998,
      eigenPhred: 6.3,
      dann: 0.999,
      popeve: -3.931,
      gerp: 5.0,
      phylop: 4.91,
      consurf: null,
      gpnStar: -8.81,
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

describe("evaluators — no unsourced cut-point reaches the vote", () => {
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

  it("AlphaGenome, Eigen and DANN are informational in the concordance", () => {
    const c = countPredictorConcordance(null, null, null, null, null, null, {
      eigenPhred: 10,
      dann: 0.999,
      alphagenome: { status: "live", aviPhred: 40 } as any,
    });
    expect(c.nPathogenic + c.nBenign + c.nVus).toBe(0);
    expect(insilicoVoteOutcome(c).direction).toBe("no-votes");
  });
});

describe("insilicoVoteOutcome — the engine's plurality rule", () => {
  it("PP3 on a plurality even when most voters are indeterminate", () => {
    expect(insilicoVoteOutcome({ nPathogenic: 1, nBenign: 0, nVus: 5 }).code).toBe("PP3");
  });
  it("nothing on a tie", () => {
    expect(insilicoVoteOutcome({ nPathogenic: 2, nBenign: 2, nVus: 0 })).toMatchObject({ direction: "tie", code: null });
  });
  it("BP4 when benign outnumber pathogenic", () => {
    expect(insilicoVoteOutcome({ nPathogenic: 1, nBenign: 3, nVus: 1 }).code).toBe("BP4");
  });
});

describe("buildPredictorEvidence — GZF1 p.Arg591Trp", () => {
  const evidence = buildPredictorEvidence({ result: gzf1() });

  it("counts seven voting tools: four pathogenic, one benign, two indeterminate", () => {
    expect(evidence.vote).toMatchObject({ nPathogenic: 4, nBenign: 1, nIndeterminate: 2, nVoting: 7, code: "PP3" });
    expect(evidence.voters.pathogenic.map(r => r.key).sort()).toEqual(["am", "cadd", "clinpred", "metarnn"]);
    expect(evidence.voters.benign.map(r => r.key)).toEqual(["revel"]);
    expect(evidence.voters.indeterminate.map(r => r.key).sort()).toEqual(["bayesdel", "popeve"]);
  });

  it("states that the calibrated reference points the other way", () => {
    expect(evidence.reference).toMatchObject({ key: "revel", relation: "opposes" });
    expect(evidence.reference?.call.code).toBe("BP4");
  });

  it("never lets an informational tool vote", () => {
    for (const r of evidence.readings.filter(x => !x.votes)) {
      expect(["alphagenome", "eigen", "dann", "esm", "esm2_3b", "vesm", "saprot", "gpn_star", "phylop", "gerp", "consurf"]).toContain(r.key);
    }
    const avi = evidence.readings.find(r => r.key === "alphagenome")!;
    expect(avi.callLabel).toBe("Informational");
    expect(avi.caveats).toEqual(expect.arrayContaining(["rank-not-probability", "includes-alphamissense"]));
  });

  it("flags the tools that take allele frequency as a feature", () => {
    for (const key of ["metarnn", "clinpred"]) {
      expect(evidence.readings.find(r => r.key === key)!.caveats).toContain("uses-af");
    }
    expect(evidence.readings.find(r => r.key === "revel")!.caveats).not.toContain("uses-af");
  });

  it("names the model that served the ESMC/VESM slot", () => {
    const row = evidence.readings.find(r => r.key === "vesm")!;
    expect(row.name).toBe("VESM");
    expect(row.note).toMatch(/VESM-150M/);
  });

  it("reads the engine record rather than inferring it", () => {
    expect(evidence.engine.known).toBe(false);
    const withRecord = buildPredictorEvidence({
      result: gzf1({ ruleBasedInsights: { acmgCriteria: [{ code: "PM2", reason: "" }, { code: "PP3_Moderate", reason: "old" }] } }),
    });
    expect(withRecord.engine).toMatchObject({ known: true, code: "PP3_Moderate" });
  });

  it("marks a criterion withheld by the weighting", () => {
    const e = buildPredictorEvidence({
      result: gzf1({ metadata: { acmgWeighting: "strict-structural" }, ruleBasedInsights: { acmgCriteria: [] } }),
    });
    expect(e.engine.withheldByWeighting).toBe(true);
  });

  it("words the finding from the vote", () => {
    const f = predictorFinding(evidence);
    expect(f.headline).toBe("Pathogenic calls outnumber benign");
    expect(f.predicate).toMatch(/^4 to 1, with 2 indeterminate/);
  });

  it("reports a missing score as pending while the analysis runs, and as no result after", () => {
    const loading = buildPredictorEvidence({ result: gzf1({ esm2Eval: null, esm2: null }), isModelLoading: true });
    expect(loading.readings.find(r => r.key === "esm2_3b")!.availability.state).toBe("pending");
    expect(loading.pending).toBe(true);
    const done = buildPredictorEvidence({ result: gzf1({ esm2Eval: null, esm2: null }) });
    expect(done.readings.find(r => r.key === "esm2_3b")!.availability.state).toBe("absent");
  });
});

describe("predictorSummary — one line for every engine and reference state", () => {
  const summary = (overrides: Record<string, any>, extra: Record<string, unknown> = {}) =>
    predictorSummary(buildPredictorEvidence({ result: gzf1(overrides), ...extra }));
  const record = (...codes: string[]) => ({ ruleBasedInsights: { acmgCriteria: codes.map(code => ({ code, reason: "" })) } });
  const scores = (patch: Record<string, unknown>) => ({ conservationData: { ...gzf1().conservationData, ...patch } });
  const ADVICE = "ClinGen advises one pre-specified calibrated tool over a count of correlated ones.";

  it("recorded, reference opposes: says both in the lead and warns", () => {
    const s = summary(record("PP3"));
    expect(s).toMatchObject({ state: "recorded", tone: "warning" });
    expect(s.lead).toBe("The engine recorded PP3 from a 4 to 1 vote, but REVEL, the calibrated reference, reads BP4.");
    expect(s.rest).toEqual([ADVICE]);
  });

  it("recorded, reference agrees: no warning, the reference's own strength named", () => {
    const s = summary({ ...record("PP3"), ...scores({ revel: 0.8 }) });
    expect(s).toMatchObject({ state: "recorded", tone: "neutral" });
    expect(s.lead).toBe("The engine recorded PP3 from a 5 to 0 vote, and REVEL, the calibrated reference, agrees (PP3 Moderate).");
    expect(s.rest).toEqual([]);
  });

  it("recorded, reference between its bands: says the vote rests on weaker tools, no warning", () => {
    const s = summary({ ...record("PP3"), ...scores({ revel: 0.5 }) });
    expect(s.tone).toBe("neutral");
    expect(s.rest[0]).toMatch(/^REVEL, the calibrated reference, sits between its bands/);
    expect(s.rest[0]).toMatch(/rests on uncalibrated or weaker tools/);
  });

  it("falls back to BayesDel when REVEL is absent", () => {
    const s = summary({ ...record("PP3"), ...scores({ revel: null, bayesdel: -0.4 }) });
    expect(s.lead).toMatch(/but BayesDel, the calibrated reference, reads BP4 Moderate\.$/);
  });

  it("no calibrated tool at all: says so, never implies agreement", () => {
    const s = summary({ ...record("PP3"), ...scores({ revel: null, bayesdel: null }) });
    expect(s.tone).toBe("neutral");
    expect(s.rest).toEqual(["Neither REVEL nor BayesDel scored this variant, so there is no calibrated reading to set beside the vote."]);
  });

  it("calibrated tool still running: says pending, not absent", () => {
    const s = summary({ ...record("PP3"), ...scores({ revel: null, bayesdel: null }) }, { isLoading: true });
    expect(s.rest.join(" ")).toMatch(/still being computed/);
    expect(s.rest.join(" ")).not.toMatch(/Neither REVEL nor BayesDel scored/);
  });

  it("no engine record: the vote's code is called unconfirmed", () => {
    const s = summary({});
    expect(s.state).toBe("unconfirmed");
    expect(s.lead).toMatch(/^The vote supports PP3, 4 to 1, but REVEL/);
    expect(s.rest[0]).toBe("This result carries no engine record to confirm it against.");
  });

  it("withheld by the weighting: named, and warned", () => {
    const s = summary({ metadata: { acmgWeighting: "strict-structural" }, ...record() });
    expect(s).toMatchObject({ state: "withheld", tone: "warning" });
    expect(s.lead).toBe("The vote supports PP3, 4 to 1, but the engine recorded no in-silico criterion.");
    expect(s.rest[0]).toBe("The strict-structural ACMG weighting withholds it.");
    expect(s.rest).toContain("REVEL, the calibrated reference, reads BP4, the other way from the vote.");
  });

  it("an earlier engine's stronger code: says the record is stale", () => {
    const s = summary(record("PP3_Moderate"));
    expect(s).toMatchObject({ state: "stale", tone: "warning" });
    expect(s.lead).toBe("The engine recorded PP3 Moderate where the current rule gives PP3 (4 to 1).");
    expect(s.rest[0]).toMatch(/earlier engine; re-run the analysis/);
  });

  it("an earlier engine recorded nothing the current rule would give: stale, not withheld", () => {
    const s = summary(record());
    expect(s.state).toBe("stale");
    expect(s.lead).toBe("The engine recorded no PP3 or BP4 where the current rule gives PP3 (4 to 1).");
  });

  it("a tie, with the calibrated reference reaching a band: no criterion, and the reference flagged", () => {
    const s = summary({ predictorData: { caddPhred: 29.5 }, conservationData: { revel: 0.234 }, ...record() });
    expect(s).toMatchObject({ state: "none", tone: "warning" });
    expect(s.lead).toBe("No PP3 or BP4: the vote is split, 1 pathogenic against 1 benign.");
    expect(s.rest[0]).toBe("REVEL, the calibrated reference, reads BP4 on its own, which the vote does not reflect.");
  });

  it("every scored voter indeterminate: no criterion", () => {
    const s = summary({ predictorData: { caddPhred: 24 }, conservationData: { bayesdel: 0.0 }, ...record() });
    expect(s.lead).toBe("No PP3 or BP4: all 2 scored voting tools sit in their indeterminate range.");
  });

  it("nothing scored: one sentence, no second word about the missing reference", () => {
    const s = summary({ predictorData: {}, conservationData: {}, ...record() });
    expect(s.lead).toBe("No PP3 or BP4: no voting tool scored this variant.");
    expect(s.rest).toEqual([]);
    expect(s.tone).toBe("neutral");
  });

  it("a benign vote the reference agrees with", () => {
    const s = summary({
      predictorData: { caddPhred: 10, amPathogenicity: 0.05 },
      conservationData: { revel: 0.1, bayesdel: -0.4, metarnn: 0.1, clinpred: 0.1 },
      ...record("BP4"),
    });
    expect(s.lead).toBe("The engine recorded BP4 from a 6 to 0 vote, and REVEL, the calibrated reference, agrees (BP4 Moderate).");
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

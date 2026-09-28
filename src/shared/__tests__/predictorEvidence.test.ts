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
import { buildPredictorEvidence, predictorFinding } from "../predictorEvidence";

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

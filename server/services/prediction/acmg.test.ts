import { describe, it, expect, vi } from "vitest";
import { computeRuleBasedACMG } from "./acmg.ts";
import { Semaphore } from "../../utils.ts";
import { countPredictorConcordance, evaluateSplicePredictor } from "../../../src/shared/thresholds.ts";

describe("ACMG Pathogenicity Engine & Rule Classifier", () => {
  it("should correctly classify standard evidence combinations (1 Very Strong + 1 Moderate -> Likely Pathogenic)", () => {
    const clinvar = { classification: "Likely pathogenic", uid: "123" };
    const res = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar,
      predictorData: { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
      conservationData: { available: true, revel: 0.6, gerp: 1.0, phylop: 0.5, consurf: 2 },
      gnomadConstraint: null,
      gnomadFrequency: { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" }
    });
    
    expect(res.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
    expect(res.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
    expect(res.acmgVerdict).toBeDefined();
  });

  it("should count BS1 as strong benign and class as Likely Benign with BP4", () => {
    const res = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
      conservationData: { available: true, revel: 0.1 },
      gnomadConstraint: null,
      gnomadFrequency: { maxAF: 0.015, groupMaxAF: 0.015, genomeAF: 0.015, exomeAF: 0.015, nHomozygous: 0, dataset: "gnomad" },
      acmgWeighting: "standard"
    });
    expect(res.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
    expect(res.acmgCriteria.some(c => c.code === "BS1")).toBe(true);
    expect(res.acmgVerdict).toBe("Likely Benign");
  });

  it("should include bayesdel in PP3/BP4 predictor concordance", () => {
    const res = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 },
      conservationData: { available: true, revel: 0.1, bayesdel: 0.2 }
    });
    expect(res.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
    expect(res.acmgCriteria.find(c => c.code === "PP3")?.reason).toContain("BayesDel 0.200");
    expect(res.acmgCriteria.find(c => c.code === "PP3")?.reason).toContain("3/4 predictors agree");
  });

  it("should respect PP3/BP4 concordance voting rules under conflicting predictor scenarios", () => {
    const res1 = computeRuleBasedACMG({
      gene: "GBA1",
      variant: "p.Asn370Ser",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 },
      conservationData: { available: true, revel: 0.1, gerp: 1.0, phylop: 0.5 }
    });
    expect(res1.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
    expect(res1.acmgCriteria.some(c => c.code === "BP4")).toBe(false);

    const res2 = computeRuleBasedACMG({
      gene: "GBA1",
      variant: "p.Asn370Ser",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
      conservationData: { available: true, revel: 0.6, gerp: 1.0, phylop: 0.5 }
    });
    expect(res2.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
    expect(res2.acmgCriteria.some(c => c.code === "PP3")).toBe(false);
  });

  it("does not promote AlphaMissense's likely_pathogenic class to a calibrated call", () => {
    // 0.65 is "likely_pathogenic" in the authors' classes (> 0.564) but below ClinGen's PP3 band
    // (≥ 0.792, Bergquist 2025): it is counted as indeterminate, and PP3 rests on CADD and REVEL.
    const res = computeRuleBasedACMG({
      gene: "LDLR",
      variant: "p.Glu101Lys",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.65, amClass: "likely_pathogenic", caddPhred: 26 },
      conservationData: { available: true, revel: 0.8 }
    });
    const pp3 = res.acmgCriteria.find(c => c.code === "PP3");
    expect(pp3).toBeDefined();
    expect(pp3?.reason).toContain("2/3");
    expect(pp3?.reason).toContain("indeterminate: AlphaMissense 0.650");
  });

  it("should output accurate count, never false agreement wording, when only one predictor is available", () => {
    const res = computeRuleBasedACMG({
      gene: "PTEN",
      variant: "p.Arg130Gln",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.85, amClass: "pathogenic", caddPhred: null },
      conservationData: { available: false, revel: null }
    });
    const pp3 = res.acmgCriteria.find(c => c.code === "PP3");
    expect(pp3).toBeDefined();
    expect(pp3?.reason).toContain("1/1 predictor supports");
    expect(pp3?.reason).not.toContain("agree");
  });

  it("should respect popEVE scores in ACMG PP3/BP4 concordance calculations", () => {
    const res = computeRuleBasedACMG({
      gene: "GBA1",
      variant: "p.Asn370Ser",
      clinvar: null,
      predictorData: {
        available: true,
        amPathogenicity: 0.8,
        amClass: "pathogenic",
        caddPhred: 26,
      },
      conservationData: {
        available: true,
        revel: 0.1,
        popeve: -3.775,
      }
    });
    // −3.775 is above popEVE's published −4.617 cut-point, so it is indeterminate, not pathogenic.
    const pp3 = res.acmgCriteria.find(c => c.code === "PP3");
    expect(pp3).toBeDefined();
    expect(pp3?.reason).toContain("2/4 predictors agree");
    expect(pp3?.reason).toContain("indeterminate: popEVE -3.775");
  });

  it("should respect acmgWeighting parameter (conservative & strict-structural modes)", () => {
    const predictorData = { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 };
    const conservationData = { available: true, revel: 0.6 };
    const gnomadConstraintMock = { isPP2Constrained: true, missense_z: 3.0, oe_mis: 0.5, pli: null };

    const resStandard = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData,
      conservationData,
      gnomadConstraint: gnomadConstraintMock,
      gnomadFrequency: { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" },
      acmgWeighting: "standard"
    });
    expect(resStandard.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
    expect(resStandard.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
    expect(resStandard.acmgCriteria.some(c => c.code === "PP2")).toBe(true);

    const resConservativeNoClinVar = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData,
      conservationData,
      gnomadConstraint: gnomadConstraintMock,
      gnomadFrequency: { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" },
      acmgWeighting: "conservative"
    });
    expect(resConservativeNoClinVar.acmgCriteria.some(c => c.code === "PP3")).toBe(false);
    expect(resConservativeNoClinVar.acmgCriteria.some(c => c.code === "PM2")).toBe(false);
    expect(resConservativeNoClinVar.acmgCriteria.some(c => c.code === "PP2")).toBe(false);

    const resConservativeWithClinVar = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: { classification: "Pathogenic", uid: "123" },
      predictorData,
      conservationData,
      gnomadConstraint: gnomadConstraintMock,
      gnomadFrequency: { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" },
      acmgWeighting: "conservative"
    });
    expect(resConservativeWithClinVar.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
    expect(resConservativeWithClinVar.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
    expect(resConservativeWithClinVar.acmgCriteria.some(c => c.code === "PP2")).toBe(true);

    const resStrictStructural = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: { classification: "Pathogenic", uid: "123" },
      predictorData,
      conservationData,
      gnomadConstraint: gnomadConstraintMock,
      gnomadFrequency: null,
      acmgWeighting: "strict-structural"
    });
    expect(resStrictStructural.acmgCriteria.some(c => c.code === "PP3")).toBe(false);
    expect(resStrictStructural.acmgCriteria.some(c => c.code === "PM2")).toBe(false);
    expect(resStrictStructural.acmgCriteria.some(c => c.code === "PP2")).toBe(false);
  });

  it("should respect ClinGen-calibrated AlphaMissense thresholds (pathogenic >= 0.983, benign <= 0.063)", () => {
    const resPath = countPredictorConcordance(null, null, 0.985, null);
    expect(resPath.signals.am).toBe("pathogenic");

    const resBenign = countPredictorConcordance(null, null, 0.05, null);
    expect(resBenign.signals.am).toBe("benign");

    const resVus = countPredictorConcordance(null, null, 0.5, null);
    expect(resVus.signals.am).toBe("vus");
  });

  it("should evaluate splicing signals via evaluateSplicePredictor without polluting predictor concordance", () => {
    // 1. Junction proximity alone is not PP3 (Walker 2023 decides on SpliceAI): a tiny delta 2 bp away is a BP4 reading.
    const spliceSignalAdj = evaluateSplicePredictor(
      { distance: 2, isNearSpliceSite: true },
      { ds_ag: 0.01, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.01 }
    );
    expect(spliceSignalAdj).toBe("benign");

    // 2. SpliceAI >= 0.2 supports PP3.
    const spliceSignalHigh = evaluateSplicePredictor(
      { distance: 15, isNearSpliceSite: false },
      { ds_ag: 0.25, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.25 }
    );
    expect(spliceSignalHigh).toBe("pathogenic");

    // 3. SpliceAI < 0.1 supports BP4.
    const spliceSignalBenign = evaluateSplicePredictor(
      { distance: 15, isNearSpliceSite: false },
      { ds_ag: 0.01, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.01 }
    );
    expect(spliceSignalBenign).toBe("benign");

    // 4. In-silico missense predictor concordance must NOT include splice in signals or voting tallies
    const conc = countPredictorConcordance(10, 0.05, 0.1, "benign", null, null);
    expect((conc.signals as any).splice).toBeUndefined();
    expect(conc.available).not.toContain("SPLICING");
  });

  it("should throttle concurrent operations using ConcurrencySemaphore", async () => {
    const sem = new Semaphore(2);
    let activeCount = 0;
    let maxActiveCount = 0;

    const task = async (id: number, delayMs: number) => {
      await sem.acquire();
      activeCount++;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      activeCount--;
      sem.release();
    };

    const p1 = task(1, 10);
    const p2 = task(2, 10);
    const p3 = task(3, 10);

    await Promise.all([p1, p2, p3]);

    expect(maxActiveCount).toBe(2);
    expect(activeCount).toBe(0);
  });

  it("should assign BS2 when variant is observed in homozygous state in population reference", () => {
    const res = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: null,
      conservationData: null,
      gnomadConstraint: null,
      gnomadFrequency: {
        maxAF: 0.001,
        groupMaxAF: 0.001,
        genomeAF: 0.001,
        exomeAF: 0.001,
        nHomozygous: 4,
        dataset: "gnomad"
      },
      acmgWeighting: "standard"
    });

    const bs2 = res.acmgCriteria.find(c => c.code === "BS2");
    expect(bs2).toBeDefined();
    expect(bs2?.reason).toContain("Observed in homozygous state in 4 individuals");
  });

  it("should assign BP1 for missense variants in LOF-intolerant genes lacking missense constraint", () => {
    const res = computeRuleBasedACMG({
      gene: "SHANK3",
      variant: "p.Ala120Val",
      clinvar: null,
      predictorData: null,
      conservationData: null,
      gnomadConstraint: {
        pli: 0.99,
        isPP2Constrained: false,
        missense_z: 0.45,
        oe_mis: 0.92
      },
      gnomadFrequency: null,
      acmgWeighting: "standard"
    });

    const bp1 = res.acmgCriteria.find(c => c.code === "BP1");
    expect(bp1).toBeDefined();
    expect(bp1?.reason).toContain("high loss-of-function intolerance (pLI: 0.99)");
    expect(bp1?.reason).toContain("lacking significant missense constraint");
  });

  it("should NOT assign BS2 when homozygote count is less than 2 or null", () => {
    const res1 = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: null,
      conservationData: null,
      gnomadConstraint: null,
      gnomadFrequency: {
        maxAF: 0.001,
        groupMaxAF: 0.001,
        genomeAF: 0.001,
        exomeAF: 0.001,
        nHomozygous: 1,
        dataset: "gnomad"
      },
      acmgWeighting: "standard"
    });
    expect(res1.acmgCriteria.some(c => c.code === "BS2")).toBe(false);

    const resNull = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: null,
      conservationData: null,
      gnomadConstraint: null,
      gnomadFrequency: {
        maxAF: 0.001,
        groupMaxAF: 0.001,
        genomeAF: 0.001,
        exomeAF: 0.001,
        nHomozygous: null,
        dataset: "gnomad"
      },
      acmgWeighting: "standard"
    });
    expect(resNull.acmgCriteria.some(c => c.code === "BS2")).toBe(false);
  });

  it("should NOT assign BP1 if gene has missense constraint or if variant is a null/truncating variant", () => {
    // 1. Constrained gene (isPP2Constrained: true) -> Should not get BP1
    const resConstrained = computeRuleBasedACMG({
      gene: "SCN1A",
      variant: "p.Met120Val",
      clinvar: null,
      predictorData: null,
      conservationData: null,
      gnomadConstraint: {
        pli: 0.99,
        isPP2Constrained: true,
        missense_z: 3.5,
        oe_mis: 0.4
      },
      gnomadFrequency: null,
      acmgWeighting: "standard"
    });
    expect(resConstrained.acmgCriteria.some(c => c.code === "BP1")).toBe(false);

    // 2. Truncating / null variant in LOF gene -> Should trigger PVS1, NOT BP1
    const resNullVar = computeRuleBasedACMG({
      gene: "SHANK3",
      variant: "p.Arg120Ter",
      clinvar: null,
      predictorData: null,
      conservationData: null,
      gnomadConstraint: {
        pli: 0.99,
        isPP2Constrained: false,
        missense_z: 0.45,
        oe_mis: 0.92
      },
      gnomadFrequency: null,
      acmgWeighting: "standard"
    });
    expect(resNullVar.acmgCriteria.some(c => c.code === "BP1")).toBe(false);
    expect(resNullVar.acmgCriteria.some(c => c.code === "PVS1")).toBe(true);
  });

  it("should accept structured ACMGEvidenceInput object and correctly classify pathogenic variant", () => {
    const input = {
      gene: "BRAF",
      variant: "p.Val600Glu",
      clinvar: { classification: "Pathogenic", uid: "13961" },
      predictorData: { available: true, amPathogenicity: 0.99, amClass: "pathogenic", caddPhred: 34 },
      conservationData: { available: true, revel: 0.95, gerp: 5.2 },
      gnomadConstraint: { pli: 0.85, isPP2Constrained: true, missense_z: 3.1, oe_mis: 0.4 },
      gnomadFrequency: { maxAF: 0.000001, groupMaxAF: 0.000001, genomeAF: 0.000001, exomeAF: 0.000001, nHomozygous: 0, dataset: "gnomad" },
      acmgWeighting: "standard" as const
    };

    const resObj = computeRuleBasedACMG(input);
    expect(resObj.acmgVerdict).toBeDefined();
    expect(resObj.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
    expect(resObj.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
    expect(resObj.acmgCriteria.some(c => c.code === "PP2")).toBe(true);
  });

  it("should withhold PM2 when gnomadFrequency serviceStatus is timeout or error", () => {
    const inputWithTimeout = {
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.9, amClass: "pathogenic", caddPhred: 28 },
      conservationData: { available: true, revel: 0.8 },
      gnomadFrequency: null,
      serviceStatus: { gnomadFrequency: "timeout" as const }
    };

    const resTimeout = computeRuleBasedACMG(inputWithTimeout);
    expect(resTimeout.acmgCriteria.some(c => c.code === "PM2")).toBe(false);
    expect(resTimeout.partialEvidence?.unavailable.some(u => u.includes("PM2 withheld"))).toBe(true);

    const inputWithSuccess = {
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.9, amClass: "pathogenic", caddPhred: 28 },
      conservationData: { available: true, revel: 0.8 },
      gnomadFrequency: { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" },
      serviceStatus: { gnomadFrequency: "ok" as const }
    };

    const resSuccess = computeRuleBasedACMG(inputWithSuccess);
    expect(resSuccess.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
  });

  it("should withhold PM2 when the coordinate's build is not one gnomAD serves", () => {
    /**
     * The gate in `core-data-fetcher.ts` refuses a non-GRCh38 coordinate BEFORE querying, and used to
     * leave `not_found` behind — which the classifier read as a confirmed absence and turned into
     * PM2. That awarded pathogenic-frequency support for a variant no database had been asked about.
     */
    const res = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.9, amClass: "pathogenic", caddPhred: 28 },
      conservationData: { available: true, revel: 0.8 },
      gnomadFrequency: null,
      serviceStatus: { gnomadFrequency: "unsupported-build" as const }
    });

    expect(res.acmgCriteria.some(c => c.code === "PM2")).toBe(false);
    // The REASON must survive into the partial-evidence list, so the report can say why.
    expect(
      res.partialEvidence?.unavailable.some(u => u.includes("build is not one gnomAD r4 serves"))
    ).toBe(true);
  });

  it("should classify 1 Very Strong (PVS1) + 2 Supporting (PP) as Likely Pathogenic", () => {
    const input = {
      gene: "BRCA1",
      variant: "p.Tyr100Ter",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.95, amClass: "pathogenic", caddPhred: 30 },
      conservationData: { available: true, revel: 0.9 },
      gnomadConstraint: { pli: 0.99, isPP2Constrained: true, missense_z: 2.5, oe_mis: 0.4 },
      gnomadFrequency: null,
      acmgWeighting: "standard" as const
    };

    const res = computeRuleBasedACMG(input);
    expect(res.acmgCriteria.some(c => c.code === "PVS1")).toBe(true);
    expect(res.acmgCriteria.filter(c => c.code.startsWith("PP")).length).toBeGreaterThanOrEqual(2);
    expect(res.acmgVerdict).toBe("Likely Pathogenic");
  });

  it("should correctly parse leading coordinate for multi-residue in-frame indel", () => {
    const input = {
      gene: "CFTR",
      variant: "p.Glu120_Lys122del",
      clinvar: null,
      predictorData: null,
      conservationData: null,
      gnomadConstraint: null,
      gnomadFrequency: null,
      sequence: "MAGLAAAVVVEEKKK",
      acmgWeighting: "standard" as const
    };

    const res = computeRuleBasedACMG(input);
    // Sequence is only 15 AA, so pos 120 is out of bounds, meaning isIndelInRepeatRegion returns false -> PM4
    expect(res.acmgCriteria.some(c => c.code === "PM4")).toBe(true);
  });

  /**
   * The AlphaGenome AVI used to raise PP3 to Strong (Phred ≥ 35) or Moderate (≥ 25), and BP4 to
   * Moderate (≤ 5), on its own. It is a rank with no ClinGen calibration and contains AlphaMissense,
   * so it is now informational: the criterion stays at Supporting strength and the AVI is listed as
   * not counted.
   */
  it.each([
    { aviPhred: 38.2, topModality: "RNA-seq" },
    { aviPhred: 27.5, topModality: "CAGE" },
  ])("never raises PP3 above Supporting from AlphaGenome (AVI $aviPhred)", ({ aviPhred, topModality }) => {
    const res = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.9, amClass: "pathogenic", caddPhred: 28 },
      conservationData: {
        available: true,
        revel: 0.85,
        alphagenome: { status: "live" as const, aviPhred, acmgStrength: "PP3_Strong" as const, topModality }
      },
      gnomadConstraint: null,
      gnomadFrequency: null,
      acmgWeighting: "standard" as const
    });
    expect(res.acmgCriteria.some(c => c.code === "PP3_Strong" || c.code === "PP3_Moderate")).toBe(false);
    const pp3 = res.acmgCriteria.find(c => c.code === "PP3");
    expect(pp3).toBeDefined();
    expect(pp3?.reason).toContain("3/3 predictors agree");
    expect(pp3?.reason).toContain(`Informational, not counted: AlphaGenome ${aviPhred.toFixed(1)} Phred`);
  });

  it("never raises BP4 above Supporting from AlphaGenome", () => {
    const res = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.05, amClass: "benign", caddPhred: 5 },
      conservationData: {
        available: true,
        revel: 0.1,
        alphagenome: { status: "live" as const, aviPhred: 3.5, acmgStrength: "BP4_Moderate" as const, topModality: "DNase" }
      },
      gnomadConstraint: null,
      gnomadFrequency: null,
      acmgWeighting: "standard" as const
    });
    expect(res.acmgCriteria.some(c => c.code === "BP4_Moderate")).toBe(false);
    expect(res.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
  });
});

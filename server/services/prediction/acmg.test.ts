import { describe, it, expect, vi } from "vitest";
import { computeRuleBasedACMG } from "./acmg.ts";
import { Semaphore } from "../../utils.ts";
import { calibratedCall, evaluateSplicePredictor } from "../../../src/shared/thresholds.ts";

describe("ACMG Pathogenicity Engine & Rule Classifier", () => {
  it("should correctly classify standard evidence combinations (1 Very Strong + 1 Moderate -> Likely Pathogenic)", () => {
    const clinvar = { classification: "Likely pathogenic", uid: "123" };
    const res = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar,
      predictorData: { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
      conservationData: { available: true, revel: 0.25, gerp: 1.0, phylop: 0.5, scorecons: 0.4 },
      gnomadConstraint: null,
      gnomadFrequency: { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" }
    });
    
    expect(res.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
    expect(res.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
    expect(res.acmgVerdict).toBeDefined();
  });

  it("does not count BS1 from the app-wide cut-point (HbS regression): the reading is shown, BS1 is not counted", () => {
    const res = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
      conservationData: { available: true, revel: 0.25 },
      gnomadConstraint: null,
      gnomadFrequency: { maxAF: 0.015, groupMaxAF: 0.015, genomeAF: 0.015, exomeAF: 0.015, nHomozygous: 0, dataset: "gnomad" },
      acmgWeighting: "standard"
    });
    expect(res.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
    expect(res.acmgCriteria.some(c => c.code === "BS1")).toBe(false);
    expect(res.acmgVerdict).not.toBe("Likely Benign");
  });

  it("uses BayesDel noAF in the primary fallback chain when REVEL has no score", () => {
    const res = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 },
      conservationData: { available: true, revel: null, bayesdel: 0.2 }
    });
    const pp3 = res.acmgCriteria.find(c => c.code === "PP3");
    expect(pp3).toBeDefined();
    expect(pp3?.reason).toContain("BayesDel noAF 0.200");
    expect(pp3?.reason).toContain("fallback");
  });

  it("uses REVEL as primary calibrated predictor and flags opposing chain tools without changing strength", () => {
    const res1 = computeRuleBasedACMG({
      gene: "GBA1",
      variant: "p.Asn370Ser",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 },
      conservationData: { available: true, revel: 0.1, gerp: 1.0, phylop: 0.5 }
    });
    const bp4 = res1.acmgCriteria.find(c => c.code === "BP4_Moderate");
    expect(bp4).toBeDefined();
    expect(bp4?.reason).toContain("AlphaMissense");
    expect(bp4?.reason).toContain("strength unchanged");
    expect(res1.acmgCriteria.some(c => c.code.startsWith("PP3"))).toBe(false);

    const res2 = computeRuleBasedACMG({
      gene: "GBA1",
      variant: "p.Asn370Ser",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
      conservationData: { available: true, revel: 0.85, gerp: 1.0, phylop: 0.5 }
    });
    const pp3 = res2.acmgCriteria.find(c => c.code === "PP3_Moderate");
    expect(pp3).toBeDefined();
    expect(pp3?.reason).toContain("AlphaMissense");
    expect(res2.acmgCriteria.some(c => c.code.startsWith("BP4"))).toBe(false);
  });

  it("does not promote AlphaMissense's likely_pathogenic class to a calibrated call", () => {
    // 0.65 is "likely_pathogenic" in the authors' classes (> 0.564) but below ClinGen's PP3 band
    // (≥ 0.792, Bergquist 2025): when AlphaMissense answers the chain, it stops as indeterminate.
    const res = computeRuleBasedACMG({
      gene: "LDLR",
      variant: "p.Glu101Lys",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.65, amClass: "likely_pathogenic", caddPhred: 32 },
      conservationData: { available: true, revel: null, bayesdel: null }
    });
    expect(res.acmgCriteria.some(c => c.code.startsWith("PP3") || c.code.startsWith("BP4"))).toBe(false);
  });

  it("falls back to AlphaMissense when REVEL and BayesDel have no score", () => {
    const res = computeRuleBasedACMG({
      gene: "PTEN",
      variant: "p.Arg130Gln",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.85, amClass: "pathogenic", caddPhred: null },
      conservationData: { available: false, revel: null, bayesdel: null }
    });
    const pp3 = res.acmgCriteria.find(c => c.code === "PP3");
    expect(pp3).toBeDefined();
    expect(pp3?.reason).toContain("AlphaMissense 0.850");
    expect(pp3?.reason).not.toContain("agree");
  });

  it("shows popEVE beside the primary call without counting it", () => {
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
        revel: 0.25,
        popeve: -3.775,
      }
    });
    const bp4 = res.acmgCriteria.find(c => c.code === "BP4");
    expect(bp4).toBeDefined();
    expect(bp4?.reason).toContain("Informational, not counted: ");
    expect(bp4?.reason).toContain("popEVE -3.775");
  });

  it("does not let a deleterious popEVE override an indeterminate primary tool", () => {
    const res = computeRuleBasedACMG({
      gene: "GBA1",
      variant: "p.Asn370Ser",
      clinvar: null,
      predictorData: { available: true, caddPhred: 26 },
      conservationData: { available: true, revel: 0.5, popeve: -5.2 },
    });
    expect(res.acmgCriteria.some(c => c.code.startsWith("PP3") || c.code.startsWith("BP4"))).toBe(false);
  });

  it("should respect acmgWeighting parameter (conservative & strict-structural modes)", () => {
    const predictorData = { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 };
    const conservationData = { available: true, revel: 0.8 };
    const gnomadConstraintMock = { isPP2Constrained: true, pp2Code: "PP2" as const, regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "synthetic interval" }, missense_z: 3.0, oe_mis: 0.5, pli: null };

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
    expect(resStandard.acmgCriteria.some(c => c.code === "PP3_Moderate")).toBe(true);
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
    expect(resConservativeNoClinVar.acmgCriteria.some(c => c.code.startsWith("PP3"))).toBe(false);
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
    expect(resConservativeWithClinVar.acmgCriteria.some(c => c.code === "PP3_Moderate")).toBe(true);
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
    expect(resStrictStructural.acmgCriteria.some(c => c.code.startsWith("PP3"))).toBe(false);
    expect(resStrictStructural.acmgCriteria.some(c => c.code === "PM2")).toBe(false);
    expect(resStrictStructural.acmgCriteria.some(c => c.code === "PP2")).toBe(false);
  });

  it("should respect ClinGen-calibrated AlphaMissense thresholds (Bergquist 2025: pathogenic >= 0.792, benign <= 0.169)", () => {
    expect(calibratedCall("alphaMissense", 0.985)?.direction).toBe("PP3");
    expect(calibratedCall("alphaMissense", 0.05)?.direction).toBe("BP4");
    expect(calibratedCall("alphaMissense", 0.5)?.direction).toBeNull();
  });

  it("should evaluate splicing signals via evaluateSplicePredictor and keep CADD/SpliceAI from casting PP3 votes", () => {
    const spliceSignalAdj = evaluateSplicePredictor(
      { distance: 2, isNearSpliceSite: true },
      { ds_ag: 0.01, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.01 }
    );
    expect(spliceSignalAdj).toBe("benign");

    const spliceSignalHigh = evaluateSplicePredictor(
      { distance: 15, isNearSpliceSite: false },
      { ds_ag: 0.25, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.25 }
    );
    expect(spliceSignalHigh).toBe("pathogenic");

    // SpliceAI >= 0.20 blocks BP4 from REVEL, without creating a splicing PP3 criterion on its own.
    const blocked = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      predictorData: { available: true, caddPhred: 10 },
      conservationData: { available: true, revel: 0.002, spliceai: { ds_ag: 0.25, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: 0.25 } },
    });
    expect(blocked.acmgCriteria.some(c => c.code.startsWith("BP4") || c.code.startsWith("PP3"))).toBe(false);
    expect(blocked.partialEvidence.unavailable.some(u => u.includes("SpliceAI max Δ 0.25"))).toBe(true);
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

  it("does not assign BS2 from gnomAD homozygote counts alone (no documented unaffected status)", () => {
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

    expect(res.acmgCriteria.find(c => c.code === "BS2")).toBeUndefined();
  });

  it("never applies BP1 from gene constraint alone: pLI is not a curated truncating-variant mechanism", () => {
    // BP1 needs it established that truncating variants cause this gene's disease (Richards 2015).
    // The engine used to infer that from pLI ≥ 0.9 plus weak missense constraint; it no longer does
    // (owner decision, doc/THRESHOLDS_TAB_REVIEW.md).
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

    expect(res.acmgCriteria.some(c => c.code === "BP1")).toBe(false);
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
        isPP2Constrained: true, pp2Code: "PP2" as const, regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "synthetic interval" },
        missense_z: 3.5,
        oe_mis: 0.4
      },
      gnomadFrequency: null,
      acmgWeighting: "standard"
    });
    expect(resConstrained.acmgCriteria.some(c => c.code === "BP1")).toBe(false);

    // 2. Truncating / null variant in curated LOF gene -> Should trigger PVS1, NOT BP1
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
      curatedLofMechanism: {
        source: "Gene2Phenotype",
        lofEstablished: true,
        nonLofOnly: false,
        mechanisms: ["loss of function"],
        records: 1
      },
      gnomadFrequency: null,
      acmgWeighting: "standard"
    });
    expect(resNullVar.acmgCriteria.some(c => c.code === "BP1")).toBe(false);
    expect(resNullVar.acmgCriteria.some(c => c.code === "PVS1")).toBe(true);

    // 3. pLI >= 0.9 alone WITHOUT curated LOF mechanism must withhold PVS1
    const resUnpaired = computeRuleBasedACMG({
      gene: "FGFR3",
      variant: "p.Arg120Ter",
      clinvar: null,
      predictorData: null,
      conservationData: null,
      gnomadConstraint: { pli: 0.99, isPP2Constrained: false, missense_z: 1.2, oe_mis: 0.8 },
      curatedLofMechanism: { source: "Gene2Phenotype", lofEstablished: false, nonLofOnly: true, mechanisms: ["gain of function"], records: 2 },
      gnomadFrequency: null,
      acmgWeighting: "standard"
    });
    expect(resUnpaired.acmgCriteria.some(c => c.code === "PVS1")).toBe(false);
    expect(resUnpaired.partialEvidence.unavailable.some(u => u.includes("gain of function"))).toBe(true);

    const resPliOnly = computeRuleBasedACMG({
      gene: "UNKNOWN_CONSTRAINED",
      variant: "p.Arg120Ter",
      clinvar: null,
      predictorData: null,
      conservationData: null,
      gnomadConstraint: { pli: 0.99, isPP2Constrained: false, missense_z: 1.2, oe_mis: 0.8 },
      gnomadFrequency: null,
      acmgWeighting: "standard"
    });
    expect(resPliOnly.acmgCriteria.some(c => c.code === "PVS1")).toBe(false);
    expect(resPliOnly.partialEvidence.unavailable.some(u => u.includes("without a curated"))).toBe(true);
  });

  it("should accept structured ACMGEvidenceInput object and correctly classify pathogenic variant", () => {
    const input = {
      gene: "BRAF",
      variant: "p.Val600Glu",
      clinvar: { classification: "Pathogenic", uid: "13961" },
      predictorData: { available: true, amPathogenicity: 0.99, amClass: "pathogenic", caddPhred: 34 },
      conservationData: { available: true, revel: 0.95, gerp: 5.2 },
      gnomadConstraint: { pli: 0.85, isPP2Constrained: true, pp2Code: "PP2" as const, regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "synthetic interval" }, missense_z: 3.1, oe_mis: 0.4 },
      gnomadFrequency: { maxAF: 0.000001, groupMaxAF: 0.000001, genomeAF: 0.000001, exomeAF: 0.000001, nHomozygous: 0, dataset: "gnomad" },
      acmgWeighting: "standard" as const
    };

    const resObj = computeRuleBasedACMG(input);
    expect(resObj.acmgVerdict).toBeDefined();
    expect(resObj.acmgCriteria.some(c => c.code === "PP3_Strong")).toBe(true);
    expect(resObj.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
    expect(resObj.acmgCriteria.some(c => c.code === "PP2")).toBe(true);
  });

  it("applies PP2 from the regional O/E with Chao et al. v3's calibrated strength, never from gene Z", () => {
    const base = {
      gene: "TEST", variant: "p.Ala10Val",
      gnomadFrequency: { maxAF: 0.000001, groupMaxAF: 0.000001, genomeAF: 0.000001, exomeAF: 0.000001, nHomozygous: 0, dataset: "gnomad" },
      acmgWeighting: "standard" as const,
    };
    const at = (oe: number, code: "PP2" | "PP2_Moderate" | null) => computeRuleBasedACMG({ ...base, gnomadConstraint: {
      pli: 0.5, missense_z: 4.2, oe_mis: 0.3, isPP2Constrained: code !== null, pp2Code: code,
      regionalRelease: "4.1.1", regionalConstraint: { isConstrained: true, oeRatio: oe, pValue: 0.001, regionText: "1:100 to 200 (GRCh38)" } } });
    const moderate = at(0.3, "PP2_Moderate").acmgCriteria.find(c => c.code.startsWith("PP2"));
    expect(moderate?.code).toBe("PP2_Moderate");
    expect(moderate?.reason).toMatch(/0\.30 .*at or below 0\.36: Moderate under Chao et al\. 2026/);
    expect(at(0.5, "PP2").acmgCriteria.some(c => c.code === "PP2")).toBe(true);
    // Gene Z 4.2 and o/e 0.3 met the retired proxy; with no calibrated band there is no PP2.
    expect(at(0.8, null).acmgCriteria.some(c => c.code.startsWith("PP2"))).toBe(false);
    // An older constraint object without pp2Code (the retired proxy's flag alone) gives no PP2.
    expect(computeRuleBasedACMG({ ...base, gnomadConstraint: { pli: 0.5, missense_z: 4.2, oe_mis: 0.3, isPP2Constrained: true } })
      .acmgCriteria.some(c => c.code.startsWith("PP2"))).toBe(false);
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

  // Richards 2015 Table 5, Pathogenic (i)(d): PVS1 + >=2 Supporting. This test used to expect "Likely
  // Pathogenic", which was the engine's combining-rule defect written down as a requirement.
  it("should classify 1 Very Strong (PVS1) + 2 Supporting (PP) as Pathogenic", () => {
    const input = {
      gene: "BRCA1",
      variant: "p.Tyr100Ter",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.95, amClass: "pathogenic", caddPhred: 30 },
      conservationData: { available: true, revel: 0.9 },
      gnomadConstraint: { pli: 0.99, isPP2Constrained: true, pp2Code: "PP2" as const, regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "synthetic interval" }, missense_z: 2.5, oe_mis: 0.4 },
      curatedLofMechanism: {
        source: "ClinGen/Gene2Phenotype" as const,
        lofEstablished: true,
        nonLofOnly: false,
        mechanisms: ["loss of function"],
        records: 2,
      },
      gnomadFrequency: null,
      acmgWeighting: "standard" as const
    };

    const res = computeRuleBasedACMG(input);
    expect(res.acmgCriteria.some(c => c.code === "PVS1")).toBe(true);
    expect(res.acmgCriteria.filter(c => c.code.startsWith("PP")).length).toBeGreaterThanOrEqual(2);
    expect(res.acmgVerdict).toBe("Pathogenic");
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
   * The AlphaGenome AVI is a rank with no ClinGen calibration and contains AlphaMissense,
   * so it stays informational: PP3/BP4 strength comes only from the primary calibrated tool.
   */
  it.each([
    { aviPhred: 38.2, topModality: "RNA-seq" },
    { aviPhred: 27.5, topModality: "CAGE" },
  ])("never raises PP3 above the primary calibrated strength from AlphaGenome (AVI $aviPhred)", ({ aviPhred, topModality }) => {
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
    expect(res.acmgCriteria.some(c => c.code === "PP3_Strong")).toBe(false);
    const pp3 = res.acmgCriteria.find(c => c.code === "PP3_Moderate");
    expect(pp3).toBeDefined();
    expect(pp3?.reason).toContain("REVEL 0.850");
    expect(pp3?.reason).toContain(`Informational, not counted: `);
    expect(pp3?.reason).toContain(`AlphaGenome ${aviPhred.toFixed(1)} Phred`);
  });

  it("never raises BP4 above the primary calibrated strength from AlphaGenome", () => {
    const res = computeRuleBasedACMG({
      gene: "PAH",
      variant: "p.Arg408Trp",
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.05, amClass: "benign", caddPhred: 5 },
      conservationData: {
        available: true,
        revel: 0.25,
        alphagenome: { status: "live" as const, aviPhred: 3.5, acmgStrength: "BP4_Moderate" as const, topModality: "DNase" }
      },
      gnomadConstraint: null,
      gnomadFrequency: null,
      acmgWeighting: "standard" as const
    });
    expect(res.acmgCriteria.some(c => c.code === "BP4_Moderate" || c.code === "BP4_Strong")).toBe(false);
    expect(res.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
  });
  describe("ClinVar 'Conflicting' is not a pathogenic or benign call", () => {
    const base = {
      gene: "PAH",
      variant: "p.Arg408Trp",
      predictorData: { available: true, amPathogenicity: 0.99, amClass: "likely_pathogenic", caddPhred: 35 },
      conservationData: { available: true, revel: 0.97, bayesdel: 0.6 },
      gnomadConstraint: null,
      gnomadFrequency: null,
    } as const;

    it.each([
      "Conflicting interpretations of pathogenicity",
      "Conflicting classifications of pathogenicity",
    ])("%s does not open the conservative-weighting gate", classification => {
      const conflicting = computeRuleBasedACMG({ ...base, clinvar: { classification, uid: "1" }, acmgWeighting: "conservative" } as any);
      // Conservative mode drops computational criteria unless ClinVar corroborates them. A conflicting
      // record does not corroborate, but a substring test on "pathogenic" said it did.
      expect(conflicting.acmgCriteria.some(x => x.code.startsWith("PP3"))).toBe(false);
    });

    it("a real Pathogenic record still corroborates the computational criteria", () => {
      const corroborated = computeRuleBasedACMG({ ...base, clinvar: { classification: "Pathogenic", uid: "1" }, acmgWeighting: "conservative" } as any);
      expect(corroborated.acmgCriteria.some(x => x.code === "PP3_Strong")).toBe(true);
    });
  });

  describe("PP3 + PM1 <= Strong cap is active under calibrated PP3 strength (Pejaver 2022)", () => {
    const evidence = [{ code: "ECO:0000269", source: "PubMed", id: "12345" }];
    const makeInput = (revel: number, variant = "p.Arg408Trp", residueIndex?: number) => ({
      gene: "PAH",
      variant,
      ...(residueIndex !== undefined ? { residueIndex } : {}),
      clinvar: null,
      predictorData: { available: true, amPathogenicity: 0.99, amClass: "likely_pathogenic", caddPhred: 35 },
      conservationData: { available: true, revel, bayesdel: 0.6 },
      gnomadConstraint: null,
      gnomadFrequency: null,
      uniprotFeatures: { features: [{ type: "Active site", description: "Proton acceptor", start: 408, end: 408, evidence }] },
    });

    it("emits PP3_Strong and withholds PM1 when REVEL reaches Strong (4 + 2 > 4)", () => {
      const res = computeRuleBasedACMG(makeInput(0.95) as any);
      const codes = res.acmgCriteria.map(x => x.code);
      expect(codes).toContain("PP3_Strong");
      expect(codes).not.toContain("PM1");
      expect(res.partialEvidence.unavailable.some(u => u.includes("PM1") && u.includes("capped at Strong"))).toBe(true);
    });

    it("emits PP3_Moderate and lets PM1 stand (2 + 2 = 4 <= 4)", () => {
      const res = computeRuleBasedACMG(makeInput(0.80) as any);
      const codes = res.acmgCriteria.map(x => x.code);
      expect(codes).toContain("PP3_Moderate");
      expect(codes).toContain("PM1");
    });

    it("uses the explicit residue index over digits in the variant string", () => {
      // The site is at 408; REVEL 0.80 (Moderate) allows PM1 so residueIndex decides whether PM1 matches.
      const res = computeRuleBasedACMG(makeInput(0.80, "NM_000277.3:p.Arg408Trp", 408) as any);
      expect(res.acmgCriteria.map(x => x.code)).toContain("PM1");
      const wrong = computeRuleBasedACMG(makeInput(0.80, "NM_000277.3:p.Arg408Trp", 99) as any);
      expect(wrong.acmgCriteria.map(x => x.code)).not.toContain("PM1");
    });
  });
});

describe("PP3/BP4 over a salvaged conservation composite and SpliceAI gate", () => {
  const run = (modelStatus?: Record<string, string>, extraCons: Record<string, unknown> = {}) => computeRuleBasedACMG({
    gene: "PAH",
    variant: "p.Arg408Trp",
    clinvar: null,
    predictorData: { available: true, amPathogenicity: 0.95, amClass: "pathogenic", caddPhred: 33 },
    conservationData: { available: true, revel: 0.95, bayesdel: 0.3, ...extraCons, ...(modelStatus ? { modelStatus } : {}) } as any,
    gnomadConstraint: null,
    gnomadFrequency: null,
    acmgWeighting: "standard"
  });

  it("awards PP3_Strong when base settled", () => {
    expect(run({ base: "settled", popeve: "settled", alphagenome: "settled" }).acmgCriteria.some(c => c.code === "PP3_Strong")).toBe(true);
  });

  it("withholds PP3/BP4 when the dbNSFP base ensemble timed out", () => {
    const res = run({ base: "timeout", popeve: "settled", alphagenome: "settled" });
    expect(res.acmgCriteria.some(c => /^(PP3|BP4)/.test(c.code))).toBe(false);
  });

  it.each(["spliceai", "alphagenome", "popeve"])("PP3 is unaffected when %s timed out", (model) => {
    expect(run({ base: "settled", popeve: "settled", alphagenome: "settled", [model]: "timeout" }).acmgCriteria.some(c => c.code === "PP3_Strong")).toBe(true);
  });

  it("withholds BP4 when SpliceAI timed out or hit a transient Broad error", () => {
    const timedOut = run({ base: "settled", spliceai: "timeout" }, { revel: 0.002 });
    expect(timedOut.acmgCriteria.some(c => /^BP4/.test(c.code))).toBe(false);
    expect(timedOut.partialEvidence.unavailable.some(u => /SpliceAI/i.test(u))).toBe(true);

    const rateLimited = run(
      { base: "settled", spliceai: "settled" },
      { revel: 0.002, spliceai: null, spliceaiFailure: { kind: "rate-limited", httpStatus: 429, detail: null } },
    );
    expect(rateLimited.acmgCriteria.some(c => /^BP4/.test(c.code))).toBe(false);
  });

  it("emits BP4_VeryStrong and classifies Benign when REVEL <= 0.003 and SpliceAI <= 0.10", () => {
    const res = run(
      { base: "settled", spliceai: "settled" },
      { revel: 0.002, spliceai: { max_ds: 0.02, ds_ag: 0.02, ds_al: 0, ds_dg: 0, ds_dl: 0 } },
    );
    expect(res.acmgCriteria.some(c => c.code === "BP4_VeryStrong")).toBe(true);
    expect(res.acmgVerdict).toBe("Benign");
  });
});

describe("PM4 / BP3 in-frame indel repeat check prefers explicit residueIndex", () => {
  it("uses residueIndex over transcript digits in variant string", () => {
    const seq = "AAAAAAACDEFGHIKLMNPQRSTVWY";
    const repeatRes = computeRuleBasedACMG({
      gene: "TEST",
      variant: "NM_000001.1:p.Ala4del",
      residueIndex: 4,
      clinvar: null,
      predictorData: null,
      conservationData: null,
      gnomadConstraint: null,
      gnomadFrequency: null,
      sequence: seq,
      acmgWeighting: "standard",
    });
    expect(repeatRes.acmgCriteria.some(c => c.code === "BP3")).toBe(true);

    const nonRepeatRes = computeRuleBasedACMG({
      gene: "TEST",
      variant: "NM_000001.1:p.Ala4del",
      residueIndex: 15,
      clinvar: null,
      predictorData: null,
      conservationData: null,
      gnomadConstraint: null,
      gnomadFrequency: null,
      sequence: seq,
      acmgWeighting: "standard",
    });
    expect(nonRepeatRes.acmgCriteria.some(c => c.code === "PM4")).toBe(true);
  });
});

describe("Candidate-allele CADD does not alter primary REVEL PP3/BP4", () => {
  const candidate = (alt: string, caddPhred: number | null, caddSource: string | null = "ProtVar") => ({
    grch37Id: null,
    id: `4-1804392-G-${alt}`,
    canonicalBy: "protvar" as const,
    retryable: false,
    caddPhred,
    caddSource,
  });

  const runWithCandidates = (candidates: ReturnType<typeof candidate>[]) => computeRuleBasedACMG({
    gene: "FGFR3",
    variant: "p.Gly380Arg",
    clinvar: null,
    predictorData: {
      available: true,
      amPathogenicity: 0.9,
      amClass: "likely_pathogenic",
      caddPhred: null,
      locusResolution: {
        route: "fallback",
        canonicalBy: null,
        retryable: false,
        failureKind: "multiple-candidates",
        steps: [],
        candidates,
      },
    },
    conservationData: { available: true, revel: 0.72 },
    gnomadConstraint: null,
    gnomadFrequency: null,
    acmgWeighting: "standard",
  });

  it("emits REVEL PP3 regardless of candidate CADD agreement, disagreement, or mixed sources", () => {
    for (const candidates of [
      [candidate("A", 25.7), candidate("C", 28.5)],
      [candidate("C", 24.5), candidate("A", 25.7)],
      [candidate("A", 27.0, "ProtVar"), candidate("C", 28.5, "dbNSFP 5.3a (local)")],
    ]) {
      const res = runWithCandidates(candidates);
      const pp3 = res.acmgCriteria.find(c => c.code === "PP3");
      expect(pp3).toBeDefined();
      expect(pp3?.reason).toContain("REVEL 0.720");
    }
  });
});


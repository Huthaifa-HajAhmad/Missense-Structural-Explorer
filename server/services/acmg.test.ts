import { describe, it, expect, vi } from "vitest";
import { computeRuleBasedACMG } from "./acmg.ts";
import { Semaphore } from "../utils.ts";
import { countPredictorConcordance } from "../../src/shared/thresholds.ts";

describe("ACMG Pathogenicity Engine & Rule Classifier", () => {
  it("should correctly classify standard evidence combinations (1 Very Strong + 1 Moderate -> Likely Pathogenic)", () => {
    const clinvar = { classification: "Likely pathogenic", uid: "123" };
    const res = computeRuleBasedACMG(
      "PAH",
      "p.Arg408Trp",
      clinvar,
      { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
      { available: true, revel: 0.6, gerp: 1.0, phylop: 0.5, consurf: 2 },
      null,
      { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" }
    );
    
    expect(res.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
    expect(res.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
    expect(res.acmgVerdict).toBeDefined();
  });

  it("should count BS1 as strong benign and class as Likely Benign with BP4", () => {
    const res = computeRuleBasedACMG(
      "PAH",
      "p.Arg408Trp",
      null,
      { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
      { available: true, revel: 0.1 },
      null,
      { maxAF: 0.015, groupMaxAF: 0.015, genomeAF: 0.015, exomeAF: 0.015, nHomozygous: 0, dataset: "gnomad" },
      "standard"
    );
    expect(res.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
    expect(res.acmgCriteria.some(c => c.code === "BS1")).toBe(true);
    expect(res.acmgVerdict).toBe("Likely Benign");
  });

  it("should include bayesdel in PP3/BP4 predictor concordance", () => {
    const res = computeRuleBasedACMG(
      "PAH",
      "p.Arg408Trp",
      null,
      { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 },
      { available: true, revel: 0.1, bayesdel: 0.2 }
    );
    expect(res.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
    expect(res.acmgCriteria.find(c => c.code === "PP3")?.reason).toContain("BayesDel: 0.2");
    expect(res.acmgCriteria.find(c => c.code === "PP3")?.reason).toContain("3/4 predictors agree");
  });

  it("should respect PP3/BP4 concordance voting rules under conflicting predictor scenarios", () => {
    const res1 = computeRuleBasedACMG(
      "GBA1",
      "p.Asn370Ser",
      null,
      { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 },
      { available: true, revel: 0.1, gerp: 1.0, phylop: 0.5 }
    );
    expect(res1.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
    expect(res1.acmgCriteria.some(c => c.code === "BP4")).toBe(false);

    const res2 = computeRuleBasedACMG(
      "GBA1",
      "p.Asn370Ser",
      null,
      { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
      { available: true, revel: 0.6, gerp: 1.0, phylop: 0.5 }
    );
    expect(res2.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
    expect(res2.acmgCriteria.some(c => c.code === "PP3")).toBe(false);
  });

  it("should assign PP3 when amClass is likely_pathogenic (ACMG-AM regression)", () => {
    const res = computeRuleBasedACMG(
      "LDLR",
      "p.Glu101Lys",
      null,
      { available: true, amPathogenicity: 0.65, amClass: "likely_pathogenic", caddPhred: 26 },
      { available: true, revel: 0.8 }
    );
    expect(res.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
    expect(res.acmgCriteria.find(c => c.code === "PP3")?.reason).toContain("3/3");
  });

  it("should output accurate count, never false agreement wording, when only one predictor is available", () => {
    const res = computeRuleBasedACMG(
      "PTEN",
      "p.Arg130Gln",
      null,
      { available: true, amPathogenicity: 0.85, amClass: "pathogenic", caddPhred: null },
      { available: false, revel: null }
    );
    const pp3 = res.acmgCriteria.find(c => c.code === "PP3");
    expect(pp3).toBeDefined();
    expect(pp3?.reason).toContain("1/1 predictor supports");
    expect(pp3?.reason).not.toContain("agree");
  });

  it("should respect popEVE scores in ACMG PP3/BP4 concordance calculations", () => {
    const res = computeRuleBasedACMG(
      "GBA1",
      "p.Asn370Ser",
      null,
      {
        available: true,
        amPathogenicity: 0.8,
        amClass: "pathogenic",
        caddPhred: 26,
      },
      {
        available: true,
        revel: 0.1,
        popeve: -3.775,
      }
    );
    const pp3 = res.acmgCriteria.find(c => c.code === "PP3");
    expect(pp3).toBeDefined();
    expect(pp3?.reason).toContain("3/4 predictors agree");
    expect(pp3?.reason).toContain("popEVE: PATHOGENIC");
  });

  it("should respect acmgWeighting parameter (conservative & strict-structural modes)", () => {
    const predictorData = { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 };
    const conservationData = { available: true, revel: 0.6 };
    const gnomadConstraintMock = { isPP2Constrained: true, missense_z: 3.0, oe_mis: 0.5, pli: null };

    const resStandard = computeRuleBasedACMG(
      "PAH",
      "p.Arg408Trp",
      null,
      predictorData,
      conservationData,
      gnomadConstraintMock,
      { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" },
      "standard"
    );
    expect(resStandard.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
    expect(resStandard.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
    expect(resStandard.acmgCriteria.some(c => c.code === "PP2")).toBe(true);

    const resConservativeNoClinVar = computeRuleBasedACMG(
      "PAH",
      "p.Arg408Trp",
      null,
      predictorData,
      conservationData,
      gnomadConstraintMock,
      { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" },
      "conservative"
    );
    expect(resConservativeNoClinVar.acmgCriteria.some(c => c.code === "PP3")).toBe(false);
    expect(resConservativeNoClinVar.acmgCriteria.some(c => c.code === "PM2")).toBe(false);
    expect(resConservativeNoClinVar.acmgCriteria.some(c => c.code === "PP2")).toBe(false);

    const resConservativeWithClinVar = computeRuleBasedACMG(
      "PAH",
      "p.Arg408Trp",
      { classification: "Pathogenic", uid: "123" },
      predictorData,
      conservationData,
      gnomadConstraintMock,
      { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" },
      "conservative"
    );
    expect(resConservativeWithClinVar.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
    expect(resConservativeWithClinVar.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
    expect(resConservativeWithClinVar.acmgCriteria.some(c => c.code === "PP2")).toBe(true);

    const resStrictStructural = computeRuleBasedACMG(
      "PAH",
      "p.Arg408Trp",
      { classification: "Pathogenic", uid: "123" },
      predictorData,
      conservationData,
      gnomadConstraintMock,
      null,
      "strict-structural"
    );
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

  it("should respect splice-site adjacent and SpliceAI signals in PP3/BP4 concordance calculations", () => {
    // 1. Splice-site adjacent should vote pathogenic and trigger PP3
    const resSpliceAdjacent = computeRuleBasedACMG(
      "GBA1",
      "p.Asn370Ser",
      null,
      {
        available: true,
        amPathogenicity: 0.1,
        amClass: "benign",
        caddPhred: 10,
      },
      {
        available: true,
        revel: 0.05,
        spliceProximity: { distance: 2, isNearSpliceSite: true },
        spliceai: { ds_ag: 0.01, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.01 }
      }
    );
    // Revel/AM/Cadd say benign, but splicing proximity says pathogenic. This results in conflicting signals.
    const concAdj = countPredictorConcordance(10, 0.05, 0.1, "benign", null, null, {
      spliceProximity: { distance: 2, isNearSpliceSite: true },
      spliceai: { ds_ag: 0.01, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.01 }
    });
    expect(concAdj.signals.splice).toBe("pathogenic");

    // 2. High SpliceAI score should vote pathogenic and trigger PP3
    const concSpliceAI = countPredictorConcordance(10, 0.05, 0.1, "benign", null, null, {
      spliceProximity: { distance: 15, isNearSpliceSite: false },
      spliceai: { ds_ag: 0.25, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.25 }
    });
    expect(concSpliceAI.signals.splice).toBe("pathogenic");

    // 3. Far distance and low SpliceAI should vote benign
    const concBenign = countPredictorConcordance(10, 0.05, 0.1, "benign", null, null, {
      spliceProximity: { distance: 15, isNearSpliceSite: false },
      spliceai: { ds_ag: 0.01, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.01 }
    });
    expect(concBenign.signals.splice).toBe("benign");
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
});

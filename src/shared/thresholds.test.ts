import { describe, it, expect } from "vitest";
import {
  evaluateRevel,
  evaluateCadd,
  evaluateAlphaMissense,
  evaluatePopEve,
  evaluateBayesdel,
  evaluateEsm,
  evaluateEsm1b,
  evaluateGpnStar,
  evaluateSplicePredictor,
  evaluateAlphaGenomeAvi,
  countPredictorConcordance,
  computeConsensusVerdict,
  computeCalibratedConsensus,
  normalizeDestabilizationMagnitude,
  THRESHOLDS
} from "./thresholds.ts";
import { getResidueContext, getCalibration } from "./uncertainty";

describe("Thresholds Evaluation & Consensus Logic Tests (F-C4)", () => {
  describe("Individual Predictors Evaluation", () => {
    // Calls follow the ClinGen bands in calibration.ts (Pejaver 2022 / Bergquist 2025); the band
    // edges themselves are pinned in src/shared/__tests__/predictorEvidence.test.ts.
    it("should evaluate REVEL scores correctly", () => {
      expect(evaluateRevel(0.8)).toBe("pathogenic");
      expect(evaluateRevel(0.6)).toBe("vus");
      expect(evaluateRevel(0.25)).toBe("benign");
      expect(evaluateRevel(null)).toBe("unavailable");
    });

    it("should evaluate CADD scores correctly", () => {
      expect(evaluateCadd(26)).toBe("pathogenic");
      expect(evaluateCadd(24)).toBe("vus");
      expect(evaluateCadd(15)).toBe("benign");
      expect(evaluateCadd(undefined)).toBe("unavailable");
    });

    it("should evaluate AlphaMissense scores and classes correctly", () => {
      expect(evaluateAlphaMissense(0.99, "pathogenic")).toBe("pathogenic");
      expect(evaluateAlphaMissense(0.01, "benign")).toBe("benign");
      // The authors' "likely_pathogenic" class starts at 0.564; the calibrated PP3 band at 0.792.
      expect(evaluateAlphaMissense(0.6, "likely_pathogenic")).toBe("vus");
      expect(evaluateAlphaMissense(0.02, "likely_benign")).toBe("benign");
      expect(evaluateAlphaMissense(null, null)).toBe("unavailable");
    });

    it("should evaluate popEVE against the authors' deleterious cut-points only", () => {
      expect(evaluatePopEve(-3.775)).toBe("vus");
      expect(evaluatePopEve(-4.617)).toBe("pathogenic");
      expect(evaluatePopEve(-5.056)).toBe("pathogenic");
      // No benign cut-point is published, and there is no 0–1 scale.
      expect(evaluatePopEve(-0.5)).toBe("vus");
      expect(evaluatePopEve(0.8)).toBe("vus");
      expect(evaluatePopEve(null)).toBe("unavailable");
    });

    it("should evaluate BayesDel scores correctly", () => {
      expect(evaluateBayesdel(0.15)).toBe("pathogenic");
      expect(evaluateBayesdel(0.0)).toBe("vus");
      expect(evaluateBayesdel(-0.05)).toBe("vus");
      expect(evaluateBayesdel(-0.2)).toBe("benign");
      expect(evaluateBayesdel(null)).toBe("unavailable");
    });

    it("should evaluate ESM (ESM-2/SaProt) scores as purely informational VUS", () => {
      expect(evaluateEsm(-6.0)).toBe("vus");
      expect(evaluateEsm(-1.0)).toBe("vus");
      expect(evaluateEsm(null)).toBe("unavailable");
    });

    it("should evaluate ESM-1b scores against the Bergquist 2025 bands", () => {
      expect(evaluateEsm1b(-11.0)).toBe("pathogenic");
      expect(evaluateEsm1b(-8.0)).toBe("vus");
      expect(evaluateEsm1b(-4.0)).toBe("benign");
    });

    it("should evaluate GPN-Star scores correctly using phylogeny LLR thresholds", () => {
      expect(evaluateGpnStar(-3.5)).toBe("pathogenic");
      expect(evaluateGpnStar(-1.2)).toBe("vus");
      expect(evaluateGpnStar(0.5)).toBe("benign");
      expect(evaluateGpnStar(null)).toBe("unavailable");
    });

    it("applies the splicing rule on SpliceAI alone: >= 0.2 PP3, < 0.1 BP4 (Walker 2023)", () => {
      const sai = (max_ds: number | null) => ({ ds_ag: null, ds_al: null, ds_dg: null, ds_dl: null, max_ds });

      // At and above the PP3 band edge.
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, sai(0.2))).toBe("pathogenic");
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, sai(0.35))).toBe("pathogenic");

      // Between the bands: neither criterion.
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, sai(0.1))).toBe("vus");
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, sai(0.19))).toBe("vus");

      /**
       * Below 0.1 is a BP4 reading wherever the variant sits. The old rule demanded > 12 bp from the
       * junction and called BP4 only at <= 0.02 (cited to a non-existent "ClinGen SVI 2019"), so 0.05
       * read as indeterminate and 0.01 at 10 bp read as VUS.
       */
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, sai(0.05))).toBe("benign");
      expect(evaluateSplicePredictor({ distance: 10, isNearSpliceSite: false }, sai(0.01))).toBe("benign");
      // MACO1 p.Glu433Lys (Broad lookup, max delta 0.004): a measured BP4 reading, not "unavailable".
      expect(evaluateSplicePredictor({ distance: 16, isNearSpliceSite: false }, sai(0.004))).toBe("benign");

      // Distance alone is not PP3: 2 bp from a junction with a tiny delta is a BP4 reading.
      expect(evaluateSplicePredictor({ distance: 2, isNearSpliceSite: true }, sai(0.01))).toBe("benign");

      // dbscSNV is the authors' cut-point, not a band: it neither decides PP3 nor substitutes for SpliceAI.
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, null, { ada_score: 0.9, rf_score: 0.9 })).toBe("unavailable");
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, null, { ada_score: 0.1, rf_score: 0.1 })).toBe("unavailable");

      // No SpliceAI score -> the rule cannot be applied.
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, null, null)).toBe("unavailable");
      expect(evaluateSplicePredictor({ distance: 25, isNearSpliceSite: false }, undefined, undefined)).toBe("unavailable");
      expect(evaluateSplicePredictor(null, sai(null))).toBe("unavailable");
      expect(evaluateSplicePredictor(null, null)).toBe("unavailable");
      expect(evaluateSplicePredictor(undefined, undefined)).toBe("unavailable");
    });

    it("should treat the AlphaGenome AVI as informational: a rank, never a call", () => {
      expect(evaluateAlphaGenomeAvi({ aviPhred: 38.5, acmgStrength: "PP3_Strong" })).toBe("vus");
      expect(evaluateAlphaGenomeAvi({ aviPhred: 26.0, acmgStrength: "PP3_Moderate" })).toBe("vus");
      expect(evaluateAlphaGenomeAvi({ aviPhred: 12.0, acmgStrength: "indeterminate" })).toBe("vus");
      expect(evaluateAlphaGenomeAvi({ aviPhred: 3.2, acmgStrength: "BP4_Moderate" })).toBe("vus");
      expect(evaluateAlphaGenomeAvi({ aviPhred: -1.0 })).toBe("unavailable");
      expect(evaluateAlphaGenomeAvi(null)).toBe("unavailable");
      expect(evaluateAlphaGenomeAvi(undefined)).toBe("unavailable");
    });
  });

  describe("Predictor Concordance Counts", () => {
    it("should count concordance correctly and exclude ESM from active consensus voting counts", () => {
      // 3 pathogenic tools (CADD, REVEL, AM) + 1 vus (BayesDel) + 1 pathogenic popEVE + 1 pathogenic informational ESM-1b
      const res = countPredictorConcordance(
        28, // CADD -> pathogenic
        0.8, // REVEL -> pathogenic
        0.99, "pathogenic", // AM -> pathogenic
        0.0, // BayesDel -> vus
        -11.0, // ESM-1b -> pathogenic (informational, excluded from voting)
        { popeve: -4.9 } // popEVE -> pathogenic (≤ −4.617)
      );

      expect(res.nPathogenic).toBe(4);
      expect(res.nDeleterious).toBe(4);
      expect(res.nBenign).toBe(0);
      expect(res.nTolerated).toBe(0);
      expect(res.signals.esm).toBe("pathogenic");
      expect(res.available).toContain("ESM-1B");
      expect(res.available).toContain("POPEVE");
    });

    it("should include ESM-2 and SaProt, unsized, as informational models when LLR is provided", () => {
      const res = countPredictorConcordance(
        null,
        null,
        null,
        null,
        0.25, // bayesdel is 5th parameter
        null,
        {
          esm2Llr: -4.5,
          saprotLlr: -3.2,
          dann: 0.98,
          clinpred: 0.95,
          eigenPhred: 7.1
        }
      );

      // Unsized: ESM-2 is served as 650M (never 3B) and SaProt as 650M or 35M, so neither size is asserted.
      expect(res.available).toContain("ESM-2");
      expect(res.available).toContain("SAPROT");
      expect(res.available).toContain("DANN");
      expect(res.available).toContain("CLINPRED");
      expect(res.available).toContain("EIGEN");
      expect(res.available).toContain("BAYESDEL");
      expect(res.signals.esm2_3b).toBe("vus");
      expect(res.signals.saprot).toBe("vus");
      // DANN has no published clinical cut-point: informational, never a call.
      expect(res.signals.dann).toBe("vus");
      expect(res.nPathogenic).toBe(2); // BayesDel 0.25 and ClinPred 0.95 vote; DANN and Eigen do not
    });

    it("should include the ESMC/VESM slot and GPN-Star as informational models without skewing voting counts", () => {
      const res = countPredictorConcordance(
        null,
        null,
        null,
        null,
        null,
        null,
        {
          vesmLlr: -6.2,
          gpnStar: -4.5
        }
      );

      expect(res.available).toContain("ESMC / VESM");
      expect(res.available).toContain("GPN-STAR");
      expect(res.signals.vesm).toBe("vus");
      expect(res.signals.gpn_star).toBe("pathogenic");
      // Must not count toward active voting tallies (informational only)
      expect(res.nPathogenic).toBe(0);
      expect(res.nBenign).toBe(0);
      expect(res.nVus).toBe(0);
    });

    it("should list AlphaGenome AVI as informational, never as a vote", () => {
      // The AVI is a rank that contains AlphaMissense; voting it counted AlphaMissense twice.
      for (const aviPhred of [36.2, 4.8]) {
        const res = countPredictorConcordance(null, null, null, null, null, null, {
          alphagenome: { status: "live", aviPhred, acmgStrength: "PP3_Strong", topModality: "RNA-seq" } as any,
        });
        expect(res.nPathogenic + res.nBenign + res.nVus).toBe(0);
        expect(res.available).toContain("ALPHAGENOME");
        expect([...res.pathogenicTools, ...res.benignTools, ...res.vusTools].find(t => t.key === "alphagenome")?.isInformationalOnly).toBe(true);
      }
    });
  });

  describe("Consensus Biophysical Stability Verdicts", () => {
    it("should compute Low Misfolding Risk when no tool is destabilizing", () => {
      const res = computeConsensusVerdict({
        foldxMean: 0.2,
        dynamut2: 0.1,
        ddmut: 0.3
      });
      expect(res).toBe("Low Misfolding Risk (Neutral Stability)");
    });

    it("should compute Moderate Misfolding Risk when exactly 1 tool is destabilizing", () => {
      const res = computeConsensusVerdict({
        foldxMean: 2.1, // Destabilizing (>= 1.5)
        dynamut2: 0.5,
        ddmut: 0.2
      });
      expect(res).toBe("Moderate Misfolding Risk (Conflicting Stability)");
    });

    it("should compute High Misfolding Risk when 2 or more tools are destabilizing", () => {
      const res = computeConsensusVerdict({
        foldxMean: 2.1, // Destabilizing (>= 1.5)
        dynamut2: -1.5, // Destabilizing (<= -1.0)
        ddmut: 0.2
      });
      expect(res).toBe("High Misfolding Risk (Destabilizing Consensus)");
    });

    it("should correctly evaluate positive RaSP scores as destabilizing", () => {
      const res = computeConsensusVerdict({
        rasp: 1.5, // Destabilizing (>= 1.0) on the new positive sign convention
        thermompnn: 0.2
      });
      expect(res).toBe("Moderate Misfolding Risk (Conflicting Stability)");

      const resSingle = computeConsensusVerdict({
        rasp: 1.5
      });
      expect(resSingle).toBe("Elevated Misfolding Risk (Single-Tool Estimate)");

      const resHigh = computeConsensusVerdict({
        rasp: 1.2, // Destabilizing
        thermompnn: 1.8 // Destabilizing (>= 1.0)
      });
      expect(resHigh).toBe("High Misfolding Risk (Destabilizing Consensus)");
    });

    it("should exclude FoldX from consensus if foldxRepairFailed is true", () => {
      const res = computeConsensusVerdict({
        foldxMean: 2.5, // Destabilizing
        rasp: 0.1,      // Neutral
        foldxRepairFailed: true
      });
      expect(res).toBe("Low Misfolding Risk (Single-Tool Estimate)");

      const resTwoTools = computeConsensusVerdict({
        foldxMean: 2.5, // Destabilizing
        rasp: 1.2,      // Destabilizing
        thermompnn: 0.1,
        foldxRepairFailed: true
      });
      expect(resTwoTools).toBe("Moderate Misfolding Risk (Conflicting Stability)");
    });

    it("should exclude FoldX from consensus if foldxBinaryMissing is true", () => {
      const res = computeConsensusVerdict({
        foldxMean: 3.0,
        rasp: 0.1,
        foldxBinaryMissing: true
      });
      expect(res).toBe("Low Misfolding Risk (Single-Tool Estimate)");
    });

    it("should resolve consensus using confidence weights under conflicting conditions (D2)", () => {
      // 1. Two weak tools (DynaMut2 + DDMut) are destabilizing: total destab weight = 2.0. Total available weight = 6.7.
      // ratio = 2.0 / 6.7 = 29.8% (< 44%) -> Moderate Misfolding Risk (Conflicting Stability)
      const resWeak = computeConsensusVerdict({
        foldxMean: 0.1,
        dynamut2: -1.5, // Destab
        ddmut: -1.5,    // Destab
        rasp: 0.1,
        thermompnn: 0.1
      });
      expect(resWeak).toBe("Moderate Misfolding Risk (Conflicting Stability)");

      // 2. High-accuracy tools (ThermoMPNN + RaSP) are destabilizing: total destab weight = 3.5. Total available = 6.7.
      // ratio = 3.5 / 6.7 = 52.2% (>= 44%) -> High Misfolding Risk (Destabilizing Consensus)
      const resStrong = computeConsensusVerdict({
        foldxMean: 0.1,
        dynamut2: 0.1,
        ddmut: 0.1,
        rasp: 1.2,       // Destab
        thermompnn: 1.5  // Destab
      });
      expect(resStrong).toBe("High Misfolding Risk (Destabilizing Consensus)");

      // 3. ThermoMPNN (weight 2.0) + DDMut (weight 1.0) are destabilizing: total destab weight = 3.0. Total available = 6.7.
      // Under calibrated stacker, 3 stable vs 2 destabilizing is a conflict: Moderate Misfolding Risk (Conflicting Stability)
      const resThermoAndWeak = computeConsensusVerdict({
        foldxMean: 0.1,
        dynamut2: 0.1,
        ddmut: -1.5,     // Destab
        rasp: 0.1,
        thermompnn: 1.5  // Destab
      });
      expect(resThermoAndWeak).toBe("Moderate Misfolding Risk (Conflicting Stability)");

      // 4. StabilityOracle (weight 1.8) is destabilizing: total weight = 1.8. Single tool fallback limit logic:
      const resStabilityOracle = computeConsensusVerdict({
        stabilityoracle: 2.0
      });
      expect(resStabilityOracle).toBe("Elevated Misfolding Risk (Single-Tool Estimate)");
    });
  });

  describe("normalizeDestabilizationMagnitude (P3-2, H-4)", () => {
    it("should handle null, undefined, and NaN inputs by returning null magnitude", () => {
      expect(normalizeDestabilizationMagnitude("foldx", null)).toEqual({ magnitude: null, isDestabilizing: false });
      expect(normalizeDestabilizationMagnitude("dynamut2", null)).toEqual({ magnitude: null, isDestabilizing: false });
      expect(normalizeDestabilizationMagnitude("ddmut", null)).toEqual({ magnitude: null, isDestabilizing: false });
      expect(normalizeDestabilizationMagnitude("rasp", null)).toEqual({ magnitude: null, isDestabilizing: false });
      expect(normalizeDestabilizationMagnitude("thermompnn", null)).toEqual({ magnitude: null, isDestabilizing: false });
      expect(normalizeDestabilizationMagnitude("foldx", NaN)).toEqual({ magnitude: null, isDestabilizing: false });
    });

    it("should correctly normalize FoldX where positive indicates destabilization", () => {
      // FoldX threshold is >= 1.5
      expect(normalizeDestabilizationMagnitude("foldx", 2.0)).toEqual({ magnitude: 2.0, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("foldx", 1.5)).toEqual({ magnitude: 1.5, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("foldx", 1.4)).toEqual({ magnitude: 1.4, isDestabilizing: false });
      expect(normalizeDestabilizationMagnitude("foldx", -0.5)).toEqual({ magnitude: -0.5, isDestabilizing: false });
    });

    it("should correctly normalize DynaMut2 where negative indicates destabilization (and magnitude is sign-inverted)", () => {
      // DynaMut2 threshold is <= -1.0
      expect(normalizeDestabilizationMagnitude("dynamut2", -1.5)).toEqual({ magnitude: 1.5, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("dynamut2", -1.0)).toEqual({ magnitude: 1.0, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("dynamut2", -0.5)).toEqual({ magnitude: 0.5, isDestabilizing: false });
      expect(normalizeDestabilizationMagnitude("dynamut2", 0.5)).toEqual({ magnitude: -0.5, isDestabilizing: false });
    });

    it("should correctly normalize DDMut where negative indicates destabilization (and magnitude is sign-inverted)", () => {
      // DDMut threshold is <= -1.0
      expect(normalizeDestabilizationMagnitude("ddmut", -1.5)).toEqual({ magnitude: 1.5, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("ddmut", -1.0)).toEqual({ magnitude: 1.0, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("ddmut", -0.5)).toEqual({ magnitude: 0.5, isDestabilizing: false });
      expect(normalizeDestabilizationMagnitude("ddmut", 0.5)).toEqual({ magnitude: -0.5, isDestabilizing: false });
    });

    it("should correctly normalize RaSP where positive indicates destabilization", () => {
      // RaSP threshold is >= 1.0
      expect(normalizeDestabilizationMagnitude("rasp", 1.5)).toEqual({ magnitude: 1.5, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("rasp", 1.0)).toEqual({ magnitude: 1.0, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("rasp", 0.5)).toEqual({ magnitude: 0.5, isDestabilizing: false });
    });

    it("should correctly normalize ThermoMPNN where positive indicates destabilization", () => {
      // ThermoMPNN threshold is >= 1.0
      expect(normalizeDestabilizationMagnitude("thermompnn", 1.5)).toEqual({ magnitude: 1.5, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("thermompnn", 1.0)).toEqual({ magnitude: 1.0, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("thermompnn", 0.5)).toEqual({ magnitude: 0.5, isDestabilizing: false });
    });

    it("should correctly normalize StabilityOracle where positive indicates destabilization", () => {
      // StabilityOracle threshold is >= 1.0
      expect(normalizeDestabilizationMagnitude("stabilityoracle", 1.5)).toEqual({ magnitude: 1.5, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("stabilityoracle", 1.0)).toEqual({ magnitude: 1.0, isDestabilizing: true });
      expect(normalizeDestabilizationMagnitude("stabilityoracle", 0.5)).toEqual({ magnitude: 0.5, isDestabilizing: false });
    });

    it("should verify component and thresholds.ts share one RaSP convention", () => {
      expect(THRESHOLDS.rasp).toBeDefined();
      expect(THRESHOLDS.rasp.destabilizing).toBe(1.0);
      expect(normalizeDestabilizationMagnitude("rasp", THRESHOLDS.rasp.destabilizing).isDestabilizing).toBe(true);
    });
  });

  describe("computeCalibratedConsensus (No Heuristics & Empty Data Handling)", () => {
    it("should return Insufficient Biophysical Data when energetics is null", () => {
      const result = computeCalibratedConsensus(null);
      expect(result.consensusVerdict).toBe("Insufficient Biophysical Data");
      expect(result.consensusProbability).toBeNull();
      expect(result.consensusConfMin).toBeNull();
      expect(result.consensusConfMax).toBeNull();
    });

    it("should return Insufficient Biophysical Data when all predictors are null", () => {
      const result = computeCalibratedConsensus({
        foldxMean: null,
        foldx: null,
        stabilityoracle: null,
        dynamut2: null,
        ddmut: null,
        rasp: null,
        thermompnn: null
      });
      expect(result.consensusVerdict).toBe("Insufficient Biophysical Data");
      expect(result.consensusProbability).toBeNull();
      expect(result.consensusConfMin).toBeNull();
      expect(result.consensusConfMax).toBeNull();
    });

    it("should exclude FoldX when foldxRepairFailed is true and report Insufficient Data if no others present", () => {
      const result = computeCalibratedConsensus({
        foldxMean: 3.5,
        foldxRepairFailed: true
      });
      expect(result.consensusVerdict).toBe("Insufficient Biophysical Data");
      expect(result.consensusProbability).toBeNull();
    });

    it("should exclude FoldX when foldxBinaryMissing is true and report Insufficient Data if no others present", () => {
      const result = computeCalibratedConsensus({
        foldxMean: 3.5,
        foldxBinaryMissing: true
      });
      expect(result.consensusVerdict).toBe("Insufficient Biophysical Data");
      expect(result.consensusProbability).toBeNull();
    });

    it("should compute calibrated consensus when at least one valid predictor exists", () => {
      const result = computeCalibratedConsensus({
        foldxMean: 3.0,
        foldxRepairFailed: false,
        foldxBinaryMissing: false
      });
      expect(result.consensusVerdict).not.toBe("Insufficient Biophysical Data");
      expect(result.consensusProbability).not.toBeNull();
      expect(typeof result.consensusProbability).toBe("number");
      expect(result.consensusProbability).toBeGreaterThan(0);
    });

    it("should dampen structure-dependent predictor weights when pLDDT is low (SCI-004)", () => {
      // FoldX says destabilizing (3.0 kcal/mol), RaSP says neutral (0.0 kcal/mol)
      // When pLDDT >= 70, FoldX weight is 1.2, RaSP weight is 1.0
      const normalResult = computeCalibratedConsensus({
        foldxMean: 3.0,
        rasp: 0.0
      }, undefined, undefined, 85);

      // When pLDDT < 50 (e.g. 40), FoldX weight is damped by 0.1, while RaSP dominates
      const dampedResult = computeCalibratedConsensus({
        foldxMean: 3.0,
        rasp: 0.0
      }, undefined, undefined, 40);

      expect(normalResult.consensusProbability).not.toBeNull();
      expect(dampedResult.consensusProbability).not.toBeNull();
      expect(dampedResult.consensusProbability!).toBeLessThan(normalResult.consensusProbability!);
    });
  });

  describe("Structural Context Uncertainty (Zero-Heuristics SCI-005)", () => {
    it("should return unknown context when features are absent or empty", () => {
      expect(getResidueContext(undefined, 100)).toBe("unknown");
      expect(getResidueContext([], 100)).toBe("unknown");
      expect(getResidueContext(undefined, 0)).toBe("unknown");
    });

    it("should provide neutral calibration (weightMultiplier: 1.0) for unknown context across all tools", () => {
      const tools = ["revel", "alphaMissense", "cadd", "popEVE", "foldx", "stabilityoracle", "thermompnn", "dynamut2", "ddmut", "rasp"];
      for (const tool of tools) {
        const cal = getCalibration(tool, "unknown");
        expect(cal.weightMultiplier).toBe(1.0);
        expect(cal.auc).toBe(0.80);
      }
    });
  });
});

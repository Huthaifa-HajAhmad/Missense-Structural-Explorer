import { describe, it, expect } from "vitest";
import {
  evaluateRevel,
  evaluateCadd,
  evaluateAlphaMissense,
  evaluatePopEve,
  evaluateBayesdel,
  evaluateEsm,
  evaluateEsm1b,
  evaluateSplicePredictor,
  countPredictorConcordance,
  computeConsensusVerdict,
  normalizeDestabilizationMagnitude,
  THRESHOLDS
} from "./thresholds";

describe("Thresholds Evaluation & Consensus Logic Tests (F-C4)", () => {
  describe("Individual Predictors Evaluation", () => {
    it("should evaluate REVEL scores correctly", () => {
      expect(evaluateRevel(0.8)).toBe("pathogenic");
      expect(evaluateRevel(0.6)).toBe("vus");
      expect(evaluateRevel(0.1)).toBe("benign");
      expect(evaluateRevel(null)).toBe("unavailable");
    });

    it("should evaluate CADD scores correctly", () => {
      expect(evaluateCadd(26)).toBe("pathogenic");
      expect(evaluateCadd(15)).toBe("vus");
      expect(evaluateCadd(8)).toBe("benign");
      expect(evaluateCadd(undefined)).toBe("unavailable");
    });

    it("should evaluate AlphaMissense scores and classes correctly", () => {
      expect(evaluateAlphaMissense(0.99, "pathogenic")).toBe("pathogenic");
      expect(evaluateAlphaMissense(0.01, "benign")).toBe("benign");
      expect(evaluateAlphaMissense(0.5, "likely_pathogenic")).toBe("pathogenic");
      expect(evaluateAlphaMissense(0.02, "likely_benign")).toBe("benign");
      expect(evaluateAlphaMissense(null, null)).toBe("unavailable");
    });

    it("should evaluate popEVE negative LLR and 0-1 scale scores correctly", () => {
      expect(evaluatePopEve(-3.775)).toBe("pathogenic");
      expect(evaluatePopEve(-5.056)).toBe("pathogenic");
      expect(evaluatePopEve(-0.5)).toBe("benign");
      expect(evaluatePopEve(0.8)).toBe("pathogenic");
      expect(evaluatePopEve(0.2)).toBe("benign");
      expect(evaluatePopEve(null)).toBe("unavailable");
    });

    it("should evaluate BayesDel scores correctly", () => {
      expect(evaluateBayesdel(0.15)).toBe("pathogenic");
      expect(evaluateBayesdel(0.0)).toBe("vus");
      expect(evaluateBayesdel(-0.05)).toBe("benign");
      expect(evaluateBayesdel(null)).toBe("unavailable");
    });

    it("should evaluate ESM (ESM-2/SaProt) scores as purely informational VUS", () => {
      expect(evaluateEsm(-6.0)).toBe("vus");
      expect(evaluateEsm(-1.0)).toBe("vus");
      expect(evaluateEsm(null)).toBe("unavailable");
    });

    it("should evaluate ESM-1b scores correctly using peer-reviewed thresholds", () => {
      expect(evaluateEsm1b(-8.0)).toBe("pathogenic");
      expect(evaluateEsm1b(-6.0)).toBe("vus");
      expect(evaluateEsm1b(-4.0)).toBe("benign");
    });

    it("should evaluate splice-site proximity and SpliceAI scores correctly", () => {
      // Near splice site -> pathogenic
      expect(evaluateSplicePredictor({ distance: 2, isNearSpliceSite: true }, { ds_ag: 0.01, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.01 })).toBe("pathogenic");
      
      // High SpliceAI score -> pathogenic
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, { ds_ag: 0.35, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.35 })).toBe("pathogenic");

      // Far and low SpliceAI -> benign
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, { ds_ag: 0.01, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.01 })).toBe("benign");

      // Both null / undefined -> unavailable
      expect(evaluateSplicePredictor(null, null)).toBe("unavailable");
      expect(evaluateSplicePredictor(undefined, undefined)).toBe("unavailable");
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
        -8.0, // ESM-1b -> pathogenic (informational, excluded from voting)
        { popeve: -3.775 } // popEVE -> pathogenic
      );

      expect(res.nPathogenic).toBe(4);
      expect(res.nDeleterious).toBe(4);
      expect(res.nBenign).toBe(0);
      expect(res.nTolerated).toBe(0);
      expect(res.signals.esm).toBe("pathogenic");
      expect(res.available).toContain("ESM-1B");
      expect(res.available).toContain("POPEVE");
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
});

import { describe, it, expect } from "vitest";
import {
  evaluateRevel,
  evaluateCadd,
  evaluateAlphaMissense,
  evaluatePopEve,
  evaluateBayesdel,
  evaluateEsm,
  countPredictorConcordance,
  computeConsensusVerdict
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

    it("should evaluate ESM co-distilled score correctly", () => {
      expect(evaluateEsm(-6.0)).toBe("pathogenic");
      expect(evaluateEsm(-3.0)).toBe("vus");
      expect(evaluateEsm(-1.0)).toBe("benign");
      expect(evaluateEsm(null)).toBe("unavailable");
    });
  });

  describe("Predictor Concordance Counts", () => {
    it("should count concordance correctly and exclude ESM from active consensus voting counts", () => {
      // 3 pathogenic tools (CADD, REVEL, AM) + 1 vus (BayesDel) + 1 pathogenic popEVE + 1 pathogenic informational ESM
      const res = countPredictorConcordance(
        28, // CADD -> pathogenic
        0.8, // REVEL -> pathogenic
        0.99, "pathogenic", // AM -> pathogenic
        0.0, // BayesDel -> vus
        -6.0, // ESM -> pathogenic (but informational, excluded from voting)
        { popeve: -3.775 } // popEVE -> pathogenic
      );

      expect(res.nPathogenic).toBe(4);
      expect(res.nDeleterious).toBe(4);
      expect(res.nBenign).toBe(0);
      expect(res.nTolerated).toBe(0);
      expect(res.signals.esm).toBe("pathogenic");
      expect(res.available).toContain("ESM");
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
  });
});

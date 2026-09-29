import { describe, it, expect } from "vitest";
import {
  THRESHOLDS,
  evaluateAlphaGenomeAvi,
  evaluateRevel,
  evaluateCadd,
  countPredictorConcordance,
  computeStabilityConsensus
} from "./index.ts";

describe("Thresholds Modular Sub-Domain Tests", () => {
  describe("constants.ts", () => {
    it("exports valid cut-points", () => {
      expect(THRESHOLDS.revel.pathogenicStrong).toBe(0.75);
      expect(THRESHOLDS.alphagenome.pathogenicStrong).toBe(35.0);
      expect(THRESHOLDS.foldxDdG.destabilizingStrong).toBe(1.5);
    });
  });

  describe("evaluators.ts", () => {
    it("evaluates AlphaGenome AVI scores", () => {
      // A rank with no ClinGen calibration: available scores are informational, never a call.
      expect(evaluateAlphaGenomeAvi({ aviPhred: 36.0 })).toBe("vus");
      expect(evaluateAlphaGenomeAvi({ aviPhred: 5.0 })).toBe("vus");
      expect(evaluateAlphaGenomeAvi(null)).toBe("unavailable");
    });

    it("evaluates REVEL and CADD scores", () => {
      expect(evaluateRevel(0.85)).toBe("pathogenic");
      expect(evaluateRevel(0.10)).toBe("benign");
      expect(evaluateRevel(0.35)).toBe("vus");

      expect(evaluateCadd(28)).toBe("pathogenic");
      expect(evaluateCadd(8)).toBe("benign");
      expect(evaluateCadd(24)).toBe("vus");
    });
  });

  describe("concordance.ts", () => {
    it("counts predictor concordance correctly", () => {
      const conc = countPredictorConcordance(28, 0.85, 0.99, "pathogenic", 0.35, -8.0);
      expect(conc.nPathogenic).toBeGreaterThanOrEqual(3);
      expect(conc.signals.cadd).toBe("pathogenic");
      expect(conc.signals.revel).toBe("pathogenic");
      expect(conc.signals.am).toBe("pathogenic");
    });
  });

  describe("consensus.ts", () => {
    it("counts engines on their own marks and reports the median", () => {
      const consensus = computeStabilityConsensus({ foldxMean: 2.5, dynamut2: -1.5, rasp: 1.8 });
      expect(consensus.consensusVerdict).toBe("Destabilizing (Engines Agree)");
      expect(consensus.enginesCounted).toBe(3);
      expect(consensus.enginesDestabilizing).toBe(3);
      expect(consensus.medianDdg).toBe(1.8);
    });
  });
});

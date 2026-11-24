import { describe, it, expect } from "vitest";
import {
  evaluateRevel,
  evaluateCadd,
  evaluateAlphaMissense,
  evaluatePopEve,
  evaluateBayesdel,
  evaluateEsm1b,
  evaluateSplicePredictor,
  evaluateAlphaGenomeAvi,
  computeConsensusVerdict,
  computeStabilityConsensus,
  THRESHOLDS
} from "./thresholds.ts";
import { classifyRawDdg, toCanonicalDdg } from "./engineStatus.ts";

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

    it("should evaluate ESM-1b scores against the Bergquist 2025 bands", () => {
      expect(evaluateEsm1b(-11.0)).toBe("pathogenic");
      expect(evaluateEsm1b(-8.0)).toBe("vus");
      expect(evaluateEsm1b(-4.0)).toBe("benign");
    });

    it("applies the splicing rule on SpliceAI alone: >= 0.2 PP3, < 0.1 BP4 (Walker 2023)", () => {
      const sai = (max_ds: number | null) => ({ ds_ag: null, ds_al: null, ds_dg: null, ds_dl: null, max_ds });

      // At and above the PP3 band edge.
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, sai(0.2))).toBe("pathogenic");
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, sai(0.35))).toBe("pathogenic");

      // Between the bands: neither criterion.
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, sai(0.1))).toBe("benign");
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

      // No SpliceAI score -> the rule cannot be applied.
      expect(evaluateSplicePredictor({ distance: 15, isNearSpliceSite: false }, null)).toBe("unavailable");
      expect(evaluateSplicePredictor({ distance: 25, isNearSpliceSite: false }, undefined)).toBe("unavailable");
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

  /**
   * The stability consensus is an agreement count on each engine's own local mark. It replaced a
   * "Low / Moderate / High Misfolding Risk" threshold on a probability from hand-typed curves
   * (`thresholds/consensus.ts`). The inputs of the old tests are kept; the verdicts now say what the
   * engines did.
   */
  describe("Stability consensus verdicts", () => {
    it("reports no destabilization when no engine passes its mark", () => {
      expect(computeConsensusVerdict({ foldxMean: 0.2, rasp: 0.1, thermompnn: 0.3 })).toBe("No Destabilization Predicted");
    });

    it("reports disagreement when one engine passes its mark and the others do not", () => {
      expect(computeConsensusVerdict({ foldxMean: 2.1, rasp: 0.3, thermompnn: 0.2 })).toBe("Engines Disagree");
    });

    it("reads positive RaSP and ThermoMPNN as destabilizing", () => {
      expect(computeConsensusVerdict({ foldxMean: 2.1, rasp: 1.5, thermompnn: 0.2 })).toBe("Engines Disagree");
      expect(computeConsensusVerdict({ foldxMean: 2.1, rasp: 1.5 })).toBe("Destabilizing (Engines Agree)");
    });

    it("reads positive RaSP as destabilizing, and names a single engine as one", () => {
      expect(computeConsensusVerdict({ rasp: 1.5, thermompnn: 0.2 })).toBe("Engines Disagree");
      expect(computeConsensusVerdict({ rasp: 1.5 })).toBe("Destabilizing (Single-Engine Estimate)");
      expect(computeConsensusVerdict({ rasp: 1.2, thermompnn: 1.8 })).toBe("Destabilizing (Engines Agree)");
    });

    it("does not call engines that all sit in the moderate band a disagreement", () => {
      expect(computeConsensusVerdict({ foldxMean: 1.0, rasp: 0.7 })).toBe("Moderately Destabilizing (Engines Agree)");
    });

    it("excludes FoldX after a failed repair or with no binary", () => {
      expect(computeConsensusVerdict({ foldxMean: 2.5, rasp: 0.1, foldxRepairFailed: true })).toBe(
        "No Destabilization (Single-Engine Estimate)"
      );
      expect(computeConsensusVerdict({ foldxMean: 2.5, rasp: 1.2, thermompnn: 0.1, foldxRepairFailed: true })).toBe(
        "Engines Disagree"
      );
      expect(computeConsensusVerdict({ foldxMean: 3.0, rasp: 0.1, foldxBinaryMissing: true })).toBe(
        "No Destabilization (Single-Engine Estimate)"
      );
    });

    it("gives every engine one vote: no hidden weights", () => {
      const firstPair = computeStabilityConsensus({ foldxMean: 1.6, stabilityoracle: 0.5, rasp: 0.1, thermompnn: 0.1 });
      const secondPair = computeStabilityConsensus({ foldxMean: 0.1, stabilityoracle: 0.0, rasp: 1.2, thermompnn: 1.5 });
      expect(firstPair.consensusVerdict).toBe("Engines Disagree");
      expect(secondPair.consensusVerdict).toBe("Engines Disagree");
      expect(firstPair.enginesDestabilizing).toBe(2);
      expect(secondPair.enginesDestabilizing).toBe(2);
      expect(computeConsensusVerdict({ stabilityoracle: 2.0 })).toBe("Destabilizing (Single-Engine Estimate)");
    });
  });

  describe("One sign convention (engineStatus is the only normalizer)", () => {
    it("returns null, never 0, for missing input", () => {
      for (const id of ["foldx", "rasp", "thermompnn", "stabilityoracle"] as const) {
        expect(toCanonicalDdg(id, null)).toBeNull();
        expect(toCanonicalDdg(id, NaN)).toBeNull();
      }
    });

    it("normalises positive-native engines and judges each on its own mark", () => {
      expect(toCanonicalDdg("foldx", 2.0)).toBe(2.0);
      expect(toCanonicalDdg("rasp", 1.5)).toBe(1.5);
      expect(toCanonicalDdg("thermompnn", 1.2)).toBe(1.2);
      expect(toCanonicalDdg("stabilityoracle", -0.5)).toBe(-0.5);
      expect(classifyRawDdg("foldx", 1.5)?.id).toBe("high");
      expect(classifyRawDdg("foldx", 1.4)?.id).toBe("moderate");
      expect(classifyRawDdg("rasp", THRESHOLDS.rasp.destabilizing)?.id).toBe("high");
      expect(classifyRawDdg("thermompnn", 1.0)?.id).toBe("high");
      // StabilityOracle has one calibrated mark (+0.2) and no moderate band.
      expect(classifyRawDdg("stabilityoracle", 0.5)?.id).toBe("high");
      expect(classifyRawDdg("stabilityoracle", 0.2)?.id).toBe("high");
      expect(classifyRawDdg("stabilityoracle", 0.19)?.id).toBe("neutral");
    });
  });

  describe("computeStabilityConsensus — empty data", () => {
    it("returns Insufficient Biophysical Data for null or all-null input", () => {
      for (const input of [null, { foldxMean: null, foldx: null, rasp: null, thermompnn: null, stabilityoracle: null }]) {
        const r = computeStabilityConsensus(input);
        expect(r.consensusVerdict).toBe("Insufficient Biophysical Data");
        expect(r.enginesCounted).toBe(0);
        expect(r.medianDdg).toBeNull();
      }
    });

    it("reports Insufficient when the only value is an excluded FoldX", () => {
      expect(computeStabilityConsensus({ foldxMean: 3.5, foldxRepairFailed: true }).consensusVerdict).toBe("Insufficient Biophysical Data");
      expect(computeStabilityConsensus({ foldxMean: 3.5, foldxBinaryMissing: true }).consensusVerdict).toBe("Insufficient Biophysical Data");
    });

    it("carries no probability field at all", () => {
      const r = computeStabilityConsensus({ foldxMean: 3.0 }) as unknown as Record<string, unknown>;
      expect(r).not.toHaveProperty("consensusProbability");
      expect(r).not.toHaveProperty("consensusConfMin");
      expect(r.medianDdg).toBe(3.0);
    });
  });
});

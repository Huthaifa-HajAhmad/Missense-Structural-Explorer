import { describe, it, expect } from "vitest";
import {
  MODEL_CALIBRATIONS,
  classifyLlr,
  describeScaleHomogeneity,
  describeWithinModelRank,
  isCalibrated,
  resolveModelCalibration
} from "../modelCalibration";
import { resolveServedModel } from "../perturbationModels";
import { PP3_BP4_CALIBRATION, calibratedCall } from "../thresholds/calibration";

/**
 * Moved from perturbationHelpers.test.ts when the 0–100 composite and its text helpers were removed
 * (doc/PERTURBATION_REVIEW.md). The registry contract they pinned still holds.
 */
describe("Model calibration registry", () => {
    it("marks every model actually evaluated on the perturbation tab as uncalibrated", () => {
      // Regression guard for the defect this module exists to fix: none of these models
      // may quietly acquire a cut-point derived for another model.
      for (const id of ["saprot", "esm2", "esmc"] as const) {
        const calibration = resolveModelCalibration(id);
        expect(calibration, `${id} must resolve`).not.toBeNull();
        expect(isCalibrated(calibration), `${id} must not be treated as calibrated`).toBe(false);
      }
      // The SaProt 35M engine variant is a distinct row and must be covered too.
      expect(isCalibrated(resolveModelCalibration("saprot", { saprotEngine: "saprot-35m" }))).toBe(false);
    });

    it("keeps ESM-1b the only calibrated row in the registry", () => {
      // Iterating the registry means a future row added as "calibrated" without a
      // derivation must fail here rather than silently tinting a score.
      const calibratedIds = Object.values(MODEL_CALIBRATIONS)
        .filter(isCalibrated)
        .map(c => c.id);
      expect(calibratedIds).toEqual(["esm1b"]);
    });

    it("does not report a shared scale when no model contributed", () => {
      // A green "shared scale" beside "0 models" is a false success state.
      expect(describeScaleHomogeneity([])).toMatchObject({ homogeneous: true, sufficient: false });
      expect(describeScaleHomogeneity([MODEL_CALIBRATIONS.esmc6b]).sufficient).toBe(false);
      expect(describeScaleHomogeneity([MODEL_CALIBRATIONS.esmc6b, MODEL_CALIBRATIONS.esm2_650m])).toMatchObject({
        homogeneous: false,
        sufficient: true
      });
    });

    it("states within-model rank ordinally and never inverts it", () => {
      // The previous revision described the model's LEAST preferred substitution as
      // "top 5%". Ordinal wording cannot be misread in either direction.
      const best = describeWithinModelRank(1, 3.9);
      const worst = describeWithinModelRank(20, 3.9);

      expect(best).toContain("1st of 20 by model preference");
      expect(best).toContain("most preferred substitutions");
      expect(worst).toContain("20th of 20 by model preference");
      expect(worst).toContain("least preferred substitutions");
      expect(worst).not.toContain("top 5%");
      expect(best).not.toContain("top 100%");
      // Out-of-range values are reported as unavailable rather than clamped to a claim.
      expect(describeWithinModelRank(0)).toContain("unavailable");
      expect(describeWithinModelRank(21)).toContain("unavailable");
      expect(describeWithinModelRank(undefined)).toContain("unavailable");
    });

    it("gives ESM-1b ClinGen's ESM1b bands, read from the one calibration table", () => {
      // The row used to carry Brandes 2023's own operating point (-7.5) and an unsourced -5.0 while
      // the PP3/BP4 evaluator used Bergquist 2025, so one score got two verdicts. Bergquist 2025
      // Table 1: PP3 Supporting <= -10.7, BP4 Supporting >= -6.3.
      const bands = PP3_BP4_CALIBRATION.esm1b;
      expect(MODEL_CALIBRATIONS.esm1b.cutPoints).toEqual({ pathogenic: bands.pp3.Supporting, benign: bands.bp4.Supporting });
      expect(MODEL_CALIBRATIONS.esm1b.cutPoints).toEqual({ pathogenic: -10.7, benign: -6.3 });
      expect(MODEL_CALIBRATIONS.esm1b.cutPointSource).toContain("Bergquist");
      expect(isCalibrated(MODEL_CALIBRATIONS.esm1b)).toBe(true);
    });

    it("classifies an ESM-1b LLR on those bands, edges inclusive", () => {
      const esm1b = MODEL_CALIBRATIONS.esm1b;
      expect(classifyLlr(-12.0, esm1b)).toBe("pathogenic");
      expect(classifyLlr(-10.7, esm1b)).toBe("pathogenic");
      expect(classifyLlr(-8.0, esm1b)).toBe("intermediate");
      expect(classifyLlr(-6.3, esm1b)).toBe("benign");
      expect(classifyLlr(-1.0, esm1b)).toBe("benign");
      // The retired numbers no longer decide anything: -7.5 was Brandes's operating point.
      expect(classifyLlr(-7.5, esm1b)).toBe("intermediate");
      expect(classifyLlr(-6.0, esm1b)).toBe("benign");
    });

    it("agrees with the PP3/BP4 evaluator on the same score", () => {
      // classifyLlr's pathogenic/benign are "at least Supporting"; the evaluator grades strength.
      for (const llr of [-25, -12.5, -10.7, -8, -6.3, -3, 4]) {
        const call = calibratedCall("esm1b", llr);
        const verdict = classifyLlr(llr, MODEL_CALIBRATIONS.esm1b);
        const expected = call?.direction === "PP3" ? "pathogenic" : call?.direction === "BP4" ? "benign" : "intermediate";
        expect(verdict, `ESM1b LLR ${llr}`).toBe(expected);
      }
    });

    it("selects the SaProt variant from the engine setting", () => {
      expect(resolveModelCalibration("saprot", { saprotEngine: "saprot-35m" })?.id).toBe("saprot35m");
      expect(resolveModelCalibration("saprot", { saprotEngine: "remote-hf" })?.id).toBe("saprot650m");
      expect(resolveModelCalibration("saprot")?.id).toBe("saprot650m");
    });

    it("never reports a verdict for a missing or unavailable score", () => {
      expect(classifyLlr(null, MODEL_CALIBRATIONS.esm1b)).toBe("unavailable");
      expect(classifyLlr(undefined, MODEL_CALIBRATIONS.esm1b)).toBe("unavailable");
      expect(classifyLlr(NaN, MODEL_CALIBRATIONS.esm1b)).toBe("unavailable");
      expect(classifyLlr(-5, null)).toBe("uncalibrated");
    });

  it("counts the residues ranked above the variant, not below it", () => {
    // Rank 20 of 20 had read "(0 of the other 19 … rank above it)" beside "least preferred".
    expect(describeWithinModelRank(20)).toContain("19 of the other 19 canonical substitutions rank above it");
    expect(describeWithinModelRank(1)).toContain("0 of the other 19 canonical substitutions rank above it");
  });

  it("records the embedding widths the architectures actually have", () => {
    expect(MODEL_CALIBRATIONS.saprot35m.embeddingDim).toBe(480); // SaProt_35M_AF2 config.json hidden_size
    expect(MODEL_CALIBRATIONS.vesm150m.embeddingDim).toBe(640); // built on esm2_t30_150M_UR50D
    expect(MODEL_CALIBRATIONS.saprot650m.embeddingDim).toBe(1280);
    expect(MODEL_CALIBRATIONS.esmc6b.embeddingDim).toBe(2560);
  });

  it("resolves the registry row from the payload's provenance, not from settings", () => {
    expect(resolveServedModel("saprot", "SaProt (SaProt_35M_AF2 - Remote)", "remote-hf").registryKey).toBe("saprot35m");
    expect(resolveServedModel("saprot", "VESM-150M (Local Fallback - SaProt unavailable)").fallback).toBe(true);
    expect(resolveServedModel("esmc", "ESMC-6B (Remote)").registryKey).toBe("esmc6b");
    const inferred = resolveServedModel("saprot", null, "saprot-35m");
    expect(inferred.inferred).toBe(true);
    expect(inferred.registryKey).toBe("saprot35m");
  });
});

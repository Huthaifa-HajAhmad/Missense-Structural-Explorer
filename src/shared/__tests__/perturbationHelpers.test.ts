import { describe, it, expect } from "vitest";
import {
  calculateLps,
  getLpsDetails,
  getSequenceEvidenceText,
  getEnergeticEvidenceText,
  getGeometricEvidenceText,
  getOverallInterpretationText,
  computeMultiModelLlr
} from "../perturbationHelpers";
import {
  MODEL_CALIBRATIONS,
  classifyLlr,
  describeScaleHomogeneity,
  describeWithinModelRank,
  isCalibrated,
  resolveModelCalibration
} from "../modelCalibration";

describe("Perturbation Interpretation Helpers", () => {
  describe("LPS Calculations", () => {
    it("handles a Low LPS case correctly", () => {
      // Small LLR (-1.0), low VdW delta (0.1), no clash, small displacement (0.05)
      const lps = calculateLps(-1.0, 0.1, 0, 0.05);
      expect(lps).not.toBeNull();
      expect(lps!).toBeLessThan(35);

      const details = getLpsDetails(lps);
      expect(details.level).toBe("low");
      expect(details.labelText).toBe("Low Disruption");
      expect(details.badgeClass).toContain("emerald");
    });

    it("handles a Severe LPS case correctly", () => {
      // Large LLR (-10.0), large VdW delta (4.5), clash delta (6), large displacement (2.0)
      const lps = calculateLps(-10.0, 4.5, 6, 2.0);
      expect(lps).not.toBeNull();
      expect(lps!).toBeGreaterThan(65);

      const details = getLpsDetails(lps);
      expect(details.level).toBe("severe");
      expect(details.labelText).toBe("Severe Disruption");
      expect(details.badgeClass).toContain("rose");
    });

    it("handles partially missing sub-scores using dynamic weight normalization", () => {
      // Missing VdW and clash values
      const lpsWithFull = calculateLps(-8.0, 3.0, 4, 1.2);
      const lpsWithMissing = calculateLps(-8.0, null, null, 1.2);

      expect(lpsWithFull).not.toBeNull();
      expect(lpsWithMissing).not.toBeNull();
      
      // Both should return valid scores since weights normalize dynamically over active fields
      expect(typeof lpsWithMissing).toBe("number");
      expect(lpsWithMissing!).toBeGreaterThan(0);
    });
  });

  describe("Evidence Text Translation", () => {
    /**
     * The calibrated branch is exercised with an ESM-1b value, because ESM-1b is the only
     * model in the registry whose cut-points were derived for it. Passing ESM-1b's
     * cut-points alongside an "ESMC-6B" label would assert the very cross-model transfer
     * this module exists to prevent.
     */
    it("states a calibrated verdict only for the model the cut-point belongs to", () => {
      const pooled = { llr: -7.8, count: 1, details: "ESM-1b: -7.8", mixedScale: false, uncalibrated: false };

      // -7.8 is at or below ESM-1b's documented -7.5 cut-point, so "strong" is licensed.
      const calibrated = getSequenceEvidenceText(-7.8, "ESM-1b", pooled, MODEL_CALIBRATIONS.esm1b);
      expect(calibrated).toContain("strong perturbation");

      // The identical number from a model with no cut-point must not borrow that verdict.
      const borrowed = getSequenceEvidenceText(-7.8, "ESMC-6B", { ...pooled, details: "ESMC-6B: -7.8" });
      expect(borrowed).toContain("no established cut-point");
      expect(borrowed).not.toContain("strong perturbation");
    });

    it("classifies ESM-1b's intermediate band as moderate, not strong", () => {
      // -6.8 lies between the -7.5 pathogenic and -5.0 benign cut-points.
      const homogeneous = { llr: -6.8, count: 2, details: "ESMC-6B: -6.0, ESM-2: -7.5", mixedScale: false };
      const text = getSequenceEvidenceText(-6.8, "ESMC-6B", homogeneous, MODEL_CALIBRATIONS.esm1b);
      expect(text).toContain("moderate perturbation");
      expect(text).not.toContain("strong perturbation");
    });

    it("refuses to classify a pool that mixes model families", () => {
      // SaProt sits near zero while ESMC sits near -8: different scales, so not poolable.
      const mixed = { llr: -4.2, count: 2, details: "ESMC-6B: -8.4, SaProt: -0.03", mixedScale: true, spread: 8.4 };

      const text = getSequenceEvidenceText(-4.2, "ESMC-6B", mixed, MODEL_CALIBRATIONS.esm1b);
      expect(text).toContain("not on a shared scale");
      expect(text).not.toContain("strong perturbation");
      expect(text).not.toContain("moderate perturbation");
    });

    it("describes a single uncalibrated model by its native scale, not a borrowed verdict", () => {
      const text = getSequenceEvidenceText(-8.43, "ESMC");
      expect(text).toContain("model-native ΔLLR -8.4 nats");
      expect(text).toContain("no established cut-point");
      expect(text).not.toContain("strong perturbation");
    });

    it("translates FoldX energetics with uncertainty", () => {
      const vdwWithSd = getEnergeticEvidenceText(2.3, 0.25);
      const lowVdw = getEnergeticEvidenceText(0.4, null);

      expect(vdwWithSd).toContain("severe steric clash");
      expect(vdwWithSd).toContain("+2.30 ± 0.25 kcal/mol");

      expect(lowVdw).toContain("neutral stability");
    });

    it("translates Cα overlay displacements", () => {
      const highDisp = getGeometricEvidenceText(1.65);
      const lowDisp = getGeometricEvidenceText(0.08);

      expect(highDisp).toContain("severe local backbone displacement");
      expect(lowDisp).toContain("negligible local backbone displacement");
    });

    it("determines overall interpretation mapping", () => {
      const severeInterpretation = getOverallInterpretationText(1.6, 2.5);
      const mildInterpretation = getOverallInterpretationText(0.35, 0.4);
      const neutralInterpretation = getOverallInterpretationText(0.05, 0.2);

      expect(severeInterpretation).toContain("severe local folding disruption");
      expect(mildInterpretation).toContain("likely affects local packing without evidence for a large conformational rearrangement");
      expect(neutralInterpretation).toContain("minimal structural disruption");
    });
  });

  describe("Multi-Model Sequence Consensus", () => {
    it("aggregates valid deep models and calculates mean LLR", () => {
      const evaluations = [
        { provenance: "ESMC-6B (Local)", llr: -6.0 },
        { provenance: "SaProt 650M AF2 (Local)", llr: -4.0 },
        { provenance: "ESM-2 3B (Local)", llr: -2.0 }
      ];
      const consensus = computeMultiModelLlr(evaluations);
      expect(consensus.count).toBe(3);
      expect(consensus.llr).toBeCloseTo(-4.0, 2);
      expect(consensus.details).toBe("ESMC-6B: -6.0, SaProt: -4.0, ESM-2: -2.0");
      // -6.0 to -2.0 is a 4 nat spread: these are not one scale, and the pool says so.
      expect(consensus.mixedScale).toBe(true);
      expect(consensus.spread).toBeCloseTo(4.0, 2);
    });

    it("does not flag a small spread, even across families, since spread is the reported signal", () => {
      const evaluations = [
        { provenance: "ESMC-6B (Local)", llr: -6.0 },
        { provenance: "ESM-2 650M (Local)", llr: -6.8 }
      ];
      const consensus = computeMultiModelLlr(evaluations);
      expect(consensus.count).toBe(2);
      expect(consensus.mixedScale).toBe(false);
      expect(consensus.spread).toBeCloseTo(0.8, 2);
      // Pooling several models is never a calibrated score, whatever the spread.
      expect(consensus.uncalibrated).toBe(true);
    });

    it("filters out degenerate flat distributions (e.g. llr === 0 with uniform prefs)", () => {
      const AA_LIST = ["L", "A", "G", "V", "S", "E", "R", "T", "I", "D", "P", "F", "K", "N", "Q", "Y", "M", "H", "W", "C"];
      const flatPreferences = AA_LIST.map(aa => ({ aa, prob: 0.0491 }));

      const evaluations = [
        { provenance: "ESMC-6B (Local)", llr: -5.5 },
        { provenance: "SaProt 650M AF2 (Local)", llr: 0.0, preferences: flatPreferences },
        { provenance: "ESM-2 3B (Local)", llr: -3.5 }
      ];

      const consensus = computeMultiModelLlr(evaluations);
      expect(consensus.count).toBe(2);
      expect(consensus.llr).toBeCloseTo(-4.5, 2);
      expect(consensus.details).toBe("ESMC-6B: -5.5, ESM-2: -3.5");
      expect(consensus.details).not.toContain("SaProt");
    });

    it("safely handles null, undefined, empty, or non-array evaluations", () => {
      const unavailable = {
        llr: null,
        count: 0,
        details: "No valid sequence model data",
        mixedScale: false,
        spread: null,
        uncalibrated: false,
        mixedScaleBasis: "family"
      };
      expect(computeMultiModelLlr(null as any)).toEqual(unavailable);
      expect(computeMultiModelLlr(undefined as any)).toEqual(unavailable);
      expect(computeMultiModelLlr([])).toEqual(unavailable);
      expect(computeMultiModelLlr([null, undefined, { llr: NaN }, { llr: "invalid" }] as any)).toEqual(unavailable);
    });

    it("decides mixed-scale from model family when families are supplied", () => {
      // Two different families that happen to agree closely: the nats gap alone would
      // call this homogeneous, but the models do not share a score scale.
      const close = [
        { provenance: "ESMC-6B (Local)", llr: -6.0 },
        { provenance: "ESM-2 650M (Local)", llr: -6.8 }
      ];

      const bySpread = computeMultiModelLlr(close);
      expect(bySpread.mixedScale).toBe(false);
      expect(bySpread.mixedScaleBasis).toBe("spread");

      const byFamily = computeMultiModelLlr(close, { families: ["esmc", "esm2"] });
      expect(byFamily.mixedScale).toBe(true);
      expect(byFamily.mixedScaleBasis).toBe("family");
      // The gap is still reported as descriptive context.
      expect(byFamily.spread).toBeCloseTo(0.8, 2);
    });

    it("treats a single family as one scale even with a wide gap", () => {
      // Two checkpoints of one architecture can differ by several nats on one variant
      // without being on different scales.
      const wide = [
        { provenance: "SaProt 650M AF2 (Local)", llr: -1.0 },
        { provenance: "SaProt 35M AF2 (Local)", llr: -5.0 }
      ];
      const pooled = computeMultiModelLlr(wide, { families: ["saprot", "saprot"] });
      expect(pooled.mixedScale).toBe(false);
      expect(pooled.mixedScaleBasis).toBe("family");
    });

    it("falls back to the spread heuristic when families are missing or misaligned", () => {
      const close = [
        { provenance: "ESMC-6B (Local)", llr: -6.0 },
        { provenance: "ESM-2 650M (Local)", llr: -6.8 }
      ];
      // Too few families to describe every contributing value: do not guess.
      const mismatched = computeMultiModelLlr(close, { families: ["esmc"] });
      expect(mismatched.mixedScaleBasis).toBe("spread");
      expect(mismatched.mixedScale).toBe(false);

      const withNulls = computeMultiModelLlr(close, { families: ["esmc", null] });
      expect(withNulls.mixedScaleBasis).toBe("spread");
    });

    it("marks any pool of two or more models as uncalibrated", () => {
      const pooled = computeMultiModelLlr([
        { provenance: "ESMC-6B (Local)", llr: -6.0 },
        { provenance: "ESM-2 650M (Local)", llr: -6.8 }
      ]);
      // A mean across models is never a score on one model's axis.
      expect(pooled.uncalibrated).toBe(true);
    });

    it("reports a scale-mixed pool rather than a calibrated verdict", () => {
      const consensus = {
        llr: -5.2,
        count: 3,
        details: "ESMC-6B: -9.1, SaProt: -0.1, ESM-2: -6.4",
        mixedScale: true,
        spread: 9.0
      };
      const text = getSequenceEvidenceText(-6.0, "ESMC-6B", consensus, MODEL_CALIBRATIONS.esm1b);
      expect(text).toContain("not on a shared scale");
      expect(text).toContain("no pooled strength classification is reported");
    });

    it("withholds a consensus verdict when no member model is calibrated", () => {
      const consensus = {
        llr: -6.4,
        count: 2,
        details: "ESMC-6B: -6.0, ESM-2: -6.8",
        mixedScale: false,
        spread: 0.8
      };
      const text = getSequenceEvidenceText(-6.4, "ESMC-6B", consensus);
      expect(text).toContain("no calibrated cut-point");
      expect(text).not.toContain("strong perturbation");
    });
  });

  describe("Per-model LLR calibration registry", () => {
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

    it("keeps ESM-1b's cut-points attached to ESM-1b alone", () => {
      expect(isCalibrated(MODEL_CALIBRATIONS.esm1b)).toBe(true);
      expect(classifyLlr(-8.0, MODEL_CALIBRATIONS.esm1b)).toBe("pathogenic");
      expect(classifyLlr(-1.0, MODEL_CALIBRATIONS.esm1b)).toBe("benign");
      expect(classifyLlr(-6.0, MODEL_CALIBRATIONS.esm1b)).toBe("intermediate");
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
  });
});

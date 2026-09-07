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
    it("translates sequence model LLR correctly", () => {
      const strongText = getSequenceEvidenceText(-7.1, "ESMC");
      const moderateText = getSequenceEvidenceText(-3.5, "SaProt");
      const weakText = getSequenceEvidenceText(-1.0, "ESM-2");

      expect(strongText).toContain("strong perturbation");
      expect(strongText).toContain("ESMC LLR -7.1");

      expect(moderateText).toContain("moderate perturbation");
      expect(moderateText).toContain("SaProt LLR -3.5");

      expect(weakText).toContain("minimal perturbation");
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
      expect(computeMultiModelLlr(null as any)).toEqual({
        llr: null,
        count: 0,
        details: "No valid sequence model data"
      });
      expect(computeMultiModelLlr(undefined as any)).toEqual({
        llr: null,
        count: 0,
        details: "No valid sequence model data"
      });
      expect(computeMultiModelLlr([])).toEqual({
        llr: null,
        count: 0,
        details: "No valid sequence model data"
      });
      expect(computeMultiModelLlr([null, undefined, { llr: NaN }, { llr: "invalid" }] as any)).toEqual({
        llr: null,
        count: 0,
        details: "No valid sequence model data"
      });
    });

    it("formats consensus evidence text when multiModel has count > 1", () => {
      const consensus = {
        llr: -5.2,
        count: 3,
        details: "ESMC-6B: -6.0, SaProt: -5.0, ESM-2: -4.6"
      };
      const text = getSequenceEvidenceText(-6.0, "ESMC-6B", consensus);
      expect(text).toBe("Sequence-model consensus (3 models): strong perturbation (ESMC-6B: -6.0, SaProt: -5.0, ESM-2: -4.6)");
    });
  });
});

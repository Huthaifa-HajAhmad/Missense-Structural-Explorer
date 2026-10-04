import { describe, it, expect } from "vitest";
import { parseFoldxDifFile, predictStructuralDisruption } from "./biophysics.ts";

describe("Biophysics Service Unit Tests (M-7 Coverage)", () => {
  describe("parseFoldxDifFile", () => {
    it("should correctly parse standard FoldX Dif output with 5 runs and compute mean and SD", () => {
      const mockFxOutput = [
        "PDB\ttotal energy\tVdW\tElectrostatics",
        "wt.pdb\t10.0\t2.0\t1.0",
        "wt_1.pdb\t15.0\t3.0\t1.5",
        "wt_2.pdb\t15.5\t3.1\t1.5",
        "wt_3.pdb\t14.8\t2.9\t1.4",
        "wt_4.pdb\t15.2\t3.0\t1.5",
        "wt_5.pdb\t15.1\t3.0\t1.5"
      ].join("\n");

      const result = parseFoldxDifFile(mockFxOutput);

      expect(result.ddG).toBeGreaterThan(4.5);
      expect(result.ddG).toBeLessThan(5.5);
      expect(result.sd).toBeGreaterThanOrEqual(0);
      expect(result.rawDdGs).toHaveLength(5);
      expect(result.stericClashWarning).toBe(false);
    });

    it("keeps a legitimate bimodal run distribution instead of discarding the minority mode", () => {
      // Real BuildModel output: SOD1 p.Ala5Val on the repaired AlphaFold template. Two side-chain
      // rotamer outcomes (~1.6 and ~2.9). A MAD filter scored the 2.9 pair at modified Z ~14 and
      // reported 1.58 ± 0.03; the honest summary keeps all five runs.
      const result = parseFoldxDifFile([
        "Pdb\ttotal energy\tBackbone Hbond",
        "wt_1_0.pdb\t2.95165\t-0.175699",
        "wt_1_1.pdb\t1.55294\t-0.178762",
        "wt_1_2.pdb\t1.61067\t-0.154488",
        "wt_1_3.pdb\t2.9026\t-0.171324",
        "wt_1_4.pdb\t1.58113\t-0.177132"
      ].join("\n"));

      expect(result.rawDdGs).toHaveLength(5);
      expect(result.excludedDdGs).toEqual([]);
      expect(result.ddG).toBeCloseTo(2.1198, 3);
      expect(result.sd).toBeGreaterThan(0.6);
    });

    it("excludes a physically impossible run (> 20 kcal/mol) from the mean and reports it", () => {
      const mockFxOutput = [
        "PDB\ttotal energy\tVdW\tElectrostatics",
        "wt.pdb\t10.0\t2.0\t1.0",
        "wt_1.pdb\t15.0\t3.0\t1.5",
        "wt_2.pdb\t15.1\t3.0\t1.5",
        "wt_3.pdb\t14.9\t3.0\t1.5",
        "wt_4.pdb\t15.0\t3.0\t1.5",
        "wt_5.pdb\t75.0\t15.0\t5.0" // Outlier run (ddG = 65.0)
      ].join("\n");

      const result = parseFoldxDifFile(mockFxOutput);
      // The unphysical run is excluded, and reported rather than silently dropped.
      expect(result.rawDdGs).toHaveLength(4);
      expect(result.excludedDdGs).toEqual([65]);
      expect(result.ddG).toBeCloseTo(5.0, 1);
    });

    it("should throw error for empty or invalid FoldX output", () => {
      expect(() => parseFoldxDifFile("")).toThrow("Invalid FoldX file: empty file.");
      expect(() => parseFoldxDifFile("No header line here")).toThrow("Invalid FoldX file: no header line found.");
    });
  });

  describe("predictStructuralDisruption", () => {
    it("should predict structural disruption for a given residue in a PDB structure", async () => {
      const mockPdb = [
        "HELIX    1   1 MET A    1  GLU A   10  1                                  10",
        "ATOM      1  N   MET A   1      11.234  22.345  33.456  1.00 85.50           N",
        "ATOM      2  CA  MET A   1      12.234  23.345  34.456  1.00 90.00           C",
        "END"
      ].join("\n");

      const result = await predictStructuralDisruption(mockPdb, "M", 1, "E", "A");
      expect(result).toBeDefined();
      expect(result.level).toBeDefined();
      expect(typeof result.reason).toBe("string");
    }, 15000);
  });
});

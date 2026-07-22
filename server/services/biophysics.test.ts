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

    it("should perform 2-SD outlier filtering when n >= 4 runs contain a sampling outlier", () => {
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
      // Outlier run should be filtered out
      expect(result.rawDdGs).toHaveLength(4);
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
    });
  });
});

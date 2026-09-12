import { describe, it, expect } from "vitest";
import { parseFoldxDifFile } from "./parser.ts";
import { getFoldxExecutionTarget } from "./detector.ts";
import { cleanPdbForFoldX, detectBFactorProvenance } from "./pdb-utils.ts";
import { getFoldxCacheKey } from "./cache.ts";

describe("FoldX Modular Engine Tests", () => {
  describe("parser.ts: parseFoldxDifFile", () => {
    it("parses valid FoldX .dif file with WT and 5 mutant runs", () => {
      const mockDif = [
        "PDB\ttotal energy\tBackbone Hbond\tSidechain Hbond\tVan der Waals\tElectrostatics",
        "wt.pdb\t100.0\t-10.0\t-5.0\t15.0\t-8.0",
        "wt_1.pdb\t102.5\t-9.8\t-4.5\t17.5\t-7.5",
        "wt_2.pdb\t102.3\t-9.9\t-4.6\t17.4\t-7.6",
        "wt_3.pdb\t102.7\t-9.7\t-4.4\t17.6\t-7.4",
        "wt_4.pdb\t102.4\t-9.8\t-4.5\t17.5\t-7.5",
        "wt_5.pdb\t102.6\t-9.8\t-4.5\t17.5\t-7.5"
      ].join("\n");

      const res = parseFoldxDifFile(mockDif);
      expect(res.ddG).toBeCloseTo(2.5, 1);
      expect(res.vdw).toBeCloseTo(2.5, 1);
      expect(res.stericClashWarning).toBe(true);
      expect(res.isDegenerate).toBe(false);
    });

    it("throws on empty or invalid file", () => {
      expect(() => parseFoldxDifFile("")).toThrow("empty file");
      expect(() => parseFoldxDifFile("Random text without headers")).toThrow("no header line found");
    });
  });

  describe("detector.ts: getFoldxExecutionTarget", () => {
    it("returns direct binary when not using Box64", () => {
      const target = getFoldxExecutionTarget("foldx.exe", ["--command=BuildModel"]);
      expect(target.file).toBe("foldx.exe");
      expect(target.args).toEqual(["--command=BuildModel"]);
    });
  });

  describe("pdb-utils.ts: cleanPdbForFoldX & detectBFactorProvenance", () => {
    it("cleans alternate locations and hydrogen atoms", () => {
      const dirtyPdb = [
        "ATOM      1  N   ALA A   1      11.104  13.207  10.000  1.00 90.00           N",
        "ATOM      2  H   ALA A   1      11.500  13.500  10.500  1.00 90.00           H",
        "ATOM      3  CA BALA A   1      12.000  14.000  11.000  0.50 90.00           C",
        "TER",
        "END"
      ].join("\n");

      const cleaned = cleanPdbForFoldX(dirtyPdb);
      expect(cleaned).toContain("ATOM      1  N   ALA A   1");
      expect(cleaned).not.toContain("ATOM      2  H");
      expect(cleaned).not.toContain("ATOM      3  CA BALA");
    });

    it("detects AlphaFold headers and pLDDT semantics", () => {
      const afPdb = "HEADER    ALPHAFOLD PREDICTION\nATOM      1  CA  ALA A   1      10.0 10.0 10.0  1.00 85.00           C";
      const prov = detectBFactorProvenance(afPdb);
      expect(prov.source).toBe("alphafold");
      expect(prov.semantic).toBe("plddt");
    });
  });

  describe("cache.ts: getFoldxCacheKey", () => {
    it("generates deterministic cache keys", () => {
      const key1 = getFoldxCacheKey("hash123", "RA215W", { pH: 7.0, temperature: 298, seed: 42 });
      const key2 = getFoldxCacheKey("hash123", "RA215W", { pH: 7.0, temperature: 298, seed: 42 });
      expect(key1).toBe(key2);
      expect(key1).toContain("hash123_RA215W_pH:7_temp:298_ion:0.05_seed:42");
    });
  });
});

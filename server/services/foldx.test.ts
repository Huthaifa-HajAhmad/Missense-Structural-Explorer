import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { parseFoldxDifFile, generateMutantPdb } from "./foldx.ts";

describe("FoldX Service & Parser Unit Tests", () => {
  describe("parseFoldxDifFile", () => {
    it("should parse stability change value (ddG) from single-run FoldX output text", () => {
      const mockFxout = `
# FoldX output file
Pdb\tTotal energy\tBackbone Hbond\tSidechain Hbond\tVan der Waals\tElectrostatics
wt.pdb\t10.50\t2.50\t8.00\t1.50\t2.00
wt_1.pdb\t12.0432\t3.04\t9.00\t2.10\t2.20
      `.trim();
      const res = parseFoldxDifFile(mockFxout);
      expect(res.ddG).toBeCloseTo(1.5432, 4);
      expect(res.sd).toBe(0);
      expect(res.vdw).toBeCloseTo(0.60, 4);
      expect(res.electrostatics).toBeCloseTo(0.20, 4);
    });

    it("should parse and average multiple FoldX stochastic runs (BIO-10)", () => {
      const mockFxout = `
# FoldX output file
Pdb\tTotal energy\tBackbone Hbond\tSidechain Hbond\tVan der Waals\tElectrostatics
wt.pdb\t10.00\t2.50\t8.00\t1.50\t2.00
wt_1.pdb\t12.00\t3.04\t9.00\t2.10\t2.20
wt_2.pdb\t13.00\t3.04\t9.00\t2.20\t2.30
wt_3.pdb\t14.00\t3.04\t9.00\t2.30\t2.40
      `.trim();
      const res = parseFoldxDifFile(mockFxout);
      expect(res.ddG).toBe(3.00);
      expect(res.sd).toBe(1.00);
    });

    it("should mark extreme outlier ddG values (> 20 kcal/mol) as degenerate artifacts (H-5, BIO-6)", () => {
      const mockFxout = `
# FoldX output file
Pdb\tTotal energy\tBackbone Hbond\tSidechain Hbond\tVan der Waals\tElectrostatics
wt.pdb\t10.00\t2.50\t8.00\t1.50\t2.00
wt_1.pdb\t160.00\t3.04\t9.00\t120.00\t20.00
      `.trim();
      const res = parseFoldxDifFile(mockFxout);
      expect(res.ddG).toBe(null);
      expect(res.isDegenerate).toBe(true);
      expect(res.stericClashWarning).toBe(true);
    });

    it("should apply strict column matching and reject greedy total headers (BIO-5)", () => {
      const mockFxout = `
Pdb\tTotal hbonds\tTotal energy
wt.pdb\t45\t10.00
wt_1.pdb\t42\t12.00
      `.trim();
      const res = parseFoldxDifFile(mockFxout);
      expect(res.ddG).toBe(2.00);
    });

    it("should throw error if total energy column is not found", () => {
      const mockFxout = `
Pdb\tOtherCol\tBackbone
wt.pdb\t10.0\t0.20
wt_1.pdb\t7.5\t0.54
      `.trim();
      expect(() => parseFoldxDifFile(mockFxout)).toThrow();
    });

    it("should throw error if file is empty or mutant row is missing", () => {
      expect(() => parseFoldxDifFile("")).toThrow();
      expect(() => parseFoldxDifFile("HeaderOnly")).toThrow();
      expect(() => parseFoldxDifFile(`
Pdb\tTotal energy
wt.pdb\t10.50
      `.trim())).toThrow();
    });

    it("should parse difference-only format where WT row is missing", () => {
      const res = parseFoldxDifFile(`
Pdb\tTotal energy
wt_1.pdb\t12.00
      `.trim());
      expect(res.ddG).toBe(12.00);
    });

    it("should parse FoldX 5.1 style output with metadata headers not starting with #", () => {
      const res = parseFoldxDifFile(`
FoldX 5.1 (2011)
by the FoldX Consortium
------------------------------------------------------

PDB file analysed: batch
Output type: BuildModel
Pdb\ttotal energy\tBackbone Hbond
wt_1.pdb\t11.8627\t1.97785
      `.trim());
      expect(res.ddG).toBe(11.8627);
    });
  });

  describe("FoldX execution failure and error propagation", () => {
    it("should throw a hard modeling engine unavailable error when FoldX execution fails", async () => {
      const dummyPdb = `
HEADER    EXPERIMENTAL STRUCTURE
ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C
TER       2      ASP A   1
END
`.trim();
      const tempJobDir = path.join(process.cwd(), "temp_jobs", "test-foldx-failure-" + crypto.randomUUID());
      await fs.promises.mkdir(tempJobDir, { recursive: true });
      
      const oldFoldxBin = process.env.FOLDX_BINARY;
      process.env.FOLDX_BINARY = "non-existent-foldx-binary";
      
      try {
        await expect(
          generateMutantPdb(dummyPdb, "DA1W", "P00439", tempJobDir)
        ).rejects.toThrow("Biophysical modeling engine unavailable");
      } finally {
        process.env.FOLDX_BINARY = oldFoldxBin;
        if (fs.existsSync(tempJobDir)) {
          await fs.promises.rm(tempJobDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("parseFoldxDifFile SD Degeneracy", () => {
    it("should mark runs with standard deviation of 0 as degenerate (failed stochastic minimization)", () => {
      const mockFxout = `
# FoldX output file
Pdb	Total energy	Backbone Hbond	Sidechain Hbond	Van der Waals	Electrostatics
wt.pdb	10.00	2.50	8.00	1.50	2.00
wt_1.pdb	12.50	3.04	9.00	2.10	2.20
wt_2.pdb	12.50	3.04	9.00	2.10	2.20
wt_3.pdb	12.50	3.04	9.00	2.10	2.20
      `.trim();
      const res = parseFoldxDifFile(mockFxout);
      expect(res.ddG).toBe(null);
      expect(res.isDegenerate).toBe(true);
      expect(res.sd).toBe(0.0);
    });
  });

  describe("FoldX Persistent Disk Cache", () => {
    it("should write to and read from the disk cache correctly", async () => {
      const { writeMutantToCache, getMutantFromCache, mutantCache } = await import("./foldx.ts");
      
      const testKey = "test_key_" + crypto.randomUUID();
      const mockResult = { pdb: "MOCK_PDB_DATA", ddG: 2.34, status: "success", foldedResidueIndex: 12 };
      
      // Clear memory cache if exists
      mutantCache.delete(testKey);
      
      // Write to cache
      writeMutantToCache(testKey, mockResult);
      
      // Wait a short bit to ensure file system async write completes
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Memory check (should be in memory LRU)
      expect(mutantCache.get(testKey)).toEqual(mockResult);
      
      // Delete from memory to force reading from disk
      mutantCache.delete(testKey);
      expect(mutantCache.get(testKey)).toBeUndefined();
      
      // Fetch using getMutantFromCache (should hit disk and restore to memory)
      const cached = getMutantFromCache(testKey);
      expect(cached).toEqual(mockResult);
      expect(mutantCache.get(testKey)).toEqual(mockResult);
      
      // Clean up cache file
      const FOLDX_CACHE_DIR = path.join(process.cwd(), "logs", "foldx_cache");
      const hash = crypto.createHash("sha256").update(testKey).digest("hex");
      const filepath = path.join(FOLDX_CACHE_DIR, `${hash}.json`);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    });
  });
});

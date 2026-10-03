import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { parseFoldxDifFile, generateMutantPdb, cleanPdbForFoldX, getFoldxExecutionTarget } from "./foldx.ts";

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
    it("should fail fast with an explicit engine-unavailable error when the FoldX binary is missing", async () => {
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
        // P0-1.5: the route must surface an explicit engine-unavailable error immediately,
        // not queue forever behind a dead binary.
        await expect(
          generateMutantPdb(dummyPdb, "DA1W", "P00439", tempJobDir)
        ).rejects.toThrow(/FoldX binary not found or not executable|Biophysical modeling engine unavailable/);
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
      expect(res.ddG).toBe(2.50);
      expect(res.isDegenerate).toBe(true);
      expect(res.sd).toBe(0.0);
    });
  });

  describe("FoldX Persistent Disk Cache", () => {
    it("should write to and read from the disk cache correctly", async () => {
      const { writeMutantToCache, getMutantFromCache, mutantCache, getCacheFilename } = await import("../foldx.ts");
      
      const testKey = "test_key_" + crypto.randomUUID();
      const mockResult = { pdb: "MOCK_PDB_DATA", ddG: 2.34, status: "success", foldedResidueIndex: 12 };
      
      // Clear memory cache if exists
      mutantCache.delete(testKey);
      
      // Write to cache
      writeMutantToCache(testKey, mockResult);
      
      // The writer atomically renames when complete: observe that boundary, not an arbitrary sleep.
      const filepath = getCacheFilename(testKey);
      await vi.waitFor(() => expect(fs.existsSync(filepath)).toBe(true), { timeout: 5000 });
      
      // Memory check (should be in memory LRU)
      expect(mutantCache.get(testKey)).toEqual(mockResult);
      
      // Delete from memory to force reading from disk
      mutantCache.delete(testKey);
      expect(mutantCache.get(testKey)).toBeUndefined();
      
      // Fetch using getMutantFromCache (should hit disk and restore to memory)
      const cached = await getMutantFromCache(testKey);
      expect(cached).toEqual(mockResult);
      expect(mutantCache.get(testKey)).toEqual(mockResult);
      
      // Clean up only the exact redirected file created above, never the real repository cache.
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    });
  });

  describe("FoldX seed exposure and rawDdGs", () => {
    it("should parse and return rawDdGs arrays in parseFoldxDifFile", () => {
      const mockFxout = `
# FoldX output file
Pdb	Total energy	Backbone Hbond	Sidechain Hbond	Van der Waals	Electrostatics
wt.pdb	10.00	2.50	8.00	1.50	2.00
wt_1.pdb	12.00	3.04	9.00	2.10	2.20
wt_2.pdb	13.00	3.04	9.00	2.20	2.30
wt_3.pdb	14.00	3.04	9.00	2.30	2.40
      `.trim();
      const res = parseFoldxDifFile(mockFxout);
      expect(res.rawDdGs).toEqual([2.0, 3.0, 4.0]);
    });
  });

  describe("PDB normalization and AlphaFold detection", () => {
    it("should clean PDB content and generate consistent cache keys", () => {
      const pdbWithHeader = `
HEADER    PREDICTED STRUCTURE
REMARK    ALPHAFOLD DBREF
ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C
TER       2      ASP A   1
END
      `.trim();
      
      const pdbWithoutHeader = `
ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C
TER       2      ASP A   1
END
      `.trim();
      
      const cleanedWithHeader = cleanPdbForFoldX(pdbWithHeader);
      const cleanedWithoutHeader = cleanPdbForFoldX(pdbWithoutHeader);
      
      expect(cleanedWithHeader).toBe(cleanedWithoutHeader);
      
      const hash1 = crypto.createHash("sha256").update(cleanedWithHeader).digest("hex");
      const hash2 = crypto.createHash("sha256").update(cleanedWithoutHeader).digest("hex");
      expect(hash1).toBe(hash2);
    });

    it("should correctly identify AlphaFold structures using regex patterns", () => {
      const afRegex = /ALPHAFOLD|DBREF.*AF\-/i;
      const remarkRegex = /^REMARK.*ALPHAFOLD/mi;
      const headerRegex = /^HEADER.*PREDICTED/mi;

      expect(afRegex.test("REMARK CREATOR OF MODEL: ALPHAFOLD")).toBe(true);
      expect(afRegex.test("DBREF AF-P00439-F1")).toBe(true);
      expect(remarkRegex.test("REMARK 999 ALPHAFOLD MODEL")).toBe(true);
      expect(headerRegex.test("HEADER PREDICTED STRUCTURE")).toBe(true);

      expect(afRegex.test("HEADER EXPERIMENTAL STRUCTURE")).toBe(false);
    });
  });

  describe("Platform Binary Resolution & Independent Execution", () => {
    it("should filter out Windows batch files (.cmd, .bat) when scanning for Linux binaries", () => {
      const files = ["foldx.cmd", "foldx_1_20270131.exe", "foldx.bat", "rotabase.txt"];
      const isLinuxCandidate = (f: string) => {
        const lower = f.toLowerCase();
        return (
          lower.startsWith("foldx") &&
          !lower.endsWith(".exe") &&
          !lower.endsWith(".txt") &&
          !lower.endsWith(".cmd") &&
          !lower.endsWith(".bat") &&
          !lower.endsWith(".ps1") &&
          !lower.endsWith(".sh")
        );
      };

      const found = files.find(isLinuxCandidate);
      expect(found).toBeUndefined();
    });

    it("should reject executing Windows batch scripts on non-Windows platforms via FOLDX_BINARY", async () => {
      const originalPlatform = process.platform;
      const originalFoldxBinary = process.env.FOLDX_BINARY;
      const dummyPdb = `
ATOM      1  N   MET A   1       0.000   0.000   0.000  1.00  0.00           N
ATOM      2  CA  MET A   1       1.458   0.000   0.000  1.00  0.00           C
ATOM      3  C   MET A   1       2.009   1.428   0.000  1.00  0.00           C
ATOM      4  O   MET A   1       1.246   2.392   0.000  1.00  0.00           O
TER       5      MET A   1
END
      `.trim();

      const tempDir = path.join(process.cwd(), "temp_jobs", "test_platform_rejection");
      fs.mkdirSync(tempDir, { recursive: true });

      try {
        process.env.FOLDX_BINARY = "/app/tools/foldx/foldx.cmd";
        // Mock non-win32 platform
        Object.defineProperty(process, "platform", { value: "linux", configurable: true });

        await expect(
          generateMutantPdb(dummyPdb, "MA1V", "P00439", tempDir)
        ).rejects.toThrow(/Windows batch script/);
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
        if (originalFoldxBinary !== undefined) {
          process.env.FOLDX_BINARY = originalFoldxBinary;
        } else {
          delete process.env.FOLDX_BINARY;
        }
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
      }
    });

    it("should allow enrichBiophysicalResult to produce consensus metrics even if FoldX failed", async () => {
      const { enrichBiophysicalResult } = await import("./energy-models.ts");

      const failedFoldxResult = {
        pdb: null,
        ddG: null,
        status: "failed",
        error: "FoldX binary not found or failed",
        energetics: {
          foldxMean: null,
          foldxRepairFailed: true,
          rasp: -1.25,
          raspReason: "precomputed_zenodo"
        }
      };

      const remoteJobs = {
        dynamut2JobId: "job-123",
        dynamut2Status: "done",
        ddmutJobId: null,
        ddmutStatus: "unavailable",
        thermompnnJobId: null,
        thermompnnStatus: "done",
        thermompnnError: null,
        thermompnnVal: 0.85,
        stabilityoracleVal: -0.42
      };

      const provenance = { source: "alphafold" };
      const enriched = enrichBiophysicalResult(failedFoldxResult, remoteJobs, provenance, 1);

      expect(enriched.status).toBe("failed");
      expect(enriched.energetics.foldx).toBeNull();
      expect(enriched.energetics.rasp).toBe(-1.25);
      expect(enriched.energetics.thermompnn).toBe(0.85);
      expect(enriched.energetics.stabilityoracle).toBe(-0.42);
      expect(enriched.energetics.consensusVerdict).toBeDefined();
      expect(enriched.energetics.consensusVerdict).not.toBeNull();
    });

    it("should resolve FoldX directly on non-ARM or Windows platforms", () => {
      const target = getFoldxExecutionTarget("tools/foldx/foldx.exe", ["--command=RepairPDB"]);
      if (process.platform === "win32") {
        expect(target.file).toBe("tools/foldx/foldx.exe");
        expect(target.args).toEqual(["--command=RepairPDB"]);
      }
    });

    it("should route through Box64 on Linux ARM64 if box64 binary exists", () => {
      const origPlatform = process.platform;
      const origArch = process.arch;
      const origEnv = process.env.BOX64_PATH;
      try {
        Object.defineProperty(process, "platform", { value: "linux", configurable: true });
        Object.defineProperty(process, "arch", { value: "arm64", configurable: true });
        // Point BOX64_PATH to a known file so existsSync passes
        process.env.BOX64_PATH = path.resolve(__filename);

        const target = getFoldxExecutionTarget("/app/tools/foldx/foldx", ["--command=RepairPDB"]);
        expect(target.file).toBe(path.resolve(__filename));
        expect(target.args).toEqual(["/app/tools/foldx/foldx", "--command=RepairPDB"]);
      } finally {
        Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
        Object.defineProperty(process, "arch", { value: origArch, configurable: true });
        if (origEnv !== undefined) {
          process.env.BOX64_PATH = origEnv;
        } else {
          delete process.env.BOX64_PATH;
        }
      }
    });
  });
});


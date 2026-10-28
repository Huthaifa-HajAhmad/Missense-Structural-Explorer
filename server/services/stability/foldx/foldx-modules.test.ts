import { describe, it, expect } from "vitest";
import { parseFoldxDifFile } from "./parser.ts";
import { getFoldxExecutionTarget } from "./detector.ts";
import { cleanPdbForFoldX, countIncompleteResidues, detectBFactorProvenance } from "./pdb-utils.ts";
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

    it("detects an AlphaFold DB accession, not any 'AF-' substring", () => {
      const afPdb = "DBREF  XXXX A    1   367  UNP    P06132  AF-P06132-F1\nATOM      1  CA  ALA A   1      10.0 10.0 10.0  1.00 85.00           C";
      expect(detectBFactorProvenance(afPdb).source).toBe("alphafold");
    });

    // 1R3S (UROD, X-ray 1.65 Å) read as AlphaFold: B-factors all under 100 plus the word MODEL in
    // REMARK 3, so FoldX skipped RepairPDB and the tab said "pLDDT in B-factors" for a crystal.
    it("reads an X-ray entry as experimental even when its B-factors fall in 0-100 and REMARK 3 names a MODEL", () => {
      const xray = [
        "HEADER    LYASE                                   03-OCT-03   1R3S              ",
        "EXPDTA    X-RAY DIFFRACTION                                                     ",
        "REMARK   3  FIT TO DATA USED IN REFINEMENT. MODEL : RESTRAINED                  ",
        "DBREF  1R3S A    1   367  UNP    P06132   DCUP_HUMAN       1    367             ",
        "ATOM      1  N   PHE A  11      21.425  47.902  66.423  1.00 37.52           N",
        "ATOM      2  CA  PHE A  11      21.112  48.558  65.127  1.00 37.50           C",
      ].join("\n");
      expect(detectBFactorProvenance(xray)).toEqual({ source: "experimental", semantic: "temperature_factor", inherited: true });
    });

    it("reads an NMR or EM entry as experimental", () => {
      for (const method of ["SOLUTION NMR", "ELECTRON MICROSCOPY"]) {
        const pdb = `HEADER    TEST\nEXPDTA    ${method}\nATOM      1  CA  ALA A   1      10.0 10.0 10.0  1.00 50.00           C`;
        expect(detectBFactorProvenance(pdb).source).toBe("experimental");
      }
    });
  });

  describe("pdb-utils.ts: countIncompleteResidues", () => {
    const atom = (serial: number, name: string, resName: string, resSeq: number) =>
      `ATOM  ${String(serial).padStart(5)}  ${name.padEnd(3)} ${resName} A${String(resSeq).padStart(4)}      11.104  13.207  10.000  1.00 90.00           ${name[0]}`;

    it("counts residues missing heavy atoms, as FoldX does before it rebuilds them", () => {
      const pdb = [
        // SER 1: complete (N CA C O CB OG)
        ...["N", "CA", "C", "O", "CB", "OG"].map((n, i) => atom(i + 1, n, "SER", 1)),
        // LYS 2: truncated at C-beta, the shape a 3.5 A structure leaves (5 of 9 heavy atoms)
        ...["N", "CA", "C", "O", "CB"].map((n, i) => atom(10 + i, n, "LYS", 2)),
        // GLY 3: complete with no side chain at all
        ...["N", "CA", "C", "O"].map((n, i) => atom(20 + i, n, "GLY", 3)),
        // ALA 4: missing its carbonyl O (backbone gap)
        ...["N", "CA", "C", "CB"].map((n, i) => atom(30 + i, n, "ALA", 4)),
        // a ligand and an unknown residue are not counted
        "HETATM   40  C1  ANP A 900      11.104  13.207  10.000  1.00 90.00           C",
        atom(41, "CA", "UNK", 5),
      ].join("\n");
      expect(countIncompleteResidues(pdb)).toBe(2);
    });

    it("does not count a C-terminal OXT as a defect", () => {
      const pdb = ["N", "CA", "C", "O", "CB", "OXT"].map((n, i) => atom(i + 1, n, "ALA", 9)).join("\n");
      expect(countIncompleteResidues(pdb)).toBe(0);
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

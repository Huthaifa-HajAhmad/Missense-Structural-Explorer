import { describe, it, expect } from "vitest";
import { 
  svd3, 
  getVdwRadius, 
  calculateClashes, 
  calculateContacts, 
  calculateHBonds, 
  calculateChi1Deviation,
  getKabschTransform,
  alignMutantToWt
} from "./structural-diff.ts";
import { PdbAtom } from "./pdb-parser.ts";

describe("Structural Diff Engine Unit Tests (C-5)", () => {
  describe("svd3 (3x3 SVD Jacobi iteration)", () => {
    it("should compute correct SVD for identity matrix", () => {
      const identity: [[number, number, number], [number, number, number], [number, number, number]] = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ];
      const res = svd3(identity);
      expect(res.S[0]).toBeCloseTo(1, 4);
      expect(res.S[1]).toBeCloseTo(1, 4);
      expect(res.S[2]).toBeCloseTo(1, 4);
    });

    it("should compute correct SVD for diagonal matrix", () => {
      const diag: [[number, number, number], [number, number, number], [number, number, number]] = [
        [3, 0, 0],
        [0, 2, 0],
        [0, 0, 1]
      ];
      const res = svd3(diag);
      expect(res.S[0]).toBeCloseTo(3, 4);
      expect(res.S[1]).toBeCloseTo(2, 4);
      expect(res.S[2]).toBeCloseTo(1, 4);
    });
  });

  describe("getVdwRadius", () => {
    it("should return correct radius and polarity for standard atom names", () => {
      const c = getVdwRadius("CA");
      expect(c.radius).toBe(1.7);
      expect(c.isPolar).toBe(false);

      const o = getVdwRadius("O");
      expect(o.radius).toBe(1.52);
      expect(o.isPolar).toBe(true);

      const n = getVdwRadius("N");
      expect(n.radius).toBe(1.55);
      expect(n.isPolar).toBe(true);
    });
  });

  describe("calculateClashes", () => {
    it("should report 0 clashes for widely spaced atoms", () => {
      const atoms: PdbAtom[] = [
        { name: "CA", resSeq: 1, x: 0, y: 0, z: 0, chain: "A", resName: "ALA" },
        { name: "CA", resSeq: 5, x: 10, y: 0, z: 0, chain: "A", resName: "ALA" }
      ];
      expect(calculateClashes(atoms)).toBe(0);
    });

    it("should detect clashes when atoms are closer than VDW sum overlap limit", () => {
      // CA radius is 1.7. Two CA atoms at 1.0 A should clash heavily.
      // Use sequence distance of 5 to avoid adjacent residue exclusion.
      const atoms: PdbAtom[] = [
        { name: "CA", resSeq: 1, x: 0, y: 0, z: 0, chain: "A", resName: "ALA" },
        { name: "CA", resSeq: 5, x: 1.0, y: 0, z: 0, chain: "A", resName: "ALA" }
      ];
      expect(calculateClashes(atoms)).toBeGreaterThan(0);
    });
  });

  describe("calculateContacts & calculateHBonds", () => {
    it("should compute contacts correctly for close residues", () => {
      const atoms: PdbAtom[] = [
        { name: "CA", resSeq: 1, x: 0, y: 0, z: 0, chain: "A", resName: "ALA" },
        { name: "CA", resSeq: 5, x: 3.5, y: 0, z: 0, chain: "A", resName: "ALA" }
      ];
      const contacts = calculateContacts(atoms, 1, "A", 4.0);
      expect(contacts.has(5)).toBe(true);
    });

    it("should compute H-bonds for polar donor-acceptors within distance", () => {
      const atoms: PdbAtom[] = [
        { name: "N", resSeq: 1, x: 0, y: 0, z: 0, chain: "A", resName: "ALA" },
        { name: "O", resSeq: 5, x: 2.8, y: 0, z: 0, chain: "A", resName: "ALA" }
      ];
      const hbonds = calculateHBonds(atoms, 1, "A", 3.5);
      expect(hbonds.has(5)).toBe(true);
    });
  });

  describe("calculateChi1Deviation", () => {
    it("should compute correct dihedral deviations handling wrap-around", () => {
      // 0 vs 90 -> 90
      expect(calculateChi1Deviation(0, 90)).toBeCloseTo(90, 4);
      // -170 vs 170 -> 20
      expect(calculateChi1Deviation(-170, 170)).toBeCloseTo(20, 4);
      // null checks
      expect(calculateChi1Deviation(null, 10)).toBe(null);
      expect(calculateChi1Deviation(20, null)).toBe(null);
    });
  });

  describe("getKabschTransform", () => {
    it("should compute translation and rotation vectors correctly", () => {
      // Use 4 asymmetric points to ensure stable Jacobi convergence
      const p = [
        { x: 0.1, y: 0.2, z: 0.3 },
        { x: 1.5, y: 0.1, z: 0.2 },
        { x: 0.3, y: 2.4, z: 0.1 },
        { x: 0.2, y: 0.3, z: 3.2 }
      ];
      // exact match should yield correct centroid coordinates and identity rotation
      const transform = getKabschTransform(p, p);
      expect(transform.centroidRef.x).toBeCloseTo(0.525, 3);
      expect(transform.centroidTarget.x).toBeCloseTo(0.525, 3);
      expect(transform.R[0][0]).toBeCloseTo(1, 4);
      expect(transform.R[1][1]).toBeCloseTo(1, 4);
      expect(transform.R[2][2]).toBeCloseTo(1, 4);
    });
  });

  describe("alignMutantToWt", () => {
    const dummyWtPdb = [
      "ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 20.00           N",
      "ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00 20.00           C",
      "ATOM      3  C   ALA A   1       2.000   1.400   0.000  1.00 20.00           C",
      "ATOM      4  O   ALA A   1       1.200   2.300   0.000  1.00 20.00           O",
      "ATOM      5  N   VAL A   2       3.300   1.500   0.000  1.00 20.00           N",
      "ATOM      6  CA  VAL A   2       4.000   2.800   0.000  1.00 20.00           C",
      "ATOM      7  N   GLY A   3       5.200   3.000   0.000  1.00 20.00           N",
      "ATOM      8  CA  GLY A   3       6.000   4.200   0.000  1.00 20.00           C",
      "ATOM      9  N   SER A   4       7.100   4.500   0.000  1.00 20.00           N",
      "ATOM     10  CA  SER A   4       8.000   5.600   0.000  1.00 20.00           C"
    ].join("\n");

    // Mutant with chain B and shifted coordinates
    const dummyMutPdbChainB = [
      "ATOM      1  N   ALA B   1       0.500   0.000   0.000  1.00 20.00           N",
      "ATOM      2  CA  ALA B   1       1.958   0.000   0.000  1.00 20.00           C",
      "ATOM      3  C   ALA B   1       2.500   1.400   0.000  1.00 20.00           C",
      "ATOM      4  O   ALA B   1       1.700   2.300   0.000  1.00 20.00           O",
      "ATOM      5  N   LEU B   2       3.800   1.500   0.000  1.00 20.00           N",
      "ATOM      6  CA  LEU B   2       4.500   2.800   0.000  1.00 20.00           C",
      "ATOM      7  N   GLY B   3       5.700   3.000   0.000  1.00 20.00           N",
      "ATOM      8  CA  GLY B   3       6.500   4.200   0.000  1.00 20.00           C",
      "ATOM      9  N   SER B   4       7.600   4.500   0.000  1.00 20.00           N",
      "ATOM     10  CA  SER B   4       8.500   5.600   0.000  1.00 20.00           C"
    ].join("\n");

    it("should align successfully across differing chains (chain A vs B) without null dereference", async () => {
      const result = await alignMutantToWt(dummyWtPdb, dummyMutPdbChainB, 2, "A", "local");
      expect(result.alignedMutPdb).toContain("ATOM");
      expect(result.globalRmsd).toBeGreaterThanOrEqual(0);
      expect(result.alignmentScope).toBe("local");
      expect(result.displacements.length).toBeGreaterThan(0);
    });

    it("reports a whole-chain fit when a local fit has too few Cα pairs", async () => {
      // Three residues: below the four pairs a local fit needs, so the whole chain is fitted.
      const wt = dummyWtPdb.split("\n").slice(0, 8).join("\n");
      const mut = dummyMutPdbChainB.split("\n").slice(0, 8).join("\n");
      const result = await alignMutantToWt(wt, mut, 2, "A", "local");
      expect(result.alignmentScope).toBe("global");
    });

    it("should support global alignment scope without crashing", async () => {
      const result = await alignMutantToWt(dummyWtPdb, dummyMutPdbChainB, 2, "A", "global");
      expect(result.alignmentScope).toBe("global");
      expect(result.globalRmsd).toBeGreaterThanOrEqual(0);
    });
  });
});

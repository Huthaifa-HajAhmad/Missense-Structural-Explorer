import { describe, it, expect } from "vitest";
import { 
  svd3, 
  getVdwRadius, 
  calculateClashes, 
  calculateContacts, 
  calculateHBonds, 
  calculateChi1Deviation,
  getKabschTransform
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
});

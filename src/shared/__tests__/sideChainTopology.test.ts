import { describe, expect, it } from "vitest";
import { SIDE_CHAIN_TOPOLOGY, diffSideChains } from "../sideChainTopology";

/** Side-chain heavy atoms (beyond N, CA, C, O) in the standard residue definitions. */
const HEAVY_ATOMS: Record<string, number> = {
  G: 0, A: 1, S: 2, C: 2, V: 3, T: 3, P: 3, L: 4, I: 4, M: 4,
  F: 7, Y: 8, W: 10, H: 6, D: 4, E: 5, N: 4, Q: 5, K: 5, R: 7,
};

describe("side-chain topology", () => {
  it("has the standard heavy-atom count for all 20 residues", () => {
    for (const [code, count] of Object.entries(HEAVY_ATOMS)) {
      expect(SIDE_CHAIN_TOPOLOGY[code].atoms.length, code).toBe(count);
    }
    expect(Object.keys(SIDE_CHAIN_TOPOLOGY).sort()).toEqual(Object.keys(HEAVY_ATOMS).sort());
  });

  it("only bonds atoms that exist, and connects every atom to the backbone", () => {
    for (const [code, residue] of Object.entries(SIDE_CHAIN_TOPOLOGY)) {
      const names = new Set(["N", "CA", ...residue.atoms.map(a => a.name)]);
      expect(new Set(residue.atoms.map(a => a.name)).size, `${code} unique names`).toBe(residue.atoms.length);
      for (const [a, b] of residue.bonds) {
        expect(names.has(a) && names.has(b), `${code} ${a}-${b}`).toBe(true);
      }
      // Walk the bond graph from CA: every side-chain atom must be reachable.
      const seen = new Set(["CA"]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const [a, b] of residue.bonds) {
          if (seen.has(a) !== seen.has(b)) {
            seen.add(a);
            seen.add(b);
            grew = true;
          }
        }
      }
      for (const atom of residue.atoms) expect(seen.has(atom.name), `${code} ${atom.name} reachable`).toBe(true);
    }
  });

  it("keeps atoms in a bond at a sensible length", () => {
    for (const [code, residue] of Object.entries(SIDE_CHAIN_TOPOLOGY)) {
      const at = new Map<string, { x: number; y: number }>([["N", { x: -0.87, y: -0.5 }], ["CA", { x: 0, y: 0 }]]);
      for (const a of residue.atoms) at.set(a.name, a);
      for (const [a, b] of residue.bonds) {
        const d = Math.hypot(at.get(a)!.x - at.get(b)!.x, at.get(a)!.y - at.get(b)!.y);
        expect(d, `${code} ${a}-${b}`).toBeGreaterThan(0.7);
        expect(d, `${code} ${a}-${b}`).toBeLessThan(1.35);
      }
    }
  });
});

describe("diffSideChains", () => {
  it("Ala to Val keeps CB and gains CG1 and CG2", () => {
    const diff = diffSideChains("A", "V")!;
    expect(diff.kept).toEqual(["CB"]);
    expect(diff.lost).toEqual([]);
    expect(diff.gained).toEqual(["CG1", "CG2"]);
    expect(diff.summary).toBe("CB kept; CG1 and CG2 gained");
    expect(diff.wildType.atoms.find(a => a.name === "CB")!.status).toBe("kept");
    expect(diff.mutant.atoms.find(a => a.name === "CG1")!.status).toBe("gained");
  });

  it("Asp to Gly loses every side-chain atom and keeps none", () => {
    const diff = diffSideChains("D", "G")!;
    expect(diff.lost).toEqual(["CB", "CG", "OD1", "OD2"]);
    expect(diff.kept).toEqual([]);
    expect(diff.gained).toEqual([]);
    expect(diff.summary).toBe("CB, CG, OD1 and OD2 lost");
    expect(diff.mutant.atoms).toEqual([]);
    expect(diff.wildType.atoms.every(a => a.status === "lost")).toBe(true);
  });

  it("matches on atom name and element, so Asp to Asn swaps OD2 for ND2", () => {
    const diff = diffSideChains("D", "N")!;
    expect(diff.kept).toEqual(["CB", "CG", "OD1"]);
    expect(diff.lost).toEqual(["OD2"]);
    expect(diff.gained).toEqual(["ND2"]);
  });

  it("marks a bond lost or gained when either end changed", () => {
    const diff = diffSideChains("A", "V")!;
    expect(diff.mutant.bonds.find(b => b.b === "CG1")!.status).toBe("gained");
    expect(diff.mutant.bonds.find(b => b.b === "CB" && b.a === "CA")!.status).toBe("kept");
  });

  it("shares one coordinate frame between the two glyphs", () => {
    const diff = diffSideChains("A", "W")!;
    expect(diff.bounds.maxX).toBeGreaterThan(3);
    expect(diff.bounds.minX).toBeLessThanOrEqual(-0.87);
  });

  it("returns null for an identical pair or a non-standard code", () => {
    expect(diffSideChains("A", "A")).toBeNull();
    expect(diffSideChains("A", "X")).toBeNull();
    expect(diffSideChains("", "V")).toBeNull();
  });
});

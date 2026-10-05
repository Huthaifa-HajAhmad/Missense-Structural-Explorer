import { describe, expect, it } from "vitest";
import { selectPocketForResidue, type SelectablePocket } from "./selection.ts";
import type { PdbAtom } from "../pdb-parser.ts";

function atom(chain: string, resSeq: number, x: number, y = 0, z = 0): PdbAtom {
  return { chain, resSeq, resName: "ALA", name: "CA", x, y, z };
}

function pocket(id: number, residueKeys: string[], cavityCentre?: { x: number; y: number; z: number }): SelectablePocket {
  return {
    id,
    residueKeys,
    residueIndices: residueKeys.map(k => parseInt(k.split("_")[1], 10)),
    cavityCentre,
  };
}

const variant = { x: 0, y: 0, z: 0 };

describe("selectPocketForResidue", () => {
  it("prefers a pocket the variant residue lines, on its own chain", () => {
    const atoms = [atom("A", 5, 0), atom("A", 10, 30), atom("A", 20, 3)];
    const pockets = [pocket(1, ["A_20"], { x: 3, y: 0, z: 0 }), pocket(2, ["A_5", "A_10"], { x: 15, y: 0, z: 0 })];
    expect(selectPocketForResidue(pockets, atoms, variant, 5, "A")?.id).toBe(2);
  });

  it("picks the nearest pocket by the cavity centre, the distance the screen prints and bands", () => {
    // Pocket 1's residues average close to the variant (centroid at 6 Å) but its cavity centre is
    // 20 Å away; pocket 2's residues average 10 Å away while its centre is 8 Å away. The old rule
    // chose pocket 1 by residue centroid and then printed 20 Å "to the nearest pocket".
    const atoms = [atom("A", 30, 2), atom("A", 31, 10), atom("A", 40, 9), atom("A", 41, 11)];
    const pockets = [
      pocket(1, ["A_30", "A_31"], { x: 20, y: 0, z: 0 }),
      pocket(2, ["A_40", "A_41"], { x: 8, y: 0, z: 0 }),
    ];
    expect(selectPocketForResidue(pockets, atoms, variant, 5, "A")?.id).toBe(2);
  });

  it("falls back to the residue centroid only for pockets without a reported centre", () => {
    const atoms = [atom("A", 30, 4), atom("A", 40, 12)];
    const pockets = [pocket(1, ["A_30"]), pocket(2, ["A_40"])];
    expect(selectPocketForResidue(pockets, atoms, variant, 5, "A")?.id).toBe(1);
  });

  it("returns null when there is no pocket", () => {
    expect(selectPocketForResidue([], [], variant, 5, "A")).toBeNull();
  });
});

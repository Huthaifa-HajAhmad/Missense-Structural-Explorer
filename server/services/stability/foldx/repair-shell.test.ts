import { describe, expect, it } from "vitest";
import { planFixShell } from "./repair-shell.ts";

/** One column-exact ATOM line: the parser reads fixed offsets, like a real PDB file. */
function atom(serial: number, name: string, resName: string, chain: string, resSeq: number, x: number, insCode = " "): string {
  const atomField = name.length < 4 ? ` ${name}`.padEnd(4) : name;
  return (
    "ATOM  " + String(serial).padStart(5) + " " + atomField + " " + resName.padStart(3) + " " + chain +
    String(resSeq).padStart(4) + insCode + "   " +
    x.toFixed(3).padStart(8) + (0).toFixed(3).padStart(8) + (0).toFixed(3).padStart(8) + "  1.00 50.00"
  );
}

/** Residues along the x axis: `[chain, resSeq, x]`, one CA each, all alanine. */
function line(residues: Array<[string, number, number]>): string {
  return residues.map(([chain, resSeq, x], i) => atom(i + 1, "CA", "ALA", chain, resSeq, x)).join("\n");
}

const ids = (file: string | null) => (file ?? "").replace(/;$/, "").split(",").filter(Boolean);
const target = (resSeq: number, chain = "A", insCode = "") => ({ chain, resSeq, insCode });

describe("planFixShell", () => {
  it("lets a residue move when any heavy atom is within 15 Å, and not beyond", () => {
    const pdb = line([["A", 1, 0], ["A", 20, 14.9], ["A", 40, 15.0], ["A", 60, 15.1], ["A", 80, 100]]);
    const plan = planFixShell(pdb, target(1))!;
    // 1 (the variant), 20 (14.9 Å) and 40 (exactly 15 Å) may move; 60 and 80 are fixed.
    expect(ids(plan.fixResiduesFile)).toEqual(["AA60", "AA80"]);
    expect(plan.summary).toMatchObject({ sphereResidues: 3, totalResidues: 5 });
  });

  it("always lets the residues just before and after the variant move, however far they sit", () => {
    // 30 residues close to the variant keep the sphere at 25 or more, so no sequence buffer helps residue 12.
    const crowd = Array.from({ length: 30 }, (_, i) => ["A", 100 + i, i * 0.5] as [string, number, number]);
    const pdb = line([["A", 9, 500], ["A", 10, 0], ["A", 11, -500], ["A", 12, 900], ...crowd]);
    const plan = planFixShell(pdb, target(10))!;
    expect(plan.summary.sequenceBufferApplied).toBe(false);
    expect(ids(plan.fixResiduesFile)).toEqual(["AA12"]);
  });

  it("adds 14 residue numbers each side when the sphere holds fewer than 25 residues", () => {
    // 60 residues 30 Å apart: only the variant and its two sequence neighbours are in the sphere.
    const pdb = line(Array.from({ length: 60 }, (_, i) => ["A", i + 1, i * 30] as [string, number, number]));
    const plan = planFixShell(pdb, target(30))!;
    expect(plan.summary).toMatchObject({ sphereResidues: 3, movableResidues: 29, sequenceBufferApplied: true });
    const fixed = new Set(ids(plan.fixResiduesFile));
    expect(fixed.has("AA16")).toBe(false); // 30 - 14
    expect(fixed.has("AA44")).toBe(false); // 30 + 14
    expect(fixed.has("AA15")).toBe(true);
    expect(fixed.has("AA45")).toBe(true);
  });

  it("does not add the sequence buffer once the sphere holds 25 residues", () => {
    // 60 residues 0.5 Å apart: all inside 15 Å of the variant.
    const pdb = line(Array.from({ length: 60 }, (_, i) => ["A", i + 1, i * 0.5] as [string, number, number]));
    const plan = planFixShell(pdb, target(1))!;
    expect(plan.summary.sequenceBufferApplied).toBe(false);
    expect(plan.summary.sphereResidues).toBe(plan.summary.movableResidues);
  });

  it("counts a residue of another chain in the sphere, and applies the buffer to the variant's chain only", () => {
    const pdb = line([["A", 1, 0], ["B", 1, 5], ["A", 12, 200], ["B", 12, 200], ["A", 40, 300]]);
    const plan = planFixShell(pdb, target(1, "A"))!;
    expect(plan.summary.sequenceBufferApplied).toBe(true);
    // B1 is close, so it moves; A12 is within 14 numbers on the variant's chain, so it moves too.
    // B12 is far in space and on another chain, so the buffer does not reach it.
    expect(ids(plan.fixResiduesFile)).toEqual(["AB12", "AA40"]);
  });

  it("names a residue with an insertion code the way FoldX does, and finds the variant by it", () => {
    const pdb = [
      atom(1, "CA", "ALA", "A", 10, 0),
      atom(2, "CA", "GLY", "A", 10, 400, "A"),
      atom(3, "CA", "SER", "A", 70, 405),
      atom(4, "CA", "THR", "A", 70, 900, "A")
    ].join("\n");
    // Residue 10 and residue 10A are different residues. Next to 10A sits residue 70, so it may move there...
    expect(ids(planFixShell(pdb, target(10, "A", "A"))!.fixResiduesFile)).toEqual(["TA70A"]);
    // ...and next to 10 nothing does: 70 is fixed, and 70A is written with its insertion code.
    expect(ids(planFixShell(pdb, target(10, "A", ""))!.fixResiduesFile)).toEqual(["SA70", "TA70A"]);
  });

  it("ignores hydrogens when measuring distance", () => {
    const pdb = [
      atom(1, "CA", "ALA", "A", 1, 0),
      atom(2, "CA", "ALA", "A", 50, 100),
      atom(3, "H", "ALA", "A", 50, 1) // a hydrogen next to the variant must not pull residue 50 in
    ].join("\n");
    expect(ids(planFixShell(pdb, target(1))!.fixResiduesFile)).toEqual(["AA50"]);
  });

  it("leaves a residue FoldX has no one-letter code for out of the file", () => {
    const pdb = [atom(1, "CA", "ALA", "A", 1, 0), atom(2, "CA", "ALA", "A", 90, 500), atom(3, "CA", "XYZ", "A", 91, 500)].join("\n");
    expect(ids(planFixShell(pdb, target(1))!.fixResiduesFile)).toEqual(["AA90"]);
  });

  it("returns no file when every residue may move, and null for a residue that is not there", () => {
    const pdb = line([["A", 1, 0], ["A", 2, 1], ["A", 3, 2]]);
    expect(planFixShell(pdb, target(2))!.fixResiduesFile).toBeNull();
    expect(planFixShell(pdb, target(99))).toBeNull();
  });

  it("is the same on every call: the file lists residues in the order of the structure", () => {
    const pdb = line(Array.from({ length: 40 }, (_, i) => ["A", i + 1, i * 40] as [string, number, number]));
    const a = planFixShell(pdb, target(20))!;
    const b = planFixShell(pdb, target(20))!;
    expect(a).toEqual(b);
    expect(a.fixResiduesFile!.endsWith(";")).toBe(true);
    const numbers = ids(a.fixResiduesFile).map(id => parseInt(id.slice(2), 10));
    expect(numbers).toEqual([...numbers].sort((x, y) => x - y));
  });
});

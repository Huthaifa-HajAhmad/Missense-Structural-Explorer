import { describe, expect, it } from "vitest";
import {
  classifySecondaryFlags,
  describeSecondarySource,
  formatSecondaryAt,
  secondaryAt,
  segmentsFromResidues,
  summariseSecondary,
  type ModelSecondary,
} from "../structureSecondary";

// Mol* SecondaryStructureType.Flag values.
const F = { helix: 2, beta: 4, bend: 8, turn: 16, alpha: 4096, h310: 2048, pi: 32768, strand: 4194304, sheet: 8388608 };

describe("classifySecondaryFlags", () => {
  it("follows Mol*'s colour-theme order, so the rail's word is the drawn colour", () => {
    expect(classifySecondaryFlags(F.helix | F.alpha)).toBe("alpha-helix");
    expect(classifySecondaryFlags(F.helix | F.h310)).toBe("310-helix");
    expect(classifySecondaryFlags(F.helix | F.pi)).toBe("pi-helix");
    expect(classifySecondaryFlags(F.beta | F.sheet)).toBe("strand");
    expect(classifySecondaryFlags(F.bend)).toBe("bend");
    expect(classifySecondaryFlags(F.turn)).toBe("turn");
    expect(classifySecondaryFlags(0)).toBe("coil");
  });

  it("lets a helix flag win over a turn flag on the same residue, as the cartoon does", () => {
    // Bare `Helix` with no class flag: Mol* draws it with the α-helix colour, but the entry did not name
    // the class, so the rail must not claim i→i+4.
    expect(classifySecondaryFlags(F.helix | F.turn)).toBe("helix-other");
    expect(classifySecondaryFlags(F.bend | F.turn)).toBe("bend");
  });

  it("separates a DSSP β-bridge from a strand in a sheet", () => {
    expect(classifySecondaryFlags(F.beta | F.strand)).toBe("beta-bridge");
    expect(classifySecondaryFlags(F.beta | F.sheet)).toBe("strand");
    expect(classifySecondaryFlags(F.beta)).toBe("strand");
  });

  it("names a helix class the entry did not spell out as unnamed, not as α", () => {
    expect(classifySecondaryFlags(F.helix | 16384)).toBe("helix-other"); // ω-helix
    expect(classifySecondaryFlags(F.helix | 65536)).toBe("helix-other"); // polyproline
  });
});

describe("segmentsFromResidues", () => {
  it("merges runs and splits at a class change and at a numbering gap", () => {
    const residues = [
      { position: 3, cls: "alpha-helix" as const },
      { position: 1, cls: "alpha-helix" as const },
      { position: 2, cls: "alpha-helix" as const },
      { position: 4, cls: "coil" as const },
      { position: 6, cls: "coil" as const },
    ];
    expect(segmentsFromResidues(residues)).toEqual([
      { cls: "alpha-helix", start: 1, end: 3 },
      { cls: "coil", start: 4, end: 4 },
      { cls: "coil", start: 6, end: 6 },
    ]);
  });
});

const MODEL: ModelSecondary = {
  source: "dssp",
  chain: "A",
  residueCount: 20,
  segments: [
    { cls: "coil", start: 1, end: 4 },
    { cls: "alpha-helix", start: 5, end: 14 },
    { cls: "turn", start: 15, end: 16 },
    { cls: "strand", start: 17, end: 20 },
  ],
};

describe("reading one residue", () => {
  it("places the residue inside its element", () => {
    const at = secondaryAt(MODEL, 9)!;
    expect(at).toMatchObject({ index: 5, length: 10 });
    expect(formatSecondaryAt(at)).toBe("α-helix 5–14 · residue 5 of 10");
    expect(formatSecondaryAt(secondaryAt(MODEL, 2)!)).toBe("Coil 1–4");
  });

  it("returns null outside the drawn residues and without a model", () => {
    expect(secondaryAt(MODEL, 25)).toBeNull();
    expect(secondaryAt(null, 9)).toBeNull();
  });
});

describe("summariseSecondary", () => {
  it("counts elements and residue shares; turns count as neither helix nor strand", () => {
    expect(summariseSecondary(MODEL)).toEqual({ helices: 1, strands: 1, helixFraction: 0.5, strandFraction: 0.2, coilFraction: expect.closeTo(0.3) });
  });

  it("names the method and the structure it ran on", () => {
    expect(describeSecondarySource("dssp", "AF-P1-F1 v6")).toBe("DSSP (Kabsch & Sander 1983), computed by Mol* on AF-P1-F1 v6.");
    expect(describeSecondarySource("file", "PDB 1ABC")).toBe("The HELIX/SHEET records deposited with PDB 1ABC.");
  });

  it("never names a method when nothing was read", () => {
    expect(describeSecondarySource(null, "PDB 1ABC")).toBe("No secondary-structure assignment has been read from PDB 1ABC.");
    expect(describeSecondarySource(undefined, null)).not.toMatch(/DSSP|HELIX/);
  });
});

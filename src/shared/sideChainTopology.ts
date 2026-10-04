/**
 * sideChainTopology.ts — 2D skeletal side chains for the 20 standard residues, and the diff
 * between two of them.
 *
 * What this is: pure chemical topology (heavy atoms, PDB atom names, bonds) with schematic 2D
 * coordinates, so the Residue shifts tab can draw which side-chain atoms a substitution keeps,
 * loses or gains. It says nothing about THIS protein: no conformation, no packing, no clash.
 *
 * INVARIANTS
 *   - Heavy side-chain atoms only, named as in the PDB standard residue definitions; the count per
 *     residue is pinned in `sideChainTopology.test.ts` (Gly 0 … Trp 10).
 *   - Coordinates are in bond-length units, y up, Cα at the origin, backbone N at (−0.87, −0.5).
 *     They are a drawing, not a structure: ring shapes are regular, not crystallographic.
 *   - An atom is "kept" when the other residue has an atom of the same name AND element. Name
 *     equality is a drawing convention (Asp OD1 and Asn OD1 are the same oxygen position); it is
 *     not a claim about mechanism or about which atom a protein "really" retains.
 *   - Both glyphs share one coordinate frame, so they can be drawn at the same scale.
 *
 * Pure: no React, no fetching.
 */

export interface TopologyAtom {
  name: string;
  element: "C" | "N" | "O" | "S";
  x: number;
  y: number;
}

export interface ResidueTopology {
  atoms: readonly TopologyAtom[];
  /** Bonds between side-chain atoms, and from the first side-chain atom to CA (or N for Pro's ring). */
  bonds: readonly (readonly [string, string])[];
}

const c = (name: string, x: number, y: number): TopologyAtom => ({ name, element: "C", x, y });
const n = (name: string, x: number, y: number): TopologyAtom => ({ name, element: "N", x, y });
const o = (name: string, x: number, y: number): TopologyAtom => ({ name, element: "O", x, y });
const s = (name: string, x: number, y: number): TopologyAtom => ({ name, element: "S", x, y });

/** Backbone anchors drawn in every glyph. */
export const BACKBONE_ANCHORS = {
  N: { x: -0.87, y: -0.5 },
  CA: { x: 0, y: 0 },
} as const;

/** The phenyl ring shared by Phe and Tyr, with CG at the bottom vertex. */
const PHENYL_ATOMS: TopologyAtom[] = [
  c("CB", 0, 1), c("CG", 0.87, 1.5), c("CD1", 1.73, 2.0), c("CD2", 0, 2.0),
  c("CE1", 1.73, 3.0), c("CE2", 0, 3.0), c("CZ", 0.87, 3.5),
];
const PHENYL_BONDS: [string, string][] = [
  ["CA", "CB"], ["CB", "CG"], ["CG", "CD1"], ["CG", "CD2"],
  ["CD1", "CE1"], ["CD2", "CE2"], ["CE1", "CZ"], ["CE2", "CZ"],
];

export const SIDE_CHAIN_TOPOLOGY: Readonly<Record<string, ResidueTopology>> = {
  G: { atoms: [], bonds: [] },
  A: { atoms: [c("CB", 0, 1)], bonds: [["CA", "CB"]] },
  S: { atoms: [c("CB", 0, 1), o("OG", 0.87, 1.5)], bonds: [["CA", "CB"], ["CB", "OG"]] },
  C: { atoms: [c("CB", 0, 1), s("SG", 0.87, 1.5)], bonds: [["CA", "CB"], ["CB", "SG"]] },
  V: {
    atoms: [c("CB", 0, 1), c("CG1", 0.87, 1.5), c("CG2", -0.87, 1.5)],
    bonds: [["CA", "CB"], ["CB", "CG1"], ["CB", "CG2"]],
  },
  T: {
    atoms: [c("CB", 0, 1), o("OG1", 0.87, 1.5), c("CG2", -0.87, 1.5)],
    bonds: [["CA", "CB"], ["CB", "OG1"], ["CB", "CG2"]],
  },
  P: {
    atoms: [c("CB", 0, 1), c("CG", -0.95, 1.31), c("CD", -1.54, 0.5)],
    bonds: [["CA", "CB"], ["CB", "CG"], ["CG", "CD"], ["CD", "N"]],
  },
  L: {
    atoms: [c("CB", 0, 1), c("CG", 0.87, 1.5), c("CD1", 0.87, 2.5), c("CD2", 1.73, 1.0)],
    bonds: [["CA", "CB"], ["CB", "CG"], ["CG", "CD1"], ["CG", "CD2"]],
  },
  I: {
    atoms: [c("CB", 0, 1), c("CG1", 0.87, 1.5), c("CG2", -0.87, 1.5), c("CD1", 0.87, 2.5)],
    bonds: [["CA", "CB"], ["CB", "CG1"], ["CB", "CG2"], ["CG1", "CD1"]],
  },
  M: {
    atoms: [c("CB", 0, 1), c("CG", 0.87, 1.5), s("SD", 0.87, 2.5), c("CE", 0, 3)],
    bonds: [["CA", "CB"], ["CB", "CG"], ["CG", "SD"], ["SD", "CE"]],
  },
  F: { atoms: PHENYL_ATOMS, bonds: PHENYL_BONDS },
  Y: {
    atoms: [...PHENYL_ATOMS, o("OH", 0.87, 4.5)],
    bonds: [...PHENYL_BONDS, ["CZ", "OH"]],
  },
  W: {
    atoms: [
      c("CB", 0, 1), c("CG", 0.65, 1.6), c("CD1", 0.06, 2.4), n("NE1", 0.65, 3.2),
      c("CE2", 1.6, 2.9), c("CD2", 1.6, 1.9), c("CE3", 2.47, 1.4), c("CZ3", 3.33, 1.9),
      c("CH2", 3.33, 2.9), c("CZ2", 2.47, 3.4),
    ],
    bonds: [
      ["CA", "CB"], ["CB", "CG"], ["CG", "CD1"], ["CD1", "NE1"], ["NE1", "CE2"], ["CE2", "CD2"], ["CD2", "CG"],
      ["CD2", "CE3"], ["CE3", "CZ3"], ["CZ3", "CH2"], ["CH2", "CZ2"], ["CZ2", "CE2"],
    ],
  },
  H: {
    atoms: [
      c("CB", 0, 1), c("CG", 0.87, 1.65), n("ND1", 1.68, 2.24), c("CE1", 1.37, 3.19),
      n("NE2", 0.37, 3.19), c("CD2", 0.06, 2.24),
    ],
    bonds: [
      ["CA", "CB"], ["CB", "CG"], ["CG", "ND1"], ["ND1", "CE1"], ["CE1", "NE2"], ["NE2", "CD2"], ["CD2", "CG"],
    ],
  },
  D: {
    atoms: [c("CB", 0, 1), c("CG", 0.87, 1.5), o("OD1", 0.87, 2.5), o("OD2", 1.73, 1.0)],
    bonds: [["CA", "CB"], ["CB", "CG"], ["CG", "OD1"], ["CG", "OD2"]],
  },
  E: {
    atoms: [c("CB", 0, 1), c("CG", 0.87, 1.5), c("CD", 0.87, 2.5), o("OE1", 0, 3), o("OE2", 1.73, 3)],
    bonds: [["CA", "CB"], ["CB", "CG"], ["CG", "CD"], ["CD", "OE1"], ["CD", "OE2"]],
  },
  N: {
    atoms: [c("CB", 0, 1), c("CG", 0.87, 1.5), o("OD1", 0.87, 2.5), n("ND2", 1.73, 1.0)],
    bonds: [["CA", "CB"], ["CB", "CG"], ["CG", "OD1"], ["CG", "ND2"]],
  },
  Q: {
    atoms: [c("CB", 0, 1), c("CG", 0.87, 1.5), c("CD", 0.87, 2.5), o("OE1", 0, 3), n("NE2", 1.73, 3)],
    bonds: [["CA", "CB"], ["CB", "CG"], ["CG", "CD"], ["CD", "OE1"], ["CD", "NE2"]],
  },
  K: {
    atoms: [c("CB", 0, 1), c("CG", 0.87, 1.5), c("CD", 0.87, 2.5), c("CE", 0, 3), n("NZ", 0, 4)],
    bonds: [["CA", "CB"], ["CB", "CG"], ["CG", "CD"], ["CD", "CE"], ["CE", "NZ"]],
  },
  R: {
    atoms: [
      c("CB", 0, 1), c("CG", 0.87, 1.5), c("CD", 0.87, 2.5), n("NE", 0, 3), c("CZ", 0, 4),
      n("NH1", -0.87, 4.5), n("NH2", 0.87, 4.5),
    ],
    bonds: [["CA", "CB"], ["CB", "CG"], ["CG", "CD"], ["CD", "NE"], ["NE", "CZ"], ["CZ", "NH1"], ["CZ", "NH2"]],
  },
};

export type GlyphStatus = "kept" | "lost" | "gained";

export interface GlyphAtom extends TopologyAtom {
  status: GlyphStatus;
}

export interface GlyphBond {
  a: string;
  b: string;
  status: GlyphStatus;
}

export interface SideChainGlyph {
  code: string;
  atoms: GlyphAtom[];
  bonds: GlyphBond[];
}

export interface SideChainDiff {
  wildType: SideChainGlyph;
  mutant: SideChainGlyph;
  kept: string[];
  lost: string[];
  gained: string[];
  /** e.g. "CB kept; CG1 and CG2 gained". */
  summary: string;
  /** One frame for both glyphs, including the backbone anchors. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function buildGlyph(
  code: string,
  topology: ResidueTopology,
  other: ResidueTopology,
  changed: "lost" | "gained"
): SideChainGlyph {
  const otherKeys = new Set(other.atoms.map(a => `${a.name}:${a.element}`));
  const statusOf = new Map<string, GlyphStatus>([["N", "kept"], ["CA", "kept"]]);
  const atoms = topology.atoms.map<GlyphAtom>(atom => {
    const status: GlyphStatus = otherKeys.has(`${atom.name}:${atom.element}`) ? "kept" : changed;
    statusOf.set(atom.name, status);
    return { ...atom, status };
  });
  const bonds = topology.bonds.map<GlyphBond>(([a, b]) => {
    const ends = [statusOf.get(a), statusOf.get(b)];
    const status = ends.find(e => e && e !== "kept") ?? "kept";
    return { a, b, status };
  });
  return { code, atoms, bonds };
}

const THREE_TO_ONE: Readonly<Record<string, string>> = {
  ALA: "A", CYS: "C", ASP: "D", GLU: "E", PHE: "F",
  GLY: "G", HIS: "H", ILE: "I", LYS: "K", LEU: "L",
  MET: "M", ASN: "N", PRO: "P", GLN: "Q", ARG: "R",
  SER: "S", THR: "T", VAL: "V", TRP: "W", TYR: "Y",
};

function normalizeCode(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.length === 1) return trimmed;
  return THREE_TO_ONE[trimmed] ?? trimmed;
}

/**
 * Diff two standard residues. Supports 1-letter and 3-letter codes.
 * Null for an identical pair or a non-standard code, so callers draw
 * nothing rather than a glyph for a residue the table does not hold.
 */
export function diffSideChains(wildTypeCode: string, mutantCode: string): SideChainDiff | null {
  const wt = normalizeCode(wildTypeCode);
  const mut = normalizeCode(mutantCode);
  if (wt === mut || wt.length !== 1 || mut.length !== 1) return null;
  const from = SIDE_CHAIN_TOPOLOGY[wt];
  const to = SIDE_CHAIN_TOPOLOGY[mut];
  if (!from || !to) return null;

  const wildType = buildGlyph(wt, from, to, "lost");
  const mutant = buildGlyph(mut, to, from, "gained");
  const kept = wildType.atoms.filter(a => a.status === "kept").map(a => a.name);
  const lost = wildType.atoms.filter(a => a.status === "lost").map(a => a.name);
  const gained = mutant.atoms.filter(a => a.status === "gained").map(a => a.name);

  const parts = [
    kept.length > 0 ? `${joinNames(kept)} kept` : null,
    lost.length > 0 ? `${joinNames(lost)} lost` : null,
    gained.length > 0 ? `${joinNames(gained)} gained` : null,
  ].filter((part): part is string => part !== null);

  const xs: number[] = [BACKBONE_ANCHORS.N.x, BACKBONE_ANCHORS.CA.x];
  const ys: number[] = [BACKBONE_ANCHORS.N.y, BACKBONE_ANCHORS.CA.y];
  for (const atom of [...from.atoms, ...to.atoms]) {
    xs.push(atom.x);
    ys.push(atom.y);
  }

  return {
    wildType,
    mutant,
    kept,
    lost,
    gained,
    summary: parts.join("; "),
    bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
  };
}

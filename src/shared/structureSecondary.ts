/**
 * structureSecondary.ts — the secondary structure of the model on the canvas, as Mol* assigned it.
 *
 * Mol* gives each residue a bit-flag word. This module turns that word into one class, using the same
 * order as Mol*'s own "secondary-structure" colour theme, so the words in the rail and the colours on
 * the cartoon can never disagree. It then merges consecutive residues into segments.
 *
 * WHERE THE ASSIGNMENT COMES FROM
 *   - A predicted model (AlphaFold DB, ESMFold, a FoldX variant) carries no helix or sheet records.
 *     Mol* computes DSSP on the drawn coordinates (Kabsch & Sander 1983): hydrogen-bond energies
 *     between backbone atoms, not a guess from the sequence.
 *   - Mol* uses the depositors' HELIX/SHEET records only for mmCIF input from the PDB archive. This
 *     app hands Mol* PDB text (`formatOf` in `useMolstarStructure`), and Mol* then computes DSSP even
 *     for a deposited entry; the `file` branch is kept for a future mmCIF loader, not because it runs
 *     today (see `readSecondaryStructure.ts`).
 * The `source` field says which one applied. Nothing here invents a class: when Mol* names a helix
 * class (ω, γ, 2-7, polyproline) or a DSSP β-bridge, the words say exactly that instead of rounding
 * it to α-helix or to a strand in a sheet.
 *
 * Pure: no React, no Mol* import (`src/shared` stays dependency-free).
 */

/**
 * Mol* `SecondaryStructureType.Flag` values (mol-model/structure/model/types).
 *
 * DSSP's own codes map as: H → Helix|HelixAlpha, G → Helix|Helix3Ten, I → Helix|HelixPi,
 * E → Beta|BetaSheet, B → Beta|BetaStrand. Deposited HELIX records carry the named helix class,
 * or bare `Helix` when the entry does not say which class it is.
 */
const FLAG = {
  helix: 2,
  beta: 4,
  bend: 8,
  turn: 16,
  helix27: 1024,
  helix3Ten: 2048,
  helixAlpha: 4096,
  helixGamma: 8192,
  helixOmega: 16384,
  helixPi: 32768,
  helixPolyproline: 65536,
  betaStrand: 4194304,
  betaSheet: 8388608,
} as const;

export type SecondaryClass =
  | "alpha-helix"
  | "310-helix"
  | "pi-helix"
  | "helix-other"
  | "strand"
  | "beta-bridge"
  | "turn"
  | "bend"
  | "coil";

/** `dssp`: computed by Mol* on these coordinates. `file`: the entry's own HELIX/SHEET records. */
export type SecondarySource = "dssp" | "file";

export interface SecondarySegment {
  cls: SecondaryClass;
  start: number;
  end: number;
}

export interface ModelSecondary {
  source: SecondarySource;
  chain: string;
  /** Residues that received a class (protein residues of the first chain). */
  residueCount: number;
  segments: SecondarySegment[];
}

/** Same branch order as Mol*'s `secondaryStructureColor`: helix first, then beta, bend, turn. */
export function classifySecondaryFlags(flags: number): SecondaryClass {
  if (flags & FLAG.helix) {
    if (flags & FLAG.helix3Ten) return "310-helix";
    if (flags & FLAG.helixPi) return "pi-helix";
    if (flags & FLAG.helixAlpha) return "alpha-helix";
    // ω-, γ-, 2-7 and polyproline helices, or a helix whose class the entry does not name. Mol*
    // draws them all with the α-helix colour, so the colour still agrees; only the word is narrower.
    return "helix-other";
  }
  if (flags & FLAG.beta) {
    // DSSP `E` is a strand in a ladder; `B` is an isolated bridge, which has no sheet partner.
    return flags & FLAG.betaStrand ? "beta-bridge" : "strand";
  }
  if (flags & FLAG.bend) return "bend";
  if (flags & FLAG.turn) return "turn";
  return "coil";
}

/** Merges residues into segments. A gap in numbering (missing residues) always ends a segment. */
export function segmentsFromResidues(residues: ReadonlyArray<{ position: number; cls: SecondaryClass }>): SecondarySegment[] {
  const sorted = [...residues].sort((a, b) => a.position - b.position);
  const out: SecondarySegment[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.cls === r.cls && r.position === last.end + 1) last.end = r.position;
    else out.push({ cls: r.cls, start: r.position, end: r.position });
  }
  return out;
}

export const SECONDARY_LABELS: Record<SecondaryClass, string> = {
  "alpha-helix": "α-helix",
  "310-helix": "3-10 helix",
  "pi-helix": "π-helix",
  "helix-other": "Helix (unnamed class)",
  strand: "β-strand",
  "beta-bridge": "β-bridge",
  turn: "Turn",
  bend: "Bend",
  coil: "Coil",
};

/** What each class means, in one line, for the rail and the callout. */
export const SECONDARY_MEANING: Record<SecondaryClass, string> = {
  "alpha-helix": "backbone i→i+4 hydrogen bonds",
  "310-helix": "backbone i→i+3 hydrogen bonds",
  "pi-helix": "backbone i→i+5 hydrogen bonds",
  "helix-other": "a helix whose class the entry does not name",
  strand: "paired with another strand in a sheet",
  "beta-bridge": "an isolated β-bridge, not part of a sheet ladder",
  turn: "a hydrogen-bonded turn, not a repeating element",
  bend: "a sharp change of chain direction, no hydrogen-bond pattern",
  coil: "no helix, strand or turn assigned",
};

/**
 * Colours drawn on the cartoon and keyed in the legend. Passed to Mol* as a custom colour map, so the
 * swatch is the drawn colour. Helix and strand keep the field's convention (warm helix, amber strand);
 * coil is a warm grey that stays visible on the light canvas, where Mol*'s default white disappears.
 *
 * `helix-other` and `beta-bridge` reuse the α-helix and strand colours because Mol*'s theme draws them
 * that way — a distinct colour here would make the rail disagree with the cartoon.
 */
export const SECONDARY_COLOURS: Record<SecondaryClass, number> = {
  "alpha-helix": 0xc2457a,
  "310-helix": 0x9b4f9e,
  "pi-helix": 0x6e4a9e,
  "helix-other": 0xc2457a,
  strand: 0xe0a526,
  "beta-bridge": 0xe0a526,
  turn: 0x2f8f83,
  bend: 0x7fb8ad,
  coil: 0xbdb7ae,
};

/** The classes the legend lists: one entry per drawn colour, so the collapsed classes appear once. */
export const SECONDARY_ORDER: SecondaryClass[] = ["alpha-helix", "310-helix", "pi-helix", "strand", "turn", "bend", "coil"];

export interface SecondaryAt {
  segment: SecondarySegment;
  /** 1-based place of the residue inside its segment. */
  index: number;
  length: number;
}

export function secondaryAt(model: ModelSecondary | null, position: number | null): SecondaryAt | null {
  if (!model || position === null) return null;
  const segment = model.segments.find(s => position >= s.start && position <= s.end);
  return segment ? { segment, index: position - segment.start + 1, length: segment.end - segment.start + 1 } : null;
}

export function isHelix(cls: SecondaryClass): boolean {
  return cls === "alpha-helix" || cls === "310-helix" || cls === "pi-helix" || cls === "helix-other";
}

export interface SecondarySummary {
  /** Helix segments, not residues. A DSSP helix broken by one bend counts as two. */
  helices: number;
  /** Strand segments in a sheet ladder. Isolated β-bridges are not counted. */
  strands: number;
  /** Share of classified residues, 0–1. */
  helixFraction: number;
  strandFraction: number;
  coilFraction: number;
}

/** Counts elements and residue shares. Turns and bends count as neither helix nor strand. */
export function summariseSecondary(model: ModelSecondary): SecondarySummary {
  let helixResidues = 0;
  let strandResidues = 0;
  let helices = 0;
  let strands = 0;
  for (const s of model.segments) {
    const n = s.end - s.start + 1;
    if (isHelix(s.cls)) { helices++; helixResidues += n; }
    else if (s.cls === "strand") { strands++; strandResidues += n; }
  }
  const total = model.residueCount || 1;
  return {
    helices,
    strands,
    helixFraction: helixResidues / total,
    strandFraction: strandResidues / total,
    coilFraction: Math.max(0, 1 - (helixResidues + strandResidues) / total),
  };
}

/**
 * One sentence naming where the assignment came from and what it was computed on. `null` means no
 * assignment has been read — never render that as DSSP.
 */
export function describeSecondarySource(source: SecondarySource | null | undefined, structureName: string | null): string {
  const on = structureName ?? "the structure on the canvas";
  if (source === "dssp") return `DSSP (Kabsch & Sander 1983), computed by Mol* on ${on}.`;
  if (source === "file") return `The HELIX/SHEET records deposited with ${on}.`;
  return `No secondary-structure assignment has been read from ${on}.`;
}

/** "α-helix 142–158 · residue 5 of 17" — the reading the rail and the callouts print. */
export function formatSecondaryAt(at: SecondaryAt): string {
  const label = SECONDARY_LABELS[at.segment.cls];
  if (at.segment.cls === "coil") return at.length > 1 ? `Coil ${at.segment.start}–${at.segment.end}` : "Coil";
  return at.length > 1
    ? `${label} ${at.segment.start}–${at.segment.end} · residue ${at.index} of ${at.length}`
    : `${label} (single residue)`;
}

/** "α-helix 142–158": the callout prints the element, not the position inside it. */
export function formatSecondaryShort(at: SecondaryAt): string {
  const label = SECONDARY_LABELS[at.segment.cls];
  if (at.segment.cls === "coil") return at.length > 1 ? `Coil ${at.segment.start}–${at.segment.end}` : "Coil";
  return at.length > 1 ? `${label} ${at.segment.start}–${at.segment.end}` : `${label} (single residue)`;
}

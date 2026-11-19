/**
 * How usable one experimental chain is AT the variant, and the fixed order in which chains are preferred.
 *
 * The rule is written down in doc/energetics-release/STRUCTURE_SELECTION_RULE.md and was fixed before any
 * FoldX value under it was seen. PDBe's own ranking is for the protein as a whole; FoldX needs the residues
 * around the variant to be present. A chain where most side chains are missing (TP53 9R2Q:K: 165 of 200)
 * cannot be repaired in time and gave +15 kcal/mol.
 */

const BACKBONE = ["N", "CA", "C", "O"] as const;

/** Heavy side-chain atoms each residue type should have (glycine has none). */
const SIDE_CHAIN: Record<string, readonly string[]> = {
  ALA: ["CB"], ARG: ["CB", "CG", "CD", "NE", "CZ", "NH1", "NH2"], ASN: ["CB", "CG", "OD1", "ND2"],
  ASP: ["CB", "CG", "OD1", "OD2"], CYS: ["CB", "SG"], GLN: ["CB", "CG", "CD", "OE1", "NE2"],
  GLU: ["CB", "CG", "CD", "OE1", "OE2"], GLY: [], HIS: ["CB", "CG", "ND1", "CD2", "CE1", "NE2"],
  ILE: ["CB", "CG1", "CG2", "CD1"], LEU: ["CB", "CG", "CD1", "CD2"], LYS: ["CB", "CG", "CD", "CE", "NZ"],
  MET: ["CB", "CG", "SD", "CE"], PHE: ["CB", "CG", "CD1", "CD2", "CE1", "CE2", "CZ"], PRO: ["CB", "CG", "CD"],
  SER: ["CB", "OG"], THR: ["CB", "OG1", "CG2"], TRP: ["CB", "CG", "CD1", "CD2", "NE1", "CE2", "CE3", "CZ2", "CZ3", "CH2"],
  TYR: ["CB", "CG", "CD1", "CD2", "CE1", "CE2", "CZ", "OH"], VAL: ["CB", "CG1", "CG2"],
};

const ONE_LETTER: Record<string, string> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
  LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V",
};

/** Within this distance of the target's CA (Å) a residue is part of its neighbourhood. */
const NEIGHBOUR_CA_DISTANCE = 8;
/** Share of complete neighbours a chain needs to count as locally complete. */
const NEIGHBOUR_MARK = 0.9;

interface Residue {
  name: string;
  atoms: Map<string, [number, number, number]>;
}

/** Residues of one chain, keyed by residue number (insertion codes kept apart), first alternate location only. */
function readChain(pdbText: string, chainId: string): Map<string, Residue> {
  const residues = new Map<string, Residue>();
  for (const line of pdbText.split("\n")) {
    if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) continue;
    if (line.charAt(21) !== chainId) continue;
    const element = line.substring(76, 78).trim().toUpperCase();
    let atomName = line.substring(12, 16).trim();
    if (element === "H" || element === "D" || (!element && /^[HD]/.test(atomName))) continue;
    const occupancy = Number(line.substring(54, 60));
    if (line.substring(54, 60).trim() && !(occupancy > 0)) continue;
    let resName = line.substring(17, 20).trim();
    if (resName === "MSE") { resName = "MET"; if (atomName === "SE") atomName = "SD"; }
    if (!SIDE_CHAIN[resName]) continue;
    const key = line.substring(22, 27).trim();
    const res = residues.get(key) ?? { name: resName, atoms: new Map() };
    if (!res.atoms.has(atomName)) {
      res.atoms.set(atomName, [Number(line.substring(30, 38)), Number(line.substring(38, 46)), Number(line.substring(46, 54))]);
    }
    residues.set(key, res);
  }
  return residues;
}

const isComplete = (res: Residue) => [...BACKBONE, ...SIDE_CHAIN[res.name]].every(a => res.atoms.has(a));
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface LocalQuality {
  targetComplete: boolean;
  /** Share of complete residues within 8 Å (CA to CA) of the target, or null when there are none. */
  neighbourFraction: number | null;
  meetsNeighbourMark: boolean;
}

/**
 * Local quality of a UniProt-numbered chain at `position`, or null when the chain is not eligible: the
 * residue there is missing, is not the wild type `wildType` (one letter), or lacks part of its backbone.
 */
export function scoreLocalQuality(pdbText: string, chainId: string, position: number, wildType: string): LocalQuality | null {
  const residues = readChain(pdbText, chainId);
  const target = residues.get(String(position));
  if (!target || ONE_LETTER[target.name] !== wildType.toUpperCase()) return null;
  if (!BACKBONE.every(a => target.atoms.has(a))) return null;
  const ca = target.atoms.get("CA")!;
  const neighbours = [...residues.entries()].filter(([key, r]) => key !== String(position) && r.atoms.has("CA") && distance(r.atoms.get("CA")!, ca) <= NEIGHBOUR_CA_DISTANCE);
  const neighbourFraction = neighbours.length ? neighbours.filter(([, r]) => isComplete(r)).length / neighbours.length : null;
  return {
    targetComplete: isComplete(target),
    neighbourFraction,
    meetsNeighbourMark: neighbourFraction !== null && neighbourFraction >= NEIGHBOUR_MARK,
  };
}

export interface ChainCandidate extends LocalQuality {
  pdbId: string;
  chainId: string;
  resolution: number | null;
  coverage: number | null;
}

/** Fixed preference order: a negative result means `a` is preferred. Ties end on PDB ID, then chain ID. */
export function compareChainCandidates(a: ChainCandidate, b: ChainCandidate): number {
  const flag = (x: boolean) => (x ? 0 : 1);
  const res = (x: number | null) => (x === null || !Number.isFinite(x) ? Number.POSITIVE_INFINITY : x);
  return flag(a.targetComplete) - flag(b.targetComplete)
    || flag(a.meetsNeighbourMark) - flag(b.meetsNeighbourMark)
    || res(a.resolution) - res(b.resolution)
    || (b.neighbourFraction ?? -1) - (a.neighbourFraction ?? -1)
    || (b.coverage ?? -1) - (a.coverage ?? -1)
    || (a.pdbId < b.pdbId ? -1 : a.pdbId > b.pdbId ? 1 : 0)
    || (a.chainId < b.chainId ? -1 : a.chainId > b.chainId ? 1 : 0);
}

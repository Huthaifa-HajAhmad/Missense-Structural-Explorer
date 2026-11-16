import { type PdbAtom } from "../pdb-parser.ts";
import { getAaPropensities } from "./propensities.ts";

export type Point = { x: number; y: number; z: number };

export function centroidOf(atoms: PdbAtom[]): Point {
  let x = 0, y = 0, z = 0;
  for (const a of atoms) { x += a.x; y += a.y; z += a.z; }
  return { x: x / atoms.length, y: y / atoms.length, z: z / atoms.length };
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2));
}

export const round2 = (value: number): number => parseFloat(value.toFixed(2));

/**
 * Describe the selected pocket's lining residues: per-residue centroid distance to the variant
 * and curated propensity role, nearest first. Shared by the P2Rank and fpocket paths.
 */
export function describePocketResidues(residueKeys: string[], atoms: PdbAtom[], mut: Point): any[] {
  const pocketResiduesMap: Record<string, any> = {};
  const propensities = getAaPropensities();

  const atomsByResKey = new Map<string, PdbAtom[]>();
  for (const a of atoms) {
    const key = `${a.chain}_${a.resSeq}`;
    const list = atomsByResKey.get(key) || [];
    list.push(a);
    atomsByResKey.set(key, list);
  }

  for (const rKey of residueKeys) {
    const resAtoms = atomsByResKey.get(rKey) || [];
    if (resAtoms.length > 0) {
      const distance = distanceBetween(centroidOf(resAtoms), mut);
      const resName = resAtoms[0].resName;
      const prop = propensities[resName] || { weight: 1.0, role: "Backbone structural spacer", type: "Aliphatic" };

      const parts = rKey.split("_");
      const rIndex = parseInt(parts[parts.length - 1], 10);

      pocketResiduesMap[rKey] = {
        index: rIndex,
        chain: parts[0],
        name: resName,
        distance: round2(distance),
        score: prop.weight,
        role: prop.role,
        type: prop.type
      };
    }
  }

  const pocketResidues = Object.values(pocketResiduesMap);
  // Nearest the variant residue first. This used to sort by a hand-set residue
  // "propensity" weight, so the client's "top 8" had no stated order.
  pocketResidues.sort((a, b) => a.distance - b.distance);
  return pocketResidues;
}

/** Distance from the variant residue to the centroid of the pocket's atoms, or null when it has none. */
export function pocketCentroidDistance(residueKeys: string[], atoms: PdbAtom[], mut: Point): number | null {
  const pAtoms = atoms.filter(a => residueKeys.includes(`${a.chain}_${a.resSeq}`));
  return pAtoms.length === 0 ? null : round2(distanceBetween(centroidOf(pAtoms), mut));
}

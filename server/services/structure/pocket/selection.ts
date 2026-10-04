/**
 * Which predicted pocket a variant residue is reported against.
 *
 * Why this module exists: the runner used to pick the "nearest" pocket by the distance from the
 * variant residue to the centroid of each pocket's residue atoms, and then report, print and band
 * (4/8/12 Å) the distance to P2Rank's own cavity centre. The two measures disagree for large or
 * elongated pockets, so the tab could print "22.6 Å from the nearest predicted pocket" for a pocket
 * that was not nearest by 22.6 Å's own measure. Selection now uses the measure that is displayed.
 *
 * INVARIANTS
 *   - A pocket the variant residue lines wins (chain-qualified key first, then index only).
 *   - Otherwise the nearest cavity centre wins; the residue-atom centroid is used only for a
 *     pocket with no reported centre (fpocket, or an older P2Rank CSV).
 *   - Pure: no I/O.
 */

import type { PdbAtom } from "../pdb-parser.ts";

export interface SelectablePocket {
  id: number;
  residueKeys: string[];
  residueIndices: number[];
  cavityCentre?: { x: number; y: number; z: number };
}

type Point = { x: number; y: number; z: number };

function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function residueAtomCentroid(pocket: SelectablePocket, atoms: readonly PdbAtom[]): Point | null {
  const keys = new Set(pocket.residueKeys);
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (const a of atoms) {
    if (!keys.has(`${a.chain}_${a.resSeq}`)) continue;
    sx += a.x;
    sy += a.y;
    sz += a.z;
    n += 1;
  }
  return n > 0 ? { x: sx / n, y: sy / n, z: sz / n } : null;
}

export function selectPocketForResidue<P extends SelectablePocket>(
  pockets: readonly P[],
  atoms: readonly PdbAtom[],
  variant: Point,
  residueIndex: number,
  chain: string | undefined
): P | null {
  if (pockets.length === 0) return null;

  const lining =
    (chain !== undefined ? pockets.find(p => p.residueKeys.includes(`${chain}_${residueIndex}`)) : undefined) ??
    pockets.find(p => p.residueIndices.includes(residueIndex));
  if (lining) return lining;

  let best: P | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const p of pockets) {
    const reference = p.cavityCentre ?? residueAtomCentroid(p, atoms);
    if (!reference) continue;
    const d = distance(reference, variant);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  return best;
}

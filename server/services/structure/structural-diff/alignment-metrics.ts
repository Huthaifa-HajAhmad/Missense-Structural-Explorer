/**
 * alignment-metrics.ts — Pure geometry, PDB transformation, and secondary interaction metrics for structural alignment
 */
import { type PdbAtom } from "../pdb-parser.ts";
import { LOCAL_STRUCTURAL_WINDOW } from "../../../../src/shared/thresholds.ts";
import { type Matrix3 } from "./geometry.ts";
import {
  calculateResidueSasa,
  calculateContacts,
  calculateHBonds,
  calculateChi1Dihedral,
  calculateChi1Deviation
} from "./contacts.ts";

export type Vec3 = { x: number; y: number; z: number };
export type Displacement = { resSeq: number; resName: string; displacement: number };
export type PartnerChange = { partner: number; type: "lost" | "gained" };

export interface FitDeviations {
  globalRmsd: number;
  localWindowRmsd: number;
  /** CA displacement of the residues within LOCAL_STRUCTURAL_WINDOW of the variant. */
  displacements: Displacement[];
  /** CA displacement of every matched residue, keyed "chain:resSeq" and "resSeq". */
  displacementByResidue: Map<string, number>;
}

/** Rotate `p` around the centre `from` with `R`, then place it relative to the centre `to`. */
export function applyFit(R: Matrix3, p: Vec3, from: Vec3, to: Vec3): Vec3 {
  const px = p.x - from.x;
  const py = p.y - from.y;
  const pz = p.z - from.z;
  return {
    x: R[0][0] * px + R[0][1] * py + R[0][2] * pz + to.x,
    y: R[1][0] * px + R[1][1] * py + R[1][2] * pz + to.y,
    z: R[2][0] * px + R[2][1] * py + R[2][2] * pz + to.z
  };
}

export function squaredDistance(a: Vec3, b: Vec3): number {
  return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2);
}

/** Map every mutant CA back into the WT frame and measure how far it lands from its WT partner. */
export function measureFitDeviations(
  matchedWt: PdbAtom[],
  matchedMut: PdbAtom[],
  pos: number,
  inverseR: Matrix3,
  centroidWt: Vec3,
  centroidMut: Vec3
): FitDeviations {
  const displacements: Displacement[] = [];
  const displacementByResidue = new Map<string, number>();
  let sumSqDist = 0;
  let sumSqDistLocal = 0;
  let countLocal = 0;

  for (let i = 0; i < matchedWt.length; i++) {
    const wtCa = matchedWt[i];
    const mutCa = matchedMut[i];
    const sq = squaredDistance(wtCa, applyFit(inverseR, mutCa, centroidMut, centroidWt));
    const dist = Math.sqrt(sq);
    sumSqDist += sq;

    displacementByResidue.set(`${mutCa.chain}:${mutCa.resSeq}`, dist);
    displacementByResidue.set(`${mutCa.resSeq}`, dist);

    if (Math.abs(wtCa.resSeq - pos) <= LOCAL_STRUCTURAL_WINDOW) {
      displacements.push({ resSeq: wtCa.resSeq, resName: wtCa.resName, displacement: parseFloat(dist.toFixed(4)) });
      sumSqDistLocal += dist * dist;
      countLocal++;
    }
  }

  return {
    globalRmsd: Math.sqrt(sumSqDist / matchedWt.length),
    localWindowRmsd: countLocal > 0 ? Math.sqrt(sumSqDistLocal / countLocal) : 0.0,
    displacements,
    displacementByResidue
  };
}

/** Rewrite the mutant PDB in the WT frame, storing each residue's CA displacement in the B-factor column. */
export function transformMutantPdb(
  mutPdb: string,
  inverseR: Matrix3,
  centroidMut: Vec3,
  centroidWt: Vec3,
  displacementByResidue: Map<string, number>
): string {
  return mutPdb
    .split(/\r?\n/)
    .map(line => {
      if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) return line;
      const point = {
        x: parseFloat(line.slice(30, 38).trim()),
        y: parseFloat(line.slice(38, 46).trim()),
        z: parseFloat(line.slice(46, 54).trim())
      };
      const resSeq = parseInt(line.slice(22, 26).trim(), 10);
      const chainId = line.slice(21, 22).trim();
      if (isNaN(point.x) || isNaN(point.y) || isNaN(point.z) || isNaN(resSeq)) return line;

      const moved = applyFit(inverseR, point, centroidMut, centroidWt);
      const disp = displacementByResidue.get(`${chainId}:${resSeq}`) ?? displacementByResidue.get(`${resSeq}`) ?? 0.0;
      return (
        line.slice(0, 30) +
        moved.x.toFixed(3).padStart(8, " ") +
        moved.y.toFixed(3).padStart(8, " ") +
        moved.z.toFixed(3).padStart(8, " ") +
        line.slice(54, 60) +
        disp.toFixed(2).padStart(6, " ") +
        line.slice(66)
      );
    })
    .join("\n");
}

/** Partners present only in the WT set ("lost"), then those present only in the mutant set ("gained"). */
export function partnerChanges(wtPartners: Set<number>, mutPartners: Set<number>): PartnerChange[] {
  const changes: PartnerChange[] = [];
  for (const r of wtPartners) {
    if (!mutPartners.has(r)) changes.push({ partner: r, type: "lost" });
  }
  for (const r of mutPartners) {
    if (!wtPartners.has(r)) changes.push({ partner: r, type: "gained" });
  }
  return changes;
}

const countChanges = (changes: PartnerChange[], type: PartnerChange["type"]) =>
  changes.filter(c => c.type === type).length;

/** Contacts, hydrogen bonds, solvent exposure and chi1 angle of the variant residue, WT against mutant. */
export function secondaryMetrics(
  wtAtoms: PdbAtom[],
  mutAtoms: PdbAtom[],
  pos: number,
  wtChain: string,
  mutChain: string
) {
  const contactChanges = partnerChanges(calculateContacts(wtAtoms, pos, wtChain), calculateContacts(mutAtoms, pos, mutChain));
  const hBondChanges = partnerChanges(calculateHBonds(wtAtoms, pos, wtChain), calculateHBonds(mutAtoms, pos, mutChain));

  const wtSasa = calculateResidueSasa(wtAtoms, pos, wtChain);
  const mutSasa = calculateResidueSasa(mutAtoms, pos, mutChain);

  const wtChi1 = calculateChi1Dihedral(wtAtoms, pos, wtChain);
  const mutChi1 = calculateChi1Dihedral(mutAtoms, pos, mutChain);

  return {
    lostContacts: countChanges(contactChanges, "lost"),
    gainedContacts: countChanges(contactChanges, "gained"),
    contactChanges,
    lostHBonds: countChanges(hBondChanges, "lost"),
    gainedHBonds: countChanges(hBondChanges, "gained"),
    hBondChanges,
    wtSasa,
    mutSasa,
    sasaChange: parseFloat((mutSasa - wtSasa).toFixed(2)),
    wtChi1,
    mutChi1,
    chi1Deviation: calculateChi1Deviation(wtChi1, mutChi1)
  };
}

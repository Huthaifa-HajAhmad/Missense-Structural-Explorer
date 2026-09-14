/**
 * aligner.ts — Structural superposition, RMSD calculation and PDB coordinate transformation
 */
import { type PdbAtom, parseAtomsFromPdbMaybeAsync } from "../pdb-parser.ts";
import { LOCAL_STRUCTURAL_WINDOW } from "../../../../src/shared/thresholds.ts";
import {
  type Matrix3,
  transpose3x3,
  multiply3x3,
  det3x3,
  svd3,
  getKabschTransform
} from "./geometry.ts";
import {
  calculateClashes,
  calculateLocalSidechainRmsd,
  calculateResidueSasa,
  calculateContacts,
  calculateHBonds,
  calculateChi1Dihedral,
  calculateChi1Deviation
} from "./contacts.ts";

export interface StructuralDiffResult {
  rmsd: number;
  localRmsd: number;
  windowDisplacements: { resSeq: number; resName: string; displacement: number }[];
  clashes: {
    wtClashCount: number;
    mutClashCount: number;
    diff: number;
  };
}

export function matchCaPairs(wtCas: PdbAtom[], mutCas: PdbAtom[]): { matchedWt: PdbAtom[]; matchedMut: PdbAtom[] } {
  // Strategy 1: Exact match by resSeq AND chain
  let matchedWt: PdbAtom[] = [];
  let matchedMut: PdbAtom[] = [];

  for (const wtCa of wtCas) {
    const mutCa = mutCas.find(a => a.resSeq === wtCa.resSeq && a.chain === wtCa.chain);
    if (mutCa) {
      matchedWt.push(wtCa);
      matchedMut.push(mutCa);
    }
  }

  if (matchedWt.length >= 3) {
    return { matchedWt, matchedMut };
  }

  // Strategy 2: Match by resSeq across primary protein chains (ignoring chain identifier differences e.g. A vs E or blank)
  matchedWt = [];
  matchedMut = [];
  const usedMutIndices = new Set<number>();

  for (const wtCa of wtCas) {
    const mutIdx = mutCas.findIndex((a, idx) => !usedMutIndices.has(idx) && a.resSeq === wtCa.resSeq);
    if (mutIdx !== -1) {
      usedMutIndices.add(mutIdx);
      matchedWt.push(wtCa);
      matchedMut.push(mutCas[mutIdx]);
    }
  }

  if (matchedWt.length >= 3) {
    return { matchedWt, matchedMut };
  }

  // Strategy 3: Sequential index matching (for structures with shifted or renumbered residue sequences)
  matchedWt = [];
  matchedMut = [];
  const minLen = Math.min(wtCas.length, mutCas.length);
  for (let i = 0; i < minLen; i++) {
    matchedWt.push(wtCas[i]);
    matchedMut.push(mutCas[i]);
  }

  return { matchedWt, matchedMut };
}

export async function computeStructuralDiff(
  wtPdb: string,
  mutPdb: string,
  pos: number,
  chain: string
): Promise<StructuralDiffResult> {
  const wtAtoms = await parseAtomsFromPdbMaybeAsync(wtPdb);
  const mutAtoms = await parseAtomsFromPdbMaybeAsync(mutPdb);

  const wtCas = wtAtoms.filter(a => a.name === "CA");
  const mutCas = mutAtoms.filter(a => a.name === "CA");

  const { matchedWt, matchedMut } = matchCaPairs(wtCas, mutCas);

  const n = matchedWt.length;
  if (n === 0) {
    throw new Error("No matching CA atoms found between WT and mutant structures for alignment.");
  }

  let centroidWt = { x: 0, y: 0, z: 0 };
  let centroidMut = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < n; i++) {
    centroidWt.x += matchedWt[i].x;
    centroidWt.y += matchedWt[i].y;
    centroidWt.z += matchedWt[i].z;

    centroidMut.x += matchedMut[i].x;
    centroidMut.y += matchedMut[i].y;
    centroidMut.z += matchedMut[i].z;
  }

  centroidWt.x /= n;
  centroidWt.y /= n;
  centroidWt.z /= n;

  centroidMut.x /= n;
  centroidMut.y /= n;
  centroidMut.z /= n;

  let H: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];

  for (let i = 0; i < n; i++) {
    const px = matchedWt[i].x - centroidWt.x;
    const py = matchedWt[i].y - centroidWt.y;
    const pz = matchedWt[i].z - centroidWt.z;

    const qx = matchedMut[i].x - centroidMut.x;
    const qy = matchedMut[i].y - centroidMut.y;
    const qz = matchedMut[i].z - centroidMut.z;

    H[0][0] += px * qx; H[0][1] += px * qy; H[0][2] += px * qz;
    H[1][0] += py * qx; H[1][1] += py * qy; H[1][2] += py * qz;
    H[2][0] += pz * qx; H[2][1] += pz * qy; H[2][2] += pz * qz;
  }

  const { U, S, V } = svd3(H);

  const VUT = multiply3x3(V, transpose3x3(U));
  const detVal = det3x3(VUT);
  const d = detVal < 0 ? -1 : 1;

  const W: Matrix3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, d]
  ];

  const R = multiply3x3(multiply3x3(V, W), transpose3x3(U));

  let sumSqDist = 0;
  for (let i = 0; i < n; i++) {
    const px = matchedWt[i].x - centroidWt.x;
    const py = matchedWt[i].y - centroidWt.y;
    const pz = matchedWt[i].z - centroidWt.z;

    const ax = R[0][0] * px + R[0][1] * py + R[0][2] * pz + centroidMut.x;
    const ay = R[1][0] * px + R[1][1] * py + R[1][2] * pz + centroidMut.y;
    const az = R[2][0] * px + R[2][1] * py + R[2][2] * pz + centroidMut.z;

    const qx = matchedMut[i].x;
    const qy = matchedMut[i].y;
    const qz = matchedMut[i].z;

    sumSqDist += Math.pow(ax - qx, 2) + Math.pow(ay - qy, 2) + Math.pow(az - qz, 2);
  }
  const rmsd = Math.sqrt(sumSqDist / n);

  const windowDisplacements: { resSeq: number; resName: string; displacement: number }[] = [];
  for (let r = pos - LOCAL_STRUCTURAL_WINDOW; r <= pos + LOCAL_STRUCTURAL_WINDOW; r++) {
    const idx = matchedWt.findIndex(a => a.resSeq === r && a.chain === chain);
    if (idx !== -1) {
      const wtCa = matchedWt[idx];
      const mutCa = matchedMut[idx];

      const px = wtCa.x - centroidWt.x;
      const py = wtCa.y - centroidWt.y;
      const pz = wtCa.z - centroidWt.z;

      const ax = R[0][0] * px + R[0][1] * py + R[0][2] * pz + centroidMut.x;
      const ay = R[1][0] * px + R[1][1] * py + R[1][2] * pz + centroidMut.y;
      const az = R[2][0] * px + R[2][1] * py + R[2][2] * pz + centroidMut.z;

      const dist = Math.sqrt(Math.pow(ax - mutCa.x, 2) + Math.pow(ay - mutCa.y, 2) + Math.pow(az - mutCa.z, 2));
      windowDisplacements.push({
        resSeq: r,
        resName: wtCa.resName,
        displacement: parseFloat(dist.toFixed(4))
      });
    }
  }

  await new Promise<void>(resolve => setImmediate(resolve));
  const localRmsd = calculateLocalSidechainRmsd(wtAtoms, mutAtoms, pos, chain);
  
  await new Promise<void>(resolve => setImmediate(resolve));
  const wtClashes = calculateClashes(wtAtoms);
  
  await new Promise<void>(resolve => setImmediate(resolve));
  const mutClashes = calculateClashes(mutAtoms);

  return {
    rmsd: parseFloat(rmsd.toFixed(4)),
    localRmsd,
    windowDisplacements,
    clashes: {
      wtClashCount: wtClashes,
      mutClashCount: mutClashes,
      diff: mutClashes - wtClashes
    }
  };
}

export interface AlignedStructuralDiffResult {
  alignedMutPdb: string;
  globalRmsd: number;
  localWindowRmsd: number;
  windowRadius: number;
  alignmentScope?: "local" | "global";
  displacements: { resSeq: number; resName: string; displacement: number }[];
  lostContacts: number;
  gainedContacts: number;
  contactChanges: { partner: number; type: "lost" | "gained" }[];
  lostHBonds: number;
  gainedHBonds: number;
  hBondChanges: { partner: number; type: "lost" | "gained" }[];
  wtSasa: number;
  mutSasa: number;
  sasaChange: number;
  wtChi1: number | null;
  mutChi1: number | null;
  chi1Deviation: number | null;
}

export async function alignMutantToWt(
  wtPdb: string,
  mutPdb: string,
  pos: number,
  chain: string,
  alignmentScope: "local" | "global" = "local"
): Promise<AlignedStructuralDiffResult> {
  const wtAtoms = await parseAtomsFromPdbMaybeAsync(wtPdb);
  const mutAtoms = await parseAtomsFromPdbMaybeAsync(mutPdb);

  const wtCas = wtAtoms.filter(a => a.name === "CA");
  const mutCas = mutAtoms.filter(a => a.name === "CA");

  const { matchedWt, matchedMut } = matchCaPairs(wtCas, mutCas);

  const n = matchedWt.length;
  if (n === 0) {
    throw new Error("No matching CA atoms found between WT and mutant structures for alignment.");
  }

  // Determine subset of CA pairs to compute Kabsch rotation & translation matrix
  const localAlignmentWindow = 15;
  let alignWt = matchedWt;
  let alignMut = matchedMut;

  if (alignmentScope === "local") {
    const localIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      if (Math.abs(matchedWt[i].resSeq - pos) <= localAlignmentWindow) {
        localIndices.push(i);
      }
    }
    // Only use local alignment if >= 4 CA pairs are available within the pocket
    if (localIndices.length >= 4) {
      alignWt = localIndices.map(i => matchedWt[i]);
      alignMut = localIndices.map(i => matchedMut[i]);
    }
  }

  const nAlign = alignWt.length;
  let centroidWt = { x: 0, y: 0, z: 0 };
  let centroidMut = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < nAlign; i++) {
    centroidWt.x += alignWt[i].x;
    centroidWt.y += alignWt[i].y;
    centroidWt.z += alignWt[i].z;

    centroidMut.x += alignMut[i].x;
    centroidMut.y += alignMut[i].y;
    centroidMut.z += alignMut[i].z;
  }

  centroidWt.x /= nAlign; centroidWt.y /= nAlign; centroidWt.z /= nAlign;
  centroidMut.x /= nAlign; centroidMut.y /= nAlign; centroidMut.z /= nAlign;

  let H: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];

  for (let i = 0; i < nAlign; i++) {
    const px = alignWt[i].x - centroidWt.x;
    const py = alignWt[i].y - centroidWt.y;
    const pz = alignWt[i].z - centroidWt.z;

    const qx = alignMut[i].x - centroidMut.x;
    const qy = alignMut[i].y - centroidMut.y;
    const qz = alignMut[i].z - centroidMut.z;

    H[0][0] += px * qx; H[0][1] += px * qy; H[0][2] += px * qz;
    H[1][0] += py * qx; H[1][1] += py * qy; H[1][2] += py * qz;
    H[2][0] += pz * qx; H[2][1] += pz * qy; H[2][2] += pz * qz;
  }

  const { U, S, V } = svd3(H);
  const VUT = multiply3x3(V, transpose3x3(U));
  const detVal = det3x3(VUT);
  const d = detVal < 0 ? -1 : 1;
  const W: Matrix3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, d]
  ];

  const R = multiply3x3(multiply3x3(V, W), transpose3x3(U));
  const R_inv = transpose3x3(R); // inverse rotation to map mutant -> WT frame

  // Compute global CA RMSD
  let sumSqDist = 0;
  for (let i = 0; i < n; i++) {
    const qx = matchedMut[i].x - centroidMut.x;
    const qy = matchedMut[i].y - centroidMut.y;
    const qz = matchedMut[i].z - centroidMut.z;

    const ax = R_inv[0][0] * qx + R_inv[0][1] * qy + R_inv[0][2] * qz + centroidWt.x;
    const ay = R_inv[1][0] * qx + R_inv[1][1] * qy + R_inv[1][2] * qz + centroidWt.y;
    const az = R_inv[2][0] * qx + R_inv[2][1] * qy + R_inv[2][2] * qz + centroidWt.z;

    sumSqDist += Math.pow(matchedWt[i].x - ax, 2) +
                 Math.pow(matchedWt[i].y - ay, 2) +
                 Math.pow(matchedWt[i].z - az, 2);
  }
  const globalRmsd = Math.sqrt(sumSqDist / n);

  // Compute per-residue displacements within LOCAL_STRUCTURAL_WINDOW and build fast O(1) map
  const displacements: { resSeq: number; resName: string; displacement: number }[] = [];
  const resDispMap = new Map<string, number>();
  let sumSqDistLocal = 0;
  let countLocal = 0;

  for (let i = 0; i < n; i++) {
    const wtCa = matchedWt[i];
    const mutCa = matchedMut[i];
    
    const qx = mutCa.x - centroidMut.x;
    const qy = mutCa.y - centroidMut.y;
    const qz = mutCa.z - centroidMut.z;

    const ax = R_inv[0][0] * qx + R_inv[0][1] * qy + R_inv[0][2] * qz + centroidWt.x;
    const ay = R_inv[1][0] * qx + R_inv[1][1] * qy + R_inv[1][2] * qz + centroidWt.y;
    const az = R_inv[2][0] * qx + R_inv[2][1] * qy + R_inv[2][2] * qz + centroidWt.z;

    const dist = Math.sqrt(Math.pow(wtCa.x - ax, 2) + Math.pow(wtCa.y - ay, 2) + Math.pow(wtCa.z - az, 2));

    resDispMap.set(`${mutCa.chain}:${mutCa.resSeq}`, dist);
    resDispMap.set(`${mutCa.resSeq}`, dist);

    if (Math.abs(wtCa.resSeq - pos) <= LOCAL_STRUCTURAL_WINDOW) {
      displacements.push({
        resSeq: wtCa.resSeq,
        resName: wtCa.resName,
        displacement: parseFloat(dist.toFixed(4))
      });
      sumSqDistLocal += dist * dist;
      countLocal++;
    }
  }

  const localWindowRmsd = countLocal > 0 ? Math.sqrt(sumSqDistLocal / countLocal) : 0.0;

  // Perform coordinate transformation on the mutant PDB text
  const mutLines = mutPdb.split(/\r?\n/);
  const alignedLines = mutLines.map(line => {
    if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
      const xVal = parseFloat(line.slice(30, 38).trim());
      const yVal = parseFloat(line.slice(38, 46).trim());
      const zVal = parseFloat(line.slice(46, 54).trim());
      const resSeqStr = line.slice(22, 26).trim();
      const resSeq = parseInt(resSeqStr, 10);
      const chainId = line.slice(21, 22).trim();

      if (!isNaN(xVal) && !isNaN(yVal) && !isNaN(zVal) && !isNaN(resSeq)) {
        const qx = xVal - centroidMut.x;
        const qy = yVal - centroidMut.y;
        const qz = zVal - centroidMut.z;

        const ax = R_inv[0][0] * qx + R_inv[0][1] * qy + R_inv[0][2] * qz + centroidWt.x;
        const ay = R_inv[1][0] * qx + R_inv[1][1] * qy + R_inv[1][2] * qz + centroidWt.y;
        const az = R_inv[2][0] * qx + R_inv[2][1] * qy + R_inv[2][2] * qz + centroidWt.z;

        const disp = resDispMap.get(`${chainId}:${resSeq}`) ?? resDispMap.get(`${resSeq}`) ?? 0.0;

        const paddedX = ax.toFixed(3).padStart(8, " ");
        const paddedY = ay.toFixed(3).padStart(8, " ");
        const paddedZ = az.toFixed(3).padStart(8, " ");
        const paddedB = disp.toFixed(2).padStart(6, " ");

        return line.slice(0, 30) + paddedX + paddedY + paddedZ + line.slice(54, 60) + paddedB + line.slice(66);
      }
    }
    return line;
  });

  const alignedMutPdb = alignedLines.join("\n");

  // Dynamic chain detection for WT and mutant models
  const wtChain = wtCas.find(a => a.resSeq === pos)?.chain || (wtCas[0]?.chain ?? chain);
  const mutChain = mutCas.find(a => a.resSeq === pos)?.chain || (mutCas[0]?.chain ?? wtChain);

  // Secondary metrics
  // 1. Contact Map
  const wtContacts = calculateContacts(wtAtoms, pos, wtChain);
  const mutContacts = calculateContacts(mutAtoms, pos, mutChain);
  const lostContactsArr: number[] = [];
  const gainedContactsArr: number[] = [];
  const contactChanges: { partner: number; type: "lost" | "gained" }[] = [];

  for (const r of wtContacts) {
    if (!mutContacts.has(r)) {
      lostContactsArr.push(r);
      contactChanges.push({ partner: r, type: "lost" });
    }
  }
  for (const r of mutContacts) {
    if (!wtContacts.has(r)) {
      gainedContactsArr.push(r);
      contactChanges.push({ partner: r, type: "gained" });
    }
  }

  // 2. Hydrogen Bond Network
  const wtHBonds = calculateHBonds(wtAtoms, pos, wtChain);
  const mutHBonds = calculateHBonds(mutAtoms, pos, mutChain);
  const lostHBArr: number[] = [];
  const gainedHBArr: number[] = [];
  const hBondChanges: { partner: number; type: "lost" | "gained" }[] = [];

  for (const r of wtHBonds) {
    if (!mutHBonds.has(r)) {
      lostHBArr.push(r);
      hBondChanges.push({ partner: r, type: "lost" });
    }
  }
  for (const r of mutHBonds) {
    if (!wtHBonds.has(r)) {
      gainedHBArr.push(r);
      hBondChanges.push({ partner: r, type: "gained" });
    }
  }

  // 3. SASA
  const wtSasa = calculateResidueSasa(wtAtoms, pos, wtChain);
  const mutSasa = calculateResidueSasa(mutAtoms, pos, mutChain);
  const sasaChange = parseFloat((mutSasa - wtSasa).toFixed(2));

  // 4. Chi1 Dihedral
  const wtChi1 = calculateChi1Dihedral(wtAtoms, pos, wtChain);
  const mutChi1 = calculateChi1Dihedral(mutAtoms, pos, mutChain);
  const chi1Deviation = calculateChi1Deviation(wtChi1, mutChi1);

  return {
    alignedMutPdb,
    globalRmsd: parseFloat(globalRmsd.toFixed(4)),
    localWindowRmsd: parseFloat(localWindowRmsd.toFixed(4)),
    windowRadius: LOCAL_STRUCTURAL_WINDOW,
    alignmentScope,
    displacements,
    lostContacts: lostContactsArr.length,
    gainedContacts: gainedContactsArr.length,
    contactChanges,
    lostHBonds: lostHBArr.length,
    gainedHBonds: gainedHBArr.length,
    hBondChanges,
    wtSasa,
    mutSasa,
    sasaChange,
    wtChi1,
    mutChi1,
    chi1Deviation
  };
}

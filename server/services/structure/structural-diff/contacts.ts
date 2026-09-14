/**
 * contacts.ts — VdW Clashes, SASA, Contacts, H-Bonds and Dihedral Geometry
 */
import { type PdbAtom } from "../pdb-parser.ts";
import { type Matrix3, getKabschTransform } from "./geometry.ts";
import { LOCAL_STRUCTURAL_WINDOW } from "../../../../src/shared/thresholds.ts";

export function getVdwRadius(atomName: string): { radius: number; isPolar: boolean } {
  const name = atomName.replace(/^\d+/, "");
  if (name.startsWith("C")) {
    return { radius: 1.70, isPolar: false };
  } else if (name.startsWith("N")) {
    return { radius: 1.55, isPolar: true };
  } else if (name.startsWith("O")) {
    return { radius: 1.52, isPolar: true };
  } else if (name.startsWith("S")) {
    return { radius: 1.80, isPolar: false };
  } else if (name.startsWith("P")) {
    return { radius: 1.80, isPolar: false };
  }
  return { radius: 1.70, isPolar: false };
}

export function calculateClashes(atoms: PdbAtom[]): number {
  const nonHAtoms = atoms
    .filter(a => !a.name.startsWith("H") && a.name !== "OXT")
    .map((atom, _idx) => ({ ...atom, _idx }));
  let clashCount = 0;
  
  const grid = new Map<string, typeof nonHAtoms>();
  const cellSize = 4.0; //cellSize slightly larger to accommodate S vdW radius (1.8+1.8-0.55 = 3.05)
  
  for (const atom of nonHAtoms) {
    const gx = Math.floor(atom.x / cellSize);
    const gy = Math.floor(atom.y / cellSize);
    const gz = Math.floor(atom.z / cellSize);
    const key = `${gx},${gy},${gz}`;
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key)!.push(atom);
  }
  
  for (const atom of nonHAtoms) {
    const gx = Math.floor(atom.x / cellSize);
    const gy = Math.floor(atom.y / cellSize);
    const gz = Math.floor(atom.z / cellSize);
    const radA = getVdwRadius(atom.name);
    
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const nKey = `${gx + dx},${gy + dy},${gz + dz}`;
          const cellAtoms = grid.get(nKey);
          if (!cellAtoms) continue;
          for (const other of cellAtoms) {
            if (atom._idx >= other._idx) {
              continue;
            }
            if (atom.chain === other.chain && Math.abs(atom.resSeq - other.resSeq) <= 1) {
              continue;
            }
            const radB = getVdwRadius(other.name);
            const isPolarPair = radA.isPolar && radB.isPolar;
            const tolerance = isPolarPair ? 0.70 : 0.55;
            const threshold = radA.radius + radB.radius - tolerance;
            
            const distSq = Math.pow(atom.x - other.x, 2) + Math.pow(atom.y - other.y, 2) + Math.pow(atom.z - other.z, 2);
            if (distSq < threshold * threshold) {
              clashCount++;
            }
          }
        }
      }
    }
  }
  return clashCount;
}


export function calculateLocalSidechainRmsd(wtAtoms: PdbAtom[], mutAtoms: PdbAtom[], pos: number, chain: string): number {
  const wtWindowAtoms = wtAtoms.filter(a => Math.abs(a.resSeq - pos) <= LOCAL_STRUCTURAL_WINDOW && a.chain === chain);
  const mutWindowAtoms = mutAtoms.filter(a => Math.abs(a.resSeq - pos) <= LOCAL_STRUCTURAL_WINDOW && a.chain === chain);

  if (wtWindowAtoms.length === 0 || mutWindowAtoms.length === 0) {
    return 0.0;
  }

  const wtBackbone: { x: number; y: number; z: number }[] = [];
  const mutBackbone: { x: number; y: number; z: number }[] = [];
  const backboneNames = ["N", "CA", "C"];

  for (let r = pos - LOCAL_STRUCTURAL_WINDOW; r <= pos + LOCAL_STRUCTURAL_WINDOW; r++) {
    for (const name of backboneNames) {
      const wtB = wtWindowAtoms.find(a => a.resSeq === r && a.name === name);
      const mutB = mutWindowAtoms.find(a => a.resSeq === r && a.name === name);
      if (wtB && mutB) {
        wtBackbone.push(wtB);
        mutBackbone.push(mutB);
      }
    }
  }

  if (wtBackbone.length < 3) return 0.0;

  try {
    const { R, centroidRef, centroidTarget } = getKabschTransform(wtBackbone, mutBackbone);

    let sumSqDist = 0;
    let count = 0;
    const backboneAtomNames = new Set(["N", "CA", "C", "O", "H", "HA", "HN"]);

    for (const wtA of wtWindowAtoms) {
      if (backboneAtomNames.has(wtA.name)) continue;
      if (wtA.resSeq === pos && wtA.name !== "CB") continue;

      const mutA = mutWindowAtoms.find(a => a.resSeq === wtA.resSeq && a.name === wtA.name);
      if (mutA) {
        const dx = mutA.x - centroidTarget.x;
        const dy = mutA.y - centroidTarget.y;
        const dz = mutA.z - centroidTarget.z;
        const mx = R[0][0] * dx + R[0][1] * dy + R[0][2] * dz + centroidRef.x;
        const my = R[1][0] * dx + R[1][1] * dy + R[1][2] * dz + centroidRef.y;
        const mz = R[2][0] * dx + R[2][1] * dy + R[2][2] * dz + centroidRef.z;

        const distSq = Math.pow(wtA.x - mx, 2) + Math.pow(wtA.y - my, 2) + Math.pow(wtA.z - mz, 2);
        sumSqDist += distSq;
        count++;
      }
    }

    if (count === 0) return 0.0;
    return parseFloat(Math.sqrt(sumSqDist / count).toFixed(4));
  } catch (e) {
    return 0.0;
  }
}

function generateSpherePoints(n = 960): { x: number; y: number; z: number }[] {
  const points: { x: number; y: number; z: number }[] = [];
  const inc = Math.PI * (3.0 - Math.sqrt(5.0));
  const off = 2.0 / n;
  for (let k = 0; k < n; k++) {
    const y = k * off - 1.0 + (off / 2.0);
    const r = Math.sqrt(1.0 - y * y);
    const phi = k * inc;
    const x = Math.cos(phi) * r;
    const z = Math.sin(phi) * r;
    points.push({ x, y, z });
  }
  return points;
}

export function calculateResidueSasa(atoms: PdbAtom[], pos: number, chain: string): number {
  const residueAtoms = atoms.filter(a => a.resSeq === pos && a.chain === chain && !a.name.startsWith("H") && a.name !== "OXT");
  if (residueAtoms.length === 0) return 0.0;
  
  const allHeavyAtoms = atoms.filter(a => !a.name.startsWith("H") && a.name !== "OXT");
  const spherePoints = generateSpherePoints(960);
  const probe = 1.4;
  let totalSasa = 0;

  // Build spatial grid to avoid O(N) neighbor searches for each atom
  const grid = new Map<string, PdbAtom[]>();
  const cellSize = 8.0; // matching neighbors distance threshold of 8.0 Å (dSq < 64.0)
  for (const other of allHeavyAtoms) {
    const gx = Math.floor(other.x / cellSize);
    const gy = Math.floor(other.y / cellSize);
    const gz = Math.floor(other.z / cellSize);
    const key = `${gx},${gy},${gz}`;
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key)!.push(other);
  }
  
  for (const atom of residueAtoms) {
    const radA = getVdwRadius(atom.name).radius;
    const R = radA + probe;
    let accessiblePoints = 0;
    
    // Query neighbors using spatial grid
    const gx = Math.floor(atom.x / cellSize);
    const gy = Math.floor(atom.y / cellSize);
    const gz = Math.floor(atom.z / cellSize);
    const neighbors: PdbAtom[] = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const nKey = `${gx + dx},${gy + dy},${gz + dz}`;
          const cellAtoms = grid.get(nKey);
          if (!cellAtoms) continue;
          for (const other of cellAtoms) {
            if (other === atom || (other.chain === atom.chain && other.resSeq === atom.resSeq && other.name === atom.name)) continue;
            const dSq = Math.pow(atom.x - other.x, 2) + Math.pow(atom.y - other.y, 2) + Math.pow(atom.z - other.z, 2);
            if (dSq < 64.0) {
              neighbors.push(other);
            }
          }
        }
      }
    }
    
    for (const pt of spherePoints) {
      const px = atom.x + pt.x * R;
      const py = atom.y + pt.y * R;
      const pz = atom.z + pt.z * R;
      
      let blocked = false;
      for (const other of neighbors) {
        const radB = getVdwRadius(other.name).radius;
        const limit = radB + probe;
        const distSq = Math.pow(px - other.x, 2) + Math.pow(py - other.y, 2) + Math.pow(pz - other.z, 2);
        if (distSq < limit * limit) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        accessiblePoints++;
      }
    }
    
    const atomSasa = 4.0 * Math.PI * R * R * (accessiblePoints / 960.0);
    totalSasa += atomSasa;
  }
  
  return parseFloat(totalSasa.toFixed(2));
}

export function calculateContacts(atoms: PdbAtom[], pos: number, chain: string, threshold = 4.0): Set<number> {
  const residueAtoms = atoms.filter(a => a.resSeq === pos && a.chain === chain && !a.name.startsWith("H") && a.name !== "OXT");
  const otherAtoms = atoms.filter(a => Math.abs(a.resSeq - pos) > 1 && a.chain === chain && !a.name.startsWith("H") && a.name !== "OXT");
  
  const contactResidues = new Set<number>();
  for (const rAtom of residueAtoms) {
    for (const oAtom of otherAtoms) {
      const distSq = Math.pow(rAtom.x - oAtom.x, 2) + Math.pow(rAtom.y - oAtom.y, 2) + Math.pow(rAtom.z - oAtom.z, 2);
      if (distSq <= threshold * threshold) {
        contactResidues.add(oAtom.resSeq);
      }
    }
  }
  return contactResidues;
}

export function calculateHBonds(atoms: PdbAtom[], pos: number, chain: string, threshold = 3.5): Set<number> {
  const polarElements = new Set(["N", "O", "S"]);
  const residuePolarAtoms = atoms.filter(a => 
    a.resSeq === pos && 
    a.chain === chain && 
    polarElements.has(a.name.replace(/^\d+/, "").slice(0, 1))
  );
  
  const otherPolarAtoms = atoms.filter(a => 
    Math.abs(a.resSeq - pos) > 1 && 
    a.chain === chain && 
    polarElements.has(a.name.replace(/^\d+/, "").slice(0, 1))
  );
  
  const hBondPartners = new Set<number>();
  for (const rAtom of residuePolarAtoms) {
    for (const oAtom of otherPolarAtoms) {
      const distSq = Math.pow(rAtom.x - oAtom.x, 2) + Math.pow(rAtom.y - oAtom.y, 2) + Math.pow(rAtom.z - oAtom.z, 2);
      if (distSq <= threshold * threshold) {
        hBondPartners.add(oAtom.resSeq);
      }
    }
  }
  return hBondPartners;
}

export function calculateChi1Dihedral(atoms: PdbAtom[], resSeq: number, chain: string): number | null {
  const residueAtoms = atoms.filter(a => a.resSeq === resSeq && a.chain === chain);
  const nAtom = residueAtoms.find(a => a.name === "N");
  const caAtom = residueAtoms.find(a => a.name === "CA");
  const cbAtom = residueAtoms.find(a => a.name === "CB");
  
  if (!nAtom || !caAtom || !cbAtom) return null;
  
  const cgAtom = residueAtoms.find(a => a.name === "CG" || a.name === "CG1" || a.name === "OG" || a.name === "OG1" || a.name === "SG");
  if (!cgAtom) return null;
  
  const p1 = nAtom;
  const p2 = caAtom;
  const p3 = cbAtom;
  const p4 = cgAtom;
  
  const b1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
  const b2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };
  const b3 = { x: p4.x - p3.x, y: p4.y - p3.y, z: p4.z - p3.z };
  
  const n1 = {
    x: b1.y * b2.z - b1.z * b2.y,
    y: b1.z * b2.x - b1.x * b2.z,
    z: b1.x * b2.y - b1.y * b2.x
  };
  const n2 = {
    x: b2.y * b3.z - b2.z * b3.y,
    y: b2.z * b3.x - b2.x * b3.z,
    z: b2.x * b3.y - b2.y * b3.x
  };
  
  const len1 = Math.sqrt(n1.x * n1.x + n1.y * n1.y + n1.z * n1.z);
  const len2 = Math.sqrt(n2.x * n2.x + n2.y * n2.y + n2.z * n2.z);
  if (len1 < 1e-9 || len2 < 1e-9) return null;
  
  n1.x /= len1; n1.y /= len1; n1.z /= len1;
  n2.x /= len2; n2.y /= len2; n2.z /= len2;
  
  const cosTheta = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
  const lenB2 = Math.sqrt(b2.x * b2.x + b2.y * b2.y + b2.z * b2.z);
  if (lenB2 < 1e-9) return null;
  const b2Unit = { x: b2.x / lenB2, y: b2.y / lenB2, z: b2.z / lenB2 };
  
  const crossNormal = {
    x: n1.y * n2.z - n1.z * n2.y,
    y: n1.z * n2.x - n1.x * n2.z,
    z: n1.x * n2.y - n1.y * n2.x
  };
  const sinTheta = crossNormal.x * b2Unit.x + crossNormal.y * b2Unit.y + crossNormal.z * b2Unit.z;
  
  const angleRad = Math.atan2(sinTheta, cosTheta);
  const angleDeg = (angleRad * 180.0) / Math.PI;
  return parseFloat(angleDeg.toFixed(2));
}

export function calculateChi1Deviation(wtAngle: number | null, mutAngle: number | null): number | null {
  if (wtAngle === null || mutAngle === null) return null;
  let diff = Math.abs(wtAngle - mutAngle);
  if (diff > 180) {
    diff = 360 - diff;
  }
  return parseFloat(diff.toFixed(2));
}

/**
 * structural-diff.ts — Structural comparison and ESM2/VESM evaluation utilities.
 *
 * Extracted from biophysics.ts. Contains:
 *   - runEsm2Eval (VESM sidecar HTTP + subprocess fallback)
 *   - svd3 (3x3 SVD via Jacobi iteration)
 *   - calculateClashes (van der Waals clash counting)
 *   - StructuralDiffResult interface
 *   - computeStructuralDiff (Kabsch-aligned Cα RMSD + local RMSD + clash delta)
 *
 * Depends on: pdb-parser.ts (PdbAtom), crypto, path, fs, child_process, lru-cache
 */
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { LRUCache } from "lru-cache";
import { type PdbAtom, parseAtomsFromPdbMaybeAsync } from "./pdb-parser.ts";
import { LOCAL_STRUCTURAL_WINDOW } from "../../src/shared/thresholds.ts";



const execFileAsync = promisify(execFile);

const esm2Cache = new LRUCache<string, any>({
  max: 500
});

export async function runEsm2Eval(
  seq: string,
  pos: number,
  wt: string,
  mut: string
): Promise<{ llr: number; verdict: string } | null> {
  const seqHash = crypto.createHash("sha256").update(seq).digest("hex").slice(0, 16);
  const cacheKey = `${seqHash}_${pos}_${wt}_${mut}`;
  const cached = esm2Cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Try HTTP first
  try {
    const res = await fetch("http://127.0.0.1:8000/predict/vesm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sidecar-Secret": process.env.SIDECAR_SECRET || ""
      },
      body: JSON.stringify({ sequence: seq, position: pos, wt, mut }),
      signal: AbortSignal.timeout(15000)
    });
    if (res.ok) {
      const parsed = await res.json();
      if (parsed.status === "success" && typeof parsed.llr === "number") {
        const result = { llr: parsed.llr, verdict: parsed.verdict !== undefined ? parsed.verdict : "raw score" };
        esm2Cache.set(cacheKey, result);
        return result;
      }
    }
  } catch (err: any) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[ESM2-Eval] Model server is offline or error: ${err.message}. Falling back to CLI subprocess.`);
    }
  }

  const pythonScript = path.join(process.cwd(), "tools", "esm2_eval.py");
  if (!fs.existsSync(pythonScript)) {
    console.warn(`[ESM2-Eval] Python sidecar not found at: ${pythonScript}.`);
    return null;
  }
  try {
    const { stdout } = await execFileAsync("python", ["-m", "uv", "run", pythonScript, seq, pos.toString(), wt, mut], { timeout: 30000 });
    const parsed = JSON.parse(stdout.trim());
    if (parsed.status === "success" && typeof parsed.llr === "number") {
      const result = { llr: parsed.llr, verdict: parsed.verdict };
      esm2Cache.set(cacheKey, result);
      return result;
    }
    console.warn(`[ESM2-Eval] Predictor returned error or invalid format:`, parsed);
    esm2Cache.set(cacheKey, null);
    return null;
  } catch (err: any) {
    console.warn(`[ESM2-Eval] Process execution failed:`, err.message);
    return null;
  }
}

type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number]
];

function transpose3x3(m: Matrix3): Matrix3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]]
  ];
}

function multiply3x3(a: Matrix3, b: Matrix3): Matrix3 {
  const c: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      c[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return c;
}

function det3x3(m: Matrix3): number {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
         m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
         m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

export function svd3(A: Matrix3): { U: Matrix3; S: [number, number, number]; V: Matrix3 } {
  let U: Matrix3 = [
    [A[0][0], A[0][1], A[0][2]],
    [A[1][0], A[1][1], A[1][2]],
    [A[2][0], A[2][1], A[2][2]]
  ];
  let V: Matrix3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];

  const maxSweeps = 30;
  const tol = 1e-12;

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let converged = true;
    const pairs = [[0, 1], [0, 2], [1, 2]];
    for (const [i, j] of pairs) {
      let a = U[0][i] * U[0][i] + U[1][i] * U[1][i] + U[2][i] * U[2][i];
      let b = U[0][j] * U[0][j] + U[1][j] * U[1][j] + U[2][j] * U[2][j];
      let c = U[0][i] * U[0][j] + U[1][i] * U[1][j] + U[2][i] * U[2][j];

      if (Math.abs(c) > tol * Math.sqrt(a * b)) {
        converged = false;
        let zeta = (b - a) / (2 * c);
        let t = Math.sign(zeta) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        let cs = 1 / Math.sqrt(1 + t * t);
        let sn = cs * t;

        for (let r = 0; r < 3; r++) {
          let u_r_i = U[r][i];
          let u_r_j = U[r][j];
          U[r][i] = cs * u_r_i - sn * u_r_j;
          U[r][j] = sn * u_r_i + cs * u_r_j;
        }

        for (let r = 0; r < 3; r++) {
          let v_r_i = V[r][i];
          let v_r_j = V[r][j];
          V[r][i] = cs * v_r_i - sn * v_r_j;
          V[r][j] = sn * v_r_i + cs * v_r_j;
        }
      }
    }
    if (converged) break;
  }

  function crossProduct(a: number[], b: number[]): number[] {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  let S: [number, number, number] = [0, 0, 0];
  const normsU = [0, 0, 0];
  const normsV = [0, 0, 0];

  for (let col = 0; col < 3; col++) {
    normsU[col] = Math.sqrt(U[0][col] * U[0][col] + U[1][col] * U[1][col] + U[2][col] * U[2][col]);
    normsV[col] = Math.sqrt(V[0][col] * V[0][col] + V[1][col] * V[1][col] + V[2][col] * V[2][col]);
    S[col] = normsU[col];

    if (normsU[col] > 1e-9) {
      U[0][col] /= normsU[col];
      U[1][col] /= normsU[col];
      U[2][col] /= normsU[col];
    }
    if (normsV[col] > 1e-9) {
      V[0][col] /= normsV[col];
      V[1][col] /= normsV[col];
      V[2][col] /= normsV[col];
    }
  }

  // Handle rank-2 case: if any single column is zero, compute it as the cross product of the other two
  if (normsU[0] <= 1e-9 && normsU[1] > 1e-9 && normsU[2] > 1e-9) {
    const u0 = crossProduct([U[0][1], U[1][1], U[2][1]], [U[0][2], U[1][2], U[2][2]]);
    U[0][0] = u0[0]; U[1][0] = u0[1]; U[2][0] = u0[2];
  } else if (normsU[0] > 1e-9 && normsU[1] <= 1e-9 && normsU[2] > 1e-9) {
    const u1 = crossProduct([U[0][2], U[1][2], U[2][2]], [U[0][0], U[1][0], U[2][0]]);
    U[0][1] = u1[0]; U[1][1] = u1[1]; U[2][1] = u1[2];
  } else if (normsU[0] > 1e-9 && normsU[1] > 1e-9 && normsU[2] <= 1e-9) {
    const u2 = crossProduct([U[0][0], U[1][0], U[2][0]], [U[0][1], U[1][1], U[2][1]]);
    U[0][2] = u2[0]; U[1][2] = u2[1]; U[2][2] = u2[2];
  }

  if (normsV[0] <= 1e-9 && normsV[1] > 1e-9 && normsV[2] > 1e-9) {
    const v0 = crossProduct([V[0][1], V[1][1], V[2][1]], [V[0][2], V[1][2], V[2][2]]);
    V[0][0] = v0[0]; V[1][0] = v0[1]; V[2][0] = v0[2];
  } else if (normsV[0] > 1e-9 && normsV[1] <= 1e-9 && normsV[2] > 1e-9) {
    const v1 = crossProduct([V[0][2], V[1][2], V[2][2]], [V[0][0], V[1][0], V[2][0]]);
    V[0][1] = v1[0]; V[1][1] = v1[1]; V[2][1] = v1[2];
  } else if (normsV[0] > 1e-9 && normsV[1] > 1e-9 && normsV[2] <= 1e-9) {
    const v2 = crossProduct([V[0][0], V[1][0], V[2][0]], [V[0][1], V[1][1], V[2][1]]);
    V[0][2] = v2[0]; V[1][2] = v2[1]; V[2][2] = v2[2];
  }

  return { U, S, V };
}

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
  const nonHAtoms = atoms.filter(a => !a.name.startsWith("H") && a.name !== "OXT");
  let clashCount = 0;
  
  const grid = new Map<string, PdbAtom[]>();
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
            if (atom.x > other.x || (atom.x === other.x && atom.y > other.y) || (atom.x === other.x && atom.y === other.y && atom.z >= other.z)) {
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

export function getKabschTransform(
  refPoints: { x: number; y: number; z: number }[],
  targetPoints: { x: number; y: number; z: number }[]
): { R: Matrix3; centroidRef: { x: number; y: number; z: number }; centroidTarget: { x: number; y: number; z: number } } {
  const n = refPoints.length;
  if (n === 0) {
    throw new Error("No points for Kabsch transform");
  }
  
  let centroidRef = { x: 0, y: 0, z: 0 };
  let centroidTarget = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < n; i++) {
    centroidRef.x += refPoints[i].x;
    centroidRef.y += refPoints[i].y;
    centroidRef.z += refPoints[i].z;
    centroidTarget.x += targetPoints[i].x;
    centroidTarget.y += targetPoints[i].y;
    centroidTarget.z += targetPoints[i].z;
  }
  centroidRef.x /= n; centroidRef.y /= n; centroidRef.z /= n;
  centroidTarget.x /= n; centroidTarget.y /= n; centroidTarget.z /= n;
  
  let H: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (let i = 0; i < n; i++) {
    const px = refPoints[i].x - centroidRef.x;
    const py = refPoints[i].y - centroidRef.y;
    const pz = refPoints[i].z - centroidRef.z;
    const qx = targetPoints[i].x - centroidTarget.x;
    const qy = targetPoints[i].y - centroidTarget.y;
    const qz = targetPoints[i].z - centroidTarget.z;
    
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
  return { R, centroidRef, centroidTarget };
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
            if (other.resSeq === atom.resSeq && other.name === atom.name) continue;
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

export interface AlignedStructuralDiffResult {
  alignedMutPdb: string;
  globalRmsd: number;
  localWindowRmsd: number;
  windowRadius: number;
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
  chain: string
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

  centroidWt.x /= n; centroidWt.y /= n; centroidWt.z /= n;
  centroidMut.x /= n; centroidMut.y /= n; centroidMut.z /= n;

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

    sumSqDist += Math.pow(wtCas.find(a => a.resSeq === matchedWt[i].resSeq && a.chain === chain)!.x - ax, 2) +
                 Math.pow(wtCas.find(a => a.resSeq === matchedWt[i].resSeq && a.chain === chain)!.y - ay, 2) +
                 Math.pow(wtCas.find(a => a.resSeq === matchedWt[i].resSeq && a.chain === chain)!.z - az, 2);
  }
  const globalRmsd = Math.sqrt(sumSqDist / n);

  // Compute per-residue displacements within LOCAL_STRUCTURAL_WINDOW
  const displacements: { resSeq: number; resName: string; displacement: number }[] = [];
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

        const wtCaMatch = matchedWt.find(a => a.resSeq === resSeq && a.chain === chainId);
        let disp = 0.0;
        if (wtCaMatch) {
          const mutCaMatch = matchedMut.find(a => a.resSeq === resSeq && a.chain === chainId);
          if (mutCaMatch) {
            const mqx = mutCaMatch.x - centroidMut.x;
            const mqy = mutCaMatch.y - centroidMut.y;
            const mqz = mutCaMatch.z - centroidMut.z;
            const max = R_inv[0][0] * mqx + R_inv[0][1] * mqy + R_inv[0][2] * mqz + centroidWt.x;
            const may = R_inv[1][0] * mqx + R_inv[1][1] * mqy + R_inv[1][2] * mqz + centroidWt.y;
            const maz = R_inv[2][0] * mqx + R_inv[2][1] * mqy + R_inv[2][2] * mqz + centroidWt.z;
            disp = Math.sqrt(Math.pow(wtCaMatch.x - max, 2) + Math.pow(wtCaMatch.y - may, 2) + Math.pow(wtCaMatch.z - maz, 2));
          }
        }

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

  // Secondary metrics
  // 1. Contact Map
  const wtContacts = calculateContacts(wtAtoms, pos, chain);
  const mutContacts = calculateContacts(mutAtoms, pos, chain);
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
  const wtHBonds = calculateHBonds(wtAtoms, pos, chain);
  const mutHBonds = calculateHBonds(mutAtoms, pos, chain);
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
  const wtSasa = calculateResidueSasa(wtAtoms, pos, chain);
  const mutSasa = calculateResidueSasa(mutAtoms, pos, chain);
  const sasaChange = parseFloat((mutSasa - wtSasa).toFixed(2));

  // 4. Chi1 Dihedral
  const wtChi1 = calculateChi1Dihedral(wtAtoms, pos, chain);
  const mutChi1 = calculateChi1Dihedral(mutAtoms, pos, chain);
  const chi1Deviation = calculateChi1Deviation(wtChi1, mutChi1);

  return {
    alignedMutPdb,
    globalRmsd: parseFloat(globalRmsd.toFixed(4)),
    localWindowRmsd: parseFloat(localWindowRmsd.toFixed(4)),
    windowRadius: LOCAL_STRUCTURAL_WINDOW,
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


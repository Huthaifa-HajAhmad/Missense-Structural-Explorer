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
import { calculateLocalSidechainRmsd } from "./biophysics.ts";


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
  const cacheKey = `${seq.length}_${pos}_${wt}_${mut}`;
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
      body: JSON.stringify({ sequence: seq, position: pos, wt, mut })
    });
    if (res.ok) {
      const parsed = await res.json();
      if (parsed.status === "success" && typeof parsed.llr === "number") {
        const result = { llr: parsed.llr, verdict: parsed.verdict };
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

export function calculateClashes(atoms: PdbAtom[]): number {
  const clashThreshold = 2.2;
  const nonHAtoms = atoms.filter(a => !a.name.startsWith("H") && a.name !== "OXT");
  let clashCount = 0;
  
  const grid = new Map<string, PdbAtom[]>();
  const cellSize = 3.0;
  
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
            const distSq = Math.pow(atom.x - other.x, 2) + Math.pow(atom.y - other.y, 2) + Math.pow(atom.z - other.z, 2);
            if (distSq < clashThreshold * clashThreshold) {
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

  const matchedWt: PdbAtom[] = [];
  const matchedMut: PdbAtom[] = [];

  for (const wtCa of wtCas) {
    const mutCa = mutCas.find(a => a.resSeq === wtCa.resSeq && a.chain === wtCa.chain);
    if (mutCa) {
      matchedWt.push(wtCa);
      matchedMut.push(mutCa);
    }
  }

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

    const ax = px * R[0][0] + py * R[1][0] + pz * R[2][0] + centroidMut.x;
    const ay = px * R[0][1] + py * R[1][1] + pz * R[2][1] + centroidMut.y;
    const az = px * R[0][2] + py * R[1][2] + pz * R[2][2] + centroidMut.z;

    const qx = matchedMut[i].x;
    const qy = matchedMut[i].y;
    const qz = matchedMut[i].z;

    sumSqDist += Math.pow(ax - qx, 2) + Math.pow(ay - qy, 2) + Math.pow(az - qz, 2);
  }
  const rmsd = Math.sqrt(sumSqDist / n);

  const windowDisplacements: { resSeq: number; resName: string; displacement: number }[] = [];
  for (let r = pos - 5; r <= pos + 5; r++) {
    const idx = matchedWt.findIndex(a => a.resSeq === r && a.chain === chain);
    if (idx !== -1) {
      const wtCa = matchedWt[idx];
      const mutCa = matchedMut[idx];

      const px = wtCa.x - centroidWt.x;
      const py = wtCa.y - centroidWt.y;
      const pz = wtCa.z - centroidWt.z;

      const ax = px * R[0][0] + py * R[1][0] + pz * R[2][0] + centroidMut.x;
      const ay = px * R[0][1] + py * R[1][1] + pz * R[2][1] + centroidMut.y;
      const az = px * R[0][2] + py * R[1][2] + pz * R[2][2] + centroidMut.z;

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

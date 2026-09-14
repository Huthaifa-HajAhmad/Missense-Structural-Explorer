/**
 * geometry.ts — 3x3 Matrix, SVD (Jacobi iteration) and Kabsch Superposition
 */
export type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number]
];

export function transpose3x3(m: Matrix3): Matrix3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]]
  ];
}

export function multiply3x3(a: Matrix3, b: Matrix3): Matrix3 {
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

export function det3x3(m: Matrix3): number {
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
        const signZeta = Math.sign(zeta) || 1;
        let t = signZeta / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
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

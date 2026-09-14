import { describe, it, expect } from "vitest";
import {
  multiply3x3,
  transpose3x3,
  det3x3,
  svd3,
  getKabschTransform,
  type Matrix3,
} from "./geometry.ts";

describe("structural-diff/geometry pure math utilities", () => {
  const identity: Matrix3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  it("multiply3x3 correctly multiplies matrices", () => {
    const A: Matrix3 = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const product = multiply3x3(A, identity);
    expect(product).toEqual(A);

    const B: Matrix3 = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ];
    const scaled = multiply3x3(A, B);
    expect(scaled).toEqual([
      [2, 4, 6],
      [8, 10, 12],
      [14, 16, 18],
    ]);
  });

  it("transpose3x3 computes matrix transpose", () => {
    const A: Matrix3 = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const At = transpose3x3(A);
    expect(At).toEqual([
      [1, 4, 7],
      [2, 5, 8],
      [3, 6, 9],
    ]);
    expect(transpose3x3(identity)).toEqual(identity);
  });

  it("det3x3 calculates 3x3 determinants accurately", () => {
    expect(det3x3(identity)).toBe(1);

    const diag: Matrix3 = [
      [2, 0, 0],
      [0, 3, 0],
      [0, 0, 4],
    ];
    expect(det3x3(diag)).toBe(24);

    const singular: Matrix3 = [
      [1, 2, 3],
      [2, 4, 6],
      [0, 1, 0],
    ];
    expect(det3x3(singular)).toBe(0);
  });

  it("svd3 decomposes identity and diagonal matrices", () => {
    const { U, S, V } = svd3(identity);
    expect(S[0]).toBeCloseTo(1, 4);
    expect(S[1]).toBeCloseTo(1, 4);
    expect(S[2]).toBeCloseTo(1, 4);

    const diag: Matrix3 = [
      [5, 0, 0],
      [0, 2, 0],
      [0, 0, 1],
    ];
    const svdDiag = svd3(diag);
    expect(svdDiag.S[0]).toBeCloseTo(5, 4);
    expect(svdDiag.S[1]).toBeCloseTo(2, 4);
    expect(svdDiag.S[2]).toBeCloseTo(1, 4);
  });

  it("svd3 handles rank-deficient matrices gracefully", () => {
    const rank2: Matrix3 = [
      [1, 0, 0],
      [0, 2, 0],
      [0, 0, 0],
    ];
    const res = svd3(rank2);
    expect(res.S[0]).toBeGreaterThanOrEqual(1);
    expect(res.U).toBeDefined();
    expect(res.V).toBeDefined();
  });

  it("getKabschTransform calculates identity superposition for identical point clouds", () => {
    const points = [
      { x: 0.1, y: 0.2, z: 0.3 },
      { x: 1.5, y: 0.1, z: 0.2 },
      { x: 0.3, y: 2.4, z: 0.1 },
      { x: 0.2, y: 0.3, z: 3.2 },
    ];

    const { R, centroidRef, centroidTarget } = getKabschTransform(points, points);
    expect(centroidRef.x).toBeCloseTo(centroidTarget.x, 3);
    expect(centroidRef.y).toBeCloseTo(centroidTarget.y, 3);
    expect(centroidRef.z).toBeCloseTo(centroidTarget.z, 3);
    expect(R[0][0]).toBeCloseTo(1, 4);
    expect(R[1][1]).toBeCloseTo(1, 4);
    expect(R[2][2]).toBeCloseTo(1, 4);
  });

  it("getKabschTransform handles translated asymmetric point clouds", () => {
    const target = [
      { x: 0.1, y: 0.2, z: 0.3 },
      { x: 1.5, y: 0.1, z: 0.2 },
      { x: 0.3, y: 2.4, z: 0.1 },
      { x: 0.2, y: 0.3, z: 3.2 },
    ];
    // Translated by (10, 20, 30)
    const moving = target.map(p => ({
      x: p.x + 10,
      y: p.y + 20,
      z: p.z + 30,
    }));

    const { R, centroidRef, centroidTarget } = getKabschTransform(target, moving);
    expect(centroidRef.x).toBeCloseTo(0.525, 3);
    expect(centroidRef.y).toBeCloseTo(0.75, 3);
    expect(centroidRef.z).toBeCloseTo(0.95, 3);
    expect(centroidTarget.x).toBeCloseTo(10.525, 3);
    expect(centroidTarget.y).toBeCloseTo(20.75, 3);
    expect(centroidTarget.z).toBeCloseTo(30.95, 3);
    expect(R[0][0]).toBeCloseTo(1, 4);
    expect(R[1][1]).toBeCloseTo(1, 4);
    expect(R[2][2]).toBeCloseTo(1, 4);
  });

  it("getKabschTransform throws on empty point sets", () => {
    expect(() => getKabschTransform([], [])).toThrow();
  });
});

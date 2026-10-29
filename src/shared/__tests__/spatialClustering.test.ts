/**
 * spatialClustering — the 3D reading the Hotspots view shows and the pre-registered benchmark graded
 * (scripts/hotspot_benchmark). Synthetic geometry, so each property is checked against a known answer.
 */
import { describe, it, expect } from "vitest";
import { spatialClustering, SPATIAL_DEFAULTS } from "../spatialClustering";

/** A 10 × 10 × 3 lattice of residues 3.8 Å apart, numbered 1…300. */
const lattice = (() => {
  const residues: number[] = [];
  const coords: number[] = [];
  let n = 0;
  for (let z = 0; z < 3; z++) for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    residues.push(++n);
    coords.push(x * 3.8, y * 3.8, z * 3.8);
  }
  return { residues, coords };
})();
const at = (x: number, y: number, z: number) => z * 100 + y * 10 + x + 1;
const corner = [0, 1, 2].flatMap((x) => [0, 1, 2].map((y) => at(x, y, 0)));
const spread = [at(9, 9, 2), at(9, 0, 2), at(0, 9, 2), at(5, 5, 1), at(9, 5, 0), at(5, 9, 0), at(0, 5, 2), at(7, 2, 1), at(2, 7, 1)];

describe("spatialClustering (Sivley et al. 2018)", () => {
  const input = { ...lattice, pathogenic: corner, neutral: spread, permutations: 500 };

  it("finds pathogenic residues packed in one corner clustered, against random residues and against population residues", () => {
    const r = spatialClustering(input)!;
    expect(r.univariate.area).toBeGreaterThan(0);
    expect(r.univariate.p).toBeLessThan(0.05);
    expect(r.bivariate.area).toBeGreaterThan(0);
    expect(r.bivariate.p).toBeLessThan(0.05);
    expect(r.clustered).toBe(true);
  });

  it("scores a residue inside the cluster above one beside the population residues, leaving each residue's own entry out", () => {
    const r = spatialClustering(input)!;
    expect(r.threshold).not.toBeNull();
    expect(r.scores.get(at(1, 1, 0))!).toBeGreaterThan(0);
    expect(r.scores.get(at(9, 9, 2))!).toBeLessThan(r.scores.get(at(1, 1, 0))!);
  });

  it("does not call scattered pathogenic residues clustered", () => {
    const r = spatialClustering({ ...lattice, pathogenic: spread, neutral: corner.concat(spread.slice(0, 3)), permutations: 500 })!;
    expect(r.clustered).toBe(false);
  });

  it("leaves a residue out of both sets when it is in both, so its own zero distance cannot count as a neighbour", () => {
    // The shared residue is in P and N. With self-inclusion its distance to itself (0 A) counts as one
    // pathogenic neighbour and one population neighbour; the published leave-residue-out rule excludes both.
    const shared = at(5, 5, 1);
    const r = spatialClustering({ ...lattice, pathogenic: [...corner, shared], neutral: [...spread, shared], permutations: 500 })!;
    const t = r.threshold!;
    expect(t).not.toBeNull();
    const xyz = (res: number) => {
      const i = res - 1;
      return [lattice.coords[3 * i], lattice.coords[3 * i + 1], lattice.coords[3 * i + 2]];
    };
    // The module stores distances in a Float32Array; replicate that rounding so the comparison is exact.
    const d = (a: number, b: number) => Math.fround(Math.hypot(xyz(a)[0] - xyz(b)[0], xyz(a)[1] - xyz(b)[1], xyz(a)[2] - xyz(b)[2]));
    const P = [...corner, shared], N = [...spread, shared];
    const pn = P.filter((j) => j !== shared).length, nn = N.filter((j) => j !== shared).length;
    const pk = P.filter((j) => j !== shared && d(shared, j) <= t).length;
    const nk = N.filter((j) => j !== shared && d(shared, j) <= t).length;
    expect(r.scores.get(shared)!).toBeCloseTo(pk / pn - nk / nn, 12);
    // The self-included value would be strictly larger: (pk+1)/(pn+1) - (nk+1)/(nn+1) is not this score.
    expect(r.scores.get(shared)!).not.toBeCloseTo((pk + 1) / (pn + 1) - (nk + 1) / (nn + 1), 12);
  });

  it("is seeded: the same input gives the same p-values", () => {
    expect(spatialClustering(input)!.bivariate.p).toBe(spatialClustering(input)!.bivariate.p);
  });

  it("refuses fewer than 3 positions in a set (the paper's minimum)", () => {
    expect(spatialClustering({ ...lattice, pathogenic: corner.slice(0, 2), neutral: spread })).toBeNull();
  });

  it("ignores residues the structure does not contain", () => {
    const r = spatialClustering({ ...input, pathogenic: [...corner, 9999] })!;
    expect(r.pathogenicResidues).toBe(corner.length);
  });

  it("keeps the pre-registered defaults", () => {
    expect(SPATIAL_DEFAULTS).toEqual({ permutations: 2000, steps: 40, seed: 20261028 });
  });
});

import { describe, expect, it } from "vitest";
import { runSpatialClustering } from "./structural-diff-worker.ts";

/**
 * The worker task the Hotspots view runs the 3D statistic through: plain arrays across the thread, and the in-gene
 * self-check the view prints. A 10 x 10 x 3 lattice of residues 3.8 A apart, numbered 1..300, with the pathogenic
 * residues packed in one corner and the population residues spread, so the answer is known.
 */
const residues: number[] = [];
const coords: number[] = [];
let n = 0;
for (let z = 0; z < 3; z++) for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { residues.push(++n); coords.push(x * 3.8, y * 3.8, z * 3.8); }
const at = (x: number, y: number, z: number) => z * 100 + y * 10 + x + 1;
const corner = [0, 1, 2, 3].flatMap((x) => [0, 1, 2].map((y) => at(x, y, 0)));
const spread = [...new Set([...Array(12)].map((_, i) => at((i * 7) % 10, (i * 3 + 5) % 10, 1 + (i % 2))))]; // distinct residues

describe("runSpatialClustering (worker task)", () => {
  it("returns plain arrays, not a Map, so the result can cross the thread", async () => {
    const r = (await runSpatialClustering({ residues, coords, pathogenic: corner, neutral: spread }))!;
    expect(r.clustered).toBe(true);
    expect(Array.isArray(r.scores)).toBe(true);
    expect(r.scores.every(([residue, score]) => Number.isInteger(residue) && Number.isFinite(score))).toBe(true);
  });

  it("scores a pathogenic-corner residue above a population residue, and gives the in-gene AUROC the benchmark defines", async () => {
    const r = (await runSpatialClustering({ residues, coords, pathogenic: corner, neutral: spread }))!;
    const score = new Map(r.scores);
    expect(score.get(corner[0])!).toBeGreaterThan(score.get(spread[0])!);
    expect(r.selfCheck).toMatchObject({ pathogenic: corner.length, neutral: spread.length });
    expect(r.selfCheck!.auroc).toBeGreaterThan(0.9); // every corner residue outranks every spread residue
  });

  it("reports no self-check when one class is empty after the sets are separated, and null for a set below the method's minimum", async () => {
    const r = (await runSpatialClustering({ residues, coords, pathogenic: corner, neutral: corner }))!;
    expect(r.selfCheck).toBeNull(); // the neutral set is the pathogenic set: no gnomAD-only residue to compare against
    expect(await runSpatialClustering({ residues, coords, pathogenic: corner.slice(0, 2), neutral: spread })).toBeNull();
  });
});

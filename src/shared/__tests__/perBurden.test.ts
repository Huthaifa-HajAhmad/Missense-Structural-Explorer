/**
 * perBurden — the port of dlal-group/PERs Part-2-burden-analysis.R. The hypergeometric tail is checked
 * against exact rational arithmetic, and the windowing and merging against the R loop's rules.
 */
import { describe, it, expect } from "vitest";
import { fisherGreater, perBurden, PER_METHOD } from "../perBurden";
import vhl from "./fixtures/hotspotsVhl.json";

/** Exact P(X ≥ a) with BigInt binomials: an independent implementation of the same tail. */
function exactGreater(a: number, b: number, c: number, d: number): number {
  const choose = (n: number, k: number): bigint => {
    if (k < 0 || k > n) return 0n;
    let r = 1n;
    for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
    return r;
  };
  const r1 = a + c, c1 = a + b, n = a + b + c + d;
  let num = 0n;
  for (let x = a; x <= Math.min(r1, c1); x++) num += choose(r1, x) * choose(n - r1, c1 - x);
  const den = choose(n, c1);
  return Number((num * 10n ** 15n) / den) / 1e15;
}

describe("PER burden test (Pérez-Palma et al. 2020)", () => {
  it.each([[5, 2, 62, 87], [8, 4, 62, 160], [1, 4, 2, 361], [9, 0, 10, 50], [0, 9, 20, 40]])("Fisher one-sided tail for [[%i, %i], [%i, %i]] matches exact arithmetic", (a, b, c, d) => {
    expect(fisherGreater(a, b, c, d)).toBeCloseTo(exactGreater(a, b, c, d), 10);
  });

  it("centres 9-residue windows every 5 residues from residue 5 to length − 4, as the R loop does", () => {
    const r = perBurden([], [], 30);
    expect(PER_METHOD).toEqual({ halfWindow: 4, step: 5, alpha: 0.05 });
    expect(r.windows).toBe(5); // centres 5, 10, 15, 20, 25; 30 is past length − 4 = 26
  });

  it("finds a dense patient stretch with no population hits and merges adjacent significant windows", () => {
    const patient = Array.from({ length: 20 }, (_, i) => 41 + i); // 41–60
    const population = Array.from({ length: 200 }, (_, i) => i + 1).filter((r) => r < 36 || r > 65);
    const r = perBurden(patient, population, 200);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0].start).toBeLessThanOrEqual(41);
    expect(r.regions[0].end).toBeGreaterThanOrEqual(56);
    expect(r.regions[0].minAdjP).toBeLessThan(0.05);
  });

  it("finds nothing when patient residues are spread evenly along a protein the population also covers", () => {
    const all = Array.from({ length: 200 }, (_, i) => i + 1);
    const r = perBurden(all.filter((x) => x % 10 === 0), all, 200);
    expect(r.regions).toEqual([]);
    expect(r.best).not.toBeNull();
  });

  it("applies Bonferroni over the protein's windows", () => {
    const r = perBurden([10, 11, 12], [100, 101], 150);
    expect(r.best!.adjP).toBeCloseTo(Math.min(1, r.best!.p * r.windows), 12);
  });

  it("agrees with the independent Python probe on VHL (scripts/hotspot_probe/per_probe.py): best 151–159, 8 vs 4, adjusted p 0.317", () => {
    const d = vhl.distribution;
    const r = perBurden(d.plp.map((p) => p.pos), d.gnomad.filter((g) => g.pass > 0).map((g) => g.pos), d.length!);
    expect(r.regions).toEqual([]);
    expect([r.best!.start, r.best!.end, r.best!.patient, r.best!.population]).toEqual([151, 159, 8, 4]);
    expect(r.best!.adjP).toBeCloseTo(0.317, 2);
  });
});

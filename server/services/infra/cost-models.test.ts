import { describe, it, expect } from "vitest";
import { buildCostModels, fitPowerLaw, oomCeiling, type TelemetrySample } from "./cost-models.ts";
import { costModelKey, decidePlacement, DEFAULT_ROUTING_POLICY, type HostFeatures } from "../../../src/shared/computeRouting.ts";

const CLASS = "arm64-emulated-2c-12g";

function sample(residues: number, wallMs: number, over: Partial<TelemetrySample> = {}): TelemetrySample {
  return { type: "foldx", hostClass: CLASS, residues, wallMs, peakRssBytes: null, outcome: "completed", ...over };
}

describe("fitPowerLaw", () => {
  it("recovers an exact power law", () => {
    const fit = fitPowerLaw([100, 200, 400, 800].map((x) => ({ x, y: 3 * x ** 1.44 })));
    expect(fit?.b).toBeCloseTo(1.44, 6);
    expect(Math.exp(fit?.a ?? 0)).toBeCloseTo(3, 6);
    expect(fit?.p90Ratio).toBeCloseTo(1, 6);
  });

  it("cannot define a slope from a single size", () => {
    expect(fitPowerLaw([{ x: 154, y: 9600 }, { x: 154, y: 9900 }])).toBeNull();
  });

  it("ignores non-positive and non-finite points", () => {
    expect(fitPowerLaw([{ x: 0, y: 1 }, { x: 10, y: Number.NaN }, { x: 20, y: -1 }])).toBeNull();
  });

  it("p90Ratio reflects scatter and never falls below 1", () => {
    const pts = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((x, i) => ({ x, y: x * (i % 2 === 0 ? 1.3 : 0.7) }));
    const fit = fitPowerLaw(pts);
    expect(fit?.p90Ratio).toBeGreaterThan(1.2);
  });
});

describe("oomCeiling", () => {
  it("is the smallest size that ran out of memory, sticky after two at that size", () => {
    const rows = [sample(1200, 0, { outcome: "oom" }), sample(1000, 0, { outcome: "oom" }), sample(800, 5000)];
    expect(oomCeiling(rows)).toEqual({ residues: 1000, sticky: false });
    expect(oomCeiling([...rows, sample(1000, 0, { outcome: "oom" })])).toEqual({ residues: 1000, sticky: true });
    expect(oomCeiling([sample(800, 5000)])).toBeNull();
  });
});

describe("buildCostModels", () => {
  it("fits only completed jobs, counts them, and keys by type and host class", () => {
    const rows = [
      sample(154, 9600),
      sample(489, 52_000),
      sample(1085, 167_200),
      sample(1300, 0, { outcome: "timeout" }),
      sample(1400, 0, { outcome: "oom" }),
      { ...sample(300, 20_000), type: "p2rank" as const },
    ];
    const models = buildCostModels(rows);
    const foldx = models[costModelKey("foldx", CLASS)];
    expect(foldx.samples).toBe(3);
    expect(foldx.maxCompletedResidues).toBe(1085);
    // One out-of-memory death is not enough to enforce a ceiling (it may be misclassified).
    expect(foldx.oomCeilingResidues).toBeNull();
    const twice = buildCostModels([...rows, sample(1600, 0, { outcome: "oom" })]);
    // Two deaths: the ceiling is the smallest size at or below which the host died twice.
    expect(twice[costModelKey("foldx", CLASS)].oomCeilingResidues).toBe(1600);
    expect(foldx.wall?.b).toBeGreaterThan(1);
    expect(foldx.peakRam).toBeNull();
    expect(foldx.peakRamSamples).toBe(0); // no row carried a peak
    expect(models[costModelKey("p2rank", CLASS)].samples).toBe(1);
    expect(Object.isFrozen(models)).toBe(true);
  });

  it("counts only MEASURED peaks toward the memory fit, so cache hits cannot gate it", () => {
    const MiB = 1024 * 1024;
    const measured = Array.from({ length: 8 }, (_, i) => sample(200 + i * 100, 40 * (200 + i * 100), { peakRssBytes: (200 + i * 100) * MiB }));
    const cacheHits = Array.from({ length: 20 }, () => sample(500, 5, { peakRssBytes: null }));
    const foldx = buildCostModels([...measured, ...cacheHits])[costModelKey("foldx", CLASS)];
    expect(foldx.samples).toBe(28); // every completed row counts toward the wall fit
    expect(foldx.peakRamSamples).toBe(8); // but only the measured ones toward memory
    expect(foldx.peakRam).not.toBeNull();
  });

  it("feeds the engine: with enough samples the server prediction is measured", () => {
    const rows = Array.from({ length: 8 }, (_, i) => sample(200 + i * 100, 40 * (200 + i * 100)));
    const server: HostFeatures = {
      id: "server", kind: "server", ownerId: null, label: "the shared server", online: true,
      arch: "arm64", emulated: true, os: "linux", cores: 2, totalRamBytes: 12 * 1024 ** 3, freeRamBytes: 6 * 1024 ** 3,
      tools: [{ name: "foldx", version: "5.1", verified: true }], runningJobs: 0, runningCostMs: 0, queuedCostMs: 0,
      linkRttMs: null, leaseLossRate: 0, minFreeBytes: 500 * 1024 ** 2,
    };
    const d = decidePlacement(
      { type: "foldx", residues: 500, chains: 1, numberOfRuns: 5, repair: false, ownerId: "u1", requires: [{ tool: "foldx" }] },
      [server], DEFAULT_ROUTING_POLICY, buildCostModels(rows),
    );
    expect(d.prediction?.basis).toBe("measured");
    expect(d.prediction?.wallMs?.p50).toBe(20_000);
  });
});

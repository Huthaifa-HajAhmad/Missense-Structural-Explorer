/**
 * perBurden.ts against the Python burden test (scripts/hotspot_probe/per_probe.py `burden`), replayed from
 * fixtures/perBurdenGolden.json (written by scripts/hotspot_probe/make_golden.py). Both sides get the same
 * residue sets and length, so this checks the two ports, not the live data.
 *
 * Compared, for SOD1, VHL, SYNTH_ONE_REGION and SYNTH_TWO_REGIONS:
 *   • window count, patient and population residue counts, sequence length: exact;
 *   • regions: start and end exact, minAdjP to relative 1e-9;
 *   • best window (smallest raw p, first on ties): centre, start, end, patient and population hits exact,
 *     p and adjP to relative 1e-9.
 * Not compared: the other windows' p and adjP. perBurden returns only the window count and the best window, so
 * those are checked only through the regions they produce. Not covered: the Ripley/3D probe, whose permutation
 * p-values use a different RNG (seeded mulberry32 in TS, Python random) and cannot match bit for bit.
 */
import { describe, it, expect } from "vitest";
import { perBurden } from "../perBurden";
import golden from "./fixtures/perBurdenGolden.json";

interface GoldenWindow {
  centre: number;
  start: number;
  end: number;
  patient: number;
  population: number;
  p: number;
  adjP: number;
}

interface GoldenBurden {
  length: number;
  patientResidues: number;
  populationResidues: number;
  windows: GoldenWindow[];
  regions: Array<{ start: number; end: number; minAdjP: number }>;
}

const cases = Object.keys(golden.inputs) as Array<keyof typeof golden.inputs>;
const REL = 1e-9;

/** Relative, so tiny p-values are held to the same precision as p near 1. */
function expectRelative(actual: number, expected: number) {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(REL * Math.abs(expected));
}

describe("perBurden matches the Python burden test on the golden cases", () => {
  it.each(cases)("%s", (name) => {
    const input = golden.inputs[name];
    const expected: GoldenBurden = golden.outputs[name];
    const actual = perBurden(input.patient, input.population, input.length);

    expect(actual.length).toBe(expected.length);
    expect(actual.patientResidues).toBe(expected.patientResidues);
    expect(actual.populationResidues).toBe(expected.populationResidues);
    expect(actual.windows).toBe(expected.windows.length);

    expect(actual.regions.map(({ start, end }) => [start, end])).toEqual(expected.regions.map(({ start, end }) => [start, end]));
    actual.regions.forEach((r, i) => expectRelative(r.minAdjP, expected.regions[i].minAdjP));

    const best = expected.windows.reduce((acc, w) => (w.p < acc.p ? w : acc));
    const b = actual.best!;
    expect([b.centre, b.start, b.end, b.patient, b.population]).toEqual([best.centre, best.start, best.end, best.patient, best.population]);
    expectRelative(b.p, best.p);
    expectRelative(b.adjP, best.adjP);
  });

  it("exercises the merge rule: one region for one stretch, two for two separated stretches", () => {
    const one = golden.inputs.SYNTH_ONE_REGION;
    const two = golden.inputs.SYNTH_TWO_REGIONS;
    expect(perBurden(one.patient, one.population, one.length).regions).toHaveLength(1);
    expect(perBurden(two.patient, two.population, two.length).regions).toHaveLength(2);
  });
});

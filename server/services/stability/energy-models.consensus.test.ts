import { describe, it, expect } from "vitest";
import { enrichBiophysicalResult } from "./energy-models.ts";

/**
 * The stored consensus must count every engine that returned a value. An earlier version of the poll
 * routes computed it from a five-engine subset, so the exported verdict disagreed with the screen.
 * Here each engine is given the only value in the run, and must be counted.
 */
const FOLDX_ONLY = { pdb: "MUTANT_PDB", ddG: 2.5, status: "success" as const, foldedResidueIndex: 489, energetics: { foldxMean: 2.5 } };
const NO_FOLDX = { pdb: "MUTANT_PDB", ddG: null, status: "success" as const, foldedResidueIndex: 489, energetics: {} };

const REMOTE_ENGINES = [
  ["RaSP", { raspStatus: "done", raspVal: 2.5 }],
  ["ThermoMPNN", { thermompnnStatus: "done", thermompnnVal: 2.5 }],
  ["StabilityOracle", { stabilityoracleStatus: "done", stabilityoracleVal: 2.5 }],
  ["DynaMut2", { dynamut2Status: "done", dynamut2Val: 2.5 }],
  ["DDMut", { ddmutStatus: "done", ddmutVal: 2.5 }],
] as const;

describe("enrichBiophysicalResult — the consensus counts every engine", () => {
  it("counts local FoldX", () => {
    expect(enrichBiophysicalResult(FOLDX_ONLY, null, null, 489).energetics.consensusEnginesCounted).toBe(1);
  });

  it.each(REMOTE_ENGINES)("counts %s", (_name, jobs) => {
    expect(enrichBiophysicalResult(NO_FOLDX, jobs, null, 489).energetics.consensusEnginesCounted).toBe(1);
  });

  it("counts all six when all six returned a value", () => {
    const jobs = Object.assign({}, ...REMOTE_ENGINES.map(([, fields]) => fields));
    expect(enrichBiophysicalResult(FOLDX_ONLY, jobs, null, 489).energetics.consensusEnginesCounted).toBe(6);
  });
});

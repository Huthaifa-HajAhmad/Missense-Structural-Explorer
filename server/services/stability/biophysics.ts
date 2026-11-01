/**
 * biophysics.ts — Re-export barrel.
 * All biophysical service modules have been extracted into focused files.
 */
import * as energyModels from "./energy-models.ts";

export * from "../structure/pdb-parser.ts";
export * from "./foldx.ts";
export * from "../structure/pocket.ts";
export * from "../structure/structural-diff.ts";

export const initializeRaspDatabase = energyModels.initializeRaspDatabase;
export const getRaspCoverage = energyModels.getRaspCoverage;

export let lookupPrecomputedRaspScore = energyModels.lookupPrecomputedRaspScore;

export async function runRaspLocal(
  wtPdbPath: string,
  mutPdbPath: string,
  chain: string,
  pos: number,
  wtAa: string,
  mutAa: string,
  uniprotId?: string | null
) {
  if (typeof exports !== "undefined" && exports.lookupPrecomputedRaspScore && exports.lookupPrecomputedRaspScore !== energyModels.lookupPrecomputedRaspScore) {
    if (uniprotId) {
      return exports.lookupPrecomputedRaspScore(uniprotId, pos, wtAa, mutAa);
    }
  }
  return energyModels.runRaspLocal(wtPdbPath, mutPdbPath, chain, pos, wtAa, mutAa, uniprotId);
}

export const thermompnnCache = energyModels.thermompnnCache;
export const testTamarindConnection = energyModels.testTamarindConnection;
export const submitThermoMpnnJob = energyModels.submitThermoMpnnJob;
export const pollThermoMpnnJob = energyModels.pollThermoMpnnJob;
export const enrichBiophysicalResult = energyModels.enrichBiophysicalResult;
export const RASP_STORE_UNAVAILABLE_REASON = energyModels.RASP_STORE_UNAVAILABLE_REASON;
export { runStabilityOracleAnalysis } from "./stabilityoracle.ts";
export { runStabilityOracleAnalysisDetailed } from "./stabilityoracle.ts";
export type { StabilityOracleOutcome } from "./stabilityoracle.ts";


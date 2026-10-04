import { CONFIG } from "../../../config.ts";

/**
 * Structures above this size skip RepairPDB (a cost guard; see runner.ts). Shared with the budget
 * test, which relies on it: a long BuildModel and a RepairPDB can never stack in one job.
 */
export const FOLDX_REPAIR_MAX_RESIDUES = 400;

export interface BuildModelBudgetInput {
  residueCount: number;
  numberOfRuns: number;
  /** True when FoldX runs through Box64 (x86_64 binary on ARM64). */
  emulated: boolean;
}

type BudgetTimeouts = Pick<
  typeof CONFIG.timeouts,
  "foldxBuildModelMs" | "foldxBuildModelMaxMs" | "foldxEmulatedFixedMs" | "foldxEmulatedMsPerResidueRun"
>;

/**
 * The BuildModel subprocess cap for THIS structure on THIS host.
 *
 * WHY IT IS NOT A CONSTANT
 * ------------------------
 * A flat 180 s killed a run that was working. Measured on the OCI host (2 vCPU ARM64, Box64) with
 * `npm run foldx:timing`, SLC12A4 (1,085 residues) took 44.0 s for one run and 167.2 s for five:
 * 13.3 s fixed plus 30.8 s per run, ~60x native. The flat cap left a 7% margin on an idle VM.
 *
 * Under emulation the cap is twice a linear cost model, clamped to
 * [foldxBuildModelMs, foldxBuildModelMaxMs]:
 *
 *   2 x (foldxEmulatedFixedMs + runs x residues x foldxEmulatedMsPerResidueRun)
 *
 * Emulated cost is SUPERLINEAR: SOD1 (154 residues) took 9.6 s and SLC12A4 161–167 s, i.e.
 * ~residues^1.44. The linear model with 2x headroom still covers that up to ~2,500 residues; above
 * it the 600 s ceiling binds and a 5-run job may not finish (AlphaFold DB fragments chains longer
 * than ~2,700). Native hosts finish 5 runs on 875 residues in under 5 s and keep the floor.
 *
 * Do not lower `foldxEmulatedMsPerResidueRun` to a fresh measurement: this is a ceiling, and
 * lowering it only removes margin.
 *
 * The clamp keeps the job inside `foldxSec`: structures this large skip RepairPDB, so the long
 * BuildModel never shares a job with the 420 s repair (asserted in foldx-timeout-budget.test.ts).
 */
export function buildModelBudgetMs(input: BuildModelBudgetInput, t: BudgetTimeouts = CONFIG.timeouts): number {
  if (!input.emulated) return t.foldxBuildModelMs;
  const modelled = 2 * (t.foldxEmulatedFixedMs + input.numberOfRuns * input.residueCount * t.foldxEmulatedMsPerResidueRun);
  return Math.round(Math.min(t.foldxBuildModelMaxMs, Math.max(t.foldxBuildModelMs, modelled)));
}

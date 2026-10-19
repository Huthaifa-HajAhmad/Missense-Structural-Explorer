import { CONFIG } from "../../../config.ts";
import { FOLDX_REPAIR_MAX_RESIDUES } from "../../../../src/shared/computeRouting.ts";

/**
 * Structures above this size skip RepairPDB (a cost guard; see runner.ts). Shared with the budget
 * test, which relies on it: a long BuildModel and a RepairPDB can never stack in one job. Defined in
 * `src/shared/computeRouting.ts` so the placement engine's `repair` flag reads the same number.
 */
export { FOLDX_REPAIR_MAX_RESIDUES };

export interface BuildModelBudgetInput {
  residueCount: number;
  numberOfRuns: number;
  /** True when FoldX runs through Box64 (x86_64 binary on ARM64). */
  emulated: boolean;
  /**
   * Residues of the template BuildModel will be handed that FoldX has to rebuild itself
   * (`countIncompleteResidues`): 0 for a repaired or cached-repair template and for an AlphaFold model.
   */
  incompleteResidues?: number;
}

type BudgetTimeouts = Pick<
  typeof CONFIG.timeouts,
  | "foldxBuildModelMs"
  | "foldxBuildModelMaxMs"
  | "foldxEmulatedFixedMs"
  | "foldxEmulatedMsPerResidueRun"
  | "foldxEmulatedMsPerIncompleteResidue"
>;

type RepairTimeouts = Pick<typeof CONFIG.timeouts, "foldxRepairMs" | "foldxEmulatedRepairMsPerResidue" | "foldxEmulatedMsPerIncompleteResidue">;

/**
 * The BuildModel subprocess cap for THIS structure on THIS host.
 *
 * WHAT WAS MEASURED (OCI 2 vCPU Neoverse-N1, Box64 0.4.4, FoldX 5.1, 2026-10-17; n = 3 per cell, CV <= 1%,
 * no CPU throttling, steal 0.2%, a foreign-CPU column per run). Seconds for 1 run / 5 runs:
 *
 *   CNNM2 6N7E chain A, 305 residues, 44 incomplete, S489C
 *     unrepaired            211.2 / 213.7     fixed 210.5 s + 0.65 s per run
 *     repaired               5.1 /   7.5      fixed   4.6 s + 0.58 s per run
 *   AlphaFold, complete side chains
 *     SOD1     154  A5V      6.3 /  10.0
 *     p53      393  R175H  35.4 / 173.3
 *     CNNM2    875  S489C  11.1 /  21.8
 *     SLC12A4 1085  Q867H  44.7 / 169.8
 *
 * WHAT THAT SAYS. Two things set BuildModel's cost here, and residue count is neither.
 *
 *  1. Incomplete residues. A crystal structure with truncated side chains (6N7E: 44 of 305 stop at
 *     C-beta, common at 3.5 A) is completed INSIDE BuildModel at ~4.7 s per residue. That is the whole
 *     difference between 5 s and 211 s, and it is why a flat 180 s killed the run that started this.
 *  2. The substitution. Per-run cost spans 0.6 s to 76 s with the same binary on the same host: at one
 *     SLC12A4 site (1 run) Gln867 -> Ala/Cys/Asp/His/Lys took 28/29/31/45/84 s. Over the four AlphaFold
 *     sizes, log(5-run total) against log(residues) has R^2 = 0.29. The 1.44-exponent curve that was
 *     here is exact at its two anchor sizes (154, 1085) and 4.5x too low at 393 and 5.6x too high at 875;
 *     the "~60x native" figure is that same 0.6-76 s spread, not an emulation penalty. Where native
 *     numbers exist the penalty is 3.2x-5.6x (154: 10.0 vs 2.3 s; 875: 21.8 vs 4.7 s; 305 RepairPDB:
 *     660 vs 205 s).
 *
 * So no size-only curve can be both tight and safe, and this is a CEILING, not a prediction: the
 * per-residue-run constant is the upper envelope of what was measured, the incomplete-residue term is
 * measured, and the whole is doubled. Worst measured point against its budget is stated in
 * budget.test.ts. A tighter bound needs the substitution as an input (and more data than this).
 *
 *   2 x (foldxEmulatedFixedMs + incomplete x foldxEmulatedMsPerIncompleteResidue
 *        + runs x residues x foldxEmulatedMsPerResidueRun)
 *
 * clamped to [foldxBuildModelMs, foldxBuildModelMaxMs]. Cutting the number of runs saves almost
 * nothing where the cost is the fixed completion (1 run 211.2 s vs 5 runs 213.7 s), so there is no
 * reduced-runs fallback: the 5-run time fits the 900 s job cap in every measured case.
 *
 * The clamp keeps the job inside `foldxSec`: structures this large skip RepairPDB, so the long
 * BuildModel never shares a job with the 420 s repair (asserted in foldx-timeout-budget.test.ts).
 */
export function buildModelBudgetMs(input: BuildModelBudgetInput, t: BudgetTimeouts = CONFIG.timeouts): number {
  if (!input.emulated) return t.foldxBuildModelMs;
  const modelled = 2 * (
    t.foldxEmulatedFixedMs +
    (input.incompleteResidues ?? 0) * t.foldxEmulatedMsPerIncompleteResidue +
    input.numberOfRuns * input.residueCount * t.foldxEmulatedMsPerResidueRun
  );
  return Math.round(Math.min(t.foldxBuildModelMaxMs, Math.max(t.foldxBuildModelMs, modelled)));
}

/**
 * RepairPDB wall time under emulation, as an ENVELOPE (measured 272 s at 154 residues, 456 s at 393,
 * 660 s at 305 with 44 incomplete): residues x 1.8 s plus the same 4.7 s per incomplete residue.
 * Per-optimisation cost varies 2x between structures, so this over-predicts every measured point
 * (1.02x, 1.55x, 1.14x) and is meant to.
 */
export function predictedRepairMs(
  input: { residueCount: number; incompleteResidues?: number },
  t: RepairTimeouts = CONFIG.timeouts
): number {
  return input.residueCount * t.foldxEmulatedRepairMsPerResidue + (input.incompleteResidues ?? 0) * t.foldxEmulatedMsPerIncompleteResidue;
}

/**
 * Whether RepairPDB is worth starting. On the emulated host a repair that cannot finish inside
 * `foldxRepairMs` is 420 s of wasted job time followed by an unrepaired BuildModel anyway: the p53 and
 * 6N7E templates need 456 s and 660 s against that cap, and the CNNM2 p.Ser489Cys job spent its 420 s
 * and still failed. Native hosts are never gated (6N7E took 205 s there).
 */
export function repairFitsBudget(
  input: { residueCount: number; incompleteResidues?: number; emulated: boolean },
  t: RepairTimeouts = CONFIG.timeouts
): boolean {
  return !input.emulated || predictedRepairMs(input, t) <= t.foldxRepairMs;
}

/** How much longer than its envelope a background repair may run: the envelope is already an upper bound, this is for a busy host. */
export const BACKGROUND_REPAIR_MARGIN = 1.5;

/**
 * The cap for a repair run in the background, or null when even that cannot hold it. Background work has
 * no job cap (it uses an idle server and yields to any job), so the bound is only "does not run forever":
 * 1.5x the repair envelope (6N7E: 1153 s for a 660 s repair), at least the interactive repair cap,
 * at most `foldxBackgroundRepairMaxMs`.
 */
export function backgroundRepairBudgetMs(
  input: { residueCount: number; incompleteResidues?: number },
  t: RepairTimeouts & Pick<typeof CONFIG.timeouts, "foldxBackgroundRepairMaxMs"> = CONFIG.timeouts
): number | null {
  const wanted = predictedRepairMs(input, t) * BACKGROUND_REPAIR_MARGIN;
  if (wanted > t.foldxBackgroundRepairMaxMs) return null;
  return Math.round(Math.max(t.foldxRepairMs, wanted));
}

/** The largest complete structure the repair gate admits under emulation (bounds the repaired path in the nest test). */
export function emulatedRepairResidueLimit(t: RepairTimeouts = CONFIG.timeouts): number {
  return Math.min(FOLDX_REPAIR_MAX_RESIDUES, Math.floor(t.foldxRepairMs / t.foldxEmulatedRepairMsPerResidue));
}

/** Never hand a stage less than this: a smaller budget fails instantly and says nothing about the structure. */
const MIN_STAGE_BUDGET_MS = 30_000;

/**
 * A stage cap cannot outlast the job. After a RepairPDB that ran to its cap and failed, BuildModel's own
 * budget (which grows with incomplete residues) could otherwise run past `foldxSec`, and the queue would
 * report a timeout for work that was still going.
 */
export function clampToJobRemaining(budgetMs: number, remainingJobMs: number): number {
  return Math.round(Math.min(budgetMs, Math.max(MIN_STAGE_BUDGET_MS, remainingJobMs)));
}

/**
 * Which repair a FoldX run uses on its template, and how to say so.
 *
 * FoldX builds the mutant on top of a "repaired" copy of the structure (`RepairPDB` rebuilds side
 * chains and removes clashes). The repaired copy changes the answer by up to ~0.5 kcal/mol, so two runs
 * of the same variant only agree if they repaired the template the same way.
 *
 * There are two ways, chosen ONLY by the size of the template, so every machine picks the same one:
 *
 *   full       RepairPDB on the whole chain. Used up to FOLDX_FULL_REPAIR_MAX_RESIDUES residues.
 *   fix-shell  RepairPDB that may move only the residues near the variant and keeps all the others
 *              fixed (FoldX `--fix-residues-file`). Used for larger templates, where a full repair is
 *              too slow to run while the reader waits (89 s to 284 s natively, several times that on
 *              the server). It is 10 to 26 times faster.
 *
 * `fix-shell` is a different estimator, not a cheaper copy of `full`. On single variants the two can differ
 * by more than a kcal/mol (numbers below, measured on S669, doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md section
 * 9.3). Against the measured values, up to 233 residues `full` is slightly but measurably closer, which is why
 * it stays where it is affordable; above that no difference was detectable. Both are deterministic, and a
 * local repair is always labelled. A value from one mode must never be mixed with a value from the other.
 *
 * `none` is what actually ran when the intended repair did not happen (it timed out, or a full repair
 * did not fit the time cap on a slow host). Such a result is shown, but it is never cached under the
 * key of the mode it was meant to have.
 */
import { FOLDX_FULL_REPAIR_MAX_RESIDUES } from "./computeRouting";
import { LOCAL_REPAIR_BENCHMARK } from "./foldxRepairBenchmark.generated";

/** Bump the suffix when the shell rule changes: it is part of the result's identity. */
export const FIX_SHELL_MODE = "fix-shell:r15-seq14:v1";

export type FoldxIntendedRepairMode = "full" | typeof FIX_SHELL_MODE;
export type FoldxRepairMode = FoldxIntendedRepairMode | "none";

export const FOLDX_REPAIR_MODES: readonly FoldxRepairMode[] = ["full", FIX_SHELL_MODE, "none"];

/** Residues within this distance (Å) of the variant, counted from any heavy atom to any heavy atom, may move. */
export const FIX_SHELL_RADIUS_A = 15;
/** When fewer residues than this are in the sphere, the neighbours along the sequence may move too. */
export const FIX_SHELL_MIN_SPHERE = 25;
/** How far along the sequence (residue numbers, same chain) that extra freedom reaches. */
export const FIX_SHELL_SEQUENCE_BUFFER = 14;

/** The one rule: the intended repair for a template of this many residues. */
export function foldxIntendedRepairMode(residueCount: number): FoldxIntendedRepairMode {
  return residueCount <= FOLDX_FULL_REPAIR_MAX_RESIDUES ? "full" : FIX_SHELL_MODE;
}

export function isFoldxRepairMode(value: unknown): value is FoldxRepairMode {
  return typeof value === "string" && (FOLDX_REPAIR_MODES as readonly string[]).includes(value);
}

/** What the reader sees for each mode. Plain words; no mode id leaks into the interface. */
export const REPAIR_MODE_LABEL: Record<FoldxRepairMode, string> = {
  full: "Whole chain repaired",
  [FIX_SHELL_MODE]: "Region around the variant repaired",
  none: "Not repaired",
};

/**
 * The caveat that goes with the local repair, shown wherever it is used. The numbers come from the benchmark
 * file, which `scripts/foldx-repair-benchmark.ts --report --write-disclosure` writes, so they cannot be typed
 * wrong or go stale here.
 */
const b = LOCAL_REPAIR_BENCHMARK;
export const FIX_SHELL_OFFSET_NOTE =
  "Only the region around the variant was repaired, because this structure is too large to repair whole while you wait. " +
  `On ${b.variants} variants with a measured stability change, across ${b.chains} large structures, it differed from a whole-chain repair by ${b.medianGap.toFixed(2)} kcal/mol at the median and up to ${b.maxGap.toFixed(2)}, and changed the band for ${b.bandChanges}. ` +
  `There was no measurable difference in how close either came to the measurements; FoldX's typical error on those variants was about ${b.typicalError.toFixed(1)} kcal/mol. ` +
  "Do not compare it with a whole-chain FoldX value as the same measurement.";

/**
 * The marks are this app's, not FoldX's, and the benchmark says how far a FoldX value can be from the
 * measurement it is standing in for. That error is bigger than anything the repair-mode difference
 * contributes, so it belongs beside the number rather than only in the method note: a reader who takes
 * "+0.6 is moderately destabilising" as a finding is trusting a caliper that is roughly four times
 * coarser than the interval it draws. Numbers come from the generated benchmark file.
 */
export const FOLDX_MEASURED_ERROR_SENTENCE =
  `On ${b.overallVariants} variants with a measured stability change it was off by about ${b.overallRmse.toFixed(1)} kcal/mol, and its band matched the measurement ${Math.round(b.overallBandAgreement)}% of the time.`;

export const FOLDX_BAND_CAVEAT =
  `FoldX publishes no threshold: the 0.5 and 1.5 kcal/mol marks are this app's. ${FOLDX_MEASURED_ERROR_SENTENCE} Read the band as a rough guide, not a caliper.`;

/**
 * The same statement with the figures for the repair the value on screen actually got. The chip's
 * tooltip has to agree with the number beside it: a local value showing 2.5 under a title that says
 * 2.0 is the kind of contradiction this screen exists to remove.
 */
export function foldxBandCaveat(localRepair: boolean): string {
  const { rmse, variants } = foldxMeasuredError(localRepair);
  const agreement = localRepair ? b.localBandAgreement : b.smallChainBandAgreement;
  return (
    `FoldX publishes no threshold: the 0.5 and 1.5 kcal/mol marks are this app's. ` +
    `On ${variants} variants with a measured stability change it was off by about ${rmse.toFixed(1)} kcal/mol, ` +
    `and its band matched the measurement ${Math.round(agreement)}% of the time. Read the band as a rough guide, not a caliper.`
  );
}

/**
 * The measured error for the value on screen, which depends on the repair it actually got: the local
 * repair on a large template is not the whole-chain repair on a small one, and quoting one number for
 * both would misstate whichever regime the reader is in.
 */
export function foldxMeasuredError(localRepair: boolean): { rmse: number; variants: number } {
  return localRepair
    ? { rmse: b.typicalError, variants: b.variants }
    : { rmse: b.smallChainRmse, variants: b.smallChainVariants };
}

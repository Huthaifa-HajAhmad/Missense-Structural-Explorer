import type { AnalysisState } from "../types";
import { computeStabilityConsensus } from "../shared/thresholds";

/**
 * The consensus verdict DERIVED from the current run state, built from EXACTLY the expressions
 * `EnergeticsView` uses, so an export cannot state a verdict the screen contradicts.
 *
 * `foldingEnergetics.consensusVerdict` is a snapshot taken when the server committed the FoldX job.
 * Remote engines keep resolving for up to ten minutes after that and the badge recomputes as they do,
 * so a report built from the stored field could print "Low Misfolding Risk (Neutral Stability)" for a
 * run the screen calls "High Misfolding Risk (Destabilizing Consensus)". A stored verdict is a fact
 * about the past; an exported report is a claim about this variant.
 *
 * The first version of this function claimed to be equivalent and was not, in two ways that a review
 * reproduced:
 *
 *   • it passed `result.uniprotFeatures` — an object `{ features: [...] }` — where the consensus
 *     expects the ARRAY. `getResidueContext` iterates the argument, so this threw
 *     "features is not iterable" inside both export click handlers: no download, no error UI, both
 *     export buttons dead. The badge passes `result.uniprotFeatures?.features`.
 *   • it sourced the residue index from the live UI selection rather than the variant's own metadata.
 *     A grid sweep showed that alone flips the verdict for ~1000 bundles.
 *
 * `result: any` is what let both mistakes past `tsc`. The result parameter is typed now — that is the real
 * fix, because this function's whole job is to agree with a caller elsewhere in the codebase.
 */
export function deriveConsensus(args: {
  result: AnalysisState["result"] | null;
  foldingEnergetics?: any;
  /** The FoldX single-value fallback, which the badge applies and the first version omitted. */
  foldingDdG?: number | null;
  /** Accepted for existing callers; the consensus no longer weights by pLDDT (see below). */
  plddt?: number | null;
}) {
  const { result, foldingEnergetics: fe, foldingDdG } = args;
  if (!result) return null;
  return computeStabilityConsensus(
    {
      // Mirrors `EnergeticsView`'s `energetics` memo key for key. The five remote engines read from
      // `foldingEnergetics` only — an extra `?? result.dynamut2` fallback here would be a divergence,
      // not a safety net.
      foldx: fe?.foldx ?? foldingDdG ?? null,
      foldxMean: fe?.foldxMean ?? foldingDdG ?? null,
      dynamut2: fe?.dynamut2 ?? null,
      ddmut: fe?.ddmut ?? null,
      rasp: fe?.rasp ?? null,
      thermompnn: fe?.thermompnn ?? null,
      stabilityoracle: fe?.stabilityoracle ?? null,
      foldxRepairFailed: fe?.foldxRepairFailed ?? false,
      foldxBinaryMissing: fe?.foldxBinaryMissing ?? false
    }
    // Values only. The residue context and pLDDT arguments fed per-context "AUC" weights that had no
    // source (`protein_class_calibration.json`); they were retired with the probability.
  );
}

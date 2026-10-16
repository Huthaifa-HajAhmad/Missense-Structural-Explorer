import type { AnalysisResult } from "./contracts";
import { computeStabilityConsensus } from "./thresholds";

export function stabilityConsensusFor(args: {
  result: AnalysisResult | null;
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
      foldxBinaryMissing: fe?.foldxBinaryMissing ?? false,
      // ProtVar stands in for FoldX on an AlphaFold template with no local value; see `FOLDX_STAND_IN_RULE`.
      protvar: fe?.protvar ?? null,
      structureProvenance: fe?.structureProvenance ?? null
    }
    // Values only. The residue context and pLDDT arguments fed per-context "AUC" weights that had no
    // source (`protein_class_calibration.json`); they were retired with the probability.
  );
}

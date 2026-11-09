import { useMemo } from "react";
import type { AnalysisResult } from "../../../types";
import { resolveResidueShiftModel } from "../../../lib/residueShiftModel";
import {
  buildPerturbationEvidence,
  type PerturbationEvidence,
  type PerturbationEvidenceInput
} from "../../../shared/perturbationEvidence";

/** Everything the evidence needs beside the analysis payload; the residue pair is read from the payload. */
export type PerturbationLegs = Omit<PerturbationEvidenceInput, "result" | "residues">;

/**
 * The one way the Structural perturbation tab and its rail build their evidence, so both read the same inputs.
 * Null until a variant has been analysed. Callers must call it before any early return.
 */
export function usePerturbationEvidence(result: AnalysisResult | null, legs: PerturbationLegs): PerturbationEvidence | null {
  const { foldingEnergetics, structuralDiff, metrics, saprotEngine, isFolding, foldingStatus, foldingError } = legs;
  const meta = result?.metadata;
  const residues = useMemo(() => {
    const m = resolveResidueShiftModel({ wildType: meta?.wildType, mutant: meta?.mutant, variant: meta?.variant });
    return { wtCode: m.wildTypeCode, mutCode: m.mutantCode, wtLabel: m.wildTypeLabel, mutLabel: m.mutantLabel };
  }, [meta?.wildType, meta?.mutant, meta?.variant]);
  return useMemo(
    () =>
      result
        ? buildPerturbationEvidence({
            result,
            residues,
            foldingEnergetics,
            structuralDiff,
            metrics,
            saprotEngine,
            isFolding: Boolean(isFolding),
            foldingStatus,
            foldingError
          })
        : null,
    [result, residues, foldingEnergetics, structuralDiff, metrics, saprotEngine, isFolding, foldingStatus, foldingError]
  );
}

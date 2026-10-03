import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { deepEvidenceContextFromStore } from "../shared/deepModelEvidence";

/** Subscribe only to evidence that can change synthesis freshness, not every workspace edit. */
export function useNarrativeEvidenceContext(saprotEngine?: string | null) {
  const evidence = useVariantAnalysisStore(useShallow(s => ({
    primaryBiophysics: s.primaryBiophysics,
    foldingDdG: s.foldingDdG, foldingEnergetics: s.foldingEnergetics,
    foldingStatus: s.foldingStatus, foldingError: s.foldingError,
    dynamut2Status: s.dynamut2Status, ddmutStatus: s.ddmutStatus,
    thermompnnStatus: s.thermompnnStatus, thermompnnError: s.thermompnnError,
    isFolding: s.isFolding, disruptionPredictor: s.disruptionPredictor
  })));
  return useMemo(() => deepEvidenceContextFromStore(evidence, saprotEngine), [evidence, saprotEngine]);
}

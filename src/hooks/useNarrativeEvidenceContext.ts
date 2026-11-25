import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { deepEvidenceContextFromStore } from "../shared/deepModelEvidence";

type StoreState = ReturnType<typeof useVariantAnalysisStore.getState>;

/** The store fields that can change synthesis freshness, and nothing else. */
export const selectNarrativeEvidence = (s: StoreState) => ({
  primaryBiophysics: s.primaryBiophysics,
  foldingDdG: s.foldingDdG, foldingEnergetics: s.foldingEnergetics,
  foldingStatus: s.foldingStatus, foldingError: s.foldingError,
  thermompnnStatus: s.thermompnnStatus, thermompnnError: s.thermompnnError,
  isFolding: s.isFolding, disruptionPredictor: s.disruptionPredictor
});

/** Subscribe only to evidence that can change synthesis freshness, not every workspace edit. */
export function useNarrativeEvidenceContext() {
  const evidence = useVariantAnalysisStore(useShallow(selectNarrativeEvidence));
  return useMemo(() => deepEvidenceContextFromStore(evidence), [evidence]);
}

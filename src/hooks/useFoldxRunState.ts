import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import type { FoldxRunState } from "../shared/energeticsEvidence";

/**
 * Whether the primary variant's local FoldX is still running, and its status. Every stability verdict
 * outside the Energetics screen reads these, so Insights, the Report and the export count the same
 * engines as the screen while a run is in progress (see `FoldxRunState`).
 */
export function useFoldxRunState(): Required<FoldxRunState> {
  const isFolding = useVariantAnalysisStore(s => s.primaryBiophysics?.isFolding ?? s.isFolding ?? false);
  const foldingStatus = useVariantAnalysisStore(s => s.primaryBiophysics?.foldingStatus ?? s.foldingStatus ?? null);
  return { isFolding: Boolean(isFolding), foldingStatus: foldingStatus ?? null };
}

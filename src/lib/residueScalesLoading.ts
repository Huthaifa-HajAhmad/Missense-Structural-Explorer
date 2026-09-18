/**
 * residueScalesLoading.ts — one answer to "are the residue property scales still
 * being assembled?" for every surface that shows them.
 *
 * There were three different notions of this in the feature, so the main column and
 * the inspector could tell the reader two different stories about the same missing
 * datum:
 *
 *   - `StructureTab` passed `analysisState.isLoading`
 *   - `ResidueShiftInspector` passed `isBiophysicalLoading`, which arrives from the
 *     store as a *separate* flag
 *   - `ClinicalInsightsCard` computed its own composite from `analysisState.isLoading`
 *
 * With `isLoading === true` and `isBiophysicalLoading === false`, the scales card
 * said "waiting for the pipeline" while the inspector said the values could not be
 * resolved — one pane promising data the other had already given up on.
 * `SplicingInspector` documents having fixed exactly this bug by reading the
 * analysis-loading flag from the store; this hook generalises that fix.
 *
 * The optional argument is the store value or a test override. It is read through
 * the same selector the panes use so a caller cannot reintroduce the divergence by
 * passing a stale prop.
 */
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";

export function useResidueScalesLoading(isBiophysicalLoadingOverride?: boolean): boolean {
  const isAnalysisLoading = useVariantAnalysisStore(state => state.analysisState.isLoading);
  const isBiophysicalLoading = useVariantAnalysisStore(state => state.isBiophysicalLoading);

  const isBiophysicalLoading_ = isBiophysicalLoadingOverride ?? isBiophysicalLoading;
  return Boolean(isBiophysicalLoading_) || Boolean(isAnalysisLoading);
}

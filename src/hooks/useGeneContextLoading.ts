import { useVariantAnalysisStore } from '../stores/useVariantAnalysisStore';
import { extraContextKey } from '../shared/evidenceKeys';
import type { GeneContextLoading } from '../shared/evidenceTabProgress';

/**
 * Whether each gene-context tab is still loading for `gene`, read from the same store slots the
 * loaders write. Each selector returns a boolean, so a settled context does not re-render callers.
 */
export function useGeneContextLoading(gene: string | null | undefined): GeneContextLoading {
  const g = gene ?? '';
  const loading = (load: { status?: string } | undefined) => load?.status === 'loading';
  const disease = useVariantAnalysisStore(s => Boolean(g) && (loading(s.diseaseContexts[g]) || loading(s.dosageContexts[g])));
  const expression = useVariantAnalysisStore(s => Boolean(g) && (
    loading(s.expressionContexts[g]) || loading(s.developmentalContexts[g]) ||
    loading(s.extraContexts[extraContextKey('hpa', g)]) || loading(s.extraContexts[extraContextKey('pext', g)])
  ));
  const models = useVariantAnalysisStore(s => Boolean(g) && (
    loading(s.modelContexts[g]) ||
    loading(s.extraContexts[extraContextKey('alignment', g)]) || loading(s.extraContexts[extraContextKey('phenotypes', g)])
  ));
  return { disease, expression, models };
}

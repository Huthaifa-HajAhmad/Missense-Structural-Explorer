import { useEffect, useRef, useState } from 'react';
import { useApiClient } from '../apiClient';
import { useVariantAnalysisStore } from '../stores/useVariantAnalysisStore';
import { geneDiseaseResponseSchema } from '../shared/diseaseFrame';
import { adultExpressionResponseSchema } from '../shared/expressionModels';
import { developmentalExpressionResponseSchema } from '../shared/developmentalExpression';
import { emptyPhenotypeSelection } from '../shared/phenotypeFrame';
import type { AnalysisResult } from '../types';
import { evidenceContextIdentity } from '../shared/evidenceContextIdentity';
import { ContextHttpError, contextRequestFailure } from '../shared/contextRequest';
const EMPTY_SELECTION = emptyPhenotypeSelection();
export function useEvidenceContext(result: AnalysisResult, expression = false) {
  const { fetchWithAuth } = useApiClient();
  const storeGene = useVariantAnalysisStore(s => s.gene);
  const storeVariant = useVariantAnalysisStore(s => s.variant);
  const gene = result.metadata?.gene || storeGene;
  const key = evidenceContextIdentity(result, storeGene, storeVariant);
  const previousKey = useRef(key);
  const [refinedIdentity, setRefinedIdentity] = useState<string | null>(null);
  const diseaseLoad = useVariantAnalysisStore(s => s.diseaseContexts[gene]);
  const expressionLoad = useVariantAnalysisStore(s => s.expressionContexts[gene]);
  const developmentalLoad = useVariantAnalysisStore(s => s.developmentalContexts[gene]);
  const selection = useVariantAnalysisStore(s => s.phenotypeSelections[key] ?? EMPTY_SELECTION);
  const actions = useVariantAnalysisStore.getState();
  const loadDisease = async () => {
    if (!gene || useVariantAnalysisStore.getState().diseaseContexts[gene]?.status === 'loading') return;
    actions.setDiseaseContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}`, { timeout: 20000 });
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = geneDiseaseResponseSchema.parse(await response.json());
      if (data.gene !== gene) throw new Error('Context identity mismatch');
      actions.setDiseaseContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) { actions.setDiseaseContext(gene, { status: 'error', data: null, error: contextRequestFailure(error) }); }
  };
  const loadExpression = async () => {
    if (!gene || useVariantAnalysisStore.getState().expressionContexts[gene]?.status === 'loading') return;
    actions.setExpressionContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/expression`, { timeout: 40000 });
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = adultExpressionResponseSchema.parse(await response.json());
      if (data.gene !== gene) throw new Error('Expression identity mismatch');
      actions.setExpressionContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) { actions.setExpressionContext(gene, { status: 'error', data: null, error: contextRequestFailure(error) }); }
  };
  const loadDevelopment = async () => {
    if (!gene || useVariantAnalysisStore.getState().developmentalContexts[gene]?.status === 'loading') return;
    actions.setDevelopmentalContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/development`, { timeout: 20000 });
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = developmentalExpressionResponseSchema.parse(await response.json());
      if (data.gene !== gene) throw new Error('Context identity mismatch');
      actions.setDevelopmentalContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) { actions.setDevelopmentalContext(gene, { status: 'error', data: null, error: contextRequestFailure(error) }); }
  };
  useEffect(() => { actions.loadPhenotypeSelection(key); }, [key]);
  useEffect(() => {
    if (previousKey.current !== key && JSON.stringify(JSON.parse(previousKey.current).slice(0, 3)) === JSON.stringify(JSON.parse(key).slice(0, 3))) setRefinedIdentity(key);
    previousKey.current = key;
  }, [key]);
  useEffect(() => {
    // A cached "not installed" or failed read is not a fact about the gene: the snapshot can be
    // installed (or the server recovered) while this session is open, so re-ask on mount.
    const cachedDisease = useVariantAnalysisStore.getState().diseaseContexts[gene];
    if (!cachedDisease || cachedDisease.status === 'error' || cachedDisease.data?.status === 'not-installed') void loadDisease();
    if (expression && !useVariantAnalysisStore.getState().expressionContexts[gene]) void loadExpression();
    if (expression && !useVariantAnalysisStore.getState().developmentalContexts[gene]) void loadDevelopment();
  }, [gene, expression, fetchWithAuth]);
  return { gene, key, selection, diseaseLoad, expressionLoad, developmentalLoad,
    identityChanged: refinedIdentity === key,
    setSelection: (value: typeof selection) => { actions.setPhenotypeSelection(key, value); setRefinedIdentity(null); },
    retryDisease: loadDisease, retryExpression: loadExpression, retryDevelopment: loadDevelopment };
}

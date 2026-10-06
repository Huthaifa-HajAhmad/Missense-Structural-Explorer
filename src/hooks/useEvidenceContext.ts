import { useEffect, useRef, useState } from 'react';
import { useApiClient } from '../apiClient';
import { useVariantAnalysisStore } from '../stores/useVariantAnalysisStore';
import { geneDiseaseResponseSchema } from '../shared/diseaseFrame';
import { adultExpressionResponseSchema } from '../shared/expressionModels';
import { developmentalExpressionResponseSchema } from '../shared/developmentalExpression';
import { emptyPhenotypeSelection } from '../shared/phenotypeFrame';
import type { AnalysisResult } from '../types';
import { evidenceContextIdentity } from '../shared/evidenceContextIdentity';
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
      if (!response.ok) throw new Error('Context request failed');
      const data = geneDiseaseResponseSchema.parse(await response.json());
      if (data.gene !== gene) throw new Error('Context identity mismatch');
      actions.setDiseaseContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch { actions.setDiseaseContext(gene, { status: 'error', data: null }); }
  };
  const loadExpression = async () => {
    if (!gene || useVariantAnalysisStore.getState().expressionContexts[gene]?.status === 'loading') return;
    actions.setExpressionContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/expression`, { timeout: 40000 });
      if (!response.ok) throw new Error('Expression request failed');
      const data = adultExpressionResponseSchema.parse(await response.json());
      if (data.gene !== gene) throw new Error('Expression identity mismatch');
      actions.setExpressionContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch { actions.setExpressionContext(gene, { status: 'error', data: null }); }
  };
  const loadDevelopment = async () => {
    if (!gene || useVariantAnalysisStore.getState().developmentalContexts[gene]?.status === 'loading') return;
    actions.setDevelopmentalContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/development`, { timeout: 20000 });
      if (!response.ok) throw new Error('Developmental request failed');
      const data = developmentalExpressionResponseSchema.parse(await response.json());
      if (data.gene !== gene) throw new Error('Context identity mismatch');
      actions.setDevelopmentalContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch { actions.setDevelopmentalContext(gene, { status: 'error', data: null }); }
  };
  useEffect(() => { actions.loadPhenotypeSelection(key); }, [key]);
  useEffect(() => {
    if (previousKey.current !== key && JSON.stringify(JSON.parse(previousKey.current).slice(0, 3)) === JSON.stringify(JSON.parse(key).slice(0, 3))) setRefinedIdentity(key);
    previousKey.current = key;
  }, [key]);
  useEffect(() => {
    if (!useVariantAnalysisStore.getState().diseaseContexts[gene]) void loadDisease();
    if (expression && !useVariantAnalysisStore.getState().expressionContexts[gene]) void loadExpression();
    if (expression && !useVariantAnalysisStore.getState().developmentalContexts[gene]) void loadDevelopment();
  }, [gene, expression, fetchWithAuth]);
  return { gene, key, selection, diseaseLoad, expressionLoad, developmentalLoad,
    identityChanged: refinedIdentity === key,
    setSelection: (value: typeof selection) => { actions.setPhenotypeSelection(key, value); setRefinedIdentity(null); },
    retryDisease: loadDisease, retryExpression: loadExpression, retryDevelopment: loadDevelopment };
}

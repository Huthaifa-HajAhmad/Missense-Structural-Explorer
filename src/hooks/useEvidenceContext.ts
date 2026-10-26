import { useEffect, useRef, useState } from 'react';
import { useApiClient } from '../apiClient';
import { useVariantAnalysisStore } from '../stores/useVariantAnalysisStore';
import { geneDiseaseResponseSchema } from '../shared/diseaseFrame';
import { dosageResponseSchema } from '../shared/dosageSensitivity';
import { adultExpressionResponseSchema } from '../shared/expressionModels';
import { developmentalExpressionResponseSchema } from '../shared/developmentalExpression';
import { z } from 'zod';
import { alignmentResponseSchema } from '../shared/residueAlignment';
import { hpoResponseSchema, hpoQueryIds } from '../shared/hpoAnnotation';
import { buildGeneDiseaseEvidence } from '../shared/diseaseFrame';
import { modelPhenotypesResponseSchema } from '../shared/modelPhenotypes';
import { hpaResponseSchema } from '../shared/hpa';
import { pextResponseSchema } from '../shared/pext';
import { modelOrganismResponseSchema } from '../shared/modelOrganisms';
import { emptyPhenotypeSelection } from '../shared/phenotypeFrame';
import type { ContextLoad } from '../stores/slices/evidenceContextSlice';
import { evidenceContextIdentity } from '../shared/evidenceContextIdentity';
import { extraContextKey, type ExtraContextKind } from '../shared/evidenceKeys';
import { ContextHttpError, contextRequestFailure } from '../shared/contextRequest';
const EMPTY_SELECTION = emptyPhenotypeSelection();
/** Alignment slots that already had their one automatic re-read after a failure. */
const alignmentAutoRetried = new Set<string>();
export type EvidenceContextInput = Parameters<typeof evidenceContextIdentity>[0];

export function useEvidenceContext(result: EvidenceContextInput, expression = false, dosage = false, models = expression, recoverCached = true) {
  const { fetchWithAuth } = useApiClient();
  const storeGene = useVariantAnalysisStore(s => s.gene);
  const storeVariant = useVariantAnalysisStore(s => s.variant);
  const gene = result.metadata?.gene || storeGene;
  const key = evidenceContextIdentity(result, storeGene, storeVariant);
  const previousKey = useRef(key);
  const [refinedIdentity, setRefinedIdentity] = useState<string | null>(null);
  const diseaseLoad = useVariantAnalysisStore(s => s.diseaseContexts[gene]);
  const dosageLoad = useVariantAnalysisStore(s => s.dosageContexts[gene]);
  const expressionLoad = useVariantAnalysisStore(s => s.expressionContexts[gene]);
  const developmentalLoad = useVariantAnalysisStore(s => s.developmentalContexts[gene]);
  const modelLoad = useVariantAnalysisStore(s => s.modelContexts[gene]);
  const alignmentLoad = useVariantAnalysisStore(s => s.extraContexts[extraContextKey('alignment', gene)]) as ContextLoad<z.infer<typeof alignmentResponseSchema>> | undefined;
  const phenotypesLoad = useVariantAnalysisStore(s => s.extraContexts[extraContextKey('phenotypes', gene)]) as ContextLoad<z.infer<typeof modelPhenotypesResponseSchema>> | undefined;
  const hpaLoad = useVariantAnalysisStore(s => s.extraContexts[extraContextKey('hpa', gene)]) as ContextLoad<z.infer<typeof hpaResponseSchema>> | undefined;
  const pextLoad = useVariantAnalysisStore(s => s.extraContexts[extraContextKey('pext', gene)]) as ContextLoad<z.infer<typeof pextResponseSchema>> | undefined;
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
  const loadDosage = async () => {
    if (!gene || useVariantAnalysisStore.getState().dosageContexts[gene]?.status === 'loading') return;
    actions.setDosageContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/dosage`, { timeout: 40000 });
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = dosageResponseSchema.parse(await response.json());
      if (data.gene !== gene) throw new Error('Dosage identity mismatch');
      actions.setDosageContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) { actions.setDosageContext(gene, { status: 'error', data: null, error: contextRequestFailure(error) }); }
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
  const loadModels = async () => {
    if (!gene || useVariantAnalysisStore.getState().modelContexts[gene]?.status === 'loading') return;
    actions.setModelContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/models`, { timeout: 60000 });
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = modelOrganismResponseSchema.parse(await response.json());
      if (data.gene !== gene) throw new Error('Model-organism identity mismatch');
      actions.setModelContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) { actions.setModelContext(gene, { status: 'error', data: null, error: contextRequestFailure(error) }); }
  };
  /** One loader for the newer sources: path suffix, schema, and the same identity and failure rules. */
  const loadExtra = async (kind: ExtraContextKind, schema: z.ZodType<{ gene: string; status: string }>, timeout: number, query = '') => {
    const slot = extraContextKey(kind, gene, query);
    if (!gene || useVariantAnalysisStore.getState().extraContexts[slot]?.status === 'loading') return;
    actions.setExtraContext(slot, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/${kind}${query ? `?disease=${encodeURIComponent(query)}` : ''}`, { timeout });
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = schema.parse(await response.json());
      if (data.gene !== gene) throw new Error('Context identity mismatch');
      actions.setExtraContext(slot, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) { actions.setExtraContext(slot, { status: 'error', data: null, error: contextRequestFailure(error) }); }
  };
  const loadAlignment = () => loadExtra('alignment', alignmentResponseSchema, 60000);
  const loadPhenotypes = () => loadExtra('phenotypes', modelPhenotypesResponseSchema, 120000);
  const loadHpa = () => loadExtra('hpa', hpaResponseSchema, 60000);
  const loadPext = () => loadExtra('pext', pextResponseSchema, 40000);
  const hpoIds = hpoQueryIds(buildGeneDiseaseEvidence(diseaseLoad?.data ?? null, selection.diseaseKey).selected?.xrefs ?? []).join(',');
  const hpoSlot = extraContextKey('hpo', gene, hpoIds);
  const hpoLoad = useVariantAnalysisStore(s => s.extraContexts[hpoSlot]) as ContextLoad<z.infer<typeof hpoResponseSchema>> | undefined;
  const loadHpo = () => loadExtra('hpo', hpoResponseSchema, 30000, hpoIds);
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
    // installed (or the server recovered) mid-session. Background prefetch owns recovery;
    // visiting a tab joins its cached outcome instead of starting another read.
    const cachedDisease = useVariantAnalysisStore.getState().diseaseContexts[gene];
    if (!cachedDisease || (recoverCached && (cachedDisease.status === 'error' || cachedDisease.data?.status === 'not-installed'))) void loadDisease();
    const cachedDosage = useVariantAnalysisStore.getState().dosageContexts[gene];
    if (dosage && (!cachedDosage || (recoverCached && cachedDosage.status === 'error'))) void loadDosage();
    if (expression && (!useVariantAnalysisStore.getState().expressionContexts[gene] || (recoverCached && useVariantAnalysisStore.getState().expressionContexts[gene]?.status === 'error'))) void loadExpression();
    if (expression && (!useVariantAnalysisStore.getState().developmentalContexts[gene] || (recoverCached && (useVariantAnalysisStore.getState().developmentalContexts[gene]?.status === 'error' || useVariantAnalysisStore.getState().developmentalContexts[gene]?.data?.status === 'not-installed')))) void loadDevelopment();
    // Alignment is prefetched when a result lands and can lose that race, so a failed read gets one
    // automatic re-read; after that, entering a tab must not restart it (retryAlignment is explicit).
    for (const [kind, load] of [['alignment', loadAlignment], ['pext', loadPext], ['phenotypes', loadPhenotypes], ['hpa', loadHpa]] as const) {
      const cached = useVariantAnalysisStore.getState().extraContexts[extraContextKey(kind, gene)];
      const slot = extraContextKey(kind, gene);
      const failed = cached?.status === 'error';
      const mayRetry = recoverCached && failed && (kind !== 'alignment' || !alignmentAutoRetried.has(slot));
      if ((kind === 'alignment' || kind === 'phenotypes' ? models : expression) && (!cached || mayRetry)) {
        if (failed && kind === 'alignment') alignmentAutoRetried.add(slot);
        void load();
      }
    }
    if ((expression || models) && selection.diseaseKey && hpoIds) {
      const cached = useVariantAnalysisStore.getState().extraContexts[hpoSlot];
      if (!cached || (recoverCached && cached.status === 'error')) void loadHpo();
    }
    const cachedModels = useVariantAnalysisStore.getState().modelContexts[gene];
    if (models && (!cachedModels || (recoverCached && (cachedModels.status === 'error' || cachedModels.data?.impc?.status === 'error')))) void loadModels();
  }, [gene, expression, dosage, models, recoverCached, fetchWithAuth, hpoSlot, selection.diseaseKey]);
  return { gene, key, selection, diseaseLoad, dosageLoad, expressionLoad, developmentalLoad, modelLoad, alignmentLoad, pextLoad, hpaLoad, phenotypesLoad, hpoLoad, hpoIds,
    identityChanged: refinedIdentity === key,
    setSelection: (value: typeof selection) => { actions.setPhenotypeSelection(key, value); setRefinedIdentity(null); },
    retryDisease: loadDisease, retryDosage: loadDosage, retryExpression: loadExpression, retryDevelopment: loadDevelopment, retryModels: loadModels, retryAlignment: loadAlignment, retryPext: loadPext, retryHpa: loadHpa, retryPhenotypes: loadPhenotypes, retryHpo: loadHpo };
}

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
import { evidenceContextIdentity, onlyFillsInIdentity } from '../shared/evidenceContextIdentity';
import { extraContextKey, hotspotsSlot, type ExtraContextKind } from '../shared/evidenceKeys';
import { readHotspots } from './hotspotsRead';
import { ContextHttpError, contextRequestFailure } from '../shared/contextRequest';
import type { HotspotContext } from '../shared/hotspotEvidence';
const EMPTY_SELECTION = emptyPhenotypeSelection();
/** Alignment slots that already had their one automatic re-read after a failure. */
const alignmentAutoRetried = new Set<string>();
export type EvidenceContextInput = Parameters<typeof evidenceContextIdentity>[0];

export type EvidenceContextOptions = {
  /** GTEx / dGTEx and their rail sources. */
  expression?: boolean;
  /** GenCC and ClinGen dosage. */
  dosage?: boolean;
  /** Alliance orthologs plus the species-tab alignment, phenotypes and HPO reads. Defaults to `expression`. */
  models?: boolean;
  /** Re-read a cached failure; false when a tab visit joins the prefetch's outcome. */
  recoverCached?: boolean;
  /** The germline hot-spot slot (protein + transcript keyed). */
  hotspots?: boolean;
};
export function useEvidenceContext(result: EvidenceContextInput, options: EvidenceContextOptions = {}) {
  const { expression = false, models = expression, dosage = false, recoverCached = true, hotspots = false } = options;
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
  const isAborted = (error: unknown, signal?: AbortSignal) =>
    Boolean(signal?.aborted || (error instanceof Error && error.name === 'AbortError'));
  const clearLoadingExtra = (slot: string) => {
    useVariantAnalysisStore.setState((s) => {
      if (s.extraContexts[slot]?.status !== 'loading') return s;
      const { [slot]: _dropped, ...rest } = s.extraContexts;
      return { extraContexts: rest };
    });
  };
  const loadDisease = async (signal?: AbortSignal) => {
    if (!gene || signal?.aborted || useVariantAnalysisStore.getState().diseaseContexts[gene]?.status === 'loading') return;
    actions.setDiseaseContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}`, signal ? { timeout: 20000, signal } : { timeout: 20000 });
      if (signal?.aborted) { await response.body?.cancel(); return; }
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = geneDiseaseResponseSchema.parse(await response.json());
      if (signal?.aborted) return;
      if (data.gene !== gene) throw new Error('Context identity mismatch');
      actions.setDiseaseContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) {
      if (isAborted(error, signal)) {
        useVariantAnalysisStore.setState((s) => {
          if (s.diseaseContexts[gene]?.status !== 'loading') return s;
          const { [gene]: _dropped, ...rest } = s.diseaseContexts;
          return { diseaseContexts: rest };
        });
        return;
      }
      actions.setDiseaseContext(gene, { status: 'error', data: null, error: contextRequestFailure(error) });
    }
  };
  const loadDosage = async (signal?: AbortSignal) => {
    if (!gene || signal?.aborted || useVariantAnalysisStore.getState().dosageContexts[gene]?.status === 'loading') return;
    actions.setDosageContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/dosage`, signal ? { timeout: 40000, signal } : { timeout: 40000 });
      if (signal?.aborted) { await response.body?.cancel(); return; }
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = dosageResponseSchema.parse(await response.json());
      if (signal?.aborted) return;
      if (data.gene !== gene) throw new Error('Dosage identity mismatch');
      actions.setDosageContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) {
      if (isAborted(error, signal)) {
        useVariantAnalysisStore.setState((s) => {
          if (s.dosageContexts[gene]?.status !== 'loading') return s;
          const { [gene]: _dropped, ...rest } = s.dosageContexts;
          return { dosageContexts: rest };
        });
        return;
      }
      actions.setDosageContext(gene, { status: 'error', data: null, error: contextRequestFailure(error) });
    }
  };
  const loadExpression = async (signal?: AbortSignal) => {
    if (!gene || signal?.aborted || useVariantAnalysisStore.getState().expressionContexts[gene]?.status === 'loading') return;
    actions.setExpressionContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/expression`, signal ? { timeout: 40000, signal } : { timeout: 40000 });
      if (signal?.aborted) { await response.body?.cancel(); return; }
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = adultExpressionResponseSchema.parse(await response.json());
      if (signal?.aborted) return;
      if (data.gene !== gene) throw new Error('Expression identity mismatch');
      actions.setExpressionContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) {
      if (isAborted(error, signal)) {
        useVariantAnalysisStore.setState((s) => {
          if (s.expressionContexts[gene]?.status !== 'loading') return s;
          const { [gene]: _dropped, ...rest } = s.expressionContexts;
          return { expressionContexts: rest };
        });
        return;
      }
      actions.setExpressionContext(gene, { status: 'error', data: null, error: contextRequestFailure(error) });
    }
  };
  const loadModels = async (signal?: AbortSignal) => {
    if (!gene || signal?.aborted || useVariantAnalysisStore.getState().modelContexts[gene]?.status === 'loading') return;
    actions.setModelContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/models`, signal ? { timeout: 60000, signal } : { timeout: 60000 });
      if (signal?.aborted) { await response.body?.cancel(); return; }
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = modelOrganismResponseSchema.parse(await response.json());
      if (signal?.aborted) return;
      if (data.gene !== gene) throw new Error('Model-organism identity mismatch');
      actions.setModelContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) {
      if (isAborted(error, signal)) {
        useVariantAnalysisStore.setState((s) => {
          if (s.modelContexts[gene]?.status !== 'loading') return s;
          const { [gene]: _dropped, ...rest } = s.modelContexts;
          return { modelContexts: rest };
        });
        return;
      }
      actions.setModelContext(gene, { status: 'error', data: null, error: contextRequestFailure(error) });
    }
  };
  /** One loader for the newer sources: path suffix, schema, and the same identity and failure rules. */
  const loadExtra = async (kind: ExtraContextKind, schema: z.ZodType<{ gene: string; status: string }>, timeout: number, query = '', search = query ? `?disease=${encodeURIComponent(query)}` : '', signal?: AbortSignal) => {
    const slot = extraContextKey(kind, gene, query);
    if (!gene || signal?.aborted || useVariantAnalysisStore.getState().extraContexts[slot]?.status === 'loading') return;
    actions.setExtraContext(slot, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/${kind}${search}`, signal ? { timeout, signal } : { timeout });
      if (signal?.aborted) { await response.body?.cancel(); return; }
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = schema.parse(await response.json());
      if (signal?.aborted) return;
      if (data.gene !== gene) throw new Error('Context identity mismatch');
      actions.setExtraContext(slot, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) {
      if (isAborted(error, signal)) {
        clearLoadingExtra(slot);
        return;
      }
      actions.setExtraContext(slot, { status: 'error', data: null, error: contextRequestFailure(error) });
    }
  };
  const loadAlignment = (signal?: AbortSignal) => loadExtra('alignment', alignmentResponseSchema, 60000, '', '', signal);
  const loadPhenotypes = (signal?: AbortSignal) => loadExtra('phenotypes', modelPhenotypesResponseSchema, 120000, '', '', signal);
  const loadHpa = (signal?: AbortSignal) => loadExtra('hpa', hpaResponseSchema, 60000, '', '', signal);
  const loadPext = (signal?: AbortSignal) => loadExtra('pext', pextResponseSchema, 40000, '', '', signal);
  const hpoIds = hpoQueryIds(buildGeneDiseaseEvidence(diseaseLoad?.data ?? null, selection.diseaseKey).selected?.xrefs ?? []).join(',');
  const hpoSlot = extraContextKey('hpo', gene, hpoIds);
  const hpoLoad = useVariantAnalysisStore(s => s.extraContexts[hpoSlot]) as ContextLoad<z.infer<typeof hpoResponseSchema>> | undefined;
  const loadHpo = (signal?: AbortSignal) => loadExtra('hpo', hpoResponseSchema, 30000, hpoIds, hpoIds ? `?disease=${encodeURIComponent(hpoIds)}` : '', signal);
  // Hot spots are read per protein and transcript (numbering is checked against the model), up front
  // with the other Evidence context so the Functional domains view never opens on a spinner.
  const uniprot = result.metadata?.uniprotId ?? '';
  const hotspotSlot = hotspotsSlot(gene, uniprot, result.transcriptId);
  const hotspotLoad = useVariantAnalysisStore(s => s.extraContexts[hotspotSlot]) as ContextLoad<HotspotContext> | undefined;
  const loadHotspots = (signal?: AbortSignal) => readHotspots(fetchWithAuth, gene, uniprot, result.transcriptId, signal);
  const loadDevelopment = async (signal?: AbortSignal) => {
    if (!gene || signal?.aborted || useVariantAnalysisStore.getState().developmentalContexts[gene]?.status === 'loading') return;
    actions.setDevelopmentalContext(gene, { status: 'loading', data: null });
    try {
      const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/development`, signal ? { timeout: 20000, signal } : { timeout: 20000 });
      if (signal?.aborted) { await response.body?.cancel(); return; }
      if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
      const data = developmentalExpressionResponseSchema.parse(await response.json());
      if (signal?.aborted) return;
      if (data.gene !== gene) throw new Error('Context identity mismatch');
      actions.setDevelopmentalContext(gene, { status: data.status === 'error' ? 'error' : 'ready', data });
    } catch (error) {
      if (isAborted(error, signal)) {
        useVariantAnalysisStore.setState((s) => {
          if (s.developmentalContexts[gene]?.status !== 'loading') return s;
          const { [gene]: _dropped, ...rest } = s.developmentalContexts;
          return { developmentalContexts: rest };
        });
        return;
      }
      actions.setDevelopmentalContext(gene, { status: 'error', data: null, error: contextRequestFailure(error) });
    }
  };
  useEffect(() => { actions.loadPhenotypeSelection(key); }, [key]);
  useEffect(() => {
    const previous = previousKey.current;
    if (previous !== key && JSON.stringify(JSON.parse(previous).slice(0, 3)) === JSON.stringify(JSON.parse(key).slice(0, 3))) {
      // A transcript arriving while the result streams is only worth a notice if a choice was left behind.
      const choiceLeftBehind = JSON.stringify(useVariantAnalysisStore.getState().phenotypeSelections[previous] ?? EMPTY_SELECTION) !== JSON.stringify(EMPTY_SELECTION);
      if (choiceLeftBehind || !onlyFillsInIdentity(previous, key)) setRefinedIdentity(key);
    }
    previousKey.current = key;
  }, [key]);
  useEffect(() => {
    if (!gene) return;
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
    const cachedHotspots = useVariantAnalysisStore.getState().extraContexts[hotspotSlot];
    if (hotspots && (!cachedHotspots || (recoverCached && cachedHotspots.status === 'error'))) void loadHotspots();
    const cachedModels = useVariantAnalysisStore.getState().modelContexts[gene];
    if (models && (!cachedModels || (recoverCached && (cachedModels.status === 'error' || cachedModels.data?.impc?.status === 'error')))) void loadModels();
  }, [gene, expression, dosage, models, recoverCached, hotspots, fetchWithAuth, hpoSlot, hotspotSlot, selection.diseaseKey]);
  return { gene, key, selection, diseaseLoad, dosageLoad, expressionLoad, developmentalLoad, modelLoad, alignmentLoad, pextLoad, hpaLoad, phenotypesLoad, hpoLoad, hpoIds, hotspotLoad,
    identityChanged: refinedIdentity === key,
    setSelection: (value: typeof selection) => { actions.setPhenotypeSelection(key, value); setRefinedIdentity(null); },
    retryDisease: loadDisease, retryDosage: loadDosage, retryExpression: loadExpression, retryDevelopment: loadDevelopment, retryModels: loadModels, retryAlignment: loadAlignment, retryPext: loadPext, retryHpa: loadHpa, retryPhenotypes: loadPhenotypes, retryHpo: loadHpo, retryHotspots: loadHotspots };
}

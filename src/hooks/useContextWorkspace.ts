import { useMemo } from 'react';
import type { AnalysisResult } from '../types';
import { useEvidenceContext } from './useEvidenceContext';
import { buildGeneDiseaseModel } from '../shared/geneDiseaseEvidence';
import { expressionReadings, geneDiseaseReadings, speciesReadings, type ContextTab } from '../shared/contextWorkspace';
import { resolveResidueShiftModel } from '../lib/residueShiftModel';
import { useShallow } from 'zustand/react/shallow';
import { useVariantAnalysisStore } from '../stores/useVariantAnalysisStore';
import { evidenceContextIdentity } from '../shared/evidenceContextIdentity';
import { extraContextKey } from '../shared/evidenceKeys';
import { emptyPhenotypeSelection } from '../shared/phenotypeFrame';
import { buildGeneDiseaseEvidence } from '../shared/diseaseFrame';
import { hpoQueryIds } from '../shared/hpoAnnotation';

type LoadedContext = ReturnType<typeof useEvidenceContext>;
type ContextData = Pick<LoadedContext, 'gene' | 'diseaseLoad' | 'dosageLoad' | 'selection' | 'expressionLoad' | 'developmentalLoad' | 'modelLoad' | 'alignmentLoad' | 'phenotypesLoad' | 'hpoLoad' | 'hpaLoad' | 'pextLoad' | 'hpoIds'>;
const EMPTY_SELECTION = emptyPhenotypeSelection();

/** Read-only inspectors do not initialise API/auth clients or subscribe to unrelated state. */
export function useContextWorkspaceRead(result: AnalysisResult, tab: ContextTab) {
  const context = useVariantAnalysisStore(useShallow(s => {
    const gene = result.metadata?.gene || s.gene;
    const selection = s.phenotypeSelections[evidenceContextIdentity(result, s.gene, s.variant)] ?? EMPTY_SELECTION;
    const diseaseLoad = s.diseaseContexts[gene];
    const frame = buildGeneDiseaseEvidence(diseaseLoad?.data ?? null, selection.diseaseKey).selected;
    const hpoIds = hpoQueryIds(frame?.xrefs ?? []).join(',');
    // The store's extraContexts map is untyped, so each read is cast; the keys themselves come
    // from the shared builder in `evidenceKeys.ts`, so a vocabulary change fails to compile here.
    return { gene, selection, diseaseLoad, dosageLoad: s.dosageContexts[gene], expressionLoad: s.expressionContexts[gene], developmentalLoad: s.developmentalContexts[gene], modelLoad: s.modelContexts[gene],
      alignmentLoad: s.extraContexts[extraContextKey('alignment', gene)] as LoadedContext['alignmentLoad'],
      phenotypesLoad: s.extraContexts[extraContextKey('phenotypes', gene)] as LoadedContext['phenotypesLoad'],
      hpaLoad: s.extraContexts[extraContextKey('hpa', gene)] as LoadedContext['hpaLoad'],
      pextLoad: s.extraContexts[extraContextKey('pext', gene)] as LoadedContext['pextLoad'],
      hpoLoad: s.extraContexts[extraContextKey('hpo', gene, hpoIds)] as LoadedContext['hpoLoad'], hpoIds };
  }));
  return useContextModels(result, tab, context);
}

/** The inspector uses the same selector/model without issuing requests. Memoisation depends
 * on source slots, not hover, filters or the whole analysis store. */
export function useContextWorkspace(result: AnalysisResult, tab: ContextTab) {
  const context = useEvidenceContext(result, tab === 'expression-models', tab === 'gene-disease', tab === 'species-models');
  return useContextModels(result, tab, context);
}
function useContextModels<T extends ContextData>(result: AnalysisResult, tab: ContextTab, context: T) {
  const { gene, diseaseLoad, dosageLoad, selection, expressionLoad, developmentalLoad, modelLoad, alignmentLoad, phenotypesLoad, hpoLoad } = context;
  const model = useMemo(() => buildGeneDiseaseModel({ gene, disease: diseaseLoad, dosage: dosageLoad, selectedKey: selection.diseaseKey }), [gene, diseaseLoad, dosageLoad, selection.diseaseKey]);
  const pair = useMemo(() => resolveResidueShiftModel({ wildType: result.metadata?.wildType, mutant: result.metadata?.mutant, variant: result.metadata?.variant }), [result]);
  const rows = useMemo(() => tab === 'gene-disease' ? geneDiseaseReadings(model)
    : tab === 'expression-models' ? expressionReadings(expressionLoad?.status === 'ready' ? expressionLoad.data : null, developmentalLoad?.status === 'ready' ? developmentalLoad.data : null, selection.systems)
    : speciesReadings({ models: modelLoad?.status === 'ready' ? modelLoad.data : null, alignment: alignmentLoad?.status === 'ready' ? alignmentLoad.data : null,
      phenotypes: phenotypesLoad?.status === 'ready' ? phenotypesLoad.data : null, sequence: result.metadata?.sequence, position: result.metadata?.residueIndex ?? null,
      wildType: pair.wildTypeCode, mutant: pair.mutantCode, diseaseKey: selection.diseaseKey,
      // `null` means the comparison cannot run (no disease chose its terms yet): a phenotype row must not
      // read "No returned overlap" for a comparison that never had terms to compare against.
      diseaseTerms: tab !== 'species-models' || hpoLoad?.status !== 'ready' ? null : hpoLoad.data?.terms.map(t => t.id) ?? null }),
  [tab, model, expressionLoad, developmentalLoad, selection.systems, selection.diseaseKey, modelLoad, alignmentLoad, phenotypesLoad, hpoLoad, result, pair]);
  return { context, model, rows, pair };
}

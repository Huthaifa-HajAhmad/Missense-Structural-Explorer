import type { StateCreator } from 'zustand';
import type { GeneDiseaseResponse } from '../../shared/diseaseFrame';
import type { AdultExpressionResponse } from '../../shared/expressionModels';
import type { DevelopmentalExpressionResponse } from '../../shared/developmentalExpression';
import type { ModelOrganismResponse } from '../../shared/modelOrganisms';
import type { DosageResponse } from '../../shared/dosageSensitivity';
import { phenotypeSelectionSchema, emptyPhenotypeSelection, type PhenotypeSelection } from '../../shared/phenotypeFrame';

export type ContextLoad<T> = { status: 'loading' | 'ready' | 'error'; data: T | null; error?: string };
export interface EvidenceContextSlice {
  diseaseContexts: Record<string, ContextLoad<GeneDiseaseResponse>>;
  expressionContexts: Record<string, ContextLoad<AdultExpressionResponse>>;
  developmentalContexts: Record<string, ContextLoad<DevelopmentalExpressionResponse>>;
  dosageContexts: Record<string, ContextLoad<DosageResponse>>;
  modelContexts: Record<string, ContextLoad<ModelOrganismResponse>>;
  /** Newer sources keyed `kind:gene`, so adding one needs no new slice field. Typed at the reader. */
  extraContexts: Record<string, ContextLoad<unknown>>;
  phenotypeSelections: Record<string, PhenotypeSelection>;
  setDiseaseContext: (gene: string, value: ContextLoad<GeneDiseaseResponse>) => void;
  setDosageContext: (gene: string, value: ContextLoad<DosageResponse>) => void;
  setExpressionContext: (gene: string, value: ContextLoad<AdultExpressionResponse>) => void;
  setDevelopmentalContext: (gene: string, value: ContextLoad<DevelopmentalExpressionResponse>) => void;
  setExtraContext: (key: string, value: ContextLoad<unknown>) => void;
  setModelContext: (gene: string, value: ContextLoad<ModelOrganismResponse>) => void;
  loadPhenotypeSelection: (key: string) => void;
  setPhenotypeSelection: (key: string, value: PhenotypeSelection) => void;
}
const storageKey = (key: string) => `mse.evidenceContext.v1:${key}`;
export const createEvidenceContextSlice: StateCreator<EvidenceContextSlice, [], [], EvidenceContextSlice> = (set, get) => ({
  diseaseContexts: {}, expressionContexts: {}, developmentalContexts: {}, dosageContexts: {}, modelContexts: {}, extraContexts: {}, phenotypeSelections: {},
  setDiseaseContext: (gene, value) => set(s => ({ diseaseContexts: { ...s.diseaseContexts, [gene]: value } })),
  setDosageContext: (gene, value) => set(s => ({ dosageContexts: { ...s.dosageContexts, [gene]: value } })),
  setExpressionContext: (gene, value) => set(s => ({ expressionContexts: { ...s.expressionContexts, [gene]: value } })),
  setDevelopmentalContext: (gene, value) => set(s => ({ developmentalContexts: { ...s.developmentalContexts, [gene]: value } })),
  setExtraContext: (key, value) => set(s => ({ extraContexts: { ...s.extraContexts, [key]: value } })),
  setModelContext: (gene, value) => set(s => ({ modelContexts: { ...s.modelContexts, [gene]: value } })),
  loadPhenotypeSelection: key => {
    if (get().phenotypeSelections[key]) return;
    let value = emptyPhenotypeSelection();
    try { const parsed = phenotypeSelectionSchema.safeParse(JSON.parse(sessionStorage.getItem(storageKey(key)) ?? 'null')); if (parsed.success) value = parsed.data; } catch { /* Session storage is optional. */ }
    set(s => ({ phenotypeSelections: { ...s.phenotypeSelections, [key]: value } }));
  },
  setPhenotypeSelection: (key, value) => {
    const valid = phenotypeSelectionSchema.parse(value);
    set(s => ({ phenotypeSelections: { ...s.phenotypeSelections, [key]: valid } }));
    try { sessionStorage.setItem(storageKey(key), JSON.stringify(valid)); } catch { /* Keep in-memory selection. */ }
  },
});

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { AnalysisResult } from '../../types';
import type { EvidenceWorkspaceTab, AttributionFilter } from '../../shared/evidenceComparison';
import { useAlleleWorkspaceState } from '../../hooks/useAlleleWorkspaceState';
import { WorkspaceTabs } from '../ui/WorkspaceTabs';
import { ReviewWorkspaceProvider } from '../review/ReviewWorkspace';

type View = 'comparison' | 'records' | 'partners' | 'strength' | 'protein' | 'pext' | 'alignment' | 'phenotypes' | 'embeddings' | 'scales';
/** Topic views retain stable IDs so pinned readings and explicit reveal actions survive navigation. */
export const EVIDENCE_DETAIL_LABELS: Record<EvidenceWorkspaceTab, string> = {
  clinical: 'Clinical assertion', predictors: 'Native score scales', alphagenome: 'Rank & composition',
  'gene-disease': 'Validity assertions', 'expression-models': 'Sampling & coverage',
  'species-models': 'Orthology & screens', structure: 'Environment & pockets',
  perturbation: 'Packing & geometry', function: 'Annotation details',
  splicing: 'Channel details', interfaces: 'Assemblies & models',
};
const extraViews: Partial<Record<EvidenceWorkspaceTab, { id: View; label: string }[]>> = {
  splicing: [{ id: 'scales', label: 'Score scales' }],
  predictors: [{ id: 'strength', label: 'Strength bands' }],
  'expression-models': [{ id: 'protein', label: 'Protein measurements' }, { id: 'pext', label: 'Expression at variant' }],
  'species-models': [{ id: 'alignment', label: 'Protein alignments' }, { id: 'phenotypes', label: 'Phenotype annotations' }],
  perturbation: [{ id: 'embeddings', label: 'Sequence embeddings' }],
};
export interface SpliceMapView { transcript: string | null; halfWidth: number | null; focusedScore: boolean; showSmallSignals: boolean }
interface TabState { view: View; selected: string | null; filter: AttributionFilter; expanded: string[]; section: string; query: string; cohort: string; relevantOnly: boolean; window?: { start: number; end: number } | 'whole' | 'near'; hidden?: string[]; spliceView?: { transcript: string; zoom: number | null; focused: boolean }; smallSignals?: boolean; initialized?: boolean; spliceMap?: SpliceMapView }
const initial: TabState = { view: 'comparison', selected: null, filter: 'all', expanded: [], section: '', query: '', cohort: 'all', relevantOnly: false };
const Context = createContext<{ states: Partial<Record<EvidenceWorkspaceTab, TabState>>; update: (tab: EvidenceWorkspaceTab, patch: Partial<TabState>) => void } | null>(null);

/** Scope to the analysed allele, not residue exploration or payload object identity.
 * Reset only Evidence state synchronously; never remount the other workspace canvases. */
export function EvidenceWorkspaceProvider({ result, children }: { result: AnalysisResult | null; children: ReactNode }) {
  const value = useAlleleWorkspaceState<EvidenceWorkspaceTab, TabState>(result, initial);
  return <Context.Provider value={value}><ReviewWorkspaceProvider result={result}>{children}</ReviewWorkspaceProvider></Context.Provider>;
}
export function useEvidenceWorkspace(tab: EvidenceWorkspaceTab) {
  const context = useContext(Context);
  const state = context?.states[tab] ?? initial;
  // Stable closures, so a memoized component can actually escape this hook's re-renders.
  const setView = useCallback((view: View) => context?.update(tab, { view }), [context, tab]);
  const setFilter = useCallback((filter: AttributionFilter) => context?.update(tab, { filter }), [context, tab]);
  const select = useCallback((selected: string | null) => context?.update(tab, { selected }), [context, tab]);
  const toggleGroup = useCallback((group: string) => context?.update(tab, { expanded: state.expanded.includes(group) ? state.expanded.filter(g => g !== group) : [...state.expanded, group] }), [context, tab, state.expanded]);
  const setOptions = useCallback((patch: Partial<Pick<TabState, 'section' | 'query' | 'cohort' | 'relevantOnly' | 'window' | 'hidden' | 'spliceView' | 'smallSignals' | 'initialized' | 'spliceMap'>>) => context?.update(tab, patch), [context, tab]);
  return { ...state, enabled: context !== null,
    comparison: context !== null && state.view === 'comparison',
    setOptions,
    setView, setFilter, select, toggleGroup };
}
export function EvidenceViewTabs({ tab, comparisonLabel = 'Comparison' }: { tab: EvidenceWorkspaceTab; comparisonLabel?: string }) {
  const w = useEvidenceWorkspace(tab);
  if (!w.enabled) return null;
  const names: Record<EvidenceWorkspaceTab, string> = { clinical: 'Population', predictors: 'Predictors', alphagenome: 'AlphaGenome', 'gene-disease': 'Gene–disease', 'expression-models': 'Expression', 'species-models': 'Species & models', structure: 'Residue shifts & pockets', perturbation: 'Structural perturbation', function: 'Functional domains', splicing: 'RNA splicing', interfaces: 'Interfaces & PPI' };
  return <div className="evw-navigation"><WorkspaceTabs id={`evidence-${tab}`} label={`${names[tab]} views`}
    tabs={[{ id: 'comparison', label: comparisonLabel }, ...(tab === 'interfaces' ? [{ id: 'partners' as const, label: 'Partners' }] : []), { id: 'records', label: EVIDENCE_DETAIL_LABELS[tab] }, ...(extraViews[tab] ?? [])]} value={w.view} onChange={w.setView} /></div>;
}
export function EvidencePanel({ tab, children }: { tab: EvidenceWorkspaceTab; children: ReactNode }) {
  const w = useEvidenceWorkspace(tab);
  return <div className="evw-panel" role={w.enabled ? 'tabpanel' : undefined} id={`evidence-${tab}-panel-${w.view}`}
    aria-labelledby={w.enabled ? `evidence-${tab}-tab-${w.view}` : undefined}>{children}</div>;
}
/** Declare content ownership at the call site. Disclosures (including inspector disclosures)
 * must never infer navigation from their IDs. Standalone renders retain all source content. */
export function EvidenceTopic({ tab, view, children }: { tab: EvidenceWorkspaceTab; view: View; children: ReactNode }) {
  const workspace = useEvidenceWorkspace(tab);
  return !workspace.enabled || workspace.view === view ? <>{children}</> : null;
}
export function InspectReadingButton({ tab, readingKey, children }: { tab: EvidenceWorkspaceTab; readingKey: string; children: ReactNode }) {
  const w = useEvidenceWorkspace(tab);
  if (!w.enabled) return <>{children}</>;
  // Selection convention of the whole workspace: a reading button pins its reading; the inspector's
  // Clear pin is the single release action. `aria-pressed` marks which control owns the pin.
  return <button type="button" className="evw-reading-button" aria-pressed={w.selected === readingKey} onClick={() => w.select(readingKey)}>{children}</button>;
}

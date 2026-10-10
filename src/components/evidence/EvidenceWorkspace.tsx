import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AnalysisResult } from '../../types';
import type { EvidenceWorkspaceTab, AttributionFilter } from '../../shared/evidenceComparison';
import { evidenceWorkspaceIdentity } from '../../shared/evidenceContextIdentity';
import { WorkspaceTabs } from '../ui/WorkspaceTabs';
import { INSPECTOR_SECTIONS, requestInspectorFocus } from '../../lib/inspectorFocus';

type View = 'comparison' | 'records';
interface TabState { view: View; selected: string | null; filter: AttributionFilter; expanded: string[]; section: string; query: string; cohort: string; relevantOnly: boolean; window?: { start: number; end: number } | 'whole' | 'near'; hidden?: string[] }
const initial: TabState = { view: 'comparison', selected: null, filter: 'all', expanded: [], section: '', query: '', cohort: 'all', relevantOnly: false };
const Context = createContext<{ states: Partial<Record<EvidenceWorkspaceTab, TabState>>; update: (tab: EvidenceWorkspaceTab, patch: Partial<TabState>) => void } | null>(null);

/** Scope to the analysed allele, not residue exploration or payload object identity.
 * Reset only Evidence state synchronously; never remount the other workspace canvases. */
export function EvidenceWorkspaceProvider({ result, children }: { result: AnalysisResult | null; children: ReactNode }) {
  // Memoized: AppViews re-renders on pointer movement, and the key sat on that hot path.
  const key = useMemo(() => evidenceWorkspaceIdentity(result), [result]);
  const [scope, setScope] = useState<{ key: string; states: Partial<Record<EvidenceWorkspaceTab, TabState>> }>({ key, states: {} });
  if (scope.key !== key) setScope({ key, states: {} });
  const update = useCallback((tab: EvidenceWorkspaceTab, patch: Partial<TabState>) => setScope(s => ({
    key, states: { ...(s.key === key ? s.states : {}), [tab]: { ...initial, ...(s.key === key ? s.states[tab] : {}), ...patch } },
  })), [key]);
  const value = useMemo(() => ({ states: scope.key === key ? scope.states : {}, update }), [scope, key, update]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useEvidenceWorkspace(tab: EvidenceWorkspaceTab) {
  const context = useContext(Context);
  const state = context?.states[tab] ?? initial;
  // Stable closures, so a memoized component can actually escape this hook's re-renders.
  const setView = useCallback((view: View) => context?.update(tab, { view }), [context, tab]);
  const setFilter = useCallback((filter: AttributionFilter) => context?.update(tab, { filter }), [context, tab]);
  const select = useCallback((selected: string | null) => context?.update(tab, { selected }), [context, tab]);
  const toggleGroup = useCallback((group: string) => context?.update(tab, { expanded: state.expanded.includes(group) ? state.expanded.filter(g => g !== group) : [...state.expanded, group] }), [context, tab, state.expanded]);
  return { ...state, enabled: context !== null,
    comparison: context !== null && state.view === 'comparison',
    setOptions: (patch: Partial<Pick<TabState, 'section' | 'query' | 'cohort' | 'relevantOnly' | 'window' | 'hidden'>>) => context?.update(tab, patch),
    setView, setFilter, select, toggleGroup };
}
export function EvidenceViewTabs({ tab, comparisonLabel = 'Comparison' }: { tab: EvidenceWorkspaceTab; comparisonLabel?: string }) {
  const w = useEvidenceWorkspace(tab);
  if (!w.enabled) return null;
  const names: Record<EvidenceWorkspaceTab, string> = { clinical: 'Population', predictors: 'Predictors', alphagenome: 'AlphaGenome', 'gene-disease': 'Gene–disease', 'expression-models': 'Expression', 'species-models': 'Species & models', structure: 'Residue shifts & pockets', perturbation: 'Structural perturbation', function: 'Functional domains' };
  return <div className="evw-navigation"><WorkspaceTabs id={`evidence-${tab}`} label={`${names[tab]} views`}
    tabs={[{ id: 'comparison', label: comparisonLabel }, { id: 'records', label: 'Source records' }]} value={w.view} onChange={w.setView} /><RevealEvidenceInspector /></div>;
}
export function EvidencePanel({ tab, children }: { tab: EvidenceWorkspaceTab; children: ReactNode }) {
  const w = useEvidenceWorkspace(tab);
  return <div className="evw-panel" role={w.enabled ? 'tabpanel' : undefined} id={`evidence-${tab}-panel-${w.view}`}
    aria-labelledby={w.enabled ? `evidence-${tab}-tab-${w.view}` : undefined}>{children}</div>;
}
export function InspectReadingButton({ tab, readingKey, children }: { tab: EvidenceWorkspaceTab; readingKey: string; children: ReactNode }) {
  const w = useEvidenceWorkspace(tab);
  if (!w.enabled) return <>{children}</>;
  return <button type="button" className="evw-reading-button" aria-pressed={w.selected === readingKey} onClick={() => w.select(readingKey)}>{children}</button>;
}
export function RevealEvidenceInspector() {
  return <button type="button" className="viz-action" onClick={() => requestInspectorFocus(INSPECTOR_SECTIONS.evidenceReading)}>Open inspector</button>;
}

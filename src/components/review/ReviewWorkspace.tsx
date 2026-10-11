import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AnalysisResult } from '../../types';
import { evidenceWorkspaceIdentity } from '../../shared/evidenceContextIdentity';
import { WorkspaceTabs } from '../ui/WorkspaceTabs';
import { INSPECTOR_SECTIONS, requestInspectorFocus } from '../../lib/inspectorFocus';

type ReviewTab = 'insights' | 'literature';
type ReviewView = 'map' | 'records' | 'summary';
interface State { view: ReviewView; selected: string | null; reveal: number }
const initial: State = { view: 'map', selected: null, reveal: 0 };
const Context = createContext<{ states: Partial<Record<ReviewTab, State>>; update: (tab: ReviewTab, patch: Partial<State>) => void } | null>(null);

/** Review selections outlive a tab remount, but never the analysed allele. */
export function ReviewWorkspaceProvider({ result, children }: { result: AnalysisResult | null; children: ReactNode }) {
  const key = useMemo(() => evidenceWorkspaceIdentity(result), [result]);
  const [scope, setScope] = useState<{ key: string; states: Partial<Record<ReviewTab, State>> }>({ key, states: {} });
  if (scope.key !== key) setScope({ key, states: {} });
  const update = useCallback((tab: ReviewTab, patch: Partial<State>) => setScope(s => ({ key,
    states: { ...(s.key === key ? s.states : {}), [tab]: { ...initial, ...(s.key === key ? s.states[tab] : {}), ...patch } },
  })), [key]);
  const value = useMemo(() => ({ states: scope.key === key ? scope.states : {}, update }), [scope, key, update]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useReviewWorkspace(tab: ReviewTab) {
  const context = useContext(Context);
  const [local, setLocal] = useState(initial);
  const state = context ? context.states[tab] ?? initial : local;
  const update = (patch: Partial<State>) => context ? context.update(tab, patch) : setLocal(s => ({ ...s, ...patch }));
  return { ...state, select: (selected: string | null) => update({ selected }),
    setView: (view: ReviewView) => update({ view }),
    finishReveal: () => update({ reveal: 0 }),
    showSelected: () => update({ view: tab === 'insights' ? 'map' : 'records', reveal: state.reveal + 1 }) };
}

export function ReviewNavigation({ tab, workspace: w }: { tab: ReviewTab; workspace: ReturnType<typeof useReviewWorkspace> }) {
  return <div className="review-navigation"><WorkspaceTabs id={`review-${tab}`} label={`${tab === 'insights' ? 'Insights' : 'Literature'} views`}
    tabs={[{ id: 'map', label: tab === 'insights' ? 'Evidence map' : 'Reading desk' }, { id: 'records', label: tab === 'insights' ? 'Criterion records' : 'Source records' },
      ...(tab === 'insights' ? [{ id: 'summary' as const, label: 'Written summary' }] : [])]}
    value={w.view} onChange={w.setView} />
    <button type="button" className="review-action" onClick={() => requestInspectorFocus(INSPECTOR_SECTIONS.evidenceReading)}>Open inspector</button></div>;
}

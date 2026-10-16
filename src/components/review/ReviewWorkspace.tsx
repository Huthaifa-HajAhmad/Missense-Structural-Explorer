import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { AnalysisResult } from '../../types';
import { useAlleleWorkspaceState } from '../../hooks/useAlleleWorkspaceState';
import { WorkspaceTabs } from '../ui/WorkspaceTabs';

type ReviewTab = 'insights' | 'literature';
type ReviewView = 'map' | 'records' | 'summary';
interface State { view: ReviewView; selected: string | null; reveal: number }
const initial: State = { view: 'map', selected: null, reveal: 0 };
const Context = createContext<{ states: Partial<Record<ReviewTab, State>>; update: (tab: ReviewTab, patch: Partial<State>) => void } | null>(null);

/** Review selections outlive a tab remount, but never the analysed allele. */
export function ReviewWorkspaceProvider({ result, children }: { result: AnalysisResult | null; children: ReactNode }) {
  const value = useAlleleWorkspaceState<ReviewTab, State>(result, initial);
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
    value={w.view} onChange={w.setView} /></div>;
}

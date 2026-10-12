import { useCallback, useMemo, useState } from 'react';
import type { AnalysisResult } from '../types';
import { evidenceWorkspaceIdentity } from '../shared/evidenceContextIdentity';

/** Selections survive remounts within an allele, and reset synchronously when it changes. */
export function useAlleleWorkspaceState<Tab extends string, State>(result: AnalysisResult | null, initial: State) {
  const key = useMemo(() => evidenceWorkspaceIdentity(result), [result]);
  const [scope, setScope] = useState<{ key: string; states: Partial<Record<Tab, State>> }>({ key, states: {} });
  if (scope.key !== key) setScope({ key, states: {} });
  const update = useCallback((tab: Tab, patch: Partial<State>) => setScope(s => ({ key,
    states: { ...(s.key === key ? s.states : {}), [tab]: { ...initial, ...(s.key === key ? s.states[tab] : {}), ...patch } },
  })), [key, initial]);
  return useMemo(() => ({ states: scope.key === key ? scope.states : {}, update }), [scope, key, update]);
}

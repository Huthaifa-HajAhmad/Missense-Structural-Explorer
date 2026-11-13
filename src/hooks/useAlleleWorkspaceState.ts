import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalysisResult } from '../types';
import { evidenceWorkspaceIdentity, isSameAnalysedAllele } from '../shared/evidenceContextIdentity';

/** Selections survive remounts and streaming within an allele, and reset synchronously when it changes. */
export function useAlleleWorkspaceState<Tab extends string, State>(result: AnalysisResult | null, initial: State) {
  const key = useMemo(() => evidenceWorkspaceIdentity(result), [result]);
  const [scope, setScope] = useState<{ key: string; states: Partial<Record<Tab, State>> }>({ key, states: {} });
  const matchesScope = scope.key === key || isSameAnalysedAllele(scope.key, key);
  const effectiveStates = matchesScope ? scope.states : {};

  useEffect(() => {
    setScope((prev) => {
      if (prev.key === key) return prev;
      return { key, states: isSameAnalysedAllele(prev.key, key) ? prev.states : {} };
    });
  }, [key]);

  const update = useCallback(
    (tab: Tab, patch: Partial<State>) =>
      setScope((s) => {
        const base = s.key === key || isSameAnalysedAllele(s.key, key) ? s.states : ({} as Partial<Record<Tab, State>>);
        return {
          key,
          states: { ...base, [tab]: { ...initial, ...base[tab], ...patch } },
        };
      }),
    [key, initial]
  );

  return useMemo(() => ({ states: effectiveStates, update }), [effectiveStates, update]);
}

import { useEffect, useState } from 'react';
import type { EvidenceChartRow } from '../../shared/evidenceComparison';
import { useEvidenceWorkspace } from './EvidenceWorkspace';

/** Explicit focus handoff only. Switching view tabs never steals keyboard focus. */
export function MechanismSelection({ tab, rows, visibleKeys }: {
  tab: 'splicing' | 'interfaces'; rows: EvidenceChartRow[]; visibleKeys: string[];
}) {
  const w = useEvidenceWorkspace(tab);
  const [reveal, setReveal] = useState<string | null>(null);
  const reading = rows.find(r => r.key === w.selected);
  useEffect(() => {
    if (!reveal) return;
    const element = [...document.querySelectorAll<HTMLElement>(`[data-mechanism="${tab}"] [data-reading-key]`)]
      .find(el => el.dataset.readingKey === reveal);
    if (!element) { setReveal(null); return; }
    const focus = element.matches('button') ? element : element.querySelector<HTMLElement>('button');
    focus?.focus();
    element.scrollIntoView?.({ block: 'nearest' });
    setReveal(null);
  }, [reveal, tab, w.view]);
  if (!w.enabled || !reading) return null;
  const outside = !visibleKeys.includes(reading.key);
  return <div className="mx-selection" role="status">
    <span><strong>{reading.name}</strong> is pinned.{outside ? ' It is outside the current view or filter; its evidence remains in the inspector.' : ' Its exact evidence is in the inspector.'}</span>
    <button type="button" className="viz-action" onClick={() => {
      const destination = tab === 'splicing' ? 'records' : reading.group === 'partners' ? 'partners' : reading.key.startsWith('track:') ? 'comparison' : 'records';
      w.setView(destination);
      if (reading.group === 'partners') w.setOptions({ section: '', query: reading.name });
      if (reading.key.startsWith('track:')) w.setOptions({ hidden: [] });
      setReveal(reading.key);
    }}>Show selected reading</button>
  </div>;
}

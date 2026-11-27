import { useEvidenceWorkspace } from '../EvidenceWorkspace';

/** Search box (and, for phenotypes, the disease-overlap switch) for one Species & models view.
 * The search text is shared by the three views, so a species chosen from the coverage chart stays
 * chosen when you move between them. Filters change what is listed, never the summary counts. */
export function SpeciesRecordFilter({ shown, total, noun, placeholder, overlap }: {
  shown: number; total: number; noun: string; placeholder: string;
  /** Present on the phenotype view only. `available` is false when no disease terms can be compared. */
  overlap?: { available: boolean };
}) {
  const w = useEvidenceWorkspace('species-models');
  // Outside the workspace (for example a printed report) there is nowhere to keep filter state.
  if (!w.enabled) return null;
  const overlapOn = !!overlap?.available && w.relevantOnly;
  const filtered = !!w.query.trim() || overlapOn;
  return <div className="ctx-card__body sm-filter">
    <div className="cx-controls">
      <label>Search records<input type="search" value={w.query} placeholder={placeholder} onChange={e => w.setOptions({ query: e.target.value })} /></label>
      {overlap?.available && <label className="cx-check">
        <input type="checkbox" checked={overlapOn} onChange={e => w.setOptions({ relevantOnly: e.target.checked })} />Disease overlap only</label>}
      {filtered && <button type="button" className="viz-action" onClick={() => w.setOptions({ query: '', relevantOnly: false })}>Clear filters</button>}
    </div>
    <p className="ctx-caption" role="status">{shown} of {total} {noun} shown.</p>
  </div>;
}

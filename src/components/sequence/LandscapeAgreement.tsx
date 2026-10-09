import React, { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { LandscapeResidueItem } from '../../shared/contracts';
import { agreementClass, residueSummary, type Agreement, type SummaryMode } from '../../shared/landscapeEvidence';
import LandscapeAgreementPlot from '../LandscapeAgreementPlot';
import { VisualizationPanel } from '../ui/VisualizationPanel';

const GROUPS: { id: Agreement | 'all'; label: string }[] = [
  { id: 'all', label: 'All paired scores' }, { id: 'discordant', label: 'Discordant' },
  { id: 'both-pp3', label: 'Both PP3' }, { id: 'both-bp4', label: 'Both BP4' },
  { id: 'other', label: 'Either indeterminate' },
];

/** Contiguous residue runs the rows cover, e.g. "91–141, 300–330": the plotted set is only what has been loaded. */
export function coveredRuns(rows: LandscapeResidueItem[]): string {
  const pos = rows.map(r => r.residx).sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < pos.length;) {
    let j = i;
    while (j + 1 < pos.length && pos[j + 1] === pos[j] + 1) j++;
    runs.push(pos[i] === pos[j] ? `${pos[i]}` : `${pos[i]}–${pos[j]}`);
    i = j + 1;
  }
  return runs.join(', ');
}

export function LandscapeAgreement({ rows, mode, onMode, variantRevel, variantAm, selectedResidue, onSelect, onHover, label, provenance }: {
  label?: string; provenance?: string;
  rows: LandscapeResidueItem[]; mode: SummaryMode; onMode?: (mode: SummaryMode) => void; variantRevel: number | null; variantAm: number | null;
  selectedResidue: number | null; onSelect: (pos: number) => void; onHover: (pos: number | null) => void;
}) {
  const [filter, setFilter] = useState<Agreement | 'all'>('all');
  const [brush, setBrush] = useState<{ x0: number; x1: number; y0: number; y1: number } | null>(null);
  // A dragged region is in score units of the current summary; it means something else after Mean ↔ Max.
  useEffect(() => setBrush(null), [mode]);
  const covered = useMemo(() => coveredRuns(rows), [rows]);
  const paired = useMemo(() => rows.flatMap(row => {
    const revel = residueSummary(row, 'revel', mode);
    const am = residueSummary(row, 'alphaMissense', mode);
    return revel === null || am === null ? [] : [{ row, revel, am, group: agreementClass(revel, am)! }];
  }), [rows, mode]);
  const filtered = paired.filter(p => (filter === 'all' || p.group === filter)
    && (!brush || (p.revel >= brush.x0 && p.revel <= brush.x1 && p.am >= brush.y0 && p.am <= brush.y1)));
  const exportCsv = () => {
    const csv = [`residue,summary,REVEL,AlphaMissense,agreement`, ...filtered.map(p =>
      `${p.row.residx},${mode},${p.revel},${p.am},${p.group}`)].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `landscape-agreement-${(label ?? 'protein').replace(/[^\w.-]+/g, '-')}-${mode}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <VisualizationPanel title="Where do the predictors disagree?"
    description={`REVEL × AlphaMissense · residue ${mode}s · loaded residues only: ${covered || 'none'}`}
    actions={<div className="viz-header-actions"><div className="viz-mode" role="group" aria-label="Residue summary">{(['mean', 'max'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() => onMode?.(value)}>{value === 'mean' ? 'Mean' : 'Max'}</button>)}</div><button type="button" className="viz-action" onClick={exportCsv} disabled={!filtered.length}><Download size={14} /> Export CSV</button></div>}
    note="Each circle summarizes a residue’s scored substitutions. The diamond is the queried variant’s own scores. Bands on residue summaries provide context; they do not assign ACMG evidence.">
    <div className="viz-filters" role="group" aria-label="Filter predictor agreement">
      {GROUPS.map(group => <button key={group.id} type="button" aria-pressed={filter === group.id}
        onClick={() => { setFilter(group.id); setBrush(null); }}>
        {group.label}<span>{group.id === 'all' ? paired.length : paired.filter(p => p.group === group.id).length}</span>
      </button>)}
    </div>
    <div className="viz-scope"><span role="status">{filtered.length} of {paired.length} paired residues shown · {rows.length - paired.length} without paired scores</span>
      {brush ? <button type="button" className="viz-action" onClick={() => setBrush(null)}>Clear region</button> : <span>Drag to select a region · select a point to inspect</span>}
    </div>
    <details className="viz-range"><summary>Set score range</summary><div>
      {([{ key: 'x0', label: 'REVEL minimum', fallback: 0 }, { key: 'x1', label: 'REVEL maximum', fallback: 1 }, { key: 'y0', label: 'AlphaMissense minimum', fallback: 0 }, { key: 'y1', label: 'AlphaMissense maximum', fallback: 1 }] as const).map(field => <label key={field.key}>{field.label}<input type="number" min="0" max="1" step="0.01"
        value={brush?.[field.key] ?? field.fallback} onChange={event => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isFinite(value)) setBrush(current => ({ ...(current ?? { x0: 0, x1: 1, y0: 0, y1: 1 }), [field.key]: Math.min(1, Math.max(0, value)) }));
        }} /></label>)}
    </div></details>
    <LandscapeAgreementPlot rows={filtered.map(p => p.row)} variantRevel={variantRevel} variantAm={variantAm}
      mode={mode} selectedResidue={selectedResidue} onSelectResidue={onSelect} onHoverResidue={onHover} onBrush={setBrush} />
    {!filtered.length && <p className="viz-empty">{paired.length ? 'No residues match this selection. Choose another group or clear the region.' : 'Paired predictor scores are not available for the loaded residues.'}</p>}
    <details className="viz-data" open={filtered.length > 0 && filtered.length <= 12}>
      <summary>Inspect plotted data <span>{filtered.length} residues</span></summary>
      <div className="viz-table-scroll" tabIndex={0} role="region" aria-label="Plotted residue scores">
        <table><caption>Residue {mode}s, ordered by position. Select a residue to update the inspector.</caption>
          <thead><tr><th scope="col">Residue</th><th scope="col">REVEL</th><th scope="col">AlphaMissense</th><th scope="col">Agreement</th></tr></thead>
          <tbody>{filtered.map(p => <tr key={p.row.residx} data-selected={selectedResidue === p.row.residx || undefined}>
            <th scope="row"><button type="button" onClick={() => onSelect(p.row.residx)} aria-pressed={selectedResidue === p.row.residx}>Residue {p.row.residx}</button></th>
            <td>{p.revel.toFixed(3)}</td><td>{p.am.toFixed(3)}</td><td>{GROUPS.find(g => g.id === p.group)?.label}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </VisualizationPanel>;
}

import { useMemo, useState } from 'react';
import { defineChart, dot, ruleX, link } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { decorative } from '@tanstack/charts/mark/decorative';
import { ChartFrame } from '../charts/ChartFrame';
import { chartTheme } from '../charts/chartTheme';
import type { EvidenceChartModel, EvidenceWorkspaceTab, AttributionFilter } from '../../shared/evidenceComparison';
import { AVI_GROUP_LABEL } from '../../shared/alphagenomeEvidence';
import { useEvidenceWorkspace } from './EvidenceWorkspace';

/** Generic rendering only: values, geometry and interpretation belong to the pure model. */
export default function EvidenceComparison({ tab, model, title, description }: {
  tab: EvidenceWorkspaceTab; model: EvidenceChartModel; title: string; description: string;
}) {
  const w = useEvidenceWorkspace(tab);
  const [preview, setPreview] = useState<{ model: EvidenceChartModel; text: string } | null>(null);
  const plotted = useMemo(() => model.rows.filter(r => r.value !== null).map((r, row) => ({ ...r, value: r.value as number, row })), [model]);
  const missing = model.rows.filter(r => r.value === null);
  const selected = model.rows.find(r => r.key === w.selected);
  const definition = useMemo(() => defineChart({
    theme: chartTheme, margin: { top: 20, right: 24, bottom: tab === 'predictors' ? 95 : 65, left: tab === 'expression-models' ? 245 : tab === 'clinical' ? 180 : 135 },
    scales: {
      x: { scale: scaleLinear().domain(model.domain), grid: { strokeOpacity: .6 },
        axis: { label: { text: '', opacity: 1 }, ticks: { values: model.ticks, format: (v: number) => model.tickLabels[model.ticks.indexOf(v)] ?? '' },
          tickLabels: { fontSize: 11, opacity: 1, ...(tab === 'predictors' ? { rotate: -35 } : {}) } } },
      y: { scale: scaleLinear().domain([Math.max(plotted.length - .5, .5), -.5]),
        axis: { line: false, ticks: { values: plotted.map(p => p.row), size: 0, format: (v: number) => plotted[v] ? `${plotted[v].name}${plotted[v].counted === false ? ' *' : ''}` : '' }, tickLabels: { fontSize: 12, opacity: 1 } } },
    },
    marks: [
      ...(tab === 'alphagenome' ? [ruleX([0], { stroke: 'var(--cs-text-secondary)', strokeWidth: 1.5 }),
        decorative(link(plotted, { id: 'contribution', key: 'key', x1: () => 0, x2: 'value', y1: 'row', y2: 'row', stroke: d => d.tone === 'accent' ? 'var(--cs-accent-clay)' : 'var(--cs-text-secondary)', strokeWidth: 7, strokeOpacity: .55 }))] : []),
      ...(['accent', 'neutral', 'danger', 'good'] as const).map(tone => dot(plotted.filter(p => p.tone === tone), {
        id: `reading-${tone}`, key: 'key', x: 'value', y: 'row', r: 6,
        fill: tone === 'accent' ? 'var(--cs-accent-clay)' : tone === 'danger' ? 'var(--cs-text-danger)' : tone === 'good' ? 'var(--cs-text-success)' : 'var(--cs-text-secondary)',
      })),
      // Only the value dot owns interaction. A bar midpoint or pin ring must not become
      // another keyboard stop or put the focus indicator at a false quantitative position.
      decorative(dot(plotted.filter(p => p.key === w.selected), { id: 'pinned', key: 'key', x: 'value', y: 'row', r: 11, fill: 'none', stroke: 'var(--cs-text-primary)', strokeWidth: 2 })),
    ],
    svgAnimation: false, maxFocusDistance: 24,
    focusRing: { fill: 'none', stroke: 'var(--cs-text-primary)', radius: 9, strokeWidth: 2 },
  }), [model, plotted, tab, w.selected]);
  return <ChartFrame title={title} description={description} summary={model.summary}
    empty={plotted.length ? undefined : tab === 'alphagenome' ? 'No returned contributions in this view. Unattributed features remain inspectable below.' : 'No values can be plotted on this axis. Inspect the available records below.'}
    actions={<div className="evw-controls">
      {tab === 'alphagenome' && <label>Feature family <select value={w.filter} onChange={e => w.setFilter(e.target.value as AttributionFilter)}>
        <option value="all">All features</option>{Object.entries(AVI_GROUP_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>}
    </div>}
    footer={<><span>{model.axisLabel}</span>{tab === 'predictors' && <span>* Informational: not counted by the voting rule.</span>}<span>Hover or use arrow keys to explore. Click or press Enter to pin a reading. Source records retain exact values.</span></>}>
    {tab === 'alphagenome' && <div className="evw-axis-guide"><span>← Lowers AVI score</span><span>Raises AVI score →</span></div>}
    {plotted.length > 0 && <div className="evw-chart-scroll" role="region" aria-label={`${title} chart`} tabIndex={0}>
      <div className="evw-chart-canvas" data-wide={tab === 'predictors' || tab === 'expression-models' || undefined}>
        <Chart definition={definition} height={Math.max(260, plotted.length * 42 + (tab === 'predictors' ? 115 : 90))}
          ariaLabel={`${title}. Arrow keys explore; Enter pins a reading.`} ariaDescription={model.summary}
          onSelect={p => { if (p) w.select(p.datum.key); }}
          onFocusChange={p => setPreview(p ? { model, text: `${p.datum.name} · ${p.datum.valueText}` } : null)} />
      </div>
    </div>}
    <p className="evw-readout" role="status" aria-label="Evidence chart readout">{(preview?.model === model ? preview.text : null) ?? (selected ? `Pinned: ${selected.name} · ${selected.valueText}` : 'Select a reading to explore its meaning and source in the inspector.')}</p>
    {tab === 'alphagenome' && w.selected && !selected && <p className="evw-caption">The pinned feature is outside this filter. Its details remain in the inspector; choose All features to see it here.</p>}
    {missing.length > 0 && <div className="evw-unplotted"><h3>{tab === 'predictors' ? 'Outside the calibrated comparison' : 'Not plotted'}</h3>
      <p>{tab === 'predictors' ? 'These tools have no calibrated strength to plot, or no returned score. Select one to inspect its own scale and status.' : tab === 'clinical' ? 'Zero and unavailable frequencies cannot sit on a log axis. Their states remain distinct.' : tab === 'expression-models' ? 'These tissues have no returned gene median. Missing measurements are not zero.' : 'A missing attribution is not a contribution of zero.'}</p>
      <div className="evw-reading-list">{missing.map(r => <button type="button" key={r.key} aria-pressed={w.selected === r.key} onClick={() => w.select(r.key)}><span>{r.name}</span>{' '}<strong>{r.valueText}</strong></button>)}</div>
    </div>}
    {tab === 'alphagenome' && <p className="evw-caption">{model.summary}</p>}
  </ChartFrame>;
}

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

/** Per-tab GEOMETRY only (margins, hit heights, controls); values and interpretation come from the model. */
export default function EvidenceComparison({ tab, model, title, description }: {
  tab: EvidenceWorkspaceTab; model: EvidenceChartModel; title: string; description: string;
}) {
  const w = useEvidenceWorkspace(tab);
  // The hovered reading is kept as a KEY, not as a captured model: tabs rebuild their model on
  // every workspace update, so an object-identity check silently dropped the readout mid-hover.
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const margin = { top: 20, right: 24, bottom: tab === 'predictors' ? 95 : 65, left: tab === 'clinical' ? 180 : 135 };
  const plotted = useMemo(() => model.rows.filter(r => r.value !== null).map((r, row) => ({ ...r, value: r.value as number, row })), [model]);
  const missing = model.rows.filter(r => r.value === null);
  const selected = model.rows.find(r => r.key === w.selected);
  const hovered = hoverKey ? model.rows.find(r => r.key === hoverKey) : null;
  const definition = useMemo(() => defineChart({
    theme: chartTheme, margin,
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
  // Activating the pinned reading again clears the pin — the chart offered no way back.
  const toggleSelect = (key: string) => w.select(key === w.selected ? null : key);
  return <ChartFrame title={title} description={description} summary={model.summary}
    empty={plotted.length ? undefined
      // A filtered view that holds no returned contributions is an interaction state, not a model
      // state: it needs the filter's own words, not the unassessed/no-vector copy.
      : tab === 'alphagenome' && w.filter !== 'all'
        ? 'No returned contributions in this view. Unattributed features remain inspectable below.'
        : model.emptyCopy}
    actions={<div className="evw-controls">
      {tab === 'alphagenome' && <label>Feature family <select value={w.filter} onChange={e => w.setFilter(e.target.value as AttributionFilter)}>
        <option value="all">All features</option>{Object.entries(AVI_GROUP_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>}
    </div>}
    footer={<><span>{model.axisLabel}</span>
      {/* Colour alone never carries a call: each dot tone names its meaning in words (WCAG 1.4.1). */}
      {tab === 'predictors' && <>
        <span className="evw-legend"><i className="evw-legend__dot" data-tone="danger" />Pathogenic direction</span>
        <span className="evw-legend"><i className="evw-legend__dot" data-tone="good" />Benign direction</span>
        <span className="evw-legend"><i className="evw-legend__dot" data-tone="neutral" />Indeterminate or no call</span>
        <span>* Informational: not counted by the voting rule.</span>
      </>}
      {tab === 'alphagenome' && <>
        <span className="evw-legend"><i className="evw-legend__dot" data-tone="accent" />Molecular prediction</span>
        <span className="evw-legend"><i className="evw-legend__dot" data-tone="neutral" />Other input</span>
      </>}
      <span>Hover or use arrow keys to explore. Click or press Enter to pin a reading; press Enter again to clear it. Source records retain exact values.</span></>}>
    {tab === 'alphagenome' && <div className="evw-axis-guide" style={{ ["--evw-guide-left" as string]: `${margin.left}px` }}><span>← Lowers AVI score</span><span>Raises AVI score →</span></div>}
    {plotted.length > 0 && <div className="evw-chart-scroll" role="region" aria-label={`${title} chart`} tabIndex={0}>
      <div className="evw-chart-canvas" data-wide={tab === 'predictors' || undefined}>
        <Chart definition={definition} height={Math.max(260, plotted.length * 42 + (tab === 'predictors' ? 115 : 90))}
          ariaLabel={`${title}. Arrow keys explore; Enter pins a reading.`} ariaDescription={model.summary}
          onSelect={p => { if (p) toggleSelect(p.datum.key); }}
          onFocusChange={p => setHoverKey(p ? p.datum.key : null)} />
      </div>
    </div>}
    <p className="evw-readout" role="status">{(() => {
      const row = hovered ?? selected;
      if (!row) return 'Select a reading to explore its meaning and source in the inspector.';
      // State, not just value: while this reading is the pin, say so — including when its dot is
      // itself hovered or keyboard-focused.
      return `${row.key === w.selected ? 'Pinned: ' : ''}${row.name} · ${row.valueText}`;
    })()}</p>
    {tab === 'alphagenome' && w.selected && !selected && <p className="evw-caption">The pinned feature is outside this filter. Its details remain in the inspector; choose All features to see it here.</p>}
    {missing.length > 0 && <div className="evw-unplotted"><h3>{model.unplottedHeading}</h3>
      <p>{model.unplottedBody}</p>
      <div className="evw-reading-list">{missing.map(r => <button type="button" key={r.key} aria-pressed={w.selected === r.key} onClick={() => toggleSelect(r.key)}><span>{r.name}</span>{' '}<strong>{r.valueText}</strong></button>)}</div>
    </div>}
    {tab === 'alphagenome' && <p className="evw-caption">{model.summary}</p>}
  </ChartFrame>;
}

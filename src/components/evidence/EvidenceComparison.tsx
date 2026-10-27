import { useMemo, useState } from 'react';
import { defineChart, dot, ruleX, link, text } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { decorative } from '@tanstack/charts/mark/decorative';
import { ChartFrame } from '../charts/ChartFrame';
import { chartTheme } from '../charts/chartTheme';
import { populationLabelWidth, populationRowLabel, type EvidenceChartModel, type EvidenceWorkspaceTab, type AttributionFilter } from '../../shared/evidenceComparison';
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
  const expanded = w.expanded.includes('all-attributions');
  const limit = tab === 'alphagenome' && !expanded ? 8 : Infinity;
  const returned = model.rows.filter(r => r.value !== null).length;
  const labelled = ['clinical', 'predictors', 'alphagenome', 'expression-models', 'perturbation'].includes(tab);
  const margin = useMemo(() => ({ top: labelled ? 12 : 20, right: tab === 'clinical' ? 190 : labelled ? 90 : 24, bottom: tab === 'predictors' ? 12 : labelled ? 48 : 65,
    left: tab === 'expression-models' ? 245 : tab === 'clinical' ? populationLabelWidth(model.rows.filter(r => r.value !== null).map(r => r.name)) : labelled ? 150 : 135 }),
    [tab, labelled, model]);
  const rowLabel = useMemo(() => (name: string) => tab === 'clinical' ? populationRowLabel(name) : name, [tab]);
  const plotted = useMemo(() => model.rows.filter(r => r.value !== null).slice(0, limit).map((r, row) => ({ ...r, value: r.value as number, row })), [model, limit]);
  const missing = model.rows.filter(r => r.value === null);
  const selected = model.rows.find(r => r.key === w.selected);
  const hovered = hoverKey ? model.rows.find(r => r.key === hoverKey) : null;
  const definition = useMemo(() => defineChart({
    theme: tab === 'predictors' ? { ...chartTheme, background: 'transparent' } : chartTheme, margin,
    scales: {
      x: { scale: scaleLinear().domain(model.domain), grid: { strokeOpacity: tab === 'predictors' ? 0 : .4 },
        axis: { label: { text: '', opacity: 1 }, ticks: { values: model.ticks, size: tab === 'predictors' ? 0 : 4, format: (v: number) => model.tickLabels[model.ticks.indexOf(v)] ?? '' },
          line: tab !== 'predictors', tickLabels: { fontSize: 11, opacity: tab === 'predictors' ? 0 : 1 } } },
      y: { scale: scaleLinear().domain([Math.max(plotted.length - .5, .5), -.5]),
        axis: { line: false, ticks: { values: plotted.map(p => p.row), size: 0, format: (v: number) => plotted[v] ? `${rowLabel(plotted[v].name)}${plotted[v].counted === false ? ' *' : ''}` : '' }, tickLabels: { fontSize: 12, opacity: 1, dx: labelled ? -12 : 0 } } },
    },
    marks: [
      ...(tab === 'alphagenome' || tab === 'perturbation' || tab === 'expression-models' ? [ruleX([0], { stroke: 'var(--cs-text-secondary)', strokeWidth: 1.5 }),
        decorative(link(plotted, { id: 'contribution', key: 'key', x1: () => 0, x2: 'value', y1: 'row', y2: 'row', stroke: d => d.tone === 'accent' ? 'var(--cs-accent-clay)' : 'var(--cs-text-secondary)', strokeWidth: 7, strokeOpacity: .55 }))] : []),
      ...(['accent', 'neutral', 'danger', 'good'] as const).map(tone => dot(plotted.filter(p => p.tone === tone), {
        id: `reading-${tone}`, key: 'key', x: 'value', y: 'row', r: 6,
        fill: tone === 'accent' ? 'var(--cs-accent-clay)' : tone === 'danger' ? 'var(--cs-text-danger)' : tone === 'good' ? 'var(--cs-text-success)' : 'var(--cs-text-secondary)',
      })),
      // Only the value dot owns interaction. A bar midpoint or pin ring must not become
      // another keyboard stop or put the focus indicator at a false quantitative position.
      decorative(dot(plotted.filter(p => p.key === w.selected), { id: 'pinned', key: 'key', x: 'value', y: 'row', r: 11, fill: 'none', stroke: 'var(--cs-text-primary)', strokeWidth: 2 })),
      ...(labelled ? [decorative(text(plotted, { id: 'reading-values', key: 'key', x: () => model.domain[1], y: 'row', text: 'valueText',
        dx: 18, dy: tab === 'clinical' ? -8 : 0, anchor: 'start', fontSize: 13, fontWeight: 600, fill: 'var(--cs-text-primary)' }))] : []),
      ...(tab === 'clinical' ? [decorative(text(plotted, { id: 'reading-context', key: 'key', x: () => model.domain[1], y: 'row', text: p => p.contextText ?? '',
        dx: 18, dy: 12, anchor: 'start', fontSize: 11, fill: 'var(--cs-text-secondary)' })),
        decorative(link(plotted.filter(p => p.group === 'rule' && p.row > 0), { id: 'rule-separator', key: 'key', x1: () => model.domain[0], x2: () => model.domain[1],
          y1: p => p.row - .5, y2: p => p.row - .5, stroke: 'var(--cs-border)', strokeDasharray: '3 4' }))] : []),
    ],
    svgAnimation: false, maxFocusDistance: 24,
    focusRing: { fill: 'none', stroke: 'var(--cs-text-primary)', radius: 9, strokeWidth: 2 },
  }), [model, plotted, tab, w.selected, margin, rowLabel]);
  // Activating the pinned reading again clears the pin — the chart offered no way back.
  const toggleSelect = (key: string) => w.select(key === w.selected ? null : key);
  return <div className="evw-comparison" data-tab={tab} data-story={labelled || undefined}><ChartFrame title={title} description={description} summary={model.summary}
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
      <span>Hover or use arrow keys to explore. Click or press Enter to pin a reading; press Enter again to clear it. The inspector retains exact values and provenance.</span></>}>
    {tab === 'alphagenome' && returned > 0 && <div className="evw-figure-scope"><span>{Math.min(returned, limit)} of {returned} returned contributions · largest magnitude first</span>
      {returned > 8 && <button type="button" className="viz-action" aria-expanded={expanded} onClick={() => w.toggleGroup('all-attributions')}>{expanded ? 'Show largest 8' : `Show all ${returned}`}</button>}</div>}
    {plotted.length > 0 && <div className="evw-chart-scroll" role="region" aria-label={`${title} chart`} tabIndex={0}>
      <div className="evw-chart-canvas" data-wide={tab === 'predictors' || tab === 'expression-models' || undefined}
        style={{ ['--evw-plot-left' as string]: `${margin.left}px`, ['--evw-plot-right' as string]: `${margin.right}px`, ['--evw-band-count' as string]: model.ticks.length }}>
        {tab === 'alphagenome' && <div className="evw-axis-guide"><span>← Lowers AVI score</span><span>Raises AVI score →</span></div>}
        {tab === 'predictors' && <div className="evw-band-head" aria-label="Published evidence bands">{model.tickLabels.map(label => <span key={label} data-direction={label.startsWith('BP4') ? 'benign' : label.startsWith('PP3') ? 'pathogenic' : 'neither'}><b>{label.split(' ')[0]}</b>{label.includes(' ') && <small>{label.substring(label.indexOf(' ') + 1)}</small>}</span>)}</div>}
        <div className="evw-plot">
        {tab === 'predictors' && <div className="evw-band-grid" aria-hidden="true">{model.tickLabels.map(label => <span key={label} data-direction={label.startsWith('BP4') ? 'benign' : label.startsWith('PP3') ? 'pathogenic' : 'neither'} />)}</div>}
        <Chart definition={definition} height={labelled ? Math.max(tab === 'clinical' ? 220 : 160, plotted.length * (tab === 'clinical' ? 60 : tab === 'predictors' ? 40 : 32) + margin.top + margin.bottom) : Math.max(260, plotted.length * (tab === 'perturbation' ? 28 : 42) + 90)}
          ariaLabel={`${title}. Arrow keys explore; Enter pins a reading.`} ariaDescription={model.summary}
          onSelect={p => { if (p) toggleSelect(p.datum.key); }}
          onFocusChange={p => setHoverKey(p ? p.datum.key : null)} />
        </div>
      </div>
    </div>}
    <p className="evw-readout" role="status">{(() => {
      const row = hovered ?? selected;
      // The inspector already says what a pin shows; this line says what THIS line does, not the same thing twice.
      if (!row) return 'Hover or focus a mark to read its value here; select it to pin the full record in the inspector.';
      // State, not just value: while this reading is the pin, say so — including when its dot is
      // itself hovered or keyboard-focused.
      return `${row.key === w.selected ? 'Pinned: ' : ''}${row.name} · ${row.valueText}`;
    })()}</p>
    {tab === 'alphagenome' && w.selected && !selected && <p className="evw-caption">The pinned feature is outside this filter. Its details remain in the inspector; choose All features to see it here.</p>}
    {tab === 'alphagenome' && selected?.value != null && !plotted.some(r => r.key === selected.key) && <p className="evw-caption">The pinned feature is outside the largest 8. Choose Show all to see it; its details remain in the inspector.</p>}
    {tab === 'clinical' && <p className="evw-caption">AC counts copies; AN counts assessed alleles, not people. Cohorts can overlap. The engine input is the frequency the ACMG rule read; it is not another cohort.</p>}
    {/* The perturbation model strip pins its model id, which is an inspector row but not a dot on this
        chart; saying "outside this chart" for it fired on the normal path. Only a probability reading
        (`<model>:<amino acid>`) that this chart does not plot is genuinely outside it. */}
    {tab === 'perturbation' && w.selected && !selected && w.selected.includes(':') && <p className="evw-caption">The pinned reading is outside this probability chart. Its details remain in the inspector.</p>}
    {missing.length > 0 && <div className="evw-unplotted"><h3>{model.unplottedHeading}</h3>
      <p>{model.unplottedBody}</p>
      <div className="evw-reading-list">{missing.map(r => <button type="button" key={r.key} aria-pressed={w.selected === r.key} onClick={() => toggleSelect(r.key)}><span>{r.name}</span>{' '}<strong>{r.valueText}</strong></button>)}</div>
    </div>}
    {tab === 'alphagenome' && <p className="evw-caption">{model.summary}</p>}
  </ChartFrame></div>;
}

import { useMemo, useState } from 'react';
import { defineChart, dot, ruleX, link } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { keyedSelection, whenSelected, type KeyedSelectionChange } from '@tanstack/charts/selection';
import { controlledSignal } from '@tanstack/charts/interaction/signal';
import { ChartFrame } from '../charts/ChartFrame';
import { chartTheme } from '../charts/chartTheme';
import { buildEnergeticsComparison, type EnergySort, type EnergyPoint, type EnergeticsChartOptions } from '../../shared/energeticsComparison';
import type { EnergeticsEvidence } from '../../shared/energeticsEvidence';
import type { EnergyEngineId, EnergyUnit } from '../../shared/engineStatus';

export default function EnergeticsComparison({ evidence, unit, selected, onSelect, options, onOptions }: {
  evidence: EnergeticsEvidence; unit: EnergyUnit; selected: EnergyEngineId | null;
  onSelect: (key: EnergyEngineId) => void;
  options: EnergeticsChartOptions; onOptions: (options: EnergeticsChartOptions) => void;
}) {
  const { sort, countedOnly, showMarks } = options;
  const [preview, setPreview] = useState<{ model: object; label: string } | null>(null);
  const model = useMemo(() => buildEnergeticsComparison(evidence, unit, sort, countedOnly), [evidence, unit, sort, countedOnly]);
  const definition = useMemo(() => {
    const selection = keyedSelection({ selected: controlledSignal<EnergyEngineId | null, KeyedSelectionChange<EnergyPoint, EnergyEngineId>>(selected, () => {}), key: (d: EnergyPoint) => d.key });
    return defineChart({
      theme: chartTheme,
      margin: { top: 16, right: 24, bottom: 58, left: 112 },
      scales: {
        x: { scale: scaleLinear().domain(model.domain), grid: { strokeOpacity: 0.8 },
          axis: { label: { text: `ΔΔG (${unit})`, fontSize: 13, fontWeight: 500, opacity: 1 }, ticks: { count: 5 }, tickLabels: { fontSize: 12, opacity: 1 } } },
        y: { scale: scaleLinear().domain([model.readings.length - 0.5, -0.5]),
          axis: { line: false, ticks: { values: model.readings.map((_, i) => i), size: 0, format: (v: number) => model.readings[v]?.name ?? '' }, tickLabels: { fontSize: 12, opacity: 1 } } },
      },
      marks: [
        ruleX([0], { stroke: 'var(--cs-text-secondary)', strokeWidth: 1.5, strokeOpacity: 0.65 }),
        ...(showMarks ? [link(model.points, { id: 'local-marks', key: 'key', x1: 'guide', x2: 'guide', y1: d => d.row - 0.17, y2: d => d.row + 0.17, stroke: 'var(--cs-text-secondary)', strokeDasharray: '3 3', strokeWidth: 2 })] : []),
        dot(model.points.filter(p => p.counted), { id: 'counted', key: 'key', x: 'value', y: 'row', r: 7, fill: 'var(--cs-accent-clay)' }),
        dot(model.points.filter(p => !p.counted), { id: 'excluded', key: 'key', x: 'value', y: 'row', r: 7, fill: 'var(--cs-surface)', stroke: 'var(--cs-text-secondary)', strokeWidth: 2 }),
        whenSelected(dot(model.points, { id: 'selected', key: 'key', x: 'value', y: 'row', r: 12, fill: 'none', stroke: 'var(--cs-text-primary)', strokeWidth: 2 }), selection),
      ],
      selection, svgAnimation: false, maxFocusDistance: 24,
      focusRing: { fill: 'none', stroke: 'var(--cs-text-primary)', radius: 10, strokeWidth: 2 },
    });
  }, [model, selected, showMarks, unit]);
  const pinned = model.points.find(p => p.key === selected);
  return <ChartFrame title="Compare stability estimates"
    description="Each dot is one method's prediction for the queried substitution. Select a dot to inspect its basis."
    summary={model.summary}
    actions={<div className="nrg-chart-controls">
      <label>Order <select value={sort} onChange={e => onOptions({ ...options, sort: e.target.value as EnergySort })}><option value="method">By method</option><option value="value">Highest ΔΔG first</option></select></label>
      <label><input type="checkbox" checked={countedOnly} onChange={e => onOptions({ ...options, countedOnly: e.target.checked })} /> Counted only</label>
      <label><input type="checkbox" checked={showMarks} onChange={e => { onOptions({ ...options, showMarks: e.target.checked }); setPreview(null); }} /> Local guides</label>
    </div>}
    footer={<><span className="nrg-chart-key"><i /> Counted estimate</span><span className="nrg-chart-key"><i data-hollow /> Excluded estimate</span>
      {showMarks && <span>Dashed ticks: each method's local destabilising mark, not a clinical cut-point.</span>}
      <span>Tab to the chart, use arrow keys to explore, then Enter to pin. Exact values are also in Engine records.</span></>}>
    <div className="nrg-axis-guide"><span>← More stable folding</span><span>Less stable folding →</span></div>
    {model.points.length ? <Chart definition={definition} height={Math.max(260, model.readings.length * 48 + 74)}
      ariaLabel="Stability estimates by method" ariaDescription={model.summary}
      onSelect={point => { if (point) onSelect(point.datum.key); }}
      onFocusChange={point => setPreview(point ? { model, label: point.markId === 'local-marks' ? point.datum.guideLabel : point.datum.label } : null)} />
      : <p className="viz-frame__empty">{countedOnly ? 'No counted estimates to plot. Turn off Counted only to inspect excluded estimates and missing methods.' : 'No estimates to plot yet. Methods without a result are listed below.'}</p>}
    <p className="nrg-chart-readout" role="status" aria-label="Estimate readout">{(preview?.model === model ? preview.label : null) ?? pinned?.label ?? 'Hover or focus a dot to read its value. Click or press Enter to keep its details in the inspector.'}</p>
    {model.missing.length > 0 && <div className="nrg-missing-methods"><span>No point plotted</span>{model.missing.map(r => <button type="button" key={r.key} aria-pressed={selected === r.key} onClick={() => onSelect(r.key)}>{r.name}<small>{r.status}</small></button>)}</div>}
    <details className="nrg-chart-help"><summary>How to read this comparison</summary><p>ΔΔG is the predicted change in folding free energy caused by this substitution. Zero means no predicted change; negative values point towards more stable folding and positive values towards less stable folding. Signs are normalised across methods.</p><p>Methods can disagree because their assumptions and training data differ. They are not independent experimental confirmations. Local guides explain the app's method calls; distance from zero is not a probability of disease. An empty row means no estimate, not a value of zero.</p></details>
  </ChartFrame>;
}

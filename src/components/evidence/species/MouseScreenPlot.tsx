import { useMemo, useState } from 'react';
import { buildMouseScreenPlot, SCREEN_CELL_LABEL, type ImpcScreen, type ScreenCell } from '../../../shared/modelOrganisms';
import type { ReviewSystemId } from '../../../shared/phenotypeFrame';

const CELLS: ScreenCell[] = ['significant', 'mixed', 'not-significant', 'not-reported'];
/** What a result means, said once in the readout. None of these is a statement about the variant. */
const READOUT_NOTE: Record<ScreenCell, string> = {
  significant: 'IMPC detected a difference in this system in the knockout mouse. A whole-gene knockout is context only; it says nothing direct about this missense variant.',
  mixed: 'IMPC detected a difference in some categories of this system and none in others. A whole-gene knockout is context only.',
  'not-significant': 'No difference was detected in the procedures run. That is not a normal result: the procedures may not test the relevant trait.',
  'not-reported': 'IMPC reported no result for this system. Missing data is not a normal result.',
};

/** A square per IMPC top-level category: filled = significant difference, outlined = no
 * significant difference, faint = not reported. The text beside it carries the same meaning. */
function Glyphs({ states }: { states: string[] }) {
  return <span className="sm-glyphs" aria-hidden="true">{states.map((s, i) => <i key={i} data-state={s} />)}</span>;
}

/** Interactive plot of the IMPC mouse knockout screen by body system. Choose a row to read its
 * categories; choose a legend item to show only the systems with that result. */
export function MouseScreenPlot({ screen, systems }: { screen: ImpcScreen; systems: ReviewSystemId[] }) {
  const plot = useMemo(() => buildMouseScreenPlot(screen, systems), [screen, systems]);
  const [only, setOnly] = useState<ScreenCell | null>(null);
  const [chosen, setChosen] = useState<ReviewSystemId | null>(null);
  const rows = only ? plot.rows.filter(r => r.cell === only) : plot.rows;
  // Open on the first system with a detected difference, so the readout starts on a finding.
  const selected = rows.find(r => r.id === chosen) ?? rows.find(r => r.cell === 'significant' || r.cell === 'mixed') ?? rows[0];
  return <div className="ctx-card__body sm-screen-plot">
    <div className="sm-screen-legend" role="group" aria-label="Show systems by result">
      {CELLS.map(c => <button key={c} type="button" aria-pressed={only === c} disabled={!plot.counts[c]} onClick={() => setOnly(only === c ? null : c)}>
        <Glyphs states={c === 'mixed' ? ['significant', 'not-significant'] : [c]} />{SCREEN_CELL_LABEL[c]}<span className="ctx-mono">{plot.counts[c]}</span>
      </button>)}
    </div>
    <div className="sm-screen-rows" role="group" aria-label="Mouse screen by body system">
      {rows.map(r => <button key={r.id} type="button" data-system={r.id} data-cell={r.cell} aria-pressed={r.id === selected.id} onClick={() => setChosen(r.id)}>
        <span className="sm-screen-row__name">{r.label}{r.review && <small> Review system</small>}</span>
        <Glyphs states={r.terms.map(t => t.state)} />
        <span className="sm-screen-row__state"> {SCREEN_CELL_LABEL[r.cell]}</span>
      </button>)}
    </div>
    <section className="sm-screen-readout" role="region" aria-label={`${selected.label} in the mouse screen`}>
      <p className="sm-screen-readout__title"><strong>{selected.label}</strong> <span className="ctx-caption">{selected.anatomy}</span></p>
      <ul>{selected.terms.map(t => <li key={t.term}><span>{t.term}</span><span className="ctx-cell" data-cell={t.state}>{SCREEN_CELL_LABEL[t.state]}</span></li>)}</ul>
      <p className="ctx-caption">{READOUT_NOTE[selected.cell]}</p>
    </section>
    {plot.unmapped.length > 0 && <p className="ctx-caption">Also reported, outside the local grouping: {plot.unmapped.join(', ')}.</p>}
  </div>;
}

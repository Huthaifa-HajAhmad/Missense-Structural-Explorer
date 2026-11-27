import React, { useId } from 'react';
import { REVIEW_SYSTEMS, ONSET_LABELS, toggleReviewSystem, type PhenotypeSelection } from '../../../shared/phenotypeFrame';
import type { GeneDiseaseResponse } from '../../../shared/diseaseFrame';
import type { ContextLoad } from '../../../stores/slices/evidenceContextSlice';
import { DiseaseContextPicker } from '../DiseaseContextPicker';

/** What each choice changes on the tab, shown under the field so a reviewer knows why to set it. */
export type ReviewFrameHints = { disease?: string; systems?: string };

/**
 * The reviewer's lens: disease, onset, systems. These are choices, never patient findings.
 * `embedded` drops the card head and the inner disclosure for a parent that already wraps the frame
 * in its own "Review context" disclosure (one heading, one fold). `onset={false}` hides the onset
 * field on a tab where no reading uses it, so the control never looks like it does something.
 */
export function ReviewFrame({ gene, load, selection, onChange, onRetry, embedded = false, onset = true, hints }: {
  gene: string; load?: ContextLoad<GeneDiseaseResponse>; selection: PhenotypeSelection;
  onChange: (selection: PhenotypeSelection) => void; onRetry: () => void;
  embedded?: boolean; onset?: boolean; hints?: ReviewFrameHints;
}) {
  const onsetId = useId();
  const fields = <>
    {onset && <div className="ctx-field xp-frame__onset">
      <label className="ctx-label" htmlFor={onsetId}>Disease onset</label>
      <select id={onsetId} className="ctx-select" value={selection.onset} onChange={e => onChange({ ...selection, onset: e.target.value as PhenotypeSelection['onset'] })}>
        {Object.entries(ONSET_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </div>}
    <div className="ctx-field">
      <span className="ctx-label" id={`${onsetId}-systems`}>Body systems</span>
      <div className="ctx-chips" role="group" aria-labelledby={`${onsetId}-systems`}>{REVIEW_SYSTEMS.map(system =>
        <button key={system.id} type="button" className="ctx-chip" aria-pressed={selection.systems.includes(system.id)} onClick={() => onChange(toggleReviewSystem(selection, system.id))}>{system.label}</button>)}</div>
      {hints?.systems && <p className="ctx-caption">{hints.systems}</p>}
    </div>
  </>;
  const disease = <div className="xp-frame__row">
    <DiseaseContextPicker inline gene={gene} load={load} selection={selection} onChange={onChange} onRetry={onRetry} />
    {hints?.disease && !!load?.data?.frames.length && <p className="ctx-caption">{hints.disease}</p>}
  </div>;
  if (embedded) return <div className="ctx-card__body xp-frame xp-frame--embedded" role="group" aria-label="Review frame" data-testid="review-frame">{disease}{fields}</div>;
  return <section className="ctx-card xp-frame" aria-label="Review frame" data-testid="review-frame">
    <div className="ctx-card__head"><h2>Shared review context</h2><span className="ctx-caption">Your choices, not patient findings</span></div>
    <div className="ctx-card__body">
      {disease}
      <details className="cx-frame-focus" open>
        <summary>Review focus · {selection.systems.length ? selection.systems.map(id => REVIEW_SYSTEMS.find(s => s.id === id)?.label).join(', ') : 'All sampled systems'}{onset ? ` · ${ONSET_LABELS[selection.onset]}` : ''}</summary>
        <div className="xp-frame-fields">{fields}</div>
      </details>
    </div>
  </section>;
}

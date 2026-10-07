import React, { useId } from 'react';
import { REVIEW_SYSTEMS, ONSET_LABELS, toggleReviewSystem, type PhenotypeSelection } from '../../../shared/phenotypeFrame';
import type { GeneDiseaseResponse } from '../../../shared/diseaseFrame';
import type { ContextLoad } from '../../../stores/slices/evidenceContextSlice';
import { DiseaseContextPicker } from '../DiseaseContextPicker';

/** The reviewer's lens in one compact card: disease, onset, systems. These are choices, never patient findings. */
export function ReviewFrame({ gene, load, selection, onChange, onRetry }: {
  gene: string; load?: ContextLoad<GeneDiseaseResponse>; selection: PhenotypeSelection;
  onChange: (selection: PhenotypeSelection) => void; onRetry: () => void;
}) {
  const onsetId = useId();
  return <section className="ctx-card xp-frame" aria-label="Review frame" data-testid="review-frame">
    <div className="ctx-card__head"><h2>Review frame</h2><span className="ctx-caption">Your choices, not patient findings</span></div>
    <div className="ctx-card__body">
      <div className="xp-frame__row">
        <DiseaseContextPicker inline gene={gene} load={load} selection={selection} onChange={onChange} onRetry={onRetry} />
        <div className="ctx-field xp-frame__onset">
          <label className="ctx-label" htmlFor={onsetId}>Disease onset</label>
          <select id={onsetId} className="ctx-select" value={selection.onset} onChange={e => onChange({ ...selection, onset: e.target.value as PhenotypeSelection['onset'] })}>
            {Object.entries(ONSET_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
      </div>
      <div className="ctx-field">
        <span className="ctx-label" id={`${onsetId}-systems`}>Review systems</span>
        <div className="ctx-chips" role="group" aria-labelledby={`${onsetId}-systems`}>{REVIEW_SYSTEMS.map(system =>
          <button key={system.id} type="button" className="ctx-chip" aria-pressed={selection.systems.includes(system.id)} onClick={() => onChange(toggleReviewSystem(selection, system.id))}>{system.label}</button>)}</div>
      </div>
    </div>
  </section>;
}

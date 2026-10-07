import React, { useId } from 'react';
import { groupHpoTerms, systemsFromAccepted, toggleAcceptedTerm, type HpoResponse } from '../../shared/hpoAnnotation';
import { REVIEW_SYSTEMS, toggleReviewSystem, type PhenotypeSelection } from '../../shared/phenotypeFrame';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';

export function HpoAnnotationCard({ load, hasDisease, hasIds, diseaseId, selection, onChange, onRetry }: {
  load?: ContextLoad<HpoResponse>; hasDisease: boolean; hasIds: boolean; diseaseId: string | null;
  selection: PhenotypeSelection; onChange: (value: PhenotypeSelection) => void; onRetry: () => void;
}) {
  const id = useId();
  const data = load?.data ?? null;
  const groups = groupHpoTerms(data);
  const implied = systemsFromAccepted(data, selection.acceptedTerms).filter(s => !selection.systems.includes(s.system));
  const verified = !!data?.disease?.mondoId && data.disease.mondoId === diseaseId;
  return <section className="ctx-card" aria-labelledby={id} data-testid="hpo-card">
    <div className="ctx-card__head"><h2 id={id}>Disease annotations</h2><span className="ctx-caption">HPO · your acceptance</span></div>
    {!hasDisease ? <p className="ctx-card__body ctx-caption">Choose a disease above to see its HPO terms. Terms are suggestions: nothing is added to your review until you accept it.</p>
      : !hasIds ? <p className="ctx-card__body">This disease has no OMIM or Orphanet identifier, which is how HPO is keyed. Nothing can be suggested; choose systems yourself.</p>
      : !load || load.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading HPO annotations.</div>
      : load.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — ${data?.message ?? 'HPO annotations could not be read.'}`}</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : data?.status !== 'ready' ? <p className="ctx-card__body">{data?.message}</p>
      : <>
        <div className="ctx-card__body">
          <p className="ctx-prose">{data.disease!.name} <span className="ctx-mono ctx-caption">{data.disease!.id}</span>: {groups.reduce((n, g) => n + g.terms.length, 0)} annotated terms across {groups.length} categories.
            {verified ? ' Matches your chosen disease by MONDO ID.' : ' Matched through the submitter cross-reference; its MONDO ID is not the same as your chosen disease, so confirm it is the same condition.'}</p>
          <p className="ctx-caption">Accepted terms stay review context. They are not findings in a patient, and they do not change any ACMG criterion.</p>
          {!!implied.length && <div className="ctx-chips" role="group" aria-label="Add systems implied by accepted terms">
            {implied.map(s => { const label = REVIEW_SYSTEMS.find(r => r.id === s.system)!.label;
              return <button key={s.system} type="button" className="ctx-chip" onClick={() => onChange(toggleReviewSystem(selection, s.system))}>Add {label} to review <span className="ctx-caption">({s.terms} accepted)</span></button>; })}
          </div>}
        </div>
        {groups.map(g => <details key={g.category} className="ctx-details ctx-details--table" open={g.terms.some(t => selection.acceptedTerms.includes(t.id))}>
          <summary>{g.category} <span className="ctx-caption">· {g.terms.length}{g.system ? ` · groups with ${REVIEW_SYSTEMS.find(r => r.id === g.system)!.label}` : ''}</span></summary>
          <ul className="ctx-terms">{g.terms.map(t => { const accepted = selection.acceptedTerms.includes(t.id);
            return <li key={t.id}><label><input type="checkbox" checked={accepted} onChange={() => onChange({ ...selection, acceptedTerms: toggleAcceptedTerm(selection.acceptedTerms, t.id) })} />
              <span>{t.name}<span className="ctx-caption ctx-block"><span className="ctx-mono">{t.id}</span>{t.frequency ? ` · ${t.frequency}` : ''}{t.onset ? ` · ${t.onset}` : ''}</span></span></label></li>; })}</ul>
        </details>)}
      </>}
    <p className="ctx-card__foot">HPO annotations describe the disease, not this variant or its carrier. Category grouping is a local convention, not an official HPO-to-anatomy mapping; inheritance and clinical-course terms are left out.</p>
  </section>;
}

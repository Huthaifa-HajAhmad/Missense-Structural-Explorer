import React, { useId } from 'react';
import { selectDisease, type PhenotypeSelection } from '../../shared/phenotypeFrame';
import type { GeneDiseaseResponse } from '../../shared/diseaseFrame';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';

export function DiseaseContextPicker({ gene, load, selection, onChange, onRetry, inline = false }: {
  /** `inline` drops the card chrome so a parent frame can place the field among its own controls. */
  inline?: boolean; gene: string; load?: ContextLoad<GeneDiseaseResponse>; selection: PhenotypeSelection;
  onChange: (selection: PhenotypeSelection) => void; onRetry: () => void;
}) {
  const id = useId();
  const frames = load?.data?.frames ?? [];
  const stale = selection.diseaseKey && !frames.some(f => f.key === selection.diseaseKey);
  const fields = <>
    <label className="ctx-label" htmlFor={id}>{inline ? 'Disease' : `Review ${gene} for`}</label>
    <select id={id} className="ctx-select" value={stale ? '' : selection.diseaseKey ?? ''}
      disabled={!frames.length} onChange={event => onChange(selectDisease(selection, event.target.value || null))}>
      <option value="">{frames.length ? 'Choose a disease and inheritance' : !load || load.status === 'loading' ? 'Loading disease choices…' : 'Disease choices unavailable'}</option>
      {frames.map(frame => <option key={frame.key} value={frame.key}>{frame.label} · {frame.inheritance.label} · {frame.diseaseId}{frame.selectionSource === 'Gene2Phenotype' ? ' · G2P choice; no GenCC assertion' : ''}</option>)}
    </select>
    {frames.length === 1 && selection.diseaseKey !== frames[0].key && <button type="button" className="ctx-button" onClick={() => onChange(selectDisease(selection, frames[0].key))}>Review the only curated disease: {frames[0].label}</button>}
    {!inline && <p className="ctx-caption">Disease choice is shared across both context tabs. Your review systems stay selected when the disease changes.</p>}
    {frames.some(f => f.selectionSource === 'Gene2Phenotype') && <p className="ctx-caption">Additional choices use verified G2P gene and MONDO IDs with the supported local allelic mapping. They do not imply GenCC validity coverage. Other allelic requirements and HPO-only choices remain to add.</p>}
    {!load || load.status === 'loading' ? <p role="status" className="ctx-caption">{ENGINE_STATE_LABELS.running} — reading the installed GenCC snapshot.</p>
      : load.status === 'error' ? <div className="ctx-notice" role="status"><span>{load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — gene–disease assertions could not be read.`}</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : load.data?.status === 'not-installed' ? <div className="ctx-status-row" role="status"><p className="ctx-caption">{ENGINE_STATE_LABELS['not-installed']} — a GenCC snapshot has not been installed.</p><button type="button" className="ctx-button ctx-button--quiet" onClick={onRetry}>Check again</button></div>
      : !frames.length ? <p className="ctx-caption">Not curated by the installed GenCC snapshot for this exact gene symbol. This does not establish absence of a disease relationship.</p> : null}
    {stale && load?.status === 'ready' && <p role="status" className="ctx-caption">The saved disease choice is absent from this snapshot. Choose it again; your review systems have been kept.</p>}
  </>;
  if (inline) return <div className="ctx-field">{fields}</div>;
  return <section className="ctx-card ctx-picker" aria-labelledby={`${id}-heading`}>
    <div className="ctx-card__head"><h2 id={`${id}-heading`}>Disease context</h2></div>
    <div className="ctx-card__body">{fields}</div>
  </section>;
}

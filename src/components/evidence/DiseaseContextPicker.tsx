import React, { useId } from 'react';
import { selectDisease, type PhenotypeSelection } from '../../shared/phenotypeFrame';
import type { GeneDiseaseResponse } from '../../shared/diseaseFrame';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';

/**
 * The disease choice that scopes the tab. With nothing to choose from it is a one-line statement of
 * why, never a disabled, empty select (which read as a broken control when GenCC was not installed).
 *
 * `inline` drops the picker row's chrome so a parent frame can place the field among its own
 * controls (the Expression & models review frame); the Gene–disease tab uses the default row.
 */
export function DiseaseContextPicker({ gene, load, selection, onChange, onRetry, inline = false }: {
  inline?: boolean; gene: string; load?: ContextLoad<GeneDiseaseResponse>; selection: PhenotypeSelection;
  onChange: (selection: PhenotypeSelection) => void; onRetry: () => void;
}) {
  const id = useId();
  const frames = load?.data?.frames ?? [];
  const stale = selection.diseaseKey && !frames.some(f => f.key === selection.diseaseKey);
  const loading = !load || load.status === 'loading';
  const empty = (message: React.ReactNode, retry?: string) => inline
    ? <div className="ctx-field" role="status">
        <p className="ctx-caption">{message}</p>
        {retry && <button type="button" className="ctx-button" onClick={onRetry}>{retry}</button>}
      </div>
    : <section className="gd-picker gd-picker--empty" aria-label="Disease context" role="status">
        <p>{message}</p>{retry && <button type="button" className="ctx-button" onClick={onRetry}>{retry}</button>}
      </section>;
  if (loading) return empty(<>{ENGINE_STATE_LABELS.running} — reading the disease sources for {gene}.</>);
  if (load.status === 'error') return empty(load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — gene–disease assertions could not be read.`, 'Try again');
  if (!frames.length) {
    return load.data?.status === 'not-installed'
      ? empty(<>{ENGINE_STATE_LABELS['not-installed']} — the GenCC snapshot is not installed on this server and could not be fetched. Gene-level evidence below is unaffected.</>, 'Check again')
      : empty('Not curated by the installed GenCC snapshot for this exact gene symbol. This does not establish absence of a disease relationship.');
  }
  const fields = <>
    <label className={inline ? 'ctx-label' : 'gd-picker__label'} htmlFor={id}>{inline ? 'Disease' : `Review ${gene} for`}</label>
    <select id={id} className="ctx-select" value={stale ? '' : selection.diseaseKey ?? ''}
      onChange={event => onChange(selectDisease(selection, event.target.value || null))}>
      <option value="">Choose a disease and inheritance</option>
      {frames.map(frame => <option key={frame.key} value={frame.key}>{frame.label} · {frame.inheritance.label} · {frame.diseaseId}{frame.selectionSource === 'Gene2Phenotype' ? ' · G2P choice; no GenCC assertion' : ''}</option>)}
    </select>
    {frames.length === 1 && selection.diseaseKey !== frames[0].key && <button type="button" className="ctx-button" onClick={() => onChange(selectDisease(selection, frames[0].key))}>Review the only curated disease: {frames[0].label}</button>}
    <p className={inline ? 'ctx-caption' : 'gd-caption gd-picker__note'}>Disease choice is shared across both context tabs. Your review systems stay selected when the disease changes.
      {frames.some(f => f.selectionSource === 'Gene2Phenotype') && ' Additional choices use verified G2P gene and MONDO IDs with the supported local allelic mapping; they do not imply GenCC validity coverage.'}</p>
    {stale && load.status === 'ready' && <p role="status">The saved disease choice is absent from this snapshot. Choose it again; your review systems have been kept.</p>}
  </>;
  if (inline) return <div className="ctx-field">{fields}</div>;
  return <section className="gd-picker" aria-label="Disease context">{fields}</section>;
}

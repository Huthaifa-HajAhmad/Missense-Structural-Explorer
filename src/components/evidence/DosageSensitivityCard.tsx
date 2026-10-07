import React, { useId } from 'react';
import { ExternalLink } from 'lucide-react';
import { buildDosageEvidence, type DosageResponse, type DosageReading } from '../../shared/dosageSensitivity';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';

const SCOPE_NOTE: Record<DosageReading['scope'], string> = {
  'same-disease': 'Curated for the selected disease (exact MONDO ID).',
  'other-disease': 'Curated for a different disease than the one selected.',
  unscoped: 'Disease not matched to the selection: no MONDO ID on one side.',
};
function Reading({ r }: { r: DosageReading }) {
  return <tr>
    <th scope="row">{r.name}<span className="ctx-caption ctx-block">{r.asks}</span></th>
    <td><span className="ev-tier" data-tone={r.tone}>{r.call}</span></td>
    <td>{r.disease ? <>{r.disease}{r.diseaseId && <span className="ctx-caption ctx-block ctx-mono">{r.diseaseId}</span>}<span className="ctx-caption ctx-block">{SCOPE_NOTE[r.scope]}</span></> : <span className="ctx-caption">No disease recorded</span>}
      {r.history && <span className="ctx-caption ctx-block">{r.history}</span>}</td>
  </tr>;
}
export function DosageSensitivityCard({ load, selectedDiseaseId, onRetry }: {
  load?: ContextLoad<DosageResponse>; selectedDiseaseId: string | null; onRetry?: () => void;
}) {
  const id = useId();
  const evidence = buildDosageEvidence(load, selectedDiseaseId);
  return <section className="ctx-card" aria-labelledby={id} data-testid="dosage-card">
    <div className="ctx-card__head"><h2 id={id}>Dosage sensitivity</h2><span className="ctx-caption">ClinGen · whole-gene copy number</span></div>
    {evidence.state === 'ready' ? <>
      <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label="ClinGen dosage sensitivity readings"><table className="ctx-table">
        <thead><tr><th scope="col">Question</th><th scope="col">ClinGen call</th><th scope="col">Curated disease</th></tr></thead>
        <tbody>{evidence.readings.map(r => <Reading key={r.key} r={r} />)}</tbody>
      </table></div>
      <p className="ctx-card__foot">Gene-level copy-number evidence{evidence.evaluatedAt ? `, last evaluated ${evidence.evaluatedAt}` : ''}. It does not show whether this missense change loses function, and casts no ACMG vote. <a className="ctx-link" href={evidence.reportUrl!} target="_blank" rel="noreferrer">ClinGen curation<span className="ctx-sr-only"> (opens in a new tab)</span><ExternalLink size={12} aria-hidden="true" /></a></p>
    </> : <div className="ctx-card__body" role="status">
      {evidence.state === 'loading' || evidence.state === 'not-requested' ? <p>{ENGINE_STATE_LABELS.running} — reading ClinGen dosage curation.</p>
        : evidence.state === 'not-found' ? <p>{evidence.message ?? 'No ClinGen dosage curation for this gene.'}</p>
        : <><p>{load?.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — ${evidence.message ?? 'ClinGen dosage curation could not be read.'}`}</p>
          {onRetry && <button type="button" className="ctx-button" onClick={onRetry}>Try again</button>}</>}
    </div>}
  </section>;
}

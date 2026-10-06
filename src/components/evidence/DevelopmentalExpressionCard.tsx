import React, { useId, useState } from 'react';
import { DGTEX_COHORTS, buildDevelopmentalEvidence, type DevelopmentalExpressionResponse, type DevelopmentalObservation } from '../../shared/developmentalExpression';
import { REVIEW_SYSTEMS, type ReviewSystemId } from '../../shared/phenotypeFrame';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';

function DevelopmentalTable({ observations }: { observations: DevelopmentalObservation[] }) {
  return <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label="Pediatric tissue and age cohort expression"><table className="ctx-table">
    <caption className="ctx-sr-only">dGTEx V1 gene expression. Median of within-donor median TPM; donor and RNA sample counts describe each tissue and age cohort.</caption>
    <thead><tr><th scope="col">Tissue · public age cohort</th><th scope="col" className="ctx-num">Median TPM</th><th scope="col" className="ctx-num">Donors</th><th scope="col" className="ctx-num">RNA samples</th></tr></thead>
    <tbody>{observations.map(o => <tr key={`${o.tissueId}|${o.tissue}|${o.cohortId}`}>
      <th scope="row">{o.tissue}<span className="ctx-caption ctx-block">{o.cohort}</span><span className="ctx-caption ctx-block ctx-mono">{o.tissueId}</span></th>
      <td className="ctx-num ctx-mono">{o.value.toLocaleString(undefined, { maximumSignificantDigits: 4 })}</td>
      <td className="ctx-num"><span className="ctx-mono">{o.donorCount}</span>{o.donorCount === 1 && <span className="ctx-caption ctx-block">Single donor</span>}</td>
      <td className="ctx-num ctx-mono">{o.sampleCount}</td>
    </tr>)}</tbody>
  </table></div>;
}
export function DevelopmentalExpressionCard({ load, systems, onRetry }: {
  load?: ContextLoad<DevelopmentalExpressionResponse>; systems: ReviewSystemId[]; onRetry: () => void;
}) {
  const [cohort, setCohort] = useState('all');
  const id = useId();
  const evidence = buildDevelopmentalEvidence(load?.data ?? null, systems, cohort);
  const overview = !evidence.relevant.length ? [...evidence.other].sort((a, b) => b.value - a.value).slice(0, 6) : [];
  const counts = load?.data?.counts;
  return <section className="ctx-card" aria-labelledby={`${id}-heading`}>
    <div className="ctx-card__head"><h2 id={`${id}-heading`}>Human pediatric expression</h2><span className="ctx-caption">dGTEx V1 · donor medians</span></div>
    {!load || load.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading the installed pediatric snapshot.</div>
      : load.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — pediatric measurements could not be read.`}</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : load.data?.status === 'not-installed' ? <div className="ctx-card__body" role="status"><p>{ENGINE_STATE_LABELS['not-installed']} — a dGTEx V1 snapshot is not installed.</p><button type="button" className="ctx-button" onClick={onRetry}>Check again</button></div>
      : load.data?.status === 'not-found' ? <p className="ctx-card__body">No exact gene symbol in the GENCODE v47 snapshot. This does not establish absence of expression.</p>
      : evidence.ready && <>
        <div className="ctx-card__body">
          <p className="ctx-prose">{counts?.includedSamples} eligible RNA samples from {counts?.includedDonors} donors. The release marks {counts?.excludedSamples} additional samples for exclusion; WGS is not expression evidence.</p>
          <label className="ctx-onset" htmlFor={id}>Sampled age cohort <select id={id} className="ctx-select" value={cohort} onChange={e => setCohort(e.target.value)}>
            <option value="all">All public age cohorts</option>{Object.entries(DGTEX_COHORTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <p className="ctx-caption">Source age groups are kept as published. Exact ages are protected. This filter is independent of disease onset.</p>
          {!!evidence.gaps.length && <p className="ctx-prose">No tissue in the local grouping for {evidence.gaps.map(s => REVIEW_SYSTEMS.find(r => r.id === s)?.label).join(', ')} in this sampled age scope. Missing coverage is not a zero measurement.</p>}
          {!evidence.relevant.length && !evidence.other.length && <p>No eligible tissue samples in this source cohort.</p>}
        </div>
        {!!evidence.relevant.length && <DevelopmentalTable observations={evidence.relevant} />}
        {!!overview.length && <><p className="ctx-card__body ctx-caption">Highest measured tissue/cohort medians in this age scope. Cohorts are independent samples, not a developmental trajectory.</p><DevelopmentalTable observations={overview} /></>}
        {evidence.other.length > overview.length && <details className="ctx-details ctx-details--table"><summary>{systems.length ? 'Other' : 'Browse'} pediatric tissue × age groups ({evidence.other.length})</summary><DevelopmentalTable observations={evidence.other} /></details>}
      </>}
    <p className="ctx-card__foot">Median across donors after taking a within-donor median for repeat samples. Sparse postmortem cohorts are descriptive; a single donor is not a population baseline. Pediatric and adult values are not a developmental trajectory or a matched comparison.</p>
  </section>;
}

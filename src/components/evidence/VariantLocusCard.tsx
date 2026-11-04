import React, { useId } from 'react';
import type { ClinVarData } from '../../shared/contracts';
import type { DiseaseFrame } from '../../shared/diseaseFrame';
import { buildVariantLocusEvidence, type VariantLocusState } from '../../shared/variantLocus';
import { formatClinicalDate } from './population/populationFormat';

const HEADLINE: Record<VariantLocusState, string> = {
  listed: 'ClinVar lists the selected disease for this variant.',
  'other-conditions': 'ClinVar records other conditions for this variant, not the selected disease.',
  'not-provided': 'ClinVar’s submitters named no condition for this variant (recorded as “not provided”).',
  'no-condition-ids': 'ClinVar conditions for this variant carry no usable identifiers, so they cannot be matched to the selected disease.',
  'no-conditions': 'ClinVar records no condition for this variant.',
  'not-listed': 'ClinVar holds no record of this variant, so it lists no condition for it.',
  'no-clinvar': 'No ClinVar record was retrieved for this variant.',
};
/** States whose answer depends on every condition having been read. */
const NEEDS_FULL_RECORD: ReadonlySet<VariantLocusState> = new Set(['other-conditions', 'not-provided', 'no-condition-ids', 'no-conditions']);
const WHAT_THE_RECORD_COUNTS: Record<'true' | 'false' | 'null', string> = {
  true: 'This record counts toward ClinVar’s variant-level aggregate classification.',
  false: 'This record is not part of ClinVar’s variant-level aggregate classification.',
  null: 'ClinVar’s file does not say whether this record counts toward the aggregate classification.',
};

export function VariantLocusCard({ clinvar, frame }: { clinvar: ClinVarData | null | undefined; frame: DiseaseFrame }) {
  const id = useId();
  const e = buildVariantLocusEvidence(clinvar, frame);
  return <section className="ctx-card" aria-labelledby={id} data-testid="variant-locus-card">
    <div className="ctx-card__head"><h2 id={id}>Variant locus</h2><span className="ctx-caption">ClinVar · conditions for this variant</span></div>
    <div className="ctx-card__body" role="status">
      <p className="ctx-label">{HEADLINE[e.state]}</p>
      {e.matchedRecords.length
        ? e.matchedRecords.map(({ label, record }) => <div key={record.accession} data-testid="variant-locus-record">
          <p><strong>{label}</strong></p>
          <p className="ctx-caption">
            ClinVar’s record for this condition: {[record.classification, record.reviewStatus, formatClinicalDate(record.lastEvaluated) && `evaluated ${formatClinicalDate(record.lastEvaluated)}`].filter(Boolean).join(' · ')}
            {' · '}
            <a className="ctx-link" href={`https://www.ncbi.nlm.nih.gov/clinvar/${record.accession}/`} target="_blank" rel="noopener noreferrer">{record.accession}<span className="ctx-sr-only"> (opens in a new tab)</span></a>
          </p>
          <p className="ctx-caption">{WHAT_THE_RECORD_COUNTS[String(record.inAggregate) as 'true' | 'false' | 'null']}</p>
        </div>)
        : !!e.matched.length && <p>Matched by identifier: {e.matched.join('; ')}.</p>}
      {!!e.other.length && <p className="ctx-caption">{e.state === 'listed' ? 'Also recorded' : 'Recorded'}: {e.other.join('; ')}.</p>}
      {!!e.unmatchable.length && <p className="ctx-caption">Cannot be compared (no MONDO, OMIM or Orphanet identifier): {e.unmatchable.join('; ')}.</p>}
      {!e.fullRecord && NEEDS_FULL_RECORD.has(e.state) && <p className="ctx-caption">Only the conditions behind ClinVar’s aggregate classification were read, so a condition on another ClinVar record would not appear here.</p>}
    </div>
    <p className="ctx-card__foot">Identifier match only (MONDO, OMIM, Orphanet); never by name.{e.state !== 'not-listed' && e.classification ? ` The ${e.classification} classification${e.reviewStatus ? ` (${e.reviewStatus})` : ''} is ClinVar’s variant-level aggregate and is not attributed to this disease.` : ''} Context only: no ACMG criterion is added.</p>
  </section>;
}

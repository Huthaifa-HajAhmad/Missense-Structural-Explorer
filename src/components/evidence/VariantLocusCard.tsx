import React, { useId } from 'react';
import type { ClinVarData } from '../../shared/contracts';
import type { DiseaseFrame } from '../../shared/diseaseFrame';
import { buildVariantLocusEvidence, type VariantLocusState } from '../../shared/variantLocus';

const HEADLINE: Record<VariantLocusState, string> = {
  listed: 'ClinVar lists the selected disease for this variant.',
  'other-conditions': 'ClinVar records other conditions for this variant, not the selected disease.',
  'no-condition-ids': 'ClinVar conditions for this variant carry no usable identifiers, so they cannot be matched to the selected disease.',
  'no-conditions': 'ClinVar records no condition for this variant.',
  'no-clinvar': 'No ClinVar record was retrieved for this variant.',
};
export function VariantLocusCard({ clinvar, frame }: { clinvar: ClinVarData | null | undefined; frame: DiseaseFrame }) {
  const id = useId();
  const e = buildVariantLocusEvidence(clinvar, frame);
  return <section className="ctx-card" aria-labelledby={id} data-testid="variant-locus-card">
    <div className="ctx-card__head"><h2 id={id}>Variant locus</h2><span className="ctx-caption">ClinVar · conditions for this variant</span></div>
    <div className="ctx-card__body" role="status">
      <p className="ctx-label">{HEADLINE[e.state]}</p>
      {!!e.matched.length && <p>Matched by identifier: {e.matched.join('; ')}.</p>}
      {!!e.other.length && e.state !== 'no-condition-ids' && <p className="ctx-caption">{e.state === 'listed' ? 'Also recorded' : 'Recorded'}: {e.other.join('; ')}.</p>}
    </div>
    <p className="ctx-card__foot">Identifier match only (MONDO, OMIM, Orphanet); never by name.{e.classification ? ` The ${e.classification} classification${e.reviewStatus ? ` (${e.reviewStatus})` : ''} is ClinVar’s variant-level aggregate and is not attributed to this disease.` : ''} Context only: no ACMG criterion is added.</p>
  </section>;
}

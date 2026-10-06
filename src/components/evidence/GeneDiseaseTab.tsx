import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { TabComponentProps } from './types';
import { useEvidenceContext } from '../../hooks/useEvidenceContext';
import { buildGeneDiseaseEvidence } from '../../shared/diseaseFrame';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import { DiseaseContextPicker } from './DiseaseContextPicker';
import { MechanismContextCard } from './MechanismContextCard';

export function GeneDiseaseTab({ analysisState }: TabComponentProps) {
  if (!analysisState.result) return null;
  return <GeneDiseaseContent result={analysisState.result} />;
}
function GeneDiseaseContent({ result }: { result: NonNullable<TabComponentProps['analysisState']['result']> }) {
  const context = useEvidenceContext(result);
  const evidence = buildGeneDiseaseEvidence(context.diseaseLoad?.data ?? null, context.selection.diseaseKey);
  return <div className="ctx-screen" data-testid="gene-disease-screen">
    <header className="ctx-heading"><div><h1 className="screen-title">Gene–disease</h1><p className="screen-tab-description">Causal relationship, disease mechanism and variant context.</p></div></header>
    {context.identityChanged && <p className="ctx-notice" role="status">The annotation reference changed. Review choices stay with their original transcript, isoform and assembly; select the context for this reference explicitly.</p>}
    <DiseaseContextPicker gene={context.gene} load={context.diseaseLoad} selection={context.selection} onChange={context.setSelection} onRetry={context.retryDisease} />
    {evidence.selected && <>
      <section className="ctx-card"><div className="ctx-card__body">
        <p className="ctx-eyebrow">{evidence.selected.inheritance.label} · <span className="ctx-mono">{evidence.selected.diseaseId}</span></p>
        <h2 className="ctx-finding">{evidence.finding}</h2>
        <p className="ctx-prose">{evidence.selected.label}. Gene–disease validity describes the relationship; it does not classify this variant.</p>
        {!!evidence.adverse.length && <p className="ctx-notice" role="status">At least one submitter disputes or refutes this relationship. Read the assertions below before interpreting other context.</p>}
      </div></section>
      <section className="ctx-card"><div className="ctx-card__head"><h2>Causality assertions</h2><span className="ctx-caption">GenCC · each submitter retained</span></div>
        {!evidence.assertions.length && <p className="ctx-card__body">{evidence.finding} The selected disease identity is supplied by {evidence.selected.selectionSource ?? 'GenCC'}; missing validity coverage does not refute the relationship.</p>}
        {!!evidence.assertions.length && <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label="Gene disease validity assertions"><table className="ctx-table">
          <thead><tr><th scope="col">Submitter</th><th scope="col">Validity</th><th scope="col">Assertion date</th><th scope="col">Source</th></tr></thead>
          <tbody>{evidence.assertions.map(assertion => <tr key={assertion.id}>
            <th scope="row">{assertion.submitter}</th><td>{assertion.level}</td><td className="ctx-mono">{assertion.evaluatedAt?.slice(0, 10) ?? 'Not reported'}</td>
            <td>{assertion.reportUrl ? <a className="ctx-link" href={assertion.reportUrl} target="_blank" rel="noreferrer">Report <ExternalLink size={12} aria-hidden="true" /></a> : 'Not linked'}</td>
          </tr>)}</tbody>
        </table></div>}
        {!!evidence.assertions.length && <p className="ctx-card__foot">Levels are reported as submitted. They are not averaged or ranked into a consensus.</p>}
      </section>
      <MechanismContextCard frame={evidence.selected} context={context.diseaseLoad?.data?.mechanismContext} onRetry={context.retryDisease} />
      <section className="ctx-card"><div className="ctx-card__head"><h2>Remaining evidence axes</h2></div><dl className="ctx-definition">
        <div><dt>Dosage sensitivity</dt><dd>{ENGINE_STATE_LABELS['not-installed']} — ClinGen dosage sensitivity is not integrated yet and cannot substitute for missense mechanism.</dd></div>
        <div><dt>Variant locus</dt><dd>Disease-conditioned ClinVar context is not integrated yet. Functional domains remain available in their own tab.</dd></div>
      </dl></section>
    </>}
  </div>;
}

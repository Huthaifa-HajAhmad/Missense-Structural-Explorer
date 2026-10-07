import React from 'react';
import type { TabComponentProps } from './types';
import { useEvidenceContext } from '../../hooks/useEvidenceContext';
import { REVIEW_SYSTEMS, ONSET_LABELS, toggleReviewSystem, type PhenotypeSelection } from '../../shared/phenotypeFrame';
import { buildAdultExpressionEvidence, type TissueExpression } from '../../shared/expressionModels';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import { DiseaseContextPicker } from './DiseaseContextPicker';
import { DevelopmentalExpressionCard } from './DevelopmentalExpressionCard';
import { ModelOrganismsCard } from './ModelOrganismsCard';
import { HpoAnnotationCard } from './HpoAnnotationCard';
import { buildGeneDiseaseEvidence } from '../../shared/diseaseFrame';
import { PextCard } from './PextCard';
import { ResidueAlignmentCard } from './ResidueAlignmentCard';
import { MeasureBar, maxOf } from './ContextCharts';
import { pextSiteFromVariantId } from '../../shared/pext';
import { isFallbackLocus } from '../../shared/locusResolution';

function TissueTable({ tissues, caption, max }: { tissues: TissueExpression[]; caption: string; max: number }) {
  return <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label={caption}><table className="ctx-table">
    <caption className="ctx-sr-only">{caption}. Median gene expression, adult GTEx v10. Sample counts describe the dataset tissue cohort.</caption>
    <thead><tr><th scope="col">Tissue</th><th scope="col" className="ctx-num">Median TPM</th><th scope="col" className="ctx-num">RNA samples</th></tr></thead>
    <tbody>{tissues.map(t => <tr key={t.id}><th scope="row"><span>{t.label}</span><span className="ctx-caption ctx-block ctx-mono">{t.ontologyId ?? 'Anatomy ID not reported'}</span></th>
      <td className="ctx-num"><span className="ctx-mono">{t.value === null ? 'No gene reading' : t.value.toLocaleString(undefined, { maximumSignificantDigits: 4 })}</span><MeasureBar value={t.value} max={max} label={`${t.label}: ${t.value ?? 'no reading'} TPM`} /></td>
      <td className="ctx-num ctx-mono">{t.sampleCount?.toLocaleString() ?? 'Not reported'}</td></tr>)}</tbody>
  </table></div>;
}
export function ExpressionModelsTab({ analysisState }: TabComponentProps) {
  if (!analysisState.result) return null;
  return <ExpressionModelsContent result={analysisState.result} />;
}
function ExpressionModelsContent({ result }: { result: NonNullable<TabComponentProps['analysisState']['result']> }) {
  const context = useEvidenceContext(result, true);
  const evidence = buildAdultExpressionEvidence(context.expressionLoad?.data ?? null, context.selection.systems);
  const chosen = buildGeneDiseaseEvidence(context.diseaseLoad?.data ?? null, context.selection.diseaseKey).selected;
  const maxTpm = maxOf((context.expressionLoad?.data?.tissues ?? []).map(t => t.value));
  const site = pextSiteFromVariantId(result.predictorData?.gnomadVariantId, result.predictorData?.gnomadVariantAssembly, isFallbackLocus(result));
  const overview = !evidence.relevant.length
    ? [...evidence.other].sort((a, b) => (b.value ?? -1) - (a.value ?? -1)).slice(0, 6) : [];
  return <div className="ctx-screen" data-testid="expression-models-screen">
    <header className="ctx-heading"><div><h1 className="screen-title">Expression &amp; models</h1><p className="screen-tab-description">Where the gene is measured, and which biological context remains uncovered.</p></div>
      </header>
    {context.identityChanged && <p className="ctx-notice" role="status">The annotation reference changed. Review choices stay with their original transcript, isoform and assembly; select the context for this reference explicitly.</p>}
    <DiseaseContextPicker gene={context.gene} load={context.diseaseLoad} selection={context.selection} onChange={context.setSelection} onRetry={context.retryDisease} />
    <section className="ctx-card"><div className="ctx-card__head"><h2>Review systems</h2><span className="ctx-caption">Your selections</span></div><div className="ctx-card__body">
      <p className="ctx-prose">Select the systems you want to review. These are review choices, not recorded patient findings.</p>
      <div className="ctx-chips" role="group" aria-label="Review organ systems">{REVIEW_SYSTEMS.map(system => <button key={system.id} type="button" className="ctx-chip" aria-pressed={context.selection.systems.includes(system.id)} onClick={() => context.setSelection(toggleReviewSystem(context.selection, system.id))}>{system.label}</button>)}</div>
      <label className="ctx-onset">Disease onset <select className="ctx-select" value={context.selection.onset} onChange={e => context.setSelection({ ...context.selection, onset: e.target.value as PhenotypeSelection['onset'] })}>{Object.entries(ONSET_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {['antenatal', 'congenital', 'neonatal', 'infantile', 'childhood', 'juvenile'].includes(context.selection.onset) && <p className="ctx-notice">Disease onset is separate from sampled age. Adult GTEx does not cover the selected onset period; dGTEx public cohorts cannot establish exact-age or prenatal coverage.</p>}
      <details className="ctx-details"><summary>How selections relate to tissue sampling</summary><p className="ctx-caption">Local display grouping. Systems reorder the table; no tissue is removed. This grouping is not an official HPO-to-anatomy mapping.</p><dl className="ctx-definition">{REVIEW_SYSTEMS.filter(s => context.selection.systems.includes(s.id)).map(s => <div key={s.id}><dt>{s.label}</dt><dd>{s.anatomy}</dd></div>)}</dl></details>
    </div></section>
    <HpoAnnotationCard load={context.hpoLoad} hasDisease={!!context.selection.diseaseKey} hasIds={!!context.hpoIds} diseaseId={chosen?.diseaseId ?? null} selection={context.selection} onChange={context.setSelection} onRetry={context.retryHpo} />
    <section className="ctx-card"><div className="ctx-card__head"><h2>Human adult expression</h2><span className="ctx-caption">GTEx v10 · median TPM</span></div>
      {!context.expressionLoad || context.expressionLoad.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading GTEx tissue expression.</div>
        : context.expressionLoad.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{context.expressionLoad.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — tissue measurements could not be read.`}</span><button type="button" className="ctx-button" onClick={context.retryExpression}>Try again</button></div>
        : <>
          {context.expressionLoad.data?.status === 'not-found' && <p className="ctx-card__body">No gene reading in this GTEx response. This is not evidence that the gene is unexpressed.</p>}
          {evidence.ready && <>
            {!!evidence.gaps.length && <div className="ctx-card__body"><p className="ctx-prose"><strong>Relevant anatomy is not sampled by GTEx.</strong></p><ul className="ctx-gap-list">{evidence.gaps.map(id => <li key={id}>{REVIEW_SYSTEMS.find(s => s.id === id)?.label}: {id === 'skeletal' ? 'bone and growth-plate cartilage' : id === 'hearing' ? 'cochlea' : id === 'vision' ? 'retina and ocular structures' : 'no tissue in the local grouping'}.</li>)}</ul></div>}
            {evidence.relevant.length > 0 && <TissueTable tissues={evidence.relevant} caption="Tissues in your review systems" max={maxTpm} />}
            {!!overview.length && <><p className="ctx-card__body ctx-caption">Highest measured tissue medians. Use review systems to bring related tissues forward.</p><TissueTable tissues={overview} caption="Highest adult tissue medians" max={maxTpm} /></>}
            {evidence.other.length > overview.length && <details className="ctx-details ctx-details--table"><summary>{context.selection.systems.length ? `Other sampled tissues (${evidence.other.length})` : `All sampled tissues (${evidence.other.length})`}</summary><TissueTable tissues={evidence.other} caption="Other adult tissues" max={maxTpm} /></details>}
          </>}
        </>}
      <p className="ctx-card__foot">Gene-level bulk RNA, adult donors. Bars are linear, scaled to the highest tissue; the number is the measurement. A zero median is a measured value, not proof of absence. Expression does not classify this variant.</p>
    </section>
    <DevelopmentalExpressionCard load={context.developmentalLoad} systems={context.selection.systems} onRetry={context.retryDevelopment} />
    <PextCard load={context.pextLoad} site={site} systems={context.selection.systems} onRetry={context.retryPext} />
    <ModelOrganismsCard load={context.modelLoad} systems={context.selection.systems} onRetry={context.retryModels} />
    <ResidueAlignmentCard load={context.alignmentLoad} onRetry={context.retryAlignment} residue={{ sequence: result.metadata?.sequence, position: result.metadata?.residueIndex ?? null, wildType: result.metadata?.wildType ?? '', mutant: result.metadata?.mutant ?? '' }} />
    <section className="ctx-card"><div className="ctx-card__head"><h2>Coverage still to add</h2></div><dl className="ctx-definition">
            <div><dt>Mouse &amp; zebrafish</dt><dd>{ENGINE_STATE_LABELS['not-installed']} — orthology and assay-scoped phenotype records.</dd></div>
      <div><dt>Development</dt><dd>Complementary prenatal and organ-specific atlases remain to add; dGTEx V1 public cohorts are shown above when installed.</dd></div>
    </dl></section>
  </div>;
}

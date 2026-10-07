import React from 'react';
import type { TabComponentProps } from './types';
import { useEvidenceContext } from '../../hooks/useEvidenceContext';
import { buildAdultExpressionEvidence, type TissueExpression } from '../../shared/expressionModels';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import { ReviewFrame } from './expression/ReviewFrame';
import { ExpressionHero } from './expression/ExpressionHero';
import { buildExpressionFinding, buildSourceFacts } from '../../shared/expressionTabEvidence';
import { DevelopmentalExpressionCard } from './DevelopmentalExpressionCard';
import { ModelOrganismsCard } from './ModelOrganismsCard';
import { HpoAnnotationCard } from './HpoAnnotationCard';
import { buildGeneDiseaseEvidence } from '../../shared/diseaseFrame';
import { HpaCard } from './HpaCard';
import { ModelPhenotypesCard } from './ModelPhenotypesCard';
import { PextCard } from './PextCard';
import { ResidueAlignmentCard } from './ResidueAlignmentCard';
import { MeasureBar, maxOf } from './ContextCharts';
import { pextSiteFromVariantId, locatePext } from '../../shared/pext';
import { isFallbackLocus } from '../../shared/locusResolution';
import { resolveResidueShiftModel } from '../../lib/residueShiftModel';

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
  const diseaseTerms = new Map((context.hpoLoad?.data?.terms ?? []).map(t => [t.id, t.name] as const));
  const maxTpm = maxOf((context.expressionLoad?.data?.tissues ?? []).map(t => t.value));
  const gtexLabels = new Map((context.expressionLoad?.data?.tissues ?? []).map(t => [t.id.toLowerCase(), t.label] as const));
  const site = pextSiteFromVariantId(result.predictorData?.gnomadVariantId, result.predictorData?.gnomadVariantAssembly, isFallbackLocus(result));
  // The pipeline records metadata.wildType/mutant as three-letter codes ("Ala"); the alignment walk compares one-letter
  // residues. Passing the raw metadata made every real payload read "Reference differs".
  const pair = resolveResidueShiftModel({ wildType: result.metadata?.wildType, mutant: result.metadata?.mutant, variant: result.metadata?.variant });
  const finding = buildExpressionFinding(context.expressionLoad?.data ?? null, context.expressionLoad?.status ?? null, context.selection.systems);
  const pextLocation = locatePext(context.pextLoad?.data ?? null, site);
  const facts = buildSourceFacts({ adult: finding, developmental: context.developmentalLoad, hpa: context.hpaLoad,
    pext: { load: context.pextLoad?.status ?? null, status: context.pextLoad?.data?.status ?? null, locationNote: pextLocation.state === 'no-locus' ? 'No verified GRCh38 position' : pextLocation.state === 'no-region' ? 'Outside the coding regions' : pextLocation.state === 'other-chromosome' ? 'Different chromosome from the gene record' : null,
      region: pextLocation.region ? { mean: pextLocation.region.mean, tissues: pextLocation.region.tissues.length } : null } });
  const overview = !evidence.relevant.length
    ? [...evidence.other].sort((a, b) => (b.value ?? -1) - (a.value ?? -1)).slice(0, 6) : [];
  return <div className="ctx-screen" data-testid="expression-models-screen">
    <header className="ctx-heading"><div><h1 className="screen-title">Expression &amp; models</h1><p className="screen-tab-description">Where the gene is measured, and which biological context remains uncovered.</p></div>
      </header>
    {context.identityChanged && <p className="ctx-notice" role="status">The annotation reference changed. Review choices stay with their original transcript, isoform and assembly; select the context for this reference explicitly.</p>}
    <ReviewFrame gene={context.gene} load={context.diseaseLoad} selection={context.selection} onChange={context.setSelection} onRetry={context.retryDisease} />
    <ExpressionHero finding={finding} facts={facts} onset={context.selection.onset} />
    <HpoAnnotationCard load={context.hpoLoad} hasDisease={!!context.selection.diseaseKey} hasIds={!!context.hpoIds} diseaseId={chosen?.diseaseId ?? null} selection={context.selection} onChange={context.setSelection} onRetry={context.retryHpo} />
    <section className="ctx-card"><div className="ctx-card__head"><h2>Human adult expression</h2><span className="ctx-caption">GTEx v10 · median TPM</span></div>
      {!context.expressionLoad || context.expressionLoad.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading GTEx tissue expression.</div>
        : context.expressionLoad.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{context.expressionLoad.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — tissue measurements could not be read.`}</span><button type="button" className="ctx-button" onClick={context.retryExpression}>Try again</button></div>
        : <>
          {context.expressionLoad.data?.status === 'not-found' && <p className="ctx-card__body">No gene reading in this GTEx response. This is not evidence that the gene is unexpressed.</p>}
          {evidence.ready && <>
            {evidence.relevant.length > 0 && <TissueTable tissues={evidence.relevant} caption="Tissues in your review systems" max={maxTpm} />}
            {!!overview.length && <><p className="ctx-card__body ctx-caption">Highest measured tissue medians. Use review systems to bring related tissues forward.</p><TissueTable tissues={overview} caption="Highest adult tissue medians" max={maxTpm} /></>}
            {evidence.other.length > overview.length && <details className="ctx-details ctx-details--table"><summary>{context.selection.systems.length ? `Other sampled tissues (${evidence.other.length})` : `All sampled tissues (${evidence.other.length})`}</summary><TissueTable tissues={evidence.other} caption="Other adult tissues" max={maxTpm} /></details>}
          </>}
        </>}
      <p className="ctx-card__foot">Gene-level bulk RNA, adult donors. Bars are linear, scaled to the highest tissue; the number is the measurement. A zero median is a measured value, not proof of absence. Expression does not classify this variant.</p>
    </section>
    <DevelopmentalExpressionCard load={context.developmentalLoad} systems={context.selection.systems} onRetry={context.retryDevelopment} />
    <HpaCard load={context.hpaLoad} onRetry={context.retryHpa} />
    <PextCard load={context.pextLoad} site={site} systems={context.selection.systems} tissueLabels={gtexLabels} onRetry={context.retryPext} />
    <ModelOrganismsCard load={context.modelLoad} systems={context.selection.systems} onRetry={context.retryModels} />
    <ModelPhenotypesCard load={context.phenotypesLoad} diseaseTerms={diseaseTerms} diseaseName={chosen?.label ?? null} onRetry={context.retryPhenotypes} />
    <ResidueAlignmentCard load={context.alignmentLoad} onRetry={context.retryAlignment} residue={{ sequence: result.metadata?.sequence, position: result.metadata?.residueIndex ?? null, wildType: pair.wildTypeCode, mutant: pair.mutantCode }} />
    <section className="ctx-card"><div className="ctx-card__head"><h2>Not covered yet</h2></div><dl className="ctx-definition">
      <div><dt>Prenatal</dt><dd>Prenatal and organ-specific atlases (BrainSpan, Cardoso-Moreira, stage-specific Bgee) are not read. dGTEx covers the pediatric public age cohorts only.</dd></div>
      <div><dt>Transcript</dt><dd>Annotation-level pext and isoform expression for the transcript carrying this missense are not read.</dd></div>
      <div><dt>Embryo</dt><dd>Embryo and fetal phenotype resources (such as DECIPHER) are not read.</dd></div>
    </dl></section>
  </div>;
}

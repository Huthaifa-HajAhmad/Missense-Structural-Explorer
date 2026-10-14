import React from 'react';
import type { TabComponentProps } from './types';
import { useContextWorkspace } from '../../hooks/useContextWorkspace';
import { ContextExplorer, ContextGuide, ContextDisclosure } from './ContextExplorer';
import { EvidencePanel, EvidenceViewTabs, useEvidenceWorkspace } from './EvidenceWorkspace';
import { ContextSourceState } from './ContextSourceState';
import { ReviewFrame } from './expression/ReviewFrame';
import { ExpressionHero } from './expression/ExpressionHero';
import { buildExpressionFinding, buildSourceFacts } from '../../shared/expressionTabEvidence';
import { DevelopmentalExpressionCard } from './DevelopmentalExpressionCard';
import { HpoAnnotationCard } from './HpoAnnotationCard';
import { buildGeneDiseaseEvidence } from '../../shared/diseaseFrame';
import { HpaCard } from './HpaCard';
import { PextCard } from './PextCard';
import { pextSiteFromVariantId, locatePext } from '../../shared/pext';
import { isFallbackLocus } from '../../shared/locusResolution';

export function ExpressionModelsTab({ analysisState }: TabComponentProps) {
  if (!analysisState.result) return null;
  return <ExpressionModelsContent result={analysisState.result} />;
}
function ExpressionModelsContent({ result }: { result: NonNullable<TabComponentProps['analysisState']['result']> }) {
  const { context, rows } = useContextWorkspace(result, 'expression-models');
  const workspace = useEvidenceWorkspace('expression-models');
  const chosen = buildGeneDiseaseEvidence(context.diseaseLoad?.data ?? null, context.selection.diseaseKey).selected;
  const gtexLabels = new Map((context.expressionLoad?.data?.tissues ?? []).map(t => [t.id.toLowerCase(), t.label] as const));
  const site = pextSiteFromVariantId(result.predictorData?.gnomadVariantId, result.predictorData?.gnomadVariantAssembly, isFallbackLocus(result));
  const finding = buildExpressionFinding(context.expressionLoad?.data ?? null, context.expressionLoad?.status ?? null, context.selection.systems);
  const pextLocation = locatePext(context.pextLoad?.data ?? null, site);
  const facts = buildSourceFacts({ adult: finding, developmental: context.developmentalLoad, hpa: context.hpaLoad,
    pext: { load: context.pextLoad?.status ?? null, status: context.pextLoad?.data?.status ?? null, locationNote: pextLocation.state === 'no-locus' ? 'No verified GRCh38 position' : pextLocation.state === 'no-region' ? 'Outside the coding regions' : pextLocation.state === 'other-chromosome' ? 'Different chromosome from the gene record' : null,
      region: pextLocation.region ? { mean: pextLocation.region.mean, tissues: pextLocation.region.tissues.length } : null } });
  const reviewFrame = <ReviewFrame compact={workspace.enabled} gene={context.gene} load={context.diseaseLoad} selection={context.selection} onChange={context.setSelection} onRetry={context.retryDisease} />;
  return <div className="ctx-screen cx-screen xp-workspace" data-testid="expression-models-screen" data-comparison={workspace.comparison || undefined}>
    <header className="ctx-heading"><div><h1 className="screen-title">Expression</h1><p className="screen-tab-description">Where the gene is measured, and which biological context remains uncovered.</p></div>
      </header>
    {context.identityChanged && <p className="ctx-notice" role="status">The annotation reference changed. Review choices stay with their original transcript, isoform and assembly; select the context for this reference explicitly.</p>}
    <EvidenceViewTabs tab="expression-models" comparisonLabel="Tissue explorer" />
    {workspace.enabled ? <details className="xp-review-settings"><summary>Review context · {chosen ? `${chosen.label} · ${chosen.inheritance.label}` : 'No disease selected'}<span>Your choices, not patient findings</span></summary>{reviewFrame}</details> : reviewFrame}
    <ExpressionHero compact={workspace.enabled} finding={finding} facts={facts} onset={context.selection.onset} />
    <EvidencePanel tab="expression-models">
      <ContextExplorer tab="expression-models" rows={rows} groups={[{ id: 'adult', label: 'Adult RNA' }, { id: 'developmental', label: 'Pediatric RNA' }]}
        empty={<ContextSourceState name={workspace.section === 'developmental' ? 'dGTEx' : 'GTEx'} load={workspace.section === 'developmental' ? context.developmentalLoad : context.expressionLoad} onRetry={workspace.section === 'developmental' ? context.retryDevelopment : context.retryExpression} />} />
    </EvidencePanel>
    <ContextDisclosure tab="expression-models" id="phenotype" title="Disease phenotype annotations and review suggestions">
    <HpoAnnotationCard load={context.hpoLoad} hasDisease={!!context.selection.diseaseKey} hasIds={!!context.hpoIds} diseaseId={chosen?.diseaseId ?? null} selection={context.selection} onChange={context.setSelection} onRetry={context.retryHpo} />
    </ContextDisclosure>
    <ContextGuide><p>TPM measures RNA abundance, not pathogenicity. Adult and pediatric RNA use separate views and scales. Review systems bring related tissues forward; they do not establish that an organ was adequately sampled.</p><p>Protein Atlas measurements use a different assay. Pext describes the proportion of expression associated with a genomic region, not expression of your selected transcript.</p></ContextGuide>
    <ContextDisclosure tab="expression-models" id="development" title="Pediatric sampling and source records">
    <DevelopmentalExpressionCard load={context.developmentalLoad} systems={context.selection.systems} onRetry={context.retryDevelopment} />
    </ContextDisclosure>
    <ContextDisclosure tab="expression-models" id="protein" title="Protein measurements">
    <HpaCard load={context.hpaLoad} onRetry={context.retryHpa} />
    </ContextDisclosure>
    <ContextDisclosure tab="expression-models" id="pext" title="Expression at the variant (pext)">
    <PextCard load={context.pextLoad} site={site} systems={context.selection.systems} tissueLabels={gtexLabels} onRetry={context.retryPext} />
    </ContextDisclosure>
    <section className="ctx-card"><div className="ctx-card__head"><h2>Not covered yet</h2></div><dl className="ctx-definition">
      <div><dt>Prenatal</dt><dd>Prenatal and organ-specific atlases (BrainSpan, Cardoso-Moreira, stage-specific Bgee) are not read. dGTEx covers the pediatric public age cohorts only.</dd></div>
      <div><dt>Transcript</dt><dd>Annotation-level pext and isoform expression for the transcript carrying this missense are not read.</dd></div>
      <div><dt>Embryo</dt><dd>Embryo and fetal phenotype resources (such as DECIPHER) are not read.</dd></div>
    </dl></section>
  </div>;
}

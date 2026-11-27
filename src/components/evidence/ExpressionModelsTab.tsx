import { useRef } from 'react';
import type { TabComponentProps } from './types';
import { useContextWorkspace } from '../../hooks/useContextWorkspace';
import { ContextExplorer } from './ContextExplorer';
import { EvidencePanel, EvidenceTopic, EvidenceViewTabs, useEvidenceWorkspace } from './EvidenceWorkspace';
import { ContextSourceState } from './ContextSourceState';
import { ReviewFrame } from './expression/ReviewFrame';
import { ReviewContextBar } from './expression/ReviewContextBar';
import { ExpressionAnswer } from './expression/ExpressionAnswer';
import { buildExpressionFinding, buildSourceFacts } from '../../shared/expressionTabEvidence';
import { DevelopmentalExpressionCard } from './DevelopmentalExpressionCard';
import { HpoAnnotationCard } from './HpoAnnotationCard';
import { buildGeneDiseaseEvidence } from '../../shared/diseaseFrame';
import { HpaCard } from './HpaCard';
import { PextCard } from './PextCard';
import { pextSiteFromVariantId, locatePext, pextTissueKey } from '../../shared/pext';
import { isFallbackLocus } from '../../shared/locusResolution';
import { expressionWorkspaceFinding } from '../../shared/expressionWorkspaceFinding';
import { evidenceTab } from '../../shared/evidenceTabs';
import { pextMark, proteinAtlasMark } from '../../shared/viewMarks';

/** What each review choice changes on this tab, shown under the field. */
const REVIEW_HINTS = {
  disease: 'Lists the disease’s HPO terms under Sampling & coverage.',
  systems: 'Brings these systems’ tissues forward in the chart, the tables and the pext tissue list.',
};

export function ExpressionModelsTab({ analysisState }: TabComponentProps) {
  if (!analysisState.result) return null;
  return <ExpressionModelsContent result={analysisState.result} />;
}
function ExpressionModelsContent({ result }: { result: NonNullable<TabComponentProps['analysisState']['result']> }) {
  const { context, rows } = useContextWorkspace(result, 'expression-models');
  const workspace = useEvidenceWorkspace('expression-models');
  const reviewRef = useRef<HTMLDetailsElement>(null);
  const chooseSystems = () => {
    if (!reviewRef.current) return;
    reviewRef.current.open = true;
    const target = reviewRef.current.querySelector<HTMLButtonElement>('.ctx-chips button');
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest' });
  };
  const systems = context.selection.systems;
  const chosen = buildGeneDiseaseEvidence(context.diseaseLoad?.data ?? null, context.selection.diseaseKey).selected;
  const gtexLabels = new Map((context.expressionLoad?.data?.tissues ?? []).map(t => [pextTissueKey(t.id), t.label] as const));
  const site = pextSiteFromVariantId(result.predictorData?.gnomadVariantId, result.predictorData?.gnomadVariantAssembly, isFallbackLocus(result));
  const finding = buildExpressionFinding(context.expressionLoad?.data ?? null, context.expressionLoad?.status ?? null, systems);
  // The same reading the rail's "Reading" step renders, so tab and rail never say different things.
  const answer = expressionWorkspaceFinding({ section: workspace.section, adult: context.expressionLoad, developmental: context.developmentalLoad, systems, cohort: workspace.cohort, adultFinding: finding });
  const pextLocation = locatePext(context.pextLoad?.data ?? null, site);
  const facts = buildSourceFacts({ adult: finding, developmental: context.developmentalLoad, hpa: context.hpaLoad,
    pext: { load: context.pextLoad?.status ?? null, status: context.pextLoad?.data?.status ?? null, location: pextLocation, regionCount: context.pextLoad?.data?.regions.length ?? 0 } });
  const transcript = result.transcriptId?.trim() || result.predictorData?.transcriptId?.trim() || null;
  const pediatric = workspace.section === 'developmental';
  const reviewFrame = <ReviewFrame gene={context.gene} load={context.diseaseLoad} selection={context.selection} onChange={context.setSelection} onRetry={context.retryDisease} embedded={workspace.enabled} hints={REVIEW_HINTS} />;
  return <div data-evidence-screen className="ctx-screen cx-screen xp-workspace" data-testid="expression-models-screen" data-comparison={workspace.comparison || undefined}>
    <header className="ctx-heading"><div><h1 className="screen-title">{evidenceTab('expression-models').label}</h1><p className="screen-tab-description">Where the gene is measured, and which biological context remains uncovered.</p></div></header>
    {context.identityChanged && <p className="ctx-notice" role="status">The annotation reference changed. Review choices stay with their original transcript, isoform and assembly; select the context for this reference explicitly.</p>}
    <EvidenceViewTabs tab="expression-models" comparisonLabel="Tissue explorer" marks={{ protein: proteinAtlasMark(context.hpaLoad?.data), pext: pextMark(pextLocation.region) }} />
    {workspace.enabled ? <ReviewContextBar ref={reviewRef} disease={chosen?.label ?? 'No disease selected'} systemCount={systems.length}
      action={workspace.view === 'pext' ? <button type="button" className="viz-action" onClick={chooseSystems}>Change review systems</button> : undefined}>{reviewFrame}</ReviewContextBar> : reviewFrame}
    <EvidencePanel tab="expression-models">
      {(!workspace.enabled || workspace.comparison) && <ExpressionAnswer answer={answer} coverage={pediatric ? [] : finding.coverage} facts={facts} onset={context.selection.onset} />}
      {(!workspace.enabled || workspace.comparison || workspace.view === 'records') && <ContextExplorer tab="expression-models" rows={rows} hasReviewSystems={systems.length > 0} onChooseSystems={workspace.enabled ? chooseSystems : undefined} groups={[{ id: 'adult', label: 'Adult RNA' }, { id: 'developmental', label: 'Pediatric RNA' }]}
        empty={<ContextSourceState name={pediatric ? 'dGTEx' : 'GTEx'} load={pediatric ? context.developmentalLoad : context.expressionLoad} onRetry={pediatric ? context.retryDevelopment : context.retryExpression} />} />}
      <EvidenceTopic tab="expression-models" view="records">
        <HpoAnnotationCard load={context.hpoLoad} hasDisease={!!context.selection.diseaseKey} hasIds={!!context.hpoIds} diseaseId={chosen?.diseaseId ?? null} selection={context.selection} onChange={context.setSelection} onRetry={context.retryHpo} />
        <DevelopmentalExpressionCard coverageOnly={workspace.enabled} cohortScope={workspace.cohort} load={context.developmentalLoad} systems={systems} onRetry={context.retryDevelopment} />
        <section className="ctx-card"><div className="ctx-card__head"><h2>Not covered yet</h2></div><dl className="ctx-definition">
          <div><dt>Prenatal</dt><dd>Prenatal and organ-specific atlases (BrainSpan, Cardoso-Moreira, stage-specific Bgee) are not read. dGTEx covers the pediatric public age cohorts only.</dd></div>
          <div><dt>Transcript</dt><dd>Annotation-level pext and isoform expression for the transcript carrying this missense are not read.</dd></div>
          <div><dt>Embryo</dt><dd>Embryo and fetal phenotype resources (such as DECIPHER) are not read.</dd></div>
        </dl></section>
      </EvidenceTopic>
      <EvidenceTopic tab="expression-models" view="protein"><HpaCard load={context.hpaLoad} onRetry={context.retryHpa} /></EvidenceTopic>
      <EvidenceTopic tab="expression-models" view="pext"><PextCard transcript={transcript} load={context.pextLoad} site={site} systems={systems} tissueLabels={gtexLabels} onRetry={context.retryPext} /></EvidenceTopic>
      {/* A plain note, not a fold: these sentences are what stop a reader over-reading TPM or pext. */}
      <section className="xp-guide" aria-labelledby="xp-guide-title"><h2 id="xp-guide-title">How to read this evidence</h2>
        <p>TPM measures RNA abundance, not pathogenicity. Adult and pediatric RNA use separate views and scales. Body systems bring related tissues forward; they do not establish that an organ was adequately sampled.</p>
        <p>Protein Atlas measurements use a different assay. Pext is the share of the gene’s expression that comes from transcripts including a coding base, not the expression of your selected transcript.</p>
      </section>
    </EvidencePanel>
  </div>;
}

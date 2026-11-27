import type { TabComponentProps } from './types';
import { useContextWorkspace } from '../../hooks/useContextWorkspace';
import { ReviewFrame } from './expression/ReviewFrame';
import { EvidenceViewTabs, EvidencePanel, EvidenceTopic, useEvidenceWorkspace } from './EvidenceWorkspace';
import { ContextGuide } from './ContextExplorer';
import { ModelOrganismsCard } from './ModelOrganismsCard';
import { ModelPhenotypesCard } from './ModelPhenotypesCard';
import { ResidueAlignmentCard } from './ResidueAlignmentCard';
import { SpeciesCoverage } from './ContextFigures';
import { evidenceTab } from '../../shared/evidenceTabs';
import type { SpeciesFinding } from '../../shared/speciesFinding';

const REVIEW_HINTS = {
  disease: 'Marks curated model phenotypes that match the disease’s HPO terms.',
  systems: 'Lists these systems first in the IMPC mouse screen under Orthology & screens.',
};

/** The tab's answer: the variant-site headline, then one line per source. Context only. */
function SpeciesAnswer({ answer }: { answer: SpeciesFinding }) {
  return <section className="sm-finding" role="status" aria-label="Species and models summary" data-testid="species-finding">
    <p className="sm-finding__headline">{answer.headline}</p>
    {answer.facts.length > 0 && <dl className="sm-finding__facts">{answer.facts.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.text}</dd></div>)}</dl>}
    {answer.state === 'failed' && <p className="ctx-caption">Retry the sources below.</p>}
  </section>;
}

export function SpeciesModelsTab({ analysisState }: TabComponentProps) {
  return analysisState.result ? <SpeciesContent result={analysisState.result} /> : null;
}
function SpeciesContent({ result }: { result: NonNullable<TabComponentProps['analysisState']['result']> }) {
  const { context: c, model, rows, pair, speciesAnswer: answer } = useContextWorkspace(result, 'species-models');
  const w = useEvidenceWorkspace('species-models');
  const phenotypes = c.phenotypesLoad?.data;
  const incomplete = phenotypes?.species.filter(s => s.status === 'error') ?? [];
  const omitted = phenotypes?.species.reduce((n, s) => n + (s.status === 'ready' ? Math.max(0, s.total - s.phenotypes.length) : 0), 0) ?? 0;
  // The alignment view uses no review choice (it shows the residue in every ortholog), so the review
  // context is left off there rather than offering controls that change nothing on screen.
  const showReview = !w.enabled || w.view !== 'alignment';
  const reviewFrame = <ReviewFrame gene={c.gene} load={c.diseaseLoad} selection={c.selection} onChange={c.setSelection} onRetry={c.retryDisease}
    embedded={w.enabled} onset={false} hints={REVIEW_HINTS} />;
  const systems = c.selection.systems.length;
  return <div data-evidence-screen className="ctx-screen cx-screen sm-workspace" data-testid="species-models-screen" data-comparison={w.comparison || undefined}>
    <header><h1 className="screen-title">{evidenceTab('species-models').label}</h1><p className="screen-tab-description">Explore orthologs, the aligned variant site, and curated animal phenotypes.</p></header>
    <EvidenceViewTabs tab="species-models" comparisonLabel="Species explorer" />
    {c.identityChanged && <p className="ctx-notice" role="status">The annotation reference changed. Review choices remain with their original transcript, isoform and assembly.</p>}
    {showReview && (w.enabled ? <details className="sm-review"><summary><strong>Review context</strong><span className="sm-review-disease">{model.selected?.label ?? 'No disease selected'}</span><span>{systems ? `${systems} ${systems === 1 ? 'system' : 'systems'}` : 'All systems'}</span><span className="sm-review-note">Your choices, not patient findings</span></summary>{reviewFrame}</details> : reviewFrame)}
    {(!w.enabled || w.comparison) && answer && <SpeciesAnswer answer={answer} />}
    {(!w.enabled || w.comparison || w.view === 'phenotypes') && <>
    {phenotypes?.mapping === 'unavailable' && <p className="cx-notice">Cross-species term mapping is unavailable. Curated phenotype records remain available without disease-overlap claims.</p>}
    {incomplete.length > 0 && <p className="cx-notice">Phenotypes could not be read completely for {[...new Set(incomplete.map(s => s.symbol))].join(', ')}. <button type="button" className="viz-action" onClick={() => void c.retryPhenotypes()}>Retry phenotypes</button></p>}
    {omitted > 0 && w.enabled && !w.comparison && w.view === 'phenotypes' && <p className="cx-notice">{omitted} returned phenotype {omitted === 1 ? 'summary' : 'summaries'} could not be resolved into term records. The counts on this view are of resolved records only, so they are partial.</p>}
    </>}
    {/* The overview holds the coverage chart only. Each source's records live in its own view, which
        has its own search, filter and pins, so no record list is repeated here. */}
    <EvidencePanel tab="species-models">{w.comparison && <SpeciesCoverage rows={rows} />}

    <EvidenceTopic tab="species-models" view="records"><ModelOrganismsCard load={c.modelLoad} systems={c.selection.systems} onRetry={c.retryModels} /></EvidenceTopic>
    <EvidenceTopic tab="species-models" view="phenotypes"><ModelPhenotypesCard load={c.phenotypesLoad} diseaseTerms={new Map((c.hpoLoad?.data?.terms ?? []).map(t => [t.id, t.name]))} diseaseName={model.selected?.label ?? null} diseaseKey={c.selection.diseaseKey} onRetry={c.retryPhenotypes} /></EvidenceTopic>
    <EvidenceTopic tab="species-models" view="alignment"><ResidueAlignmentCard load={c.alignmentLoad} onRetry={c.retryAlignment} residue={{ sequence: result.metadata?.sequence, position: result.metadata?.residueIndex ?? null, wildType: pair.wildTypeCode, mutant: pair.mutantCode }} /></EvidenceTopic>
    {(!w.enabled || w.comparison) && <>
    {!model.selected && !!c.diseaseLoad?.data?.frames.length && <p className="cx-caption">Choose a disease to explore overlap with its annotated HPO terms. These are disease annotations, not patient findings.</p>}
    <ContextGuide><p>An ortholog is a gene related through speciation. A species may have several; the view retains every returned ortholog and distinguishes Alliance gene records from Ensembl alignments.</p><p>The Protein alignments view walks gapped protein alignments and verifies the human sequence first. A gap or reference mismatch stays explicit. Whole-protein identity is different from conservation at this site.</p><p>Animal phenotype summaries have limited experimental detail. No significant difference is not proof of a normal organism, and no annotation is not a negative experiment.</p></ContextGuide>
    </>}
    </EvidencePanel>
  </div>;
}

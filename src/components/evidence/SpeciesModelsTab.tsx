import type { TabComponentProps } from './types';
import { useContextWorkspace } from '../../hooks/useContextWorkspace';
import { ReviewFrame } from './expression/ReviewFrame';
import { EvidenceViewTabs, EvidencePanel, EvidenceTopic, useEvidenceWorkspace } from './EvidenceWorkspace';
import { ContextExplorer, ContextGuide } from './ContextExplorer';
import { ContextSourceState } from './ContextSourceState';
import { ModelOrganismsCard } from './ModelOrganismsCard';
import { ModelPhenotypesCard } from './ModelPhenotypesCard';
import { ResidueAlignmentCard } from './ResidueAlignmentCard';
import { SpeciesCoverage } from './ContextFigures';

export function SpeciesModelsTab({ analysisState }: TabComponentProps) {
  return analysisState.result ? <SpeciesContent result={analysisState.result} /> : null;
}
function SpeciesContent({ result }: { result: NonNullable<TabComponentProps['analysisState']['result']> }) {
  const { context: c, model, rows, pair } = useContextWorkspace(result, 'species-models');
  const w = useEvidenceWorkspace('species-models');
  const source = w.section === 'alignment' ? { name: 'Ensembl alignment', load: c.alignmentLoad, onRetry: c.retryAlignment }
    : w.section === 'phenotypes' ? { name: 'Model phenotypes', load: c.phenotypesLoad, onRetry: c.retryPhenotypes }
    : { name: 'Alliance orthologs', load: c.modelLoad, onRetry: c.retryModels };
  const speciesCount = new Set(rows.map(r => r.taxon)).size;
  const phenotypes = c.phenotypesLoad?.data;
  const incomplete = phenotypes?.species.filter(s => s.status === 'error') ?? [];
  const omitted = phenotypes?.species.reduce((n, s) => n + (s.status === 'ready' ? Math.max(0, s.total - s.phenotypes.length) : 0), 0) ?? 0;
  return <div data-evidence-screen className="ctx-screen cx-screen sm-workspace" data-testid="species-models-screen" data-comparison={w.comparison || undefined}>
    <header><h1 className="screen-title">Species &amp; models</h1><p className="screen-tab-description">Explore orthologs, the aligned variant site, and curated animal phenotypes.</p></header>
    <EvidenceViewTabs tab="species-models" comparisonLabel="Species explorer" />
    {c.identityChanged && <p className="ctx-notice" role="status">The annotation reference changed. Review choices remain with their original transcript, isoform and assembly.</p>}
    <details className="sm-review" open={!w.enabled || undefined}><summary>Review context · {model.selected ? `${model.selected.label} · ${model.selected.inheritance.label}` : 'No disease selected'}</summary><ReviewFrame compact={w.enabled} gene={c.gene} load={c.diseaseLoad} selection={c.selection} onChange={c.setSelection} onRetry={c.retryDisease} /></details>
    <p className="sm-finding"><strong>{speciesCount} species with returned records.</strong> {rows.filter(r => r.group === 'orthologs').length} Alliance orthologs and {rows.filter(r => r.group === 'alignment').length} Ensembl alignments retain their own identifiers.</p>
    <p>These sources describe different aspects of a model. A matching residue or phenotype does not show that a human variant is tolerated or disease-causing.</p>
    {phenotypes?.mapping === 'unavailable' && <p className="cx-notice">Cross-species term mapping is unavailable. Curated phenotype records remain available without disease-overlap claims.</p>}
    {incomplete.length > 0 && <p className="cx-notice">Phenotypes could not be read completely for {incomplete.map(s => s.symbol).join(', ')}. <button type="button" className="viz-action" onClick={c.retryPhenotypes}>Retry phenotypes</button></p>}
    {omitted > 0 && <p className="cx-notice">{omitted} returned phenotype summaries could not be resolved into the displayed term records. Coverage is partial; displayed counts are not the full annotation set.</p>}
    <EvidencePanel tab="species-models">{w.comparison && <SpeciesCoverage rows={rows} />}{(!w.enabled || w.comparison) && <ContextExplorer tab="species-models" rows={rows}
      groups={[{ id: 'orthologs', label: 'Orthologs' }, { id: 'alignment', label: 'Variant site' }, { id: 'phenotypes', label: 'Phenotypes' }]}
      empty={<ContextSourceState {...source} />} relevantLabel="Selected disease term overlap only" />}

    {!model.selected && <p className="cx-caption">Choose a disease to explore overlap with its annotated HPO terms. These are disease annotations, not patient findings.</p>}
    <ContextGuide><p>An ortholog is a gene related through speciation. A species may have several; the view retains every returned ortholog and distinguishes Alliance gene records from Ensembl alignments.</p><p>The variant-site view walks gapped protein alignments and verifies the human sequence first. A gap or reference mismatch stays explicit. Whole-protein identity is different from conservation at this site.</p><p>Animal phenotype summaries have limited experimental detail. No significant difference is not proof of a normal organism, and no annotation is not a negative experiment.</p></ContextGuide>
    <EvidenceTopic tab="species-models" view="records"><ModelOrganismsCard load={c.modelLoad} systems={c.selection.systems} onRetry={c.retryModels} /></EvidenceTopic>
    <EvidenceTopic tab="species-models" view="phenotypes"><ModelPhenotypesCard load={c.phenotypesLoad} diseaseTerms={new Map((c.hpoLoad?.data?.terms ?? []).map(t => [t.id, t.name]))} diseaseName={model.selected?.label ?? null} onRetry={c.retryPhenotypes} /></EvidenceTopic>
    <EvidenceTopic tab="species-models" view="alignment"><ResidueAlignmentCard load={c.alignmentLoad} onRetry={c.retryAlignment} residue={{ sequence: result.metadata?.sequence, position: result.metadata?.residueIndex ?? null, wildType: pair.wildTypeCode, mutant: pair.mutantCode }} /></EvidenceTopic>
    </EvidencePanel>
  </div>;
}

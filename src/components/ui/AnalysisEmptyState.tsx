import React from 'react';
import { Activity, ArrowRight, BarChart2, BookOpen, FileText, FlaskConical, Layers, Map, type LucideIcon } from 'lucide-react';
import type { MasterView } from '../MasterSidebar';
import '../../styles/analysis-empty-state.css';

type EmptyWorkspace = { title: string; description: string; Icon: LucideIcon; topics: [string, string, string] };
const EVIDENCE: Record<string, Omit<EmptyWorkspace, 'Icon'>> = {
  clinical: { title: 'Population data', description: 'See how often a variant appears in population cohorts and review its clinical assertions.', topics: ['Population frequencies', 'ClinVar assertions', 'Evidence sources'] },
  'gene-disease': { title: 'Gene–disease', description: 'Explore curated links between the gene and disease, including inheritance and mechanism.', topics: ['Gene–disease validity', 'Inheritance and mechanism', 'Submitted assertions'] },
  'expression-models': { title: 'Expression', description: 'Explore where the gene is expressed across tissues, ages and available protein measurements.', topics: ['Tissue expression', 'Sampling and coverage', 'Protein measurements'] },
  'species-models': { title: 'Species & models', description: 'Put the variant in context with orthologs, aligned residues and experimental models.', topics: ['Orthologs and screens', 'Protein alignments', 'Model phenotypes'] },
  function: { title: 'Functional domains', description: 'Locate the variant within the protein’s annotated domains and functional regions.', topics: ['Protein annotations', 'Variant-site context', 'Functional evidence'] },
  predictors: { title: 'In-silico predictors', description: 'Compare computational predictions and the evidence-strength bands they reach.', topics: ['Predictor comparison', 'Native score scales', 'Evidence-strength bands'] },
  alphagenome: { title: 'AlphaGenome', description: 'Explore predicted regulatory effects when a supported genomic variant is available.', topics: ['Variant impact score', 'Feature contributions', 'Genomic context'] },
  splicing: { title: 'RNA splicing', description: 'Examine predicted splice changes in their transcript and junction context.', topics: ['Splice-site predictions', 'Transcript geometry', 'Splicing evidence'] },
  structure: { title: 'Residue shifts & pockets', description: 'Compare side-chain properties and locate the variant relative to predicted pockets.', topics: ['Residue properties', 'Structural context', 'Nearby pockets'] },
  perturbation: { title: 'Structural perturbation', description: 'Compare sequence-model readings with available changes in local packing and geometry.', topics: ['Sequence-model scores', 'Packing and geometry', 'Model availability'] },
  interfaces: { title: 'Interfaces & PPI', description: 'Explore protein interfaces, interacting partners and the variant’s available assembly context.', topics: ['Protein partners', 'Interface context', 'Assembly evidence'] },
};
const WORKSPACES: Partial<Record<MasterView, EmptyWorkspace>> = {
  energetics: { title: 'Energetics', description: 'Compare predicted changes in folding stability and inspect the methods behind each estimate.', Icon: Activity, topics: ['Stability estimates', 'Agreement between methods', 'Engine records'] },
  landscape: { title: 'Residue landscape', description: 'Explore predictors, conservation and population evidence along the protein sequence.', Icon: Map, topics: ['Whole-protein overview', 'Residue comparisons', 'Variant-site context'] },
  insights: { title: 'Insights', description: 'Review the evidence assembled for a variant and how it contributes to the interpretation.', Icon: FlaskConical, topics: ['Evidence summary', 'ACMG criteria records', 'Interpretation and gaps'] },
  literature: { title: 'Literature', description: 'Find publications about the gene and variant, then inspect what each source actually reports.', Icon: BookOpen, topics: ['Published literature', 'Variant mention coverage', 'Source screening'] },
  report: { title: 'Report', description: 'Assemble the analysis into a reviewable report with evidence, sources and your commentary.', Icon: FileText, topics: ['Evidence sections', 'Author commentary', 'Document export'] },
};

export function emptyWorkspace(view: MasterView, evidenceTab: string): EmptyWorkspace | null {
  if (view === 'evidence') return { ...(EVIDENCE[evidenceTab] ?? EVIDENCE.clinical), Icon: BarChart2 };
  if (view === 'structure' || view === 'structure_alphafold' || view === 'structure_esmfold') return {
    title: '3D structure', Icon: Layers,
    description: 'Inspect the variant in a three-dimensional model and compare available wild-type and variant structures.',
    topics: [view === 'structure_esmfold' ? 'ESMFold models' : 'AlphaFold & FoldX models', 'Residue environment', 'Structure comparison'],
  };
  return WORKSPACES[view] ?? null;
}

export function AnalysisEmptyState({ workspace: { title, description, Icon, topics }, onSearch }: { workspace: EmptyWorkspace; onSearch: () => void }) {
  return <div className="analysis-empty-scroll">
    <section className="analysis-empty-workspace" aria-labelledby="empty-workspace-title">
      <header>
        <h1 id="empty-workspace-title" className="screen-title">{title}</h1>
        <p className="screen-tab-description">{description}</p>
      </header>
      <div className="analysis-empty-card">
        <div className="analysis-empty-start">
          <Icon className="analysis-empty-icon" aria-hidden="true" />
          <h2>No analysis loaded</h2>
          <p>Start with a gene and protein change, a genomic coordinate, or an rsID. The results will be available across your workspaces.</p>
          <button type="button" onClick={onSearch}>Analyse a variant <ArrowRight aria-hidden="true" /></button>
        </div>
        <div className="analysis-empty-topics">
          <h3>In this workspace</h3>
          <ul>{topics.map((topic, index) => <li key={topic}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{topic}</li>)}</ul>
          <p>Available evidence depends on the variant and source coverage.</p>
        </div>
      </div>
    </section>
  </div>;
}

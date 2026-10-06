import React from 'react';
import type { AnalysisResult } from '../../types';
import { useVariantAnalysisStore } from '../../stores/useVariantAnalysisStore';
import { buildGeneDiseaseEvidence, type ContextProvenance } from '../../shared/diseaseFrame';
import { REVIEW_SYSTEMS, ONSET_LABELS } from '../../shared/phenotypeFrame';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import { evidenceContextIdentity } from '../../shared/evidenceContextIdentity';

function Source({ provenance }: { provenance: ContextProvenance }) {
  return <section className="ctx-rail__section"><h3>{provenance.source}</h3><dl className="ctx-definition">
    <div><dt>Dataset</dt><dd>{provenance.release ?? 'Release not reported'}</dd></div>
    <div><dt>{provenance.timestampBasis === 'local-import' ? 'Imported' : provenance.timestampBasis === 'download' ? 'Retrieved' : 'Recorded'}</dt><dd className="ctx-mono">{provenance.retrievedAt.slice(0, 10)}</dd></div>
    <div><dt>Terms</dt><dd>{provenance.licence}</dd></div>
  </dl><a className="ctx-link" href={provenance.url} target="_blank" rel="noreferrer">Source endpoint</a><details className="ctx-details"><summary>Snapshot fingerprint</summary><p className="ctx-hash ctx-mono">{provenance.sha256}</p></details></section>;
}
export function EvidenceContextRail({ analysisResult, expression }: { analysisResult: AnalysisResult; expression: boolean }) {
  const state = useVariantAnalysisStore();
  const gene = analysisResult.metadata?.gene || state.gene;
  const key = evidenceContextIdentity(analysisResult, state.gene, state.variant);
  const selection = state.phenotypeSelections[key];
  const disease = state.diseaseContexts[gene]?.data ?? null;
  const evidence = buildGeneDiseaseEvidence(disease, selection?.diseaseKey ?? null);
  return <div className="ctx-rail"><section className="ctx-rail__section"><h2>Review trace</h2><ol className="ctx-trace">
    <li><strong>Disease choice</strong><p>{evidence.selected ? `${evidence.selected.label} · ${evidence.selected.inheritance.label}` : 'No disease selected.'}</p></li>
    <li><strong>{expression ? 'Review systems' : 'Assertions'}</strong><p>{expression ? selection?.systems.map(id => REVIEW_SYSTEMS.find(s => s.id === id)?.label).join(', ') || 'No systems selected; all tissues remain available.' : evidence.selected ? `${evidence.assertions.length} source assertions for this disease and inheritance.` : 'Choose a disease to review its assertions.'}</p></li>
    <li><strong>Interpretation boundary</strong><p>Context only. No ACMG criterion is added or changed.</p></li>
    {expression && <li><strong>Disease onset</strong><p>{ONSET_LABELS[selection?.onset ?? 'unknown']}. Kept separate from sampled age.</p></li>}
  </ol></section>
    {!!evidence.adverse.length && <p className="ctx-notice">This disease relationship has disputed or refuted assertions. Gene expression cannot resolve that dispute.</p>}
    {expression && <section className="ctx-rail__section"><h3>Method</h3><p>Adult GTEx v10 medians with tissue RNA-seq cohort counts. Counts are samples, not independent donors or a gene-specific detection count.</p><p>Review-system grouping is local. Onset is kept separate from sampled developmental age.</p></section>}
    {disease?.provenance && <Source provenance={disease.provenance} />}
    {disease?.mechanismContext?.provenance && <Source provenance={disease.mechanismContext.provenance} />}
    {!disease?.provenance && <p className="ctx-caption">{state.diseaseContexts[gene]?.error ?? `${!state.diseaseContexts[gene] ? 'Not requested' : state.diseaseContexts[gene]?.status === 'loading' ? ENGINE_STATE_LABELS.running : state.diseaseContexts[gene]?.status === 'error' ? ENGINE_STATE_LABELS['upstream-error'] : ENGINE_STATE_LABELS['not-installed']} — no validity-source manifest is available.`}</p>}
    {expression && state.expressionContexts[gene]?.data?.provenance && <Source provenance={state.expressionContexts[gene].data!.provenance!} />}
    {expression && state.developmentalContexts[gene]?.data?.provenance && <><section className="ctx-rail__section"><h3>Pediatric method</h3><p>dGTEx V1 uses GENCODE v47. Public age cohorts are broad and independent of onset. Donor medians are derived locally; excluded samples are omitted.</p><p>Pinned data may differ from the latest portal release.</p></section><Source provenance={state.developmentalContexts[gene].data!.provenance!} /></>}
  </div>;
}

import React from 'react';
import type { AnalysisResult } from '../../types';
import { useVariantAnalysisStore } from '../../stores/useVariantAnalysisStore';
import { buildGeneDiseaseEvidence, type ContextProvenance } from '../../shared/diseaseFrame';
import { REVIEW_SYSTEMS, ONSET_LABELS } from '../../shared/phenotypeFrame';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import { buildDosageEvidence } from '../../shared/dosageSensitivity';
import { hpoQueryIds } from '../../shared/hpoAnnotation';
import { buildExpressionFinding } from '../../shared/expressionTabEvidence';
import { evidenceContextIdentity } from '../../shared/evidenceContextIdentity';

type Slot = { status: 'loading' | 'ready' | 'error'; data: unknown; error?: string } | undefined;
const asProvenance = (value: unknown): ContextProvenance[] => {
  const p = (value as { provenance?: ContextProvenance | ContextProvenance[] | null } | null)?.provenance;
  return !p ? [] : Array.isArray(p) ? p : [p];
};
/** One word for what a source returned, in the shared engine vocabulary. */
function slotState(slot: Slot): { label: string; tone: 'good' | 'muted' | 'warning' } {
  if (!slot || slot.status === 'loading') return { label: ENGINE_STATE_LABELS.running, tone: 'muted' };
  if (slot.status === 'error') return { label: ENGINE_STATE_LABELS['upstream-error'], tone: 'warning' };
  const status = (slot.data as { status?: string } | null)?.status;
  if (status === 'not-installed') return { label: ENGINE_STATE_LABELS['not-installed'], tone: 'muted' };
  if (status === 'not-found' || status === 'no-pext') return { label: ENGINE_STATE_LABELS['no-result'], tone: 'muted' };
  if (status === 'error') return { label: ENGINE_STATE_LABELS['upstream-error'], tone: 'warning' };
  return { label: 'Read', tone: 'good' };
}
const day = (iso: string) => iso.slice(0, 10);
const basisLabel = (p: ContextProvenance) => p.timestampBasis === 'local-import' ? 'Imported' : p.timestampBasis === 'download' ? 'Retrieved' : 'Recorded';

function Step({ n, label, state, children }: { n: number; label: string; state?: 'warn'; children: React.ReactNode }) {
  return <li className="rail-step" data-state={state}>
    <span className="rail-step__n" aria-hidden="true">{n}</span>
    <div className="rail-step__body"><span className="rail-step__label">{label}</span><div className="rail-step__value">{children}</div></div>
  </li>;
}
function Provenance({ provenance }: { provenance: ContextProvenance }) {
  return <details className="xp-prov" aria-label={`${provenance.source} provenance`}>
    <summary><span className="xp-prov__name">{provenance.source}</span><span className="xp-prov__meta">{provenance.release ?? `${basisLabel(provenance)} ${day(provenance.retrievedAt)}`}</span></summary>
    <dl className="rail-kv">
      <div className="rail-kv__row"><dt>Release</dt><dd>{provenance.release ?? 'Not reported'}</dd></div>
      <div className="rail-kv__row"><dt>{basisLabel(provenance)}</dt><dd className="ctx-mono">{day(provenance.retrievedAt)}</dd></div>
      <div className="rail-kv__row"><dt>Terms</dt><dd>{provenance.licence}</dd></div>
    </dl>
    <a className="ctx-link" href={provenance.url} target="_blank" rel="noreferrer">Source endpoint</a>
    <p className="ctx-caption">Snapshot fingerprint</p><p className="ctx-hash ctx-mono">{provenance.sha256}</p>
  </details>;
}

export function EvidenceContextRail({ analysisResult, expression }: { analysisResult: AnalysisResult; expression: boolean }) {
  const state = useVariantAnalysisStore();
  const gene = analysisResult.metadata?.gene || state.gene;
  const key = evidenceContextIdentity(analysisResult, state.gene, state.variant);
  const selection = state.phenotypeSelections[key];
  const disease = state.diseaseContexts[gene]?.data ?? null;
  const evidence = buildGeneDiseaseEvidence(disease, selection?.diseaseKey ?? null);
  const dosage = buildDosageEvidence(state.dosageContexts[gene], evidence.selected?.diseaseId ?? null);
  const systems = selection?.systems ?? [];
  const extra = (kind: string, suffix = ''): Slot => state.extraContexts[`${kind}:${gene}${suffix}`];
  const hpoIds = hpoQueryIds(evidence.selected?.xrefs ?? []).join(',');
  const adult = state.expressionContexts[gene];
  const finding = buildExpressionFinding(adult?.data ?? null, adult?.status ?? null, systems);

  // Every source the tab renders is traced here, in the order the tab shows them.
  const sources: Array<{ name: string; slot: Slot; note?: string }> = expression ? [
    { name: 'GTEx adult tissues', slot: adult },
    { name: 'dGTEx pediatric', slot: state.developmentalContexts[gene] },
    { name: 'Human Protein Atlas', slot: extra('hpa') },
    { name: 'gnomAD base-level pext', slot: extra('pext') },
    { name: 'Alliance orthologs', slot: state.modelContexts[gene] },
    { name: 'IMPC mouse screen', slot: state.modelContexts[gene] ? { status: state.modelContexts[gene].status, data: (state.modelContexts[gene].data as { impc?: { status: string } | null } | null)?.impc ?? { status: 'not-found' } } : undefined },
    { name: 'Curated model phenotypes', slot: extra('phenotypes') },
    { name: 'Ensembl protein alignment', slot: extra('alignment') },
    ...(evidence.selected && hpoIds ? [{ name: 'HPO disease terms', slot: extra('hpo', hpoIds) }] : []),
  ] : [];
  const provenance: ContextProvenance[] = [
    ...(expression ? [disease, adult?.data, state.developmentalContexts[gene]?.data, extra('hpa')?.data, extra('pext')?.data, ...(state.modelContexts[gene]?.data ? [state.modelContexts[gene].data] : []), extra('phenotypes')?.data, extra('alignment')?.data, extra('hpo', hpoIds)?.data].flatMap(asProvenance) : []),
    ...(expression ? [] : [...asProvenance(disease), ...(state.dosageContexts[gene]?.data ? asProvenance(state.dosageContexts[gene].data) : []), ...asProvenance(disease?.mechanismContext)]),
  ];

  return <div className="ctx-rail">
    <section className="rail-section" aria-labelledby="ctx-rail-trace"><h3 className="eyebrow" id="ctx-rail-trace">Review trace</h3>
      <ol className="rail-steps" data-testid="context-trace">
        <Step n={1} label="Disease choice">{evidence.selected ? <>{evidence.selected.label}<span className="rail-step__sub">{evidence.selected.inheritance.label}</span></> : 'No disease selected.'}</Step>
        {expression ? <>
          <Step n={2} label="Review systems">{systems.length ? systems.map(id => REVIEW_SYSTEMS.find(s => s.id === id)?.label).join(', ') : 'None selected'}
            <span className="rail-step__sub">{systems.length ? 'Local grouping, not an HPO-to-anatomy mapping.' : 'All sampled tissues stay available.'}</span></Step>
          <Step n={3} label="Disease onset">{ONSET_LABELS[selection?.onset ?? 'unknown']}<span className="rail-step__sub">Kept separate from sampled age.</span></Step>
          <Step n={4} label="Reading">{finding.headline}<span className="rail-step__sub">{finding.predicate}</span></Step>
        </> : <>
          <Step n={2} label="Assertions">{evidence.selected ? `${evidence.assertions.length} source assertions for this disease and inheritance.` : 'Choose a disease to review its assertions.'}</Step>
        </>}
        <Step n={expression ? 5 : 3} label="Interpretation boundary">Context only<span className="rail-step__sub">No ACMG criterion is added or changed.</span></Step>
      </ol>
      {!!evidence.adverse.length && <p className="rail-step__warn" role="note">This disease relationship has disputed or refuted assertions. Gene expression cannot resolve that dispute.</p>}
    </section>

    {expression && <section className="rail-section" aria-labelledby="ctx-rail-sources"><h3 className="eyebrow" id="ctx-rail-sources">Sources read</h3>
      <dl className="rail-kv rail-kv--sources" data-testid="context-sources">{sources.map(s => { const st = slotState(s.slot);
        return <div className="rail-kv__row" key={s.name}><dt>{s.name}</dt><dd><span className="ev-tier" data-tone={st.tone === 'good' ? 'neutral' : st.tone}>{st.label}</span></dd></div>; })}</dl>
    </section>}

    <section className="rail-section" aria-labelledby="ctx-rail-method"><h3 className="eyebrow" id="ctx-rail-method">Method</h3>
      {expression ? <>
        <details className="rail-notes"><summary>How the reading is made</summary><ul>
          <li>Adult GTEx medians are bulk RNA-seq per tissue; counts are samples, not independent donors or a gene-specific detection count.</li>
          <li>The figure is the highest measured median in your systems, with its rank among sampled tissues. No expression cut-point is applied, so nothing is called expressed or not.</li>
          <li>A system GTEx does not sample is a coverage gap, never a low reading.</li></ul></details>
        {!!systems.length && <details className="rail-notes"><summary>What each system covers</summary><ul>{systems.map(id => { const s = REVIEW_SYSTEMS.find(r => r.id === id)!; return <li key={id}><strong>{s.label}</strong>: {s.anatomy}</li>; })}</ul></details>}
        <details className="rail-notes"><summary>Pediatric and model-organism notes</summary><ul>
          <li>dGTEx V1 uses GENCODE v47. Public age cohorts are broad and independent of onset. Donor medians are derived locally.</li>
          <li>Stringent Alliance orthologs are all listed. IMPC terms are top-level screen outcomes; the local system grouping is not an official mapping.</li>
          <li>Pext is a base-level maximum over transcripts, not the expression of the transcript carrying this missense.</li></ul></details>
      </> : evidence.selected && dosage.state === 'ready'
        ? <p className="rail-step__sub">ClinGen dosage scores are gene-level copy-number calls: {dosage.readings.map(r => `${r.name.toLowerCase()} ${r.code ?? r.call.toLowerCase()}`).join('; ')}. Codes 30 and 40 are special categories, not higher scores. No ACMG criterion is added.</p>
        : dosage.state === 'error' || dosage.state === 'not-found'
          ? <p className="rail-step__sub">Dosage: {dosage.state === 'error' ? `${ENGINE_STATE_LABELS['upstream-error']} — ClinGen dosage curation could not be read.` : `${ENGINE_STATE_LABELS['no-result']} — no ClinGen dosage curation for this gene.`}</p>
          : <p className="rail-step__sub">Validity levels are shown as each submitter reported them; they are not averaged into a consensus.</p>}
    </section>

    {!!provenance.length && <section className="rail-section" aria-labelledby="ctx-rail-prov"><h3 className="eyebrow" id="ctx-rail-prov">Provenance</h3><div data-testid="context-provenance">{provenance.map(p => <Provenance key={`${p.source}:${p.sha256}`} provenance={p} />)}</div></section>}
    {!expression && !disease?.provenance && <section className="rail-section"><p className="rail-step__sub">{state.diseaseContexts[gene]?.error ?? `${!state.diseaseContexts[gene] ? 'Not requested' : state.diseaseContexts[gene]?.status === 'loading' ? ENGINE_STATE_LABELS.running : state.diseaseContexts[gene]?.status === 'error' ? ENGINE_STATE_LABELS['upstream-error'] : ENGINE_STATE_LABELS['not-installed']} — no validity-source manifest is available.`}</p></section>}
  </div>;
}

import React from 'react';
import type { AnalysisResult } from '../../types';
import type { ContextProvenance } from '../../shared/diseaseFrame';
import { GeneDiseaseRail } from './GeneDiseaseRail';
import { Step, Provenance, slotState, type Slot } from './RailParts';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import { REVIEW_SYSTEMS, ONSET_LABELS } from '../../shared/phenotypeFrame';
import { pextSiteFromVariantId, locatePext } from '../../shared/pext';
import { isFallbackLocus } from '../../shared/locusResolution';
import { expressionWorkspaceFinding } from '../../shared/expressionWorkspaceFinding';
import { useEvidenceWorkspace } from '../evidence/EvidenceWorkspace';
import { useContextWorkspaceRead } from '../../hooks/useContextWorkspace';
import { EvidenceReadingInspector } from './EvidenceReadingInspector';

const asProvenance = (value: unknown): ContextProvenance[] => {
  const p = (value as { provenance?: ContextProvenance | ContextProvenance[] | null } | null)?.provenance;
  return !p ? [] : Array.isArray(p) ? p : [p];
};
export function EvidenceContextRail({ analysisResult, expression, species = false }: { analysisResult: AnalysisResult; expression: boolean; species?: boolean }) {
  return !expression && !species ? <GeneDiseaseRail analysisResult={analysisResult} /> : <ContextRail analysisResult={analysisResult} species={species} />;
}
function ContextRail({ analysisResult, species }: { analysisResult: AnalysisResult; species: boolean }) {
  const tab = species ? 'species-models' : 'expression-models';
  const { context: c, model, rows, speciesAnswer } = useContextWorkspaceRead(analysisResult, tab);
  const systems = c.selection.systems;
  const workspace = useEvidenceWorkspace(tab);
  const site = pextSiteFromVariantId(analysisResult.predictorData?.gnomadVariantId, analysisResult.predictorData?.gnomadVariantAssembly, isFallbackLocus(analysisResult));
  const reading = { section: workspace.section, adult: c.expressionLoad, developmental: c.developmentalLoad, systems, cohort: workspace.cohort };
  const finding = expressionWorkspaceFinding(workspace.view === 'protein' ? { ...reading, measure: 'protein', hpa: c.hpaLoad }
    : workspace.view === 'pext' ? { ...reading, measure: 'pext', pext: {
      load: c.pextLoad?.status ?? null, status: c.pextLoad?.data?.status ?? null,
      location: locatePext(c.pextLoad?.data ?? null, site), regionCount: c.pextLoad?.data?.regions.length ?? 0,
    } } : reading);
  // A completed read that found no mouse ortholog must not display "No result": the card explains
  // "not applicable" plainly, and the rail now says the same thing instead of implying an empty record.
  const impcState = (() => {
    if (!c.modelLoad || c.modelLoad.status === 'loading') return { label: ENGINE_STATE_LABELS.running, tone: 'muted' as const };
    if (c.modelLoad.status === 'error') return { label: ENGINE_STATE_LABELS['upstream-error'], tone: 'warning' as const };
    const payload = c.modelLoad.data;
    // Only a ready read that has no mouse ortholog may say so; a gene the Alliance read could not
    // resolve ("not-found") says nothing about any ortholog.
    if (payload?.status !== 'ready') return { label: 'Not applicable — gene not resolved', tone: 'muted' as const };
    if (!payload.impc) return { label: 'Not applicable — no mouse ortholog', tone: 'muted' as const };
    if (payload.impc.status === 'ready') return { label: 'Available', tone: 'good' as const };
    if (payload.impc.status === 'error') return { label: ENGINE_STATE_LABELS['upstream-error'], tone: 'warning' as const };
    return { label: ENGINE_STATE_LABELS['no-result'], tone: 'muted' as const };
  })();
  const sources: Array<{ name: string; slot: Slot; state?: { label: string; tone: 'good' | 'muted' | 'warning' } }> = species ? [
    { name: 'Alliance orthologs', slot: c.modelLoad },
    { name: 'IMPC mouse screen', slot: c.modelLoad, state: impcState },
    { name: 'Curated model phenotypes', slot: c.phenotypesLoad },
    { name: 'Ensembl protein alignment', slot: c.alignmentLoad },
  ] : [
    { name: 'GTEx adult tissues', slot: c.expressionLoad },
    { name: 'dGTEx pediatric', slot: c.developmentalLoad },
    { name: 'Human Protein Atlas', slot: c.hpaLoad },
    { name: 'gnomAD base-level pext', slot: c.pextLoad },
  ];
  if (model.selected && c.hpoIds) sources.push({ name: 'HPO disease terms', slot: c.hpoLoad });
  const provenance = [...new Map([c.diseaseLoad?.data, ...sources.map(s => s.slot?.data)].flatMap(asProvenance).map(p => [`${p.source}:${p.sha256}`, p])).values()];
  const trace = <section className="rail-section" aria-labelledby="ctx-rail-trace"><h3 className="eyebrow" id="ctx-rail-trace">Review trace</h3>
      <ol className="rail-steps" data-testid="context-trace">
        <Step n={1} label="Disease choice">{model.selected ? <>{model.selected.label}<span className="rail-step__sub">{model.selected.inheritance.label}</span></> : 'No disease selected.'}</Step>
        <Step n={2} label="Body systems">{systems.length ? systems.map(id => REVIEW_SYSTEMS.find(s => s.id === id)?.label).join(', ') : 'All systems'}<span className="rail-step__sub">{systems.length ? 'Local display grouping, not an ontology equivalence.' : 'None chosen. Local display grouping, not an ontology equivalence.'}</span></Step>
        {/* Onset changes no species reading (animal records carry no age here), so the step is Expression's only. */}
        {!species && <Step n={3} label="Disease onset">{ONSET_LABELS[c.selection.onset]}<span className="rail-step__sub">Kept separate from sampled age.</span></Step>}
        <Step n={species ? 3 : 4} label="Reading">{species ? speciesAnswer?.headline : <>{finding.headline}<span className="rail-step__sub">{finding.detail}</span></>}</Step>
        <Step n={species ? 4 : 5} label="Interpretation boundary">Context only<span className="rail-step__sub">No ACMG criterion is added or changed.</span></Step>
      </ol>
      {model.assertions.some(a => a.adverse) && <p className="rail-step__warn" role="note">This disease relationship has disputed, refuted or no-known-relationship assertions. Context cannot resolve that dispute.</p>}
    </section>;
  return <div className={species ? 'ctx-rail' : 'ctx-rail xp-rail'}>
    <EvidenceReadingInspector tab={tab} rows={rows} flatNotes={!species} />
    {/* The trace's last step states the ACMG boundary, so no separate boundary line repeats it. */}
    {trace}
    {!species && model.assertions.some(a => a.adverse) && <p className="rail-step__warn" role="note">The selected disease has disputed, refuted or no-known-relationship assertions. Expression cannot resolve that dispute.</p>}
    <section className="rail-section" aria-labelledby="ctx-rail-sources"><h3 className="eyebrow" id="ctx-rail-sources">Sources</h3>
      <dl className="rail-kv rail-kv--sources" data-testid="context-sources">{sources.map(s => { const st = s.state ?? slotState(s.slot); return <div className="rail-kv__row" key={s.name}><dt>{s.name}</dt><dd><span className="ev-tier" data-tone={st.tone}>{st.label}</span></dd></div>; })}</dl>
    </section>
    <section className="rail-section" aria-labelledby="ctx-rail-method"><h3 className="eyebrow" id="ctx-rail-method">Method</h3>
      {/* Expression shows its method flat: four short notes do not need a fold. Species keeps its disclosure. */}
      {species ? <details className="rail-notes"><summary>How the reading is made</summary><ul>
        <li>All returned orthologs remain separate. Sharing a species does not prove that two providers refer to the same ortholog.</li>
        <li>Residue mapping requires the analysed human sequence and reference residue to match the alignment. When Ensembl aligns another isoform, the site is placed only if the 21 residues around it occur exactly once in that isoform. Gaps never become substitutions.</li>
        <li>uPheno term overlap is disease-annotation context, not patient phenotype similarity. Missing model annotations do not establish normality.</li>
        <li>IMPC summaries do not provide assay, allele, sex, age or sample count here. No functional ACMG criterion follows from these summaries.</li>
      </ul></details> : <div className="rail-notes xp-rail-notes"><ul>
        <li>Adult GTEx medians are bulk RNA-seq per tissue; counts are samples, not independent donors or a gene-specific detection count.</li>
        <li>No expression cut-point is applied. Zero is a measurement; missing coverage is not a low reading.</li>
        <li>dGTEx uses medians across donors after within-donor medians for repeated samples.</li>
      </ul></div>}
      {!!systems.length && (species
        ? <details className="rail-notes"><summary>What each system covers</summary><ul>{systems.map(id => { const s = REVIEW_SYSTEMS.find(r => r.id === id)!; return <li key={id}><strong>{s.label}</strong>: {s.anatomy}</li>; })}</ul></details>
        : <div className="rail-notes xp-rail-notes"><p className="xp-rail-notes__title">What each system covers</p><ul>{systems.map(id => { const s = REVIEW_SYSTEMS.find(r => r.id === id)!; return <li key={id}><strong>{s.label}</strong>: {s.anatomy}</li>; })}</ul></div>)}
    </section>
    {!!provenance.length && <section className="rail-section" aria-labelledby="ctx-rail-prov"><h3 className="eyebrow" id="ctx-rail-prov">Provenance</h3><div data-testid="context-provenance">{species ? provenance.map(p => <Provenance key={`${p.source}:${p.sha256}`} provenance={p} />) : <table className="xp-provenance-table"><caption className="ctx-sr-only">Source releases and retrieval details</caption><thead><tr><th scope="col">Source</th><th scope="col">Release / date</th></tr></thead><tbody>{provenance.map(p => <tr key={`${p.source}:${p.sha256}`}><th scope="row">{p.source}</th><td><Provenance provenance={p} name="" /></td></tr>)}</tbody></table>}</div></section>}
  </div>;
}

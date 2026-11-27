import React, { useId } from 'react';
import { matchedNames, orderSpecies, splitByDiseaseMatch, type ModelPhenotypesResponse, type ModelPhenotype } from '../../shared/modelPhenotypes';
import { speciesLabel } from '../../shared/modelOrganisms';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';
import { matchesQuery, phenotypeKey } from '../../shared/contextWorkspace';
import { InspectReadingButton, useEvidenceWorkspace } from './EvidenceWorkspace';
import { SpeciesRecordFilter } from './species/SpeciesRecordFilter';

function Rows({ rows, terms, keyOf }: { rows: ModelPhenotype[]; terms: Map<string, string>; keyOf: (p: ModelPhenotype) => string }) {
  return <ul className="ctx-terms">{rows.map((p, i) => { const names = matchedNames(p, terms);
    // The index keeps the key unique: Alliance can return two records with the same term and statement
    // (different model records), and the reading builder (contextWorkspace) keys the same way.
    return <li key={`${p.termId}:${p.statement}:${i}`} className="ctx-pheno"><span><InspectReadingButton tab="species-models" readingKey={keyOf(p)}>{p.statement}</InspectReadingButton><span className="ctx-caption ctx-block"><span className="ctx-mono">{p.termId}</span> · {p.annotations} annotation{p.annotations === 1 ? '' : 's'}{p.models ? ` · ${p.models} model${p.models === 1 ? '' : 's'}` : ''}</span></span>
      {names.length > 0 && <span className="ctx-cell" data-cell="significant">Same phenotype as: {names.join(', ')}</span>}</li>; })}</ul>;
}

export function ModelPhenotypesCard({ load, diseaseTerms, diseaseName, diseaseKey = null, onRetry }: {
  load?: ContextLoad<ModelPhenotypesResponse>; diseaseTerms: Map<string, string>; diseaseName: string | null; onRetry: () => void;
  /** The chosen disease; part of each phenotype's reading key, so a pin opens the same record in the inspector. */
  diseaseKey?: string | null;
}) {
  const id = useId();
  const data = load?.data ?? null;
  const species = orderSpecies(data?.species ?? []);
  const w = useEvidenceWorkspace('species-models');
  const overlapAvailable = data?.mapping === 'available' && diseaseTerms.size > 0;
  const overlapOnly = overlapAvailable && w.relevantOnly;
  const filtering = !!w.query.trim() || overlapOnly;
  // A species that matches the search keeps all its phenotypes; otherwise only matching phenotypes stay.
  // Species left with nothing to show are dropped while a filter is on. Counts in each summary stay whole.
  const listed = species.map(s => {
    const speciesHit = matchesQuery(w.query, [speciesLabel(s.taxonId, s.species), s.taxonId, s.symbol, s.orthologId]);
    const split = splitByDiseaseMatch(s.phenotypes, diseaseTerms);
    const keep = (p: ModelPhenotype) => speciesHit || matchesQuery(w.query, [p.statement, p.termId]);
    return { s, speciesHit, matchCount: split.matched.length, matched: split.matched.filter(keep), other: overlapOnly ? [] : split.other.filter(keep) };
  }).filter(x => !filtering || x.matched.length + x.other.length > 0 || (x.speciesHit && !overlapOnly));
  const phenotypeTotal = species.reduce((n, s) => n + s.phenotypes.length, 0);
  return <section className="ctx-card" aria-labelledby={id} data-testid="model-phenotypes-card">
    <div className="ctx-card__head"><h2 id={id}>Curated model phenotypes</h2><span className="ctx-caption">Alliance · uPheno matches</span></div>
    {!load || load.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading curated phenotypes for each ortholog.</div>
      : load.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — ${data?.message ?? 'phenotypes could not be read.'}`}</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : data?.status !== 'ready' ? <p className="ctx-card__body">{data?.message}</p>
      : <>
        <div className="ctx-card__body sm-phenotype-summary">{diseaseName
          ? <><span className="sm-summary-label">Disease phenotype comparison</span><strong>{diseaseName}</strong><p>Matching disease traits are marked. A shared trait does not establish that the gene causes this disease.</p></>
          : <>Choose a disease to mark phenotypes that match its HPO terms.</>}
        {data.mapping === 'unavailable' && <span className="ctx-block ctx-caption">The uPheno match table could not be read, so no cross-species matches are shown.</span>}</div>
        {!species.length && <p className="ctx-card__body">No ortholog in a covered organism.</p>}
        {species.length > 0 && <SpeciesRecordFilter shown={listed.reduce((n, x) => n + x.matched.length + x.other.length, 0)} total={phenotypeTotal} noun="phenotype records" placeholder="Species, symbol or phenotype" overlap={{ available: overlapAvailable }} />}
        {filtering && !listed.length && <p className="ctx-card__body">No phenotype record matches these filters.</p>}
        {listed.map(({ s, matchCount, matched, other }) => { const keyOf = (p: ModelPhenotype) => phenotypeKey(diseaseKey, s.orthologId, p.termId, s.phenotypes.indexOf(p));
          return <details key={s.orthologId} className="ctx-details ctx-details--table" open={matched.length > 0 || (filtering && other.length > 0)}>
            <summary>{speciesLabel(s.taxonId, s.species)} <span className="ctx-mono">{s.symbol}</span> <span className="ctx-caption">· {s.status === 'error' ? 'could not be read' : `${s.phenotypes.length} displayed / ${s.total} ${s.total === 1 ? 'summary' : 'summaries'}${matchCount ? ` · ${matchCount} match${matchCount === 1 ? '' : 'es'}` : ''}`}</span></summary>
            {s.status === 'error' ? <p className="ctx-card__body ctx-notice"><span>{ENGINE_STATE_LABELS['upstream-error']} — this ortholog was not read completely.</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></p>
              : !s.total ? <p className="ctx-card__body ctx-caption">No curated phenotype annotation. That is not evidence of a normal organism.</p>
              : <>{s.total > s.phenotypes.length && <p className="ctx-card__body sm-partial-note">{s.total - s.phenotypes.length} {s.total - s.phenotypes.length === 1 ? 'summary has' : 'summaries have'} no resolved phenotype terms in this response. {s.phenotypes.length ? 'The available terms are listed below.' : 'No term details can be displayed; this is not a negative phenotype result.'}</p>}{matched.length > 0 && <Rows rows={matched} terms={diseaseTerms} keyOf={keyOf} />}
                {other.length > 0 && (matched.length ? <details className="ctx-details ctx-details--table"><summary>Other curated phenotypes ({other.length})</summary><Rows rows={other} terms={diseaseTerms} keyOf={keyOf} /></details> : <Rows rows={other} terms={diseaseTerms} keyOf={keyOf} />)}</>}
          </details>; })}
      </>}
    <p className="ctx-card__foot">Positive curations only, from allele and genotype records; an empty list means nothing curated. Morpholino and other perturbations carry their own artefact risks. Model phenotypes are not automatically PS3/BS3 and cast no ACMG vote.</p>
  </section>;
}

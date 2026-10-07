import React, { useId } from 'react';
import { matchedNames, orderSpecies, splitByDiseaseMatch, type ModelPhenotypesResponse, type ModelPhenotype } from '../../shared/modelPhenotypes';
import { speciesLabel } from '../../shared/modelOrganisms';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';

function Rows({ rows, terms }: { rows: ModelPhenotype[]; terms: Map<string, string> }) {
  return <ul className="ctx-terms">{rows.map(p => { const names = matchedNames(p, terms);
    return <li key={p.termId} className="ctx-pheno"><span>{p.statement}<span className="ctx-caption ctx-block"><span className="ctx-mono">{p.termId}</span> · {p.annotations} annotation{p.annotations === 1 ? '' : 's'}{p.models ? ` · ${p.models} model${p.models === 1 ? '' : 's'}` : ''}</span></span>
      {names.length > 0 && <span className="ctx-cell" data-cell="significant">Same phenotype as: {names.join(', ')}</span>}</li>; })}</ul>;
}

export function ModelPhenotypesCard({ load, diseaseTerms, diseaseName, onRetry }: {
  load?: ContextLoad<ModelPhenotypesResponse>; diseaseTerms: Map<string, string>; diseaseName: string | null; onRetry: () => void;
}) {
  const id = useId();
  const data = load?.data ?? null;
  const species = orderSpecies(data?.species ?? []);
  return <section className="ctx-card" aria-labelledby={id} data-testid="model-phenotypes-card">
    <div className="ctx-card__head"><h2 id={id}>Curated model phenotypes</h2><span className="ctx-caption">Alliance · uPheno matches</span></div>
    {!load || load.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading curated phenotypes for each ortholog.</div>
      : load.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — ${data?.message ?? 'phenotypes could not be read.'}`}</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : data?.status !== 'ready' ? <p className="ctx-card__body">{data?.message}</p>
      : <>
        <p className="ctx-card__body ctx-prose">{diseaseName
          ? <>Phenotypes the animal models share with the HPO terms of <strong>{diseaseName}</strong> are marked. A shared phenotype shows the same trait was recorded; it does not show the gene causes this disease.</>
          : <>Choose a disease to mark phenotypes that match its HPO terms.</>}
        {data.mapping === 'unavailable' && <span className="ctx-block ctx-caption">The uPheno match table could not be read, so no cross-species matches are shown.</span>}</p>
        {!species.length && <p className="ctx-card__body">No ortholog in a covered organism.</p>}
        {species.map(s => { const { matched, other } = splitByDiseaseMatch(s.phenotypes, diseaseTerms);
          return <details key={s.orthologId} className="ctx-details ctx-details--table" open={matched.length > 0}>
            <summary>{speciesLabel(s.taxonId, s.species)} <span className="ctx-mono">{s.symbol}</span> <span className="ctx-caption">· {s.status === 'error' ? 'could not be read' : `${s.total} curated${matched.length ? ` · ${matched.length} match${matched.length === 1 ? '' : 'es'}` : ''}`}</span></summary>
            {s.status === 'error' ? <p className="ctx-card__body ctx-notice"><span>{ENGINE_STATE_LABELS['upstream-error']} — this ortholog was not read completely.</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></p>
              : !s.total ? <p className="ctx-card__body ctx-caption">No curated phenotype annotation. That is not evidence of a normal organism.</p>
              : <>{matched.length > 0 && <Rows rows={matched} terms={diseaseTerms} />}
                {other.length > 0 && (matched.length ? <details className="ctx-details ctx-details--table"><summary>Other curated phenotypes ({other.length})</summary><Rows rows={other} terms={diseaseTerms} /></details> : <Rows rows={other} terms={diseaseTerms} />)}</>}
          </details>; })}
      </>}
    <p className="ctx-card__foot">Positive curations only, from allele and genotype records; an empty list means nothing curated. Morpholino and other perturbations carry their own artefact risks. Model phenotypes are not automatically PS3/BS3 and cast no ACMG vote.</p>
  </section>;
}

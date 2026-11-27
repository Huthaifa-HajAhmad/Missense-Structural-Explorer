import React, { useId } from 'react';
import { buildModelEvidence, type ModelOrganismResponse, type Ortholog } from '../../shared/modelOrganisms';
import type { ReviewSystemId } from '../../shared/phenotypeFrame';
import { matchesQuery, orthologKey } from '../../shared/contextWorkspace';
import { InspectReadingButton, useEvidenceWorkspace } from './EvidenceWorkspace';
import { SpeciesRecordFilter } from './species/SpeciesRecordFilter';
import { MouseScreenPlot } from './species/MouseScreenPlot';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';

const matchLabel = (o: Ortholog) => o.bestForward && o.bestReverse ? 'Best match both directions' : o.bestForward || o.bestReverse ? 'Best match one direction' : o.bestForward === null || o.bestReverse === null ? 'Match direction not fully reported' : 'Not a best match';
const SCREEN_NOTE = 'IMPC top-level categories from the mouse knockout screen. Choose a system to read its categories. Procedures, allele, sex and age are not shown here.';

function OrthologTable({ groups }: { groups: Array<ReturnType<typeof buildModelEvidence>['groups'][number] & { total: number }> }) {
  return <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label="Orthologs in model organisms"><table className="ctx-table">
    <caption className="ctx-sr-only">Stringent Alliance orthologs of the human gene. A species can have several.</caption>
    <thead><tr><th scope="col">Organism</th><th scope="col">Ortholog</th><th scope="col">Alliance match</th><th scope="col" className="ctx-num">Methods</th></tr></thead>
    <tbody>{groups.flatMap(g => g.rows.map((o, i) => <tr key={o.id}>
      {i === 0 && <th scope="row" rowSpan={g.rows.length}>{g.species}{g.oneToMany && <span className="ctx-caption ctx-block">{g.total} orthologs</span>}</th>}
      <td><InspectReadingButton tab="species-models" readingKey={orthologKey(o.taxonId, o.id)}><span className="ctx-mono">{o.symbol}</span></InspectReadingButton><span className="ctx-caption ctx-block ctx-mono">{o.id}</span></td>
      <td>{matchLabel(o)}{o.confidence && <span className="ctx-caption ctx-block">{o.confidence[0].toUpperCase() + o.confidence.slice(1)} confidence</span>}</td>
      <td className="ctx-num ctx-mono">{o.methodCount}</td>
    </tr>))}</tbody>
  </table></div>;
}

export function ModelOrganismsCard({ load, systems, onRetry }: { load?: ContextLoad<ModelOrganismResponse>; systems: ReviewSystemId[]; onRetry: () => void }) {
  const id = useId();
  const data = load?.data ?? null;
  const evidence = buildModelEvidence(data, systems);
  const { query } = useEvidenceWorkspace('species-models');
  // Search narrows the rows; each species keeps its full ortholog count beside its name.
  const shown = evidence.groups.map(g => ({ ...g, total: g.rows.length, rows: g.rows.filter(o => matchesQuery(query, [g.species, o.taxonId, o.symbol, o.id])) })).filter(g => g.rows.length);
  const orthologCount = evidence.groups.reduce((n, g) => n + g.rows.length, 0);
  return <section className="ctx-card" aria-labelledby={id} data-testid="model-organisms-card">
    <div className="ctx-card__head"><h2 id={id}>Model organisms</h2><span className="ctx-caption">Alliance orthologs · IMPC mouse screen</span></div>
    {!load || load.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading orthologs and mouse screening.</div>
      : load.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — ${data?.message ?? 'orthologs could not be read.'}`}</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : data?.status === 'not-found' ? <p className="ctx-card__body">{data.message}</p>
      : evidence.noOrtholog ? <p className="ctx-card__body">No stringent ortholog in a complete Alliance response. This does not mean the pathway is absent in model organisms.</p>
      : evidence.ready && <>
        <SpeciesRecordFilter shown={shown.reduce((n, g) => n + g.rows.length, 0)} total={orthologCount} noun="orthologs" placeholder="Species, taxon or symbol" />
        {shown.length ? <OrthologTable groups={shown} /> : <p className="ctx-card__body">No ortholog matches this search.</p>}
        <div className="ctx-card__body sm-screen-heading">
          <h3 className="ctx-subhead">Mouse knockout screen</h3><p className="ctx-caption">{SCREEN_NOTE}</p>
          {data?.impc === null ? <p className="ctx-prose">No mouse ortholog, so no IMPC screen to read.</p>
            : data?.impc?.status === 'error' ? <p className="ctx-notice"><span>{ENGINE_STATE_LABELS['upstream-error']} — IMPC did not respond.</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></p>
            : data?.impc?.status === 'not-found' ? <p className="ctx-prose">IMPC has no record for the mouse ortholog.</p>
            : evidence.screens.length === 0 ? <p className="ctx-prose">No mouse screen records were returned.</p> : null}
        </div>
        {evidence.screens.map(screen => <div key={screen.mgiId} className="sm-mouse-screen">
          <p className="ctx-card__body sm-screen-note">{screen.phenotypingDataAvailable === true
            ? <>IMPC phenotyped <span className="ctx-mono">{screen.symbol}</span>. “No significant difference” means no effect was detected in the procedures run, not that the mouse is normal.</>
            : screen.phenotypingDataAvailable === false ? <>IMPC has not phenotyped <span className="ctx-mono">{screen.symbol}</span> ({screen.phenotypeStatus ?? 'status not reported'}). Absence of data is not a normal result.</>
            : <>Phenotyping availability is not reported for <span className="ctx-mono">{screen.symbol}</span>. This is not a confirmed untested or normal result.</>}
            {screen.embryoDataAvailable === false && screen.phenotypingDataAvailable === true ? ' No embryo screening data.' : ''}</p>
          {screen.phenotypingDataAvailable === true && <MouseScreenPlot screen={screen} systems={systems} />}
        </div>)}
      </>}
    <p className="ctx-card__foot">Orthology is predicted, not proof of equal function. Mouse and other model phenotypes are context only: they are not automatically PS3/BS3 and cast no ACMG vote.</p>
  </section>;
}

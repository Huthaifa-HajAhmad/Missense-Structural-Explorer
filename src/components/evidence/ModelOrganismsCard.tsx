import React, { useId } from 'react';
import { buildModelEvidence, screenCellForSystem, SCREEN_CELL_LABEL, unmappedScreenTerms, type ModelOrganismResponse, type Ortholog } from '../../shared/modelOrganisms';
import { REVIEW_SYSTEMS, type ReviewSystemId } from '../../shared/phenotypeFrame';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';

const matchLabel = (o: Ortholog) => o.bestForward && o.bestReverse ? 'Best match both directions' : o.bestForward || o.bestReverse ? 'Best match one direction' : 'Not a best match';
const SCREEN_NOTE = 'IMPC top-level terms, mouse knockout screen. Procedures, allele, sex and age are not shown here.';

function OrthologTable({ groups }: { groups: ReturnType<typeof buildModelEvidence>['groups'] }) {
  return <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label="Orthologs in model organisms"><table className="ctx-table">
    <caption className="ctx-sr-only">Stringent Alliance orthologs of the human gene. A species can have several.</caption>
    <thead><tr><th scope="col">Organism</th><th scope="col">Ortholog</th><th scope="col">Alliance match</th><th scope="col" className="ctx-num">Methods</th></tr></thead>
    <tbody>{groups.flatMap(g => g.rows.map((o, i) => <tr key={o.id}>
      {i === 0 && <th scope="row" rowSpan={g.rows.length}>{g.species}{g.oneToMany && <span className="ctx-caption ctx-block">{g.rows.length} orthologs</span>}</th>}
      <td><span className="ctx-mono">{o.symbol}</span><span className="ctx-caption ctx-block ctx-mono">{o.id}</span></td>
      <td>{matchLabel(o)}{o.confidence && <span className="ctx-caption ctx-block">{o.confidence[0].toUpperCase() + o.confidence.slice(1)} confidence</span>}</td>
      <td className="ctx-num ctx-mono">{o.methodCount}</td>
    </tr>))}</tbody>
  </table></div>;
}

function ScreenGrid({ evidence, systems }: { evidence: ReturnType<typeof buildModelEvidence>; systems: ReviewSystemId[] }) {
  const first = evidence.screens[0];
  if (!first) return null;
  const rows = REVIEW_SYSTEMS.filter(s => systems.includes(s.id));
  const rest = REVIEW_SYSTEMS.filter(s => !systems.includes(s.id));
  const table = (list: readonly (typeof REVIEW_SYSTEMS)[number][], label: string) => <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label={label}><table className="ctx-table">
    <caption className="ctx-sr-only">{SCREEN_NOTE}</caption>
    <thead><tr><th scope="col">System</th><th scope="col">Mouse screen ({first.symbol})</th></tr></thead>
    <tbody>{list.map(s => { const cell = screenCellForSystem(first, s.id);
      return <tr key={s.id}><th scope="row">{s.label}</th><td><span className="ctx-cell" data-cell={cell}>{SCREEN_CELL_LABEL[cell]}</span></td></tr>; })}</tbody>
  </table></div>;
  const stray = unmappedScreenTerms(first);
  return <>
    {rows.length > 0 && table(rows, 'Mouse screen for your review systems')}
    {rest.length > 0 && (rows.length
      ? <details className="ctx-details ctx-details--table"><summary>Other systems ({rest.length})</summary>{table(rest, 'Mouse screen for other systems')}</details>
      : table(rest, 'Mouse screen by system'))}
    {!!stray.length && <p className="ctx-card__body ctx-caption">Also reported, outside the local grouping: {stray.join(', ')}.</p>}
  </>;
}

export function ModelOrganismsCard({ load, systems, onRetry }: { load?: ContextLoad<ModelOrganismResponse>; systems: ReviewSystemId[]; onRetry: () => void }) {
  const id = useId();
  const data = load?.data ?? null;
  const evidence = buildModelEvidence(data, systems);
  const first = evidence.screens[0];
  return <section className="ctx-card" aria-labelledby={id} data-testid="model-organisms-card">
    <div className="ctx-card__head"><h2 id={id}>Model organisms</h2><span className="ctx-caption">Alliance orthologs · IMPC mouse screen</span></div>
    {!load || load.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading orthologs and mouse screening.</div>
      : load.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — ${data?.message ?? 'orthologs could not be read.'}`}</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : data?.status === 'not-found' ? <p className="ctx-card__body">{data.message}</p>
      : evidence.noOrtholog ? <p className="ctx-card__body">No stringent ortholog in a complete Alliance response. This does not mean the pathway is absent in model organisms.</p>
      : evidence.ready && <>
        <OrthologTable groups={evidence.groups} />
        <div className="ctx-card__body">
          <h3 className="ctx-subhead">Mouse knockout screen</h3>
          {data?.impc === null ? <p className="ctx-prose">No mouse ortholog, so no IMPC screen to read.</p>
            : data?.impc?.status === 'error' ? <p className="ctx-notice"><span>{ENGINE_STATE_LABELS['upstream-error']} — IMPC did not respond.</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></p>
            : data?.impc?.status === 'not-found' ? <p className="ctx-prose">IMPC has no record for the mouse ortholog.</p>
            : first && <p className="ctx-prose">{first.phenotypingDataAvailable
              ? <>IMPC phenotyped <span className="ctx-mono">{first.symbol}</span>. “No significant difference” means no effect was detected in the procedures run, not that the mouse is normal.</>
              : <>IMPC has not phenotyped <span className="ctx-mono">{first.symbol}</span> ({first.phenotypeStatus ?? 'status not reported'}). Absence of data is not a normal result.</>}</p>}
        </div>
        {first?.phenotypingDataAvailable && <ScreenGrid evidence={evidence} systems={systems} />}
      </>}
    <p className="ctx-card__foot">Orthology is predicted, not proof of equal function. Mouse and other model phenotypes are context only: they are not automatically PS3/BS3 and cast no ACMG vote.{first?.embryoDataAvailable === false && first.phenotypingDataAvailable ? ' No embryo screening data.' : ''} {SCREEN_NOTE}</p>
  </section>;
}

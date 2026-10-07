import React, { useId } from 'react';
import { locatePext, orderPextTissues, pextTissueLabel, type PextResponse, type PextSite } from '../../shared/pext';
import type { ReviewSystemId } from '../../shared/phenotypeFrame';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';
import { MeasureBar, PextStrip } from './ContextCharts';

const LOCATION_NOTE = {
  'no-locus': 'This analysis has no verified GRCh38 position, so the variant cannot be placed on the coding regions.',
  'other-chromosome': 'The variant position is on a different chromosome than the gnomAD gene record, so it is not placed.',
  'no-region': 'This position is outside the coding regions that pext covers (UTR or intron). No region means no value, not zero.',
} as const;

function TissueBars({ tissues, labels }: { tissues: Array<{ tissue: string; value: number | null }>; labels: Map<string, string> }) {
  return <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label="Base-level pext by tissue"><table className="ctx-table">
    <caption className="ctx-sr-only">Base-level pext in this coding region, one value per GTEx v10 tissue.</caption>
    <thead><tr><th scope="col">Tissue</th><th scope="col" className="ctx-num">Base-level pext</th></tr></thead>
    <tbody>{tissues.map(t => <tr key={t.tissue}><th scope="row">{labels.get(t.tissue) ?? pextTissueLabel(t.tissue)}</th>
      <td className="ctx-num"><span className="ctx-mono">{t.value === null ? 'No value' : t.value.toFixed(2)}</span><MeasureBar value={t.value} max={1} label={`pext ${t.value ?? 'unreported'}`} /></td></tr>)}</tbody>
  </table></div>;
}

/** `tissueLabels` maps gnomAD's snake_case tissue ids to the GTEx names the adult table shows, so one tissue has one name. */
export function PextCard({ load, site, systems, tissueLabels = new Map(), onRetry }: { load?: ContextLoad<PextResponse>; site: PextSite | null; systems: ReviewSystemId[]; tissueLabels?: Map<string, string>; onRetry: () => void }) {
  const id = useId();
  const data = load?.data ?? null;
  const location = locatePext(data, site);
  const tissues = location.region ? orderPextTissues(location.region, systems) : null;
  // Tied values make a "top 8" arbitrary, so say so instead of listing identical rows.
  const values = new Set((location.region?.tissues ?? []).map(t => t.value === null ? null : t.value.toFixed(2)));
  const uniform = values.size === 1 && !values.has(null) ? [...values][0] : null;
  return <section className="ctx-card" aria-labelledby={id} data-testid="pext-card">
    <div className="ctx-card__head"><h2 id={id}>Base-level pext</h2><span className="ctx-caption">gnomAD v4 · GTEx v10 · coding regions</span></div>
    {!load || load.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading pext.</div>
      : load.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — ${data?.message ?? 'pext could not be read.'}`}</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : data?.status === 'not-found' || data?.status === 'no-pext' ? <p className="ctx-card__body">{data.message}</p>
      : data && <>
        {data.flags.includes('low_max_pext') && <p className="ctx-card__body ctx-notice" role="status">gnomAD flags this gene as <span className="ctx-mono">low_max_pext</span>: no region reaches a meaningful pext, so its values are weak evidence of coding expression.</p>}
        <div className="ctx-card__body">
          <PextStrip regions={data.regions} activeIndex={location.index} position={site?.pos ?? null} />
          <p className="ctx-caption">{data.regions.length} coding {data.regions.length === 1 ? 'region' : 'regions'} in order, width by coding length, darker = higher mean pext across tissues. Introns are not drawn.</p>
          {location.state !== 'region' && <p className="ctx-prose">{LOCATION_NOTE[location.state]}</p>}
        </div>
        {tissues && <>
          {!!tissues.relevant.length && <TissueBars tissues={tissues.relevant} labels={tissueLabels} />}
          {!!tissues.other.length && (tissues.relevant.length
            ? <details className="ctx-details ctx-details--table"><summary>Other tissues ({tissues.other.length})</summary><TissueBars tissues={tissues.other} labels={tissueLabels} /></details>
            : uniform
              ? <p className="ctx-card__body">All {tissues.other.length} tissues have base-level pext <span className="ctx-mono">{uniform}</span> in this region, so there is no ranking to show.</p>
              : <TissueBars tissues={tissues.other.slice(0, 8)} labels={tissueLabels} />)}
          {!tissues.relevant.length && tissues.other.length > (uniform ? 0 : 8) && <details className="ctx-details ctx-details--table"><summary>All {tissues.other.length} tissues</summary><TissueBars tissues={tissues.other} labels={tissueLabels} /></details>}
        </>}
      </>}
    <p className="ctx-card__foot">Base-level pext is a maximum over every transcript touching the base. It does not show that the transcript carrying this missense is expressed, and no cut-point is applied. Tissue count comes from the response; tissues with too few GTEx samples are excluded. Context only.</p>
  </section>;
}

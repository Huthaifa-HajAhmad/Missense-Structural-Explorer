import React, { useId } from 'react';
import type { HpaMeasure, HpaResponse } from '../../shared/hpa';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';
import { MeasureBar, maxOf } from './ContextCharts';

const cap = (s: string) => s.replace(/^./, c => c.toUpperCase());
function Measures({ rows, unit, caption }: { rows: HpaMeasure[]; unit: string; caption: string }) {
  const max = maxOf(rows.map(r => r.value));
  return <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label={caption}><table className="ctx-table">
    <caption className="ctx-sr-only">{caption}. Only the enriched entries HPA lists; unlisted is not zero.</caption>
    <thead><tr><th scope="col">{unit === 'nCPM' ? 'Cell type' : 'Tissue'}</th><th scope="col" className="ctx-num">{unit}</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.name}><th scope="row">{cap(r.name)}</th><td className="ctx-num"><span className="ctx-mono">{r.value.toLocaleString(undefined, { maximumSignificantDigits: 4 })}</span><MeasureBar value={r.value} max={max} label={`${r.name}: ${r.value} ${unit}`} /></td></tr>)}</tbody>
  </table></div>;
}

export function HpaCard({ load, onRetry }: { load?: ContextLoad<HpaResponse>; onRetry: () => void }) {
  const id = useId();
  const data = load?.data ?? null;
  return <section className="ctx-card" aria-labelledby={id} data-testid="hpa-card">
    <div className="ctx-card__head"><h2 id={id}>Protein Atlas</h2><span className="ctx-caption">HPA · tissue, cell type and protein</span></div>
    {!load || load.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading the Human Protein Atlas.</div>
      : load.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — ${data?.message ?? 'the atlas could not be read.'}`}</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : data?.status !== 'ready' || !data.rna || !data.cells || !data.protein ? <p className="ctx-card__body">{data?.message}</p>
      : <>
        <dl className="ctx-definition">
          <div><dt>RNA, tissue</dt><dd>{data.rna.specificity ?? 'Not reported'}<span className="ctx-caption ctx-block">{data.rna.distribution ?? 'Distribution not reported'}</span></dd></div>
          <div><dt>RNA, cell type</dt><dd>{data.cells.specificity ?? 'Not reported'}<span className="ctx-caption ctx-block">{data.cells.distribution ?? 'Distribution not reported'}</span></dd></div>
          <div><dt>Protein</dt><dd>{data.protein.evidence ?? 'Evidence level not reported'}<span className="ctx-caption ctx-block">Tissue pattern: {data.protein.tissueSpecificity ?? 'not reported'}</span></dd></div>
          <div><dt>Antibodies</dt><dd>{data.protein.antibodies.length ? <><span className="ctx-mono">{data.protein.antibodies.join(', ')}</span><span className="ctx-caption ctx-block">Immunohistochemistry reliability: {data.protein.reliabilityIhc ?? 'not reported'} · immunofluorescence: {data.protein.reliabilityIf ?? 'not reported'}</span></> : 'None listed'}</dd></div>
        </dl>
        {data.cells.enrichedCells.length > 0 && <><p className="ctx-card__body ctx-caption">Cell types with enriched expression (single-cell RNA, nCPM). This covers cell types GTEx bulk tissue cannot resolve, such as retinal photoreceptors.</p><Measures rows={data.cells.enrichedCells} unit="nCPM" caption="Enriched cell types" /></>}
        {data.rna.enrichedTissues.length > 0 && <><p className="ctx-card__body ctx-caption">Tissues with enriched expression (nTPM).</p><Measures rows={data.rna.enrichedTissues} unit="nTPM" caption="Enriched tissues" /></>}
        {!data.cells.enrichedCells.length && !data.rna.enrichedTissues.length && <p className="ctx-card__body ctx-caption">HPA lists no enriched tissue or cell type for this gene.</p>}
      </>}
    <p className="ctx-card__foot">HPA tissue RNA is a consensus that includes GTEx, so it does not replicate the adult table above. nTPM and nCPM are different scales and are not compared. Protein evidence is about the gene product, not this variant. Context only.</p>
  </section>;
}

import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { GeneDiseaseModel, AssertionRow } from '../../shared/geneDiseaseEvidence';
import { safeExternalHref } from '../../shared/externalLink';
import { VALIDITY_SCALE, validityPosition, validityTone } from '../../shared/diseaseFrame';
import type { DosageReading } from '../../shared/dosageSensitivity';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import { OrdinalScale } from './ContextCharts';

const DOSAGE_LEVELS = ['0', '1', '2', '3'] as const;
const SCOPE_NOTE: Record<DosageReading['scope'], string> = {
  'same-disease': 'Curated for the selected disease (exact MONDO ID).',
  'other-disease': 'Curated for a different disease than the one selected.',
  unscoped: 'Disease not matched to the selection: no MONDO ID on one side.',
};

function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <tr className="gd-empty"><td colSpan={5}><strong>{title}</strong>{children && <span className="gd-empty__reason">{children}</span>}{action}</td></tr>;
}
function AssertionLine({ a }: { a: AssertionRow }) {
  return <tr data-adverse={a.adverse || undefined}>
    <th scope="row">{a.submitter}{a.expertPanel && <span className="gd-caption gd-block">Expert panel curation</span>}</th>
    <td><span className="ev-tier" data-tone={validityTone(a.level)}>{a.level}</span></td>
    <td><OrdinalScale levels={VALIDITY_SCALE} index={validityPosition(a.level)} label={`${a.submitter} classification`} /></td>
    <td>{(() => { const href = safeExternalHref(a.reportUrl); return href
      ? <a className="ctx-link" href={href} target="_blank" rel="noreferrer">Report<span className="ctx-sr-only"> from {a.submitter} (opens in a new tab)</span><ExternalLink size={12} aria-hidden="true" /></a>
      : <span className="gd-caption">Not linked</span>; })()}</td>
    <td className="gd-mono">{a.evaluatedAt ?? <span className="gd-caption">Not reported</span>}</td>
  </tr>;
}
function DosageLine({ r, evaluatedAt }: { r: DosageReading; evaluatedAt: string | null }) {
  return <tr>
    <th scope="row">{r.name}<span className="gd-caption gd-block">{r.asks}</span></th>
    <td><span className="ev-tier" data-tone={r.tone}>{r.call}</span></td>
    <td>{r.code !== null && r.code <= 3
      ? <OrdinalScale levels={DOSAGE_LEVELS} index={r.code} quiet={r.code === 0} label={`${r.name} evidence score`} />
      : <span className="gd-caption">{r.code === null ? 'Not scored' : 'Special category'}</span>}</td>
    <td>{r.disease
      ? <>{r.disease}{r.diseaseId && <span className="gd-caption gd-block gd-mono">{r.diseaseId}</span>}<span className="gd-caption gd-block">{SCOPE_NOTE[r.scope]}</span>{r.history && <span className="gd-caption gd-block">{r.history}</span>}</>
      : <span className="gd-caption">{r.code === 0 ? 'Nothing curated; not a finding of tolerance.' : 'No disease curated for this score.'}</span>}</td>
    <td className="gd-mono">{evaluatedAt ?? <span className="gd-caption">Not reported</span>}</td>
  </tr>;
}

export function GeneDiseaseReadings({ model, onRetryDosage }: { model: GeneDiseaseModel; onRetryDosage?: () => void }) {
  const { dosage, sources } = model;
  const gencc = sources.gencc;
  return <div className="gd-card gd-readings" data-testid="gene-disease-readings">
    <div className="gd-table-wrap" tabIndex={0} role="region" aria-label="Gene–disease evidence readings">
      <table className="gd-table">
        <thead><tr><th scope="col">Source</th><th scope="col">Reading</th><th scope="col">Position</th><th scope="col">Detail</th><th scope="col">Date</th></tr></thead>
        <tbody data-testid="validity-rows">
          <tr className="gd-group"><th colSpan={5} scope="rowgroup">Causality · GenCC, each submitter retained</th></tr>
          {model.assertions.map(a => <AssertionLine key={a.id} a={a} />)}
          {!model.assertions.length && (
            model.verdict.kind === 'loading' ? <Empty title={ENGINE_STATE_LABELS.running}>Reading GenCC validity assertions.</Empty>
              : !gencc.available && !model.frameCount
              ? <Empty title={`GenCC ${gencc.label.toLowerCase()}`}>Disease-level validity is not readable on this server; the reason and a retry are in the disease choice above.</Empty>
              : !model.selected && !model.frameCount ? <Empty title="No curated disease">The installed snapshot lists no disease for this gene, so there are no validity assertions to read.</Empty>
              : !model.selected ? <Empty title="No disease chosen">Choose a disease above to read its validity assertions.</Empty>
              : <Empty title={`${ENGINE_STATE_LABELS['no-result']} — not curated`}>{model.sentence}</Empty>)}
        </tbody>
        <tbody data-testid="dosage-card">
          <tr className="gd-group"><th colSpan={5} scope="rowgroup">Dosage sensitivity · ClinGen, whole-gene copy number</th></tr>
          {dosage.state === 'ready' && dosage.readings.map(r => <DosageLine key={r.key} r={r} evaluatedAt={dosage.evaluatedAt} />)}
          {(dosage.state === 'loading' || dosage.state === 'not-requested') && <Empty title={ENGINE_STATE_LABELS.running}>Reading ClinGen dosage curation.</Empty>}
          {dosage.state === 'not-found' && <Empty title={ENGINE_STATE_LABELS['no-result']}>{dosage.message ?? 'No ClinGen dosage curation for this gene.'}</Empty>}
          {dosage.state === 'error' && <Empty title={ENGINE_STATE_LABELS['upstream-error']} action={onRetryDosage && <button type="button" className="ctx-button" onClick={onRetryDosage}>Try again</button>}>{sources.dosage.reason ?? 'ClinGen dosage curation could not be read.'}</Empty>}
        </tbody>
      </table>
    </div>
    <p className="gd-foot">
      <span>Levels are shown as submitted; the position marks one submitter’s level on GenCC’s scale and is never averaged or ranked into a consensus.
        {' '}Dosage is gene-level copy-number evidence{dosage.evaluatedAt ? `, last evaluated ${dosage.evaluatedAt}` : ''}. It does not show whether this missense change loses function, and casts no ACMG vote.</span>
      {(() => { const href = safeExternalHref(dosage.reportUrl); return href
        ? <a className="ctx-link" href={href} target="_blank" rel="noreferrer">ClinGen curation<span className="ctx-sr-only"> (opens in a new tab)</span><ExternalLink size={12} aria-hidden="true" /></a>
        : null; })()}
    </p>
  </div>;
}

import React from 'react';
import type { ContextProvenance } from '../../shared/diseaseFrame';
import { safeExternalHref } from '../../shared/externalLink';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';

export type Slot = { status: 'loading' | 'ready' | 'error'; data: unknown; error?: string } | undefined;
/** One word for what a source returned, in the shared engine vocabulary. */
export function slotState(slot: Slot): { label: string; tone: 'good' | 'muted' | 'warning' } {
  if (!slot || slot.status === 'loading') return { label: ENGINE_STATE_LABELS.running, tone: 'muted' };
  if (slot.status === 'error') return { label: ENGINE_STATE_LABELS['upstream-error'], tone: 'warning' };
  const status = (slot.data as { status?: string } | null)?.status;
  if (status === 'not-installed') return { label: ENGINE_STATE_LABELS['not-installed'], tone: 'muted' };
  if (status === 'not-found' || status === 'no-pext') return { label: ENGINE_STATE_LABELS['no-result'], tone: 'muted' };
  if (status === 'error') return { label: ENGINE_STATE_LABELS['upstream-error'], tone: 'warning' };
  return { label: 'Read', tone: 'good' };
}
/** Shared by both evidence-context rails, so the Gene–disease and Expression traces read identically. */
const day = (iso: string) => iso.slice(0, 10);
const basisLabel = (p: ContextProvenance) => p.timestampBasis === 'local-import' ? 'Imported' : p.timestampBasis === 'download' ? 'Retrieved' : 'Recorded';

export function Step({ n, label, state, children }: { n: number; label: string; state?: 'warn'; children: React.ReactNode }) {
  return <li className="rail-step" data-state={state}>
    <span className="rail-step__n" aria-hidden="true">{n}</span>
    <div className="rail-step__body"><span className="rail-step__label">{label}</span><div className="rail-step__value">{children}</div></div>
  </li>;
}

/** `rolling`: a live table with no release number (ClinGen dosage); each record carries its own date. */
export function Provenance({ provenance, rolling = false }: { provenance: ContextProvenance; rolling?: boolean }) {
  return <details className="xp-prov" aria-label={`${provenance.source} provenance`}>
    <summary><span className="xp-prov__name">{provenance.source}</span><span className="xp-prov__meta">{provenance.release ?? (rolling ? 'Rolling table' : `${basisLabel(provenance)} ${day(provenance.retrievedAt)}`)}</span></summary>
    <dl className="rail-kv">
      <div className="rail-kv__row"><dt>Release</dt><dd>{provenance.release ?? (rolling ? 'Rolling table; per-gene dates' : 'Not reported')}</dd></div>
      <div className="rail-kv__row"><dt>{basisLabel(provenance)}</dt><dd className="ctx-mono">{day(provenance.retrievedAt)}</dd></div>
      <div className="rail-kv__row"><dt>Terms</dt><dd>{provenance.licence}</dd></div>
    </dl>
    {(() => { const href = safeExternalHref(provenance.url); return href
      ? <a className="ctx-link" href={href} target="_blank" rel="noreferrer">Source endpoint<span className="ctx-sr-only"> (opens in a new tab)</span></a>
      : <span className="ctx-caption">Source endpoint: {provenance.url || "not provided"}</span>; })()}
    <p className="ctx-caption">Snapshot fingerprint</p><p className="ctx-hash ctx-mono">{provenance.sha256}</p>
  </details>;
}

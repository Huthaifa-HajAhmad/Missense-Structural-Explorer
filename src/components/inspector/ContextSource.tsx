import React from 'react';
import type { ContextProvenance } from '../../shared/diseaseFrame';

/** `rolling`: a live table with no release number (ClinGen dosage); each record carries its own evaluation date. */
export function ContextSource({ provenance, rolling = false }: { provenance: ContextProvenance; rolling?: boolean }) {
  return <section className="ctx-rail__section"><h3>{provenance.source}</h3><dl className="ctx-definition">
    <div><dt>Dataset</dt><dd>{provenance.release ?? (rolling ? 'Rolling table; per-gene dates' : 'Release not reported')}</dd></div>
    <div><dt>{provenance.timestampBasis === 'local-import' ? 'Imported' : provenance.timestampBasis === 'download' ? 'Retrieved' : 'Recorded'}</dt><dd className="ctx-mono">{provenance.retrievedAt.slice(0, 10)}</dd></div>
    <div><dt>Terms</dt><dd>{provenance.licence}</dd></div>
  </dl><a className="ctx-link" href={provenance.url} target="_blank" rel="noreferrer">Source endpoint</a><details className="ctx-details"><summary>Snapshot fingerprint</summary><p className="ctx-hash ctx-mono">{provenance.sha256}</p></details></section>;
}

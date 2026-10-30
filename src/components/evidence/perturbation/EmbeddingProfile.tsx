import React from 'react';
import type { PerturbationEvidence } from '../../../shared/perturbationEvidence';

/** Measured positions only; missing values break the line instead of becoming zero. */
export function EmbeddingProfile({ evidence }: { evidence: PerturbationEvidence }) {
  const e = evidence.esm3;
  if (!e || !e.perPosition.some(p => p.value !== null)) return null;
  const site = evidence.residues.position;
  const end = Math.max(e.perPosition.length, site ?? 1, 2);
  const max = Math.max(e.drift ?? 0, 0.001);
  const x = (position: number) => 40 + (position - 1) / (end - 1) * 520;
  const y = (value: number) => 150 - value / max * 120;
  let previousMeasured = false;
  const path = e.perPosition.map(p => {
    if (p.value === null) { previousMeasured = false; return ''; }
    const segment = `${previousMeasured ? 'L' : 'M'}${x(p.position)},${y(p.value)}`;
    previousMeasured = true;
    return segment;
  }).join(' ');
  // An isolated measured residue has no neighbour to draw a line to, so it gets a dot.
  const isolated = (i: number) => e.perPosition[i - 1]?.value == null && e.perPosition[i + 1]?.value == null;
  return <figure className="ptb-card ptb-embedding-profile" data-testid="ptb-embedding-profile">
    <figcaption>{e.label} along the sequence · cosine distance between original and substituted sequence</figcaption>
    <svg viewBox="0 0 600 185" role="img" aria-label={`${e.label} by residue position, cosine distance. Exact values are listed under "Exact changes by position".`}>
      <path d="M40 25 V150 H560" fill="none" stroke="currentColor" />
      <path d={path} fill="none" stroke="var(--cs-accent-clay)" strokeWidth="2" />
      {e.perPosition.map((p, i) => p.value !== null && (p.position === e.driftResidue || isolated(i))
        ? <circle key={p.position} cx={x(p.position)} cy={y(p.value)} r="3" fill="var(--cs-accent-clay)" />
        : null)}
      <text x="34" y="30" textAnchor="end">{max.toPrecision(2)}</text><text x="34" y="154" textAnchor="end">0</text>
      <text x="40" y="177">1</text><text x={x(end)} y="177" textAnchor="end">{end}</text>
      {site !== null && <line x1={x(site)} x2={x(site)} y1="25" y2="150" stroke="currentColor" strokeDasharray="4 3" />}
    </svg>
    <p>
      Horizontal axis: residue position. {site !== null ? `Dashed line: the substituted residue, ${site}. ` : ''}
      Largest change: {e.drift?.toPrecision(3)}{e.driftResidue !== null ? ` at residue ${e.driftResidue}` : ''}.
      {e.coverage ? ` Measured at ${e.coverage.measured.toLocaleString('en-GB')} of ${e.coverage.total.toLocaleString('en-GB')} residues${e.coverage.measured < e.coverage.total ? '; the rest appear as gaps' : ''}.` : ''}{' '}
      A larger value is a larger change in the model&apos;s description of that residue, not a larger disease risk.{' '}
      This profile uses cosine distance; the residue-detail trace in Model comparison uses Euclidean distance, so the two scales cannot be compared.
    </p>
    <details>
      <summary>Exact changes by position</summary>
      <div className="ptb-profile-values" tabIndex={0} role="region" aria-label="Exact changes by position">
        <table>
          <caption className="ptb-sr-only">{e.label}, cosine distance per residue</caption>
          <thead><tr><th scope="col">Position</th><th scope="col">Cosine distance</th></tr></thead>
          <tbody>{e.perPosition.map(p => <tr key={p.position}><td>{p.position}</td><td>{p.value === null ? 'Not measured' : p.value.toPrecision(4)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  </figure>;
}

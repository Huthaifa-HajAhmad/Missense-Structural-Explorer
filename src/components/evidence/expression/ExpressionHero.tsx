import React from 'react';
import { Layers } from 'lucide-react';
import type { ExpressionFinding, SourceFact } from '../../../shared/expressionTabEvidence';

const EARLY_ONSET = ['antenatal', 'congenital', 'neonatal', 'infantile', 'childhood', 'juvenile'];
export const onsetNeedsCaveat = (onset: string) => EARLY_ONSET.includes(onset);

/** The finding: how far the measurements reach the reviewer's systems. Context only, no ACMG vote. */
export function ExpressionHero({ finding, facts, onset }: { finding: ExpressionFinding; facts: SourceFact[]; onset: string }) {
  return <section className="ctx-card xp-hero" aria-labelledby="xp-finding-title" data-testid="expression-finding">
    <div className="xp-hero__body">
      <div className="xp-hero__top">
        <span className="ctx-eyebrow xp-eyebrow" id="xp-finding-title"><Layers size={14} aria-hidden="true" />Where is the gene measured?</span>
      </div>
      {finding.figure !== null && <div className="xp-hero__figure">
        <span className="xp-figure">{finding.figure.toLocaleString(undefined, { maximumSignificantDigits: 4 })}<span className="xp-figure__unit"> TPM</span></span>
        {finding.figureLabel && <span className="xp-hero__figure-label">{finding.figureLabel}</span>}
      </div>}
      <p className="ctx-prose xp-hero__finding"><strong>{finding.headline}</strong> — {finding.predicate}</p>
      {!!finding.coverage.length && <ul className="xp-coverage" aria-label="Review systems and GTEx coverage">{finding.coverage.map(c =>
        <li key={c.id} className="xp-coverage__cell" data-state={c.state}>
          <span className="xp-coverage__name">{c.label}</span>
          <span className="xp-coverage__value">{c.top ? <><span className="ctx-mono">{c.top.value === null ? '—' : c.top.value.toLocaleString(undefined, { maximumSignificantDigits: 4 })}</span> TPM</> : 'Not sampled'}</span>
          <span className="xp-coverage__sub">{c.top ? c.top.label : 'No GTEx tissue'}</span>
        </li>)}</ul>}
      {onsetNeedsCaveat(onset) && <p className="xp-callout" role="status">Disease onset is separate from sampled age. Adult GTEx does not cover this onset period, and the public pediatric cohorts cannot establish exact-age or prenatal coverage.</p>}
    </div>
    <dl className="xp-facts">{facts.map(f => <div key={f.key} className="xp-fact" data-tone={f.tone}>
      <dt>{f.label}</dt><dd><span className="xp-fact__value">{f.value}</span><span className="xp-fact__sub">{f.sub}</span></dd></div>)}</dl>
  </section>;
}

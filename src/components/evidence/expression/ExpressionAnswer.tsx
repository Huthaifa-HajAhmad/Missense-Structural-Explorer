import type { SourceFact, SystemCoverage } from '../../../shared/expressionTabEvidence';
import type { ExpressionWorkspaceFinding } from '../../../shared/expressionWorkspaceFinding';

const EARLY_ONSET = ['antenatal', 'congenital', 'neonatal', 'infantile', 'childhood', 'juvenile'];
const onsetNeedsCaveat = (onset: string) => EARLY_ONSET.includes(onset);
const fmt = (n: number) => n.toLocaleString(undefined, { maximumSignificantDigits: 4 });

/**
 * The tab's answer: where the gene is measured (the open RNA source), then one line per source.
 * The rail's "Reading" step renders the same `answer`, so the two never disagree. Context only:
 * no expression cut-point, no ACMG criterion.
 */
export function ExpressionAnswer({ answer, coverage, facts, onset }: {
  answer: ExpressionWorkspaceFinding; coverage: SystemCoverage[]; facts: SourceFact[]; onset: string;
}) {
  return <section className="xp-answer" aria-label="Expression summary" data-testid="expression-finding">
    <p className="xp-answer__source">{answer.source}</p>
    <p className="xp-answer__headline">{answer.headline}</p>
    <p className="xp-answer__detail">{answer.detail}</p>
    {coverage.length > 0 && <ul className="xp-coverage" aria-label="Review systems and GTEx coverage">{coverage.map(c =>
      <li key={c.id} className="xp-coverage__cell" data-state={c.state}>
        <span className="xp-coverage__name">{c.label}</span>
        <span className="xp-coverage__value">{c.top ? <><span className="ctx-mono">{c.top.value === null ? '—' : fmt(c.top.value)}</span> TPM</> : c.state === 'no-reading' ? 'No gene reading' : 'Not sampled'}</span>
        <span className="xp-coverage__sub">{c.top ? c.top.label : c.state === 'no-reading' ? 'Tissue returned without a median' : 'No GTEx tissue'}</span>
      </li>)}</ul>}
    <dl className="xp-answer__facts">{facts.map(f => <div key={f.key} data-tone={f.tone}>
      <dt>{f.label}</dt><dd><span className="xp-answer__value">{f.value}</span><span className="xp-answer__sub">{f.sub}</span></dd></div>)}</dl>
    {onsetNeedsCaveat(onset) && <p className="xp-callout" role="note">Disease onset is separate from sampled age. Adult GTEx does not cover this onset period, and the public pediatric cohorts cannot establish exact-age or prenatal coverage.</p>}
  </section>;
}

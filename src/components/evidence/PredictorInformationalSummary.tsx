import React from 'react';
import { LOCAL_AGREEMENT_COPY, localPredictorAgreement, type PredictorEvidence, type PredictorReading } from '../../shared/predictorEvidence';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import { InspectReadingButton } from './EvidenceWorkspace';

type SummaryHeading = 'h3' | 'h4';

/**
 * Keep informational readings separate by meaning in both the workspace and inspector.
 *
 * `compact` is the Comparison card. The chart's own "outside the comparison" card already lists every
 * non-voting reading with its value, so repeating the names here would show each reading twice; the
 * compact form states only what the readings say together (coverage, sequence preference, how to read
 * them). The records view and the inspector keep the per-reading lists, because they are read without the chart.
 */
export function PredictorInformationalSummary({
  evidence,
  headingLevel = 'h4',
  compact = false,
}: {
  evidence: PredictorEvidence;
  headingLevel?: SummaryHeading;
  compact?: boolean;
}) {
  const agreement = localPredictorAgreement(evidence);
  if (compact) {
    return <dl className="prd-agreement" data-testid="predictor-agreement-summary">
      <div><dt>Coverage</dt><dd>{agreement.scored} of {agreement.total} non-voting readings scored.</dd></div>
      <div><dt>Sequence preference</dt><dd>{agreement.preferenceSummary}</dd></div>
      <div><dt>How to read</dt><dd>{LOCAL_AGREEMENT_COPY.descriptive} {agreement.preferenceCaveat}</dd></div>
    </dl>;
  }
  const Heading = headingLevel;
  // "Not scored" would be a false completed state while an analysis is still producing readings.
  const notScoredHeading = agreement.missing.some(reading => reading.availability.state === 'pending')
    ? 'Not yet returned'
    : 'Not scored';
  const score = (reading: PredictorReading) =>
    <span className="prd-context__score">{reading.scoreText}{reading.unit ? ` ${reading.unit}` : ''}</span>;
  return <div className="prd-context">
    <p>{agreement.descriptive}</p>
    <div className="prd-context__groups">
      {agreement.calibrated.length > 0 && <section><Heading>Published bands / not counted</Heading><dl>{agreement.calibrated.map(({ reading, label }) => <div key={reading.key}><dt><InspectReadingButton tab="predictors" readingKey={reading.key}>{reading.name}</InspectReadingButton></dt><dd>{score(reading)}<span>{label}</span></dd></div>)}</dl></section>}
      <section><Heading>Sequence preference</Heading><p>{agreement.preferenceSummary}</p>{agreement.preference.length > 0 && <dl>{agreement.preference.map(({ reading, label }) => <div key={reading.key}><dt><InspectReadingButton tab="predictors" readingKey={reading.key}>{reading.name}</InspectReadingButton></dt><dd>{score(reading)}<span>{label}</span></dd></div>)}</dl>}</section>
      {agreement.unclassified.length > 0 && <section><Heading>Other scores</Heading><p>No sequence-preference reading: these scores measure different properties.</p><dl>{agreement.unclassified.map(reading => <div key={reading.key}><dt><InspectReadingButton tab="predictors" readingKey={reading.key}>{reading.name}</InspectReadingButton></dt><dd>{score(reading)}<span>{reading.callLabel}</span></dd></div>)}</dl></section>}
      {agreement.missing.length > 0 && <section><Heading>{notScoredHeading}</Heading><dl>{agreement.missing.map(reading => <div key={reading.key}><dt><InspectReadingButton tab="predictors" readingKey={reading.key}>{reading.name}</InspectReadingButton></dt><dd>{reading.availability.label ?? ENGINE_STATE_LABELS['no-result']}</dd></div>)}</dl></section>}
    </div>
    <p>{agreement.preferenceCaveat}</p>
  </div>;
}

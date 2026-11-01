import React from 'react';
import { localPredictorAgreement, type PredictorEvidence, type PredictorReading } from '../../shared/predictorEvidence';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import { InspectReadingButton } from './EvidenceWorkspace';

type SummaryHeading = 'h3' | 'h4';

/**
 * Keep informational readings separate by meaning in both the workspace and inspector.
 *
 * `showScores` is off on the Comparison card, where the chart's own unplotted list already carries
 * every value; the summary there explains the groups and keeps the selectable names. The records
 * view and the inspector keep the values, because they are the surfaces read without the chart.
 */
export function PredictorInformationalSummary({
  evidence,
  headingLevel = 'h4',
  showScores = true,
}: {
  evidence: PredictorEvidence;
  headingLevel?: SummaryHeading;
  showScores?: boolean;
}) {
  const agreement = localPredictorAgreement(evidence);
  const Heading = headingLevel;
  const score = (reading: PredictorReading) =>
    showScores ? <span className="prd-context__score">{reading.scoreText}{reading.unit ? ` ${reading.unit}` : ''}</span> : null;
  return <div className="prd-context">
    <p>{agreement.descriptive}</p>
    {!showScores && <p className="prd-context__hint">Exact scores are in the comparison above; select a model to inspect its scale and source.</p>}
    <div className="prd-context__groups">
      {agreement.calibrated.length > 0 && <section><Heading>Published bands / not counted</Heading><dl>{agreement.calibrated.map(({ reading, label }) => <div key={reading.key}><dt><InspectReadingButton tab="predictors" readingKey={reading.key}>{reading.name}</InspectReadingButton></dt><dd>{score(reading)}<span>{label}</span></dd></div>)}</dl></section>}
      <section><Heading>Sequence preference</Heading><p>{agreement.preferenceSummary}</p>{agreement.preference.length > 0 && <dl>{agreement.preference.map(({ reading, label }) => <div key={reading.key}><dt><InspectReadingButton tab="predictors" readingKey={reading.key}>{reading.name}</InspectReadingButton></dt><dd>{score(reading)}<span>{label}</span></dd></div>)}</dl>}</section>
      {agreement.unclassified.length > 0 && <section><Heading>Other scores</Heading><p>No sequence-preference reading: these scores measure different properties.</p><dl>{agreement.unclassified.map(reading => <div key={reading.key}><dt><InspectReadingButton tab="predictors" readingKey={reading.key}>{reading.name}</InspectReadingButton></dt><dd>{score(reading)}<span>{reading.callLabel}</span></dd></div>)}</dl></section>}
      {agreement.missing.length > 0 && <section><Heading>Not scored</Heading><dl>{agreement.missing.map(reading => <div key={reading.key}><dt><InspectReadingButton tab="predictors" readingKey={reading.key}>{reading.name}</InspectReadingButton></dt><dd>{reading.availability.label ?? ENGINE_STATE_LABELS['no-result']}</dd></div>)}</dl></section>}
    </div>
    <p>{agreement.preferenceCaveat}</p>
  </div>;
}
